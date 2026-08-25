import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { ProviderSoftCredentials } from './credentials.js';
import { downloadOneReportHttp } from './http-download.js';
import { PsHttpClient } from './ps-http-client.js';
import {
  ALL_BOT_KINDS,
  BOT_REPORT_FILENAMES,
  defaultDateRange,
  isDailyReport,
  loadReportUserIds,
  loginUrl,
  REFERENCE_REPORT_KINDS,
  REPORT_DATE_FILTER_LABELS,
  REPORT_DATE_INPUTS,
  preferDateInputSelector,
  REPORT_LINK_NAMES,
  reportViewUrl,
  type BotReportKind,
  type ReportUserIds,
} from './report-config.js';
import type { LocalDownloadResult } from './stub-reports.js';
export type { LocalDownloadResult } from './stub-reports.js';
export { writeStubReports } from './stub-reports.js';
import { DownloadFailureError } from './errors.js';

/** Playwright attempts when used as fallback (or preferPlaywright). */
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
  /**
   * Prefer Playwright first, HTTP only when Playwright fails for a kind.
   * Default false: HTTP-primary, Playwright fallback (legacy).
   * Legacy alias: `disableHttpFallback` also forces Playwright-first.
   */
  preferPlaywright?: boolean;
  /** @deprecated Use preferPlaywright — when true, Playwright-first (HTTP fallback on failure). */
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

async function exportToExcel(
  page: Page,
  kind: BotReportKind,
  downloadDir: string,
  onStep?: DownloadReportsOptions['onStep'],
): Promise<string> {
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

/**
 * Step 2 — ensure Gender: is selected (and Real DOB is not) so exports match
 * coordinator CSVs. No-op when Gender: is absent from the saved-report catalog.
 */
async function ensureGenderColumn(
  page: Page,
  kind: BotReportKind,
  onStep?: DownloadReportsOptions['onStep'],
): Promise<void> {
  if (kind !== 'opened_cases' && kind !== 'new_services') return;

  const result = await page.evaluate(() => {
    // Browser context — keep types loose for Node tsc (no DOM lib).
    let gender: { checked: boolean; click: () => void } | null = null;
    let realDob: { checked: boolean; click: () => void } | null = null;
    const labels = Array.from(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).document.querySelectorAll(
        '[id^="Content_RptRepeater_lblReportColumnName_"]',
      ),
    ) as Array<{ id: string; textContent: string | null }>;
    for (const lab of labels) {
      const name = (lab.textContent || '').trim();
      const idx = lab.id.split('_').pop();
      if (!idx) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chk = (globalThis as any).document.getElementById(
        `Content_RptRepeater_chkReportColumn_${idx}`,
      ) as { checked: boolean; click: () => void } | null;
      if (!chk) continue;
      if (/^Gender:?$/i.test(name) || name === 'Gender:') gender = chk;
      if (/Real DOB/i.test(name)) realDob = chk;
    }
    const actions: string[] = [];
    if (gender && !gender.checked) {
      gender.click();
      actions.push('checked Gender:');
    } else if (gender?.checked) {
      actions.push('Gender: already on');
    } else {
      actions.push('Gender: not in catalog');
    }
    if (realDob?.checked) {
      realDob.click();
      actions.push('unchecked Real DOB');
    }
    return { actions, hasGender: Boolean(gender) };
  });

  log(onStep, 'modify', `${kind}: Step2 columns — ${result.actions.join('; ')}`);
  if (!result.hasGender && (kind === 'opened_cases' || kind === 'new_services')) {
    throw new DownloadFailureError({
      stage: 'playwright_report',
      reportKind: kind,
      cause:
        `${kind}: ProviderSoft Step 2 has no Gender: column. ` +
        `Recreate the saved Service Report with Gender: checked (see PROVIDERSOFT_REPORT_*_ID).`,
    });
  }
}

/** Fill from/to date pickers for the Step 3 filter row matching `label`. */
async function fillDateFilterByLabel(
  page: Page,
  label: string,
  range: DateRange,
): Promise<boolean> {
  const ids = await page.evaluate(
    ({ wantLabel, from, to }: { wantLabel: string; from: string; to: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document as {
        querySelectorAll: (s: string) => ArrayLike<{
          id: string;
          value: string;
          focus: () => void;
          dispatchEvent: (e: unknown) => void;
          parentElement: { innerText?: string; parentElement: unknown } | null;
        }>;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ev = (globalThis as any).Event;
      const inputs = Array.from(
        doc.querySelectorAll('input[id*="datePicker_dateInput"]:not([id*="ClientState"])'),
      );
      const matched: typeof inputs = [];
      for (const inp of inputs) {
        let el: { innerText?: string; parentElement: unknown } | null = inp;
        let rowLabel = '';
        for (let i = 0; i < 10 && el; i++) {
          const t = (el.innerText || '').split('\n')[0]?.trim() || '';
          if (t && !/^Open the calendar/i.test(t) && t.length < 80) {
            rowLabel = t;
            break;
          }
          el = el.parentElement as { innerText?: string; parentElement: unknown } | null;
        }
        if (rowLabel.toLowerCase() === wantLabel.toLowerCase()) matched.push(inp);
      }
      const pair = matched.slice(0, 2);
      if (pair[0]) {
        pair[0].focus();
        pair[0].value = from;
        pair[0].dispatchEvent(new Ev('input', { bubbles: true }));
        pair[0].dispatchEvent(new Ev('change', { bubbles: true }));
      }
      if (pair[1]) {
        pair[1].focus();
        pair[1].value = to;
        pair[1].dispatchEvent(new Ev('input', { bubbles: true }));
        pair[1].dispatchEvent(new Ev('change', { bubbles: true }));
      }
      return pair.map((i) => i.id);
    },
    { wantLabel: label, from: range.from, to: range.to },
  );

  return ids.length >= 2;
}

/**
 * Wizard path:
 * Modify Report → (ensure Gender:) → Next → set dates → Next →
 * Export to Excel (or ReportView fallback when Step4 has no Export).
 */
async function modifyDatesAndExport(
  page: Page,
  kind: BotReportKind,
  downloadDir: string,
  range: DateRange,
  options: {
    onStep?: DownloadReportsOptions['onStep'];
    baseUrl: string;
    userReportId?: string;
  },
): Promise<string> {
  const { onStep, baseUrl, userReportId } = options;
  if (REFERENCE_REPORT_KINDS.includes(kind)) {
    log(onStep, 'export', `${kind}: reference report (no date filter)`);
    return exportToExcel(page, kind, downloadDir, onStep);
  }

  log(onStep, 'modify', `${kind}: Modify Report`);
  await clickReady(page.getByRole('button', { name: 'Modify Report' }));
  await settle(page);

  await ensureGenderColumn(page, kind, onStep);

  await clickReady(page.getByRole('button', { name: 'Next >>' }));
  await settle(page);

  const label = REPORT_DATE_FILTER_LABELS[kind];
  log(onStep, 'dates', `${kind}: ${label} ${range.from} → ${range.to}`);
  const filledByLabel = await fillDateFilterByLabel(page, label, range);
  // Prefer ..._dateInput fill (codegen may only show popupButton — map to dateInput)
  const inputs = REPORT_DATE_INPUTS[kind];
  const fromSel = preferDateInputSelector(inputs.from);
  const toSel = preferDateInputSelector(inputs.to);
  if (!filledByLabel) {
    log(onStep, 'dates', `${kind}: label miss — fallback selectors ${fromSel}`);
    await fillReady(page.locator(fromSel), range.from);
    await fillReady(page.locator(toSel), range.to);
  } else {
    // Also mirror into visible inputs via Playwright fill (RadDatePicker can ignore bare .value)
    const fromLoc = page.locator(fromSel);
    const toLoc = page.locator(toSel);
    if (await fromLoc.count()) {
      await fromLoc.fill(range.from).catch(() => undefined);
      await toLoc.fill(range.to).catch(() => undefined);
    }
  }

  // Verify values stuck before leaving the filter step
  const seen = await page.evaluate((wantLabel) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document as {
      querySelectorAll: (s: string) => ArrayLike<{ value: string; parentElement: unknown; innerText?: string }>;
    };
    const inputs = Array.from(
      doc.querySelectorAll('input[id*="datePicker_dateInput"]:not([id*="ClientState"])'),
    );
    const vals: string[] = [];
    for (const inp of inputs) {
      let el: { innerText?: string; parentElement: unknown } | null = inp;
      let rowLabel = '';
      for (let i = 0; i < 10 && el; i++) {
        const t = (el.innerText || '').split('\n')[0]?.trim() || '';
        if (t && !/^Open the calendar/i.test(t) && t.length < 80) {
          rowLabel = t;
          break;
        }
        el = el.parentElement as { innerText?: string; parentElement: unknown } | null;
      }
      if (rowLabel.toLowerCase() === wantLabel.toLowerCase()) vals.push(String(inp.value || ''));
    }
    return vals.slice(0, 2);
  }, label);
  log(onStep, 'dates', `${kind}: filter inputs now=${JSON.stringify(seen)}`);

  await clickReady(page.getByRole('button', { name: 'Next >>' }));
  await settle(page);

  const nextAgain = page.getByRole('button', { name: 'Next >>' });
  if (await nextAgain.count()) {
    await clickReady(nextAgain);
    await settle(page);
  }

  const exportBtn = page.getByRole('button', { name: 'Export to Excel' });
  if (!(await exportBtn.count()) && userReportId) {
    log(
      onStep,
      'export',
      `${kind}: no Export on wizard Step4 — opening ReportView to export filtered result`,
    );
    await page.goto(reportViewUrl(baseUrl, userReportId), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT.navigation,
    });
    await settle(page);
    const rec = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = String(((globalThis as any).document?.body?.innerText as string) || '');
      const m = text.match(/Number of Records:\s*(\d+)/i);
      return m ? Number(m[1]) : -1;
    });
    log(onStep, 'export', `${kind}: ReportView records=${rec}`);
  }

  return exportToExcel(page, kind, downloadDir, onStep);
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
  const ids = options.reportIds ?? loadReportUserIds();
  return ALL_BOT_KINDS.filter((k) => !REFERENCE_REPORT_KINDS.includes(k) || ids[k]);
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

/** Playwright-only retries (used as fallback after HTTP, or when preferPlaywright). */
async function downloadOnePlaywrightWithRetries(
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
        {
          onStep: options.onStep,
          baseUrl: options.credentials.baseUrl,
          userReportId: reportIds[kind],
        },
      );
    } catch (err) {
      lastError = err;
      log(
        options.onStep,
        'retry',
        `${kind}: Playwright attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  throw new DownloadFailureError({
    stage: 'playwright_report',
    reportKind: kind,
    attempts: PLAYWRIGHT_ATTEMPTS,
    userReportId: reportIds[kind],
    cause: lastError,
  });
}

/**
 * Download via Playwright. Returns kinds that still need another backend
 * (login failure → all kinds; per-kind export failure → those kinds).
 */
async function downloadKindsViaPlaywright(
  options: DownloadReportsOptions,
  reportIds: ReportUserIds,
  kinds: BotReportKind[],
  files: LocalDownloadResult['files'],
): Promise<BotReportKind[]> {
  if (!kinds.length) return [];

  const session = await launchSession(options);
  const failed: BotReportKind[] = [];
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
      log(
        options.onStep,
        'retry',
        `Playwright login failed after ${PLAYWRIGHT_ATTEMPTS} attempts (${loginErr instanceof Error ? loginErr.message : loginErr})`,
      );
      return [...kinds];
    }

    for (const kind of kinds) {
      const range = resolveRange(kind, options);
      log(
        options.onStep,
        'dates',
        `plan ${kind}: ${range.from} → ${range.to}` +
          (kind === 'verified_sessions' ? ' (weekly)' : ' (daily)'),
      );
      try {
        files[kind] = await downloadOnePlaywrightWithRetries(
          session.page,
          kind,
          options,
          reportIds,
          range,
        );
      } catch (err) {
        log(
          options.onStep,
          'retry',
          `${kind}: Playwright failed (${err instanceof Error ? err.message : err}); will try HTTP`,
        );
        failed.push(kind);
      }
    }
  } finally {
    if (!options.keepOpen) await session.close().catch(() => undefined);
  }
  return failed;
}

async function downloadKindsViaHttp(
  options: DownloadReportsOptions,
  reportIds: ReportUserIds,
  kinds: BotReportKind[],
  files: LocalDownloadResult['files'],
  mode: 'primary' | 'fallback',
): Promise<BotReportKind[]> {
  const needPlaywright: BotReportKind[] = [];
  let httpClient: PsHttpClient | undefined;

  for (const kind of kinds) {
    const range = resolveRange(kind, options);
    log(
      options.onStep,
      'dates',
      `plan ${kind}: ${range.from} → ${range.to}` +
        (kind === 'verified_sessions' ? ' (weekly)' : ' (daily)'),
    );

    const id = reportIds[kind];
    if (!id) {
      log(options.onStep, 'http', `${kind}: no UserReportId — will use Playwright`);
      needPlaywright.push(kind);
      continue;
    }

    try {
      if (!httpClient) {
        log(options.onStep, 'http', `HTTP-${mode}: login`);
        httpClient = new PsHttpClient(options.credentials);
        await httpClient.login();
        log(options.onStep, 'http', `HTTP-${mode}: login ok`);
      }
      files[kind] = await downloadOneReportHttp(
        httpClient,
        kind,
        id,
        options.downloadDir,
        range,
        (_step, detail) => log(options.onStep, 'http', detail),
      );
    } catch (err) {
      log(
        options.onStep,
        'retry',
        `${kind}: HTTP-${mode} failed (${err instanceof Error ? err.message : err})` +
          (mode === 'primary' ? '; falling back to Playwright' : ''),
      );
      if (mode === 'primary') needPlaywright.push(kind);
      else {
        throw new DownloadFailureError({
          stage: 'http_fallback',
          reportKind: kind,
          userReportId: id,
          cause: err,
        });
      }
    }
  }

  return needPlaywright;
}

/**
 * Download reports.
 * Default: **HTTP backend first** (correct columns incl. Gender:), then Playwright fallback.
 * Set preferPlaywright for headed training / debugging.
 */
export async function downloadReports(
  options: DownloadReportsOptions,
): Promise<LocalDownloadResult> {
  const reportIds = options.reportIds ?? loadReportUserIds();
  const kinds = resolveKinds(options);
  const preferPlaywright =
    options.preferPlaywright === true || options.disableHttpFallback === true;

  await mkdir(options.downloadDir, { recursive: true });
  const files: LocalDownloadResult['files'] = {};

  if (preferPlaywright) {
    log(options.onStep, 'launch', 'Playwright-primary (+ HTTP fallback on failure)');
    const needHttp = await downloadKindsViaPlaywright(options, reportIds, kinds, files);
    if (needHttp.length) {
      log(
        options.onStep,
        'http',
        `HTTP fallback for: ${needHttp.join(', ')}`,
      );
      await downloadKindsViaHttp(options, reportIds, needHttp, files, 'fallback');
    }
  } else {
    const needPlaywright = await downloadKindsViaHttp(
      options,
      reportIds,
      kinds,
      files,
      'primary',
    );
    if (needPlaywright.length) {
      log(
        options.onStep,
        'launch',
        `Playwright fallback for: ${needPlaywright.join(', ')}`,
      );
      const stillFailed = await downloadKindsViaPlaywright(
        options,
        reportIds,
        needPlaywright,
        files,
      );
      if (stillFailed.length) {
        throw new DownloadFailureError({
          stage: 'playwright_fallback',
          cause: `Playwright fallback failed for: ${stillFailed.join(', ')}`,
        });
      }
    }
  }

  if (!Object.keys(files).length) {
    throw new DownloadFailureError({
      stage: 'no_reports',
      cause: `No report files downloaded for kinds: ${kinds.join(', ')}`,
    });
  }

  const missing = kinds.filter((kind) => !files[kind]);
  if (missing.length) {
    const apiMissing = missing.includes('verified_sessions');
    throw new DownloadFailureError({
      stage: 'incomplete_reports',
      reportKind: apiMissing ? 'verified_sessions' : missing[0],
      cause: apiMissing
        ? `API Report (verified sessions) was requested but not downloaded (also missing: ${missing.join(', ')}). Pipeline refuses to continue without the sessions report.`
        : `Requested report(s) not downloaded: ${missing.join(', ')}`,
    });
  }

  log(options.onStep, 'done', JSON.stringify(files));
  return { files };
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
