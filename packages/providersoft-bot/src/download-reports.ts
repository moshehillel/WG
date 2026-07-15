import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { ReportKind } from '@white-glove/shared';
import { REPORT_FILENAMES } from '@white-glove/shared';
import type { ProviderSoftCredentials } from './credentials.js';

export interface DownloadReportsOptions {
  credentials: ProviderSoftCredentials;
  downloadDir: string;
  headless?: boolean;
  /**
   * Selector / navigation hooks — filled once we have access to the live UI.
   * Defaults intentionally target common login form patterns.
   */
  selectors?: Partial<ProviderSoftSelectors>;
}

export interface ProviderSoftSelectors {
  username: string;
  password: string;
  submit: string;
  reportsMenu: string;
  reportLinks: Record<ReportKind, string>;
  exportButton: string;
}

const DEFAULT_SELECTORS: ProviderSoftSelectors = {
  username: 'input[name="username"], input[name="UserName"], #username, input[type="email"]',
  password: 'input[name="password"], input[name="Password"], #password, input[type="password"]',
  submit: 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")',
  reportsMenu: 'a:has-text("Reports"), text=Reports',
  reportLinks: {
    opened_cases: 'text=New Opened Cases',
    closed_cases: 'text=Closed Cases',
    verified_sessions: 'text=Verified Sessions',
  },
  exportButton: 'button:has-text("Export"), a:has-text("Export"), button:has-text("Download"), a:has-text("CSV")',
};

export interface LocalDownloadResult {
  files: Record<ReportKind, string>;
}

async function login(page: Page, creds: ProviderSoftCredentials, selectors: ProviderSoftSelectors) {
  await page.goto(creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator(selectors.username).first().fill(creds.username);
  await page.locator(selectors.password).first().fill(creds.password);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => undefined),
    page.locator(selectors.submit).first().click(),
  ]);
}

async function downloadOneReport(
  page: Page,
  kind: ReportKind,
  downloadDir: string,
  selectors: ProviderSoftSelectors,
): Promise<string> {
  await page.locator(selectors.reportsMenu).first().click({ timeout: 30_000 });
  await page.locator(selectors.reportLinks[kind]).first().click({ timeout: 30_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.locator(selectors.exportButton).first().click(),
  ]);

  const suggested = download.suggestedFilename();
  const ext = path.extname(suggested) || '.csv';
  const target = path.join(downloadDir, `${REPORT_FILENAMES[kind]}${ext}`);
  await download.saveAs(target);
  return target;
}

/**
 * Logs into ProviderSoft and downloads the three required reports.
 * Selectors are best-effort until live UI access is available; local dry-runs
 * can use `writeStubReports` instead.
 */
export async function downloadReports(
  options: DownloadReportsOptions,
): Promise<LocalDownloadResult> {
  const selectors: ProviderSoftSelectors = {
    ...DEFAULT_SELECTORS,
    ...options.selectors,
    reportLinks: {
      ...DEFAULT_SELECTORS.reportLinks,
      ...options.selectors?.reportLinks,
    },
  };

  await mkdir(options.downloadDir, { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: options.headless ?? true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await login(page, options.credentials, selectors);

    const files = {} as Record<ReportKind, string>;
    for (const kind of ['opened_cases', 'closed_cases', 'verified_sessions'] as ReportKind[]) {
      files[kind] = await downloadOneReport(page, kind, options.downloadDir, selectors);
    }
    return { files };
  } finally {
    await browser?.close();
  }
}

/** Local / CI stub when ProviderSoft credentials or UI are unavailable. */
export async function writeStubReports(downloadDir: string): Promise<LocalDownloadResult> {
  await mkdir(downloadDir, { recursive: true });
  const opened = [
    'Case ID,First Name,Last Name,Program Type,Service Code,Authorization Number,Contract ID',
    'HH-1,Home,Health,Home Health,PCA001,AUTH-1,CT-1',
    'EI-1,Early,Case,Early Intervention,HHA001,AUTH-E,CT-E',
  ].join('\n');
  const closed = ['case_id,status,closed_date,closed_reason', 'HH-0,Closed,2026-07-01,Discharged'].join(
    '\n',
  );
  const sessions = [
    'session_id,patient_id,case_id,service_code,visit_date,start_time,end_time,status',
    'S-1,p1,HH-1,PCA001,2026-07-14,09:00,10:00,Verified',
    'S-2,p1,HH-1,HHA001,2026-07-14,11:00,12:00,Verified',
    'S-3,p2,HH-2,ZZZ999,2026-07-14,13:00,14:00,Verified',
  ].join('\n');

  const files = {
    opened_cases: path.join(downloadDir, `${REPORT_FILENAMES.opened_cases}.csv`),
    closed_cases: path.join(downloadDir, `${REPORT_FILENAMES.closed_cases}.csv`),
    verified_sessions: path.join(downloadDir, `${REPORT_FILENAMES.verified_sessions}.csv`),
  };
  await writeFile(files.opened_cases, opened, 'utf8');
  await writeFile(files.closed_cases, closed, 'utf8');
  await writeFile(files.verified_sessions, sessions, 'utf8');
  return { files };
}

export async function readReportFile(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}
