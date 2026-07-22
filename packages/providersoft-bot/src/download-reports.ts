import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { ProviderSoftCredentials } from './credentials.js';
import { downloadOneReportHttp, downloadReportsViaHttp } from './http-download.js';
import { PsHttpClient } from './ps-http-client.js';
import {
  ALL_BOT_KINDS,
  BOT_REPORT_FILENAMES,
  defaultDateRange,
  isDailyReport,
  loadReportUserIds,
  loginUrl,
  REPORT_DATE_INPUTS,
  REPORT_LINK_NAMES,
  reportViewUrl,
  type BotReportKind,
  type ReportUserIds,
} from './report-config.js';
import type { LocalDownloadResult } from './stub-reports.js';
export type { LocalDownloadResult } from './stub-reports.js';
export { writeStubReports } from './stub-reports.js';
import { DownloadFailureError } from './errors.js';

/** 1 initial attempt + 2 retries, then HTTP backend fallback. */
const PLAYWRIGHT_ATTEMPTS = 3;

/** ProviderSoft ASP.NET postbacks are slow — generous defaults. */
const TIMEOUT = {
  action: 60_000,
  navigation: 120_000,
  download: 180_000,
  settle: 45_000,
} as const;

export type TrainStep =
  | 'launch'
  | 'login'
  | 'navigate_report'
  | 'modify'
  | 'dates'
  | 'export'
  | 'retry'
  | 'http'
  | 'done'
  | 'skip';

export interface DateRange {
  from: string;
  to: string;
}

export interface DownloadReportsOptions {
  credentials: ProviderSoftCredentials;
  downloadDir: string;
  headless?: boolean;
  /** Which reports to download. Default: all four bot kinds. */
  kinds?: BotReportKind[];
  reportIds?: ReportUserIds;
  /**
   * Optional override for **daily** reports only.
   * API Report always uses past-week → today unless `dateRanges.verified_sessions` is set.
   */
  dateRange?: DateRange;
  /** Per-kind date overrides (escape hatch). */
  dateRanges?: Partial<Record<BotReportKind, DateRange>>;
  onStep?: (step: TrainStep, detail: string) => void;
  keepOpen?: boolean;
  /** Disable HTTP fallback after Playwright retries (default: false = allow fallback). */
  disableHttpFallback?: boolean;
}

function log(
  onStep: DownloadReportsOptions['onStep'],
  step: TrainStep,
  detail: string,
): void {
  onStep?.(step, detail);
}

/** Wait for ASP.NET page to finish loading after a postback. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: TIMEOUT.settle }).catch(() => undefined);
  await page.waitForTimeout(750);
}

async function clickReady(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: TIMEOUT.action });
  await locator.click({ timeout: TIMEOUT.action });
}

async function fillReady(locator: Locator, value: string): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: TIMEOUT.action });
  await locator.click({ timeout: TIMEOUT.action });
  await locator.fill(value, { timeout: TIMEOUT.action });
}

async function login(
  page: Page,
  creds: ProviderSoftCredentials,
  onStep?: DownloadReportsOptions['onStep'],
): Promise<void> {
  const url = loginUrl(creds.baseUrl);
  log(onStep, 'login', `goto ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT.navigation });
  await settle(page);

  await fillReady(page.locator('#unametxt'), creds.username);
  await fillReady(page.locator('#passtxt'), creds.password);

  log(onStep, 'login', 'submit credentials');
  await clickReady(page.getByRole('button', { name: 'Login' }));
  await settle(page);

  if (/login\.aspx/i.test(page.url())) {
    throw new DownloadFailureError({
      stage: 'login',
      cause: `Playwright login rejected credentials — still on login page ${page.url()}`,
    });
  }
  log(onStep, 'login', `ok → ${page.url()}`);
}

async function openReportsMenu(page: Page): Promise<void> {
  const reports = page.getByRole('link', { name: 'ReportsReports' });
  if (await reports.count()) {
    await clickReady(reports.first());
    await settle(page);
    return;
  }
  await clickReady(page.getByRole('link', { name: /Reports/i }).first());
  await settle(page);
}

async function openReportPage(
  page: Page,
  kind: BotReportKind,
  baseUrl: string,
  reportIds: ReportUserIds,
  onStep?: DownloadReportsOptions['onStep'],
): Promise<void> {
  const id = reportIds[kind];
  if (id) {
    const url = reportViewUrl(baseUrl, id);
    log(onStep, 'navigate_report', `${kind} via UserReportId=${id}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT.navigation });
    await settle(page);
    return;
  }

  log(onStep, 'navigate_report', `${kind} via Reports → ${REPORT_LINK_NAMES[kind]}`);
  await openReportsMenu(page);
  await clickReady(
    page.getByRole('link', { name: REPORT_LINK_NAMES[kind], exact: false }).first(),
  );
  await settle(page);
}

/**
 * Wizard path from codegen:
 * Modify Report → Next → set dates → Next → Next → Export to Excel
 */
async function modifyDatesAndExport(
  page: Page,
  kind: BotReportKind,
  downloadDir: string,
  range: DateRange,
  onStep?: DownloadReportsOptions['onStep'],
): Promise<string> {
  log(onStep, 'modify', `${kind}: Modify Report`);
  await clickReady(page.getByRole('button', { name: 'Modify Report' }));
  await settle(page);

  await clickReady(page.getByRole('button', { name: 'Next >>' }));
  await settle(page);

  const inputs = REPORT_DATE_INPUTS[kind];
  log(onStep, 'dates', `${kind}: ${range.from} → ${range.to}`);
  await fillReady(page.locator(inputs.from), range.from);
  await fillReady(page.locator(inputs.to), range.to);

  await clickReady(page.getByRole('button', { name: 'Next >>' }));
  await settle(page);
  await clickReady(page.getByRole('button', { name: 'Next >>' }));
  await settle(page);

  const exportBtn = page.getByRole('button', { name: 'Export to Excel' });
  await exportBtn.waitFor({ state: 'visible', timeout: TIMEOUT.action });

  log(onStep, 'export', `Export to Excel (${kind})`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: TIMEOUT.download }),
    exportBtn.click({ timeout: TIMEOUT.action }),
  ]);

  const suggested = download.suggestedFilename();
  const ext = path.extname(suggested) || '.csv';
  const target = path.join(downloadDir, `${BOT_REPORT_FILENAMES[kind]}${ext}`);
  await download.saveAs(target);
  log(onStep, 'export', `saved ${target} (suggested: ${suggested})`);
  return target;
}

export interface InteractiveSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

async function launchSession(
  options: DownloadReportsOptions,
): Promise<InteractiveSession> {
  log(options.onStep, 'launch', `headless=${options.headless ?? true}`);
  const inLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const browser = await chromium.launch({
    headless: options.headless ?? true,
    args: inLambda
      ? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--no-zygote',
        ]
      : undefined,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  context.setDefaultTimeout(TIMEOUT.action);
  context.setDefaultNavigationTimeout(TIMEOUT.navigation);
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

function resolveKinds(options: DownloadReportsOptions): BotReportKind[] {
  if (options.kinds?.length) return options.kinds;
  return [...ALL_BOT_KINDS];
}

function resolveRange(
  kind: BotReportKind,
  options: DownloadReportsOptions,
): DateRange {
  if (options.dateRanges?.[kind]) return options.dateRanges[kind]!;
  if (options.dateRange && isDailyReport(kind)) return options.dateRange;
  return defaultDateRange(kind);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function downloadOneWithRetries(
  page: Page,
  kind: BotReportKind,
  options: DownloadReportsOptions,
  reportIds: ReportUserIds,
  range: DateRange,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PLAYWRIGHT_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        log(
          options.onStep,
          'retry',
          `${kind}: Playwright attempt ${attempt}/${PLAYWRIGHT_ATTEMPTS}`,
        );
        await sleep(1500 * (attempt - 1));
      }
      await openReportPage(
        page,
        kind,
        options.credentials.baseUrl,
        reportIds,
        options.onStep,
      );
      return await modifyDatesAndExport(
        page,
        kind,
        options.downloadDir,
        range,
        options.onStep,
      );
    } catch (err) {
      lastError = err;
      log(
        options.onStep,
        'retry',
        `${kind}: attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (options.disableHttpFallback) {
    throw new DownloadFailureError({
      stage: 'playwright_report',
      reportKind: kind,
      attempts: PLAYWRIGHT_ATTEMPTS,
      cause: lastError,
    });
  }

  const id = reportIds[kind];
  if (!id) {
    throw new DownloadFailureError({
      stage: 'http_fallback',
      reportKind: kind,
      attempts: PLAYWRIGHT_ATTEMPTS,
      cause:
        `${kind}: Playwright failed ${PLAYWRIGHT_ATTEMPTS} time(s) and no UserReportId configured for HTTP fallback. ` +
        `Set PROVIDERSOFT_REPORT_*_ID. Last Playwright error: ${lastError instanceof Error ? lastError.message : lastError}`,
    });
  }

  log(
    options.onStep,
    'http',
    `${kind}: falling back to ProviderSoft HTTP backend (UserReportId=${id}) after ${PLAYWRIGHT_ATTEMPTS} Playwright failure(s)`,
  );
  const client = new PsHttpClient(options.credentials);
  try {
    await client.login();
  } catch (err) {
    throw new DownloadFailureError({
      stage: 'http_login',
      reportKind: kind,
      userReportId: id,
      cause: err,
    });
  }
  try {
    return await downloadOneReportHttp(
      client,
      kind,
      id,
      options.downloadDir,
      range,
      (_step, detail) => log(options.onStep, 'http', detail),
    );
  } catch (err) {
    throw new DownloadFailureError({
      stage: 'http_fallback',
      reportKind: kind,
      userReportId: id,
      attempts: PLAYWRIGHT_ATTEMPTS,
      cause: err,
    });
  }
}

/**
 * Login + download reports via Playwright (up to 3 attempts each),
 * then HTTP backend fallback when a UserReportId is configured.
 */
export async function downloadReports(
  options: DownloadReportsOptions,
): Promise<LocalDownloadResult> {
  const reportIds = options.reportIds ?? loadReportUserIds();
  const kinds = resolveKinds(options);

  await mkdir(options.downloadDir, { recursive: true });
  const session = await launchSession(options);

  try {
    let loginOk = false;
    let loginErr: unknown;
    for (let attempt = 1; attempt <= PLAYWRIGHT_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          log(options.onStep, 'retry', `login attempt ${attempt}/${PLAYWRIGHT_ATTEMPTS}`);
          await sleep(1500 * (attempt - 1));
        }
        await login(session.page, options.credentials, options.onStep);
        loginOk = true;
        break;
      } catch (err) {
        loginErr = err;
        log(
          options.onStep,
          'retry',
          `login failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    if (!loginOk) {
      if (options.disableHttpFallback) {
        throw new DownloadFailureError({
          stage: 'login',
          attempts: PLAYWRIGHT_ATTEMPTS,
          cause: loginErr,
        });
      }
      log(options.onStep, 'http', 'Playwright login failed; downloading all via HTTP backend');
      try {
        return await downloadReportsViaHttp({
          credentials: options.credentials,
          downloadDir: options.downloadDir,
          kinds,
          reportIds,
          dateRange: options.dateRange,
          dateRanges: options.dateRanges,
          onStep: (_step, detail) => log(options.onStep, 'http', detail),
        });
      } catch (err) {
        throw new DownloadFailureError({
          stage: 'http_login',
          attempts: PLAYWRIGHT_ATTEMPTS,
          cause: err,
        });
      }
    }

    const files: LocalDownloadResult['files'] = {};
    for (const kind of kinds) {
      const range = resolveRange(kind, options);
      log(
        options.onStep,
        'dates',
        `plan ${kind}: ${range.from} → ${range.to}` +
          (kind === 'verified_sessions' ? ' (weekly)' : ' (daily)'),
      );
      files[kind] = await downloadOneWithRetries(
        session.page,
        kind,
        options,
        reportIds,
        range,
      );
    }

    if (!Object.keys(files).length) {
      throw new DownloadFailureError({
        stage: 'no_reports',
        cause: `No report files downloaded for kinds: ${kinds.join(', ')}`,
      });
    }

    log(options.onStep, 'done', JSON.stringify(files));
    return { files };
  } finally {
    if (!options.keepOpen) await session.close().catch(() => undefined);
  }
}

/** Login-only helper for headed training. */
export async function loginOnly(
  options: Omit<DownloadReportsOptions, 'kinds'>,
): Promise<InteractiveSession> {
  const session = await launchSession(options);
  try {
    await login(session.page, options.credentials, options.onStep);
    log(options.onStep, 'done', `logged in at ${session.page.url()}`);
    return session;
  } catch (err) {
    if (!options.keepOpen) await session.close();
    throw err;
  }
}

export async function readReportFile(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}
