import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderSoftCredentials } from './credentials.js';
import {
  BOT_REPORT_FILENAMES,
  defaultDateRange,
  isDailyReport,
  loadReportUserIds,
  REPORT_DATE_INPUTS,
  reportViewUrl,
  type BotReportKind,
  type ReportUserIds,
} from './report-config.js';
import {
  collectHiddenFields,
  findSubmitByValue,
  joinUrl,
  pickNameById,
  PsHttpClient,
} from './ps-http-client.js';
import type { LocalDownloadResult } from './stub-reports.js';

export interface HttpDownloadOptions {
  credentials: ProviderSoftCredentials;
  downloadDir: string;
  kinds: BotReportKind[];
  reportIds?: ReportUserIds;
  dateRange?: { from: string; to: string };
  dateRanges?: Partial<Record<BotReportKind, { from: string; to: string }>>;
  onStep?: (step: string, detail: string) => void;
}

function resolveRange(
  kind: BotReportKind,
  options: HttpDownloadOptions,
): { from: string; to: string } {
  if (options.dateRanges?.[kind]) return options.dateRanges[kind]!;
  if (options.dateRange && isDailyReport(kind)) return options.dateRange;
  return defaultDateRange(kind);
}

async function clickSubmit(
  client: PsHttpClient,
  pageUrl: string,
  html: string,
  buttonValue: string,
): Promise<{ html: string; url: string; location?: string }> {
  const submit = findSubmitByValue(html, buttonValue);
  if (!submit) {
    throw new Error(`HTTP: button "${buttonValue}" not found on ${pageUrl}`);
  }
  const body = collectHiddenFields(html);
  body.set(submit.name, submit.value);
  const res = await client.postForm(pageUrl, body);
  if (res.location && /Download\.asp/i.test(res.location)) {
    return { html: '', url: pageUrl, location: res.location };
  }
  if (res.location) {
    const nextUrl = joinUrl(client.creds.baseUrl, res.location);
    const next = await client.get(nextUrl);
    return { html: next.html, url: nextUrl, location: next.location };
  }
  return { html: res.html, url: pageUrl, location: res.location };
}

/**
 * ProviderSoft backend (HTTP) download for a single report that has a UserReportId.
 * Mirrors the UI wizard when possible; falls back to direct Export if Modify fails.
 */
export async function downloadOneReportHttp(
  client: PsHttpClient,
  kind: BotReportKind,
  userReportId: string,
  downloadDir: string,
  range: { from: string; to: string },
  onStep?: HttpDownloadOptions['onStep'],
): Promise<string> {
  const pageUrl = reportViewUrl(client.creds.baseUrl, userReportId);
  onStep?.('http', `${kind}: GET ${pageUrl}`);
  let page = await client.get(pageUrl);
  let html = page.html;
  let url = pageUrl;

  try {
    onStep?.('http', `${kind}: Modify Report`);
    const modified = await clickSubmit(client, url, html, 'Modify Report');
    html = modified.html;
    url = modified.url;

    onStep?.('http', `${kind}: Next >> (to filters)`);
    const step1 = await clickSubmit(client, url, html, 'Next >>');
    html = step1.html;
    url = step1.url;

    const fromId = REPORT_DATE_INPUTS[kind].from;
    const toId = REPORT_DATE_INPUTS[kind].to;
    const fromName = pickNameById(html, fromId);
    const toName = pickNameById(html, toId);
    if (!fromName || !toName) {
      throw new Error(`HTTP: date inputs not found for ${kind}`);
    }
    onStep?.('http', `${kind}: dates ${range.from} → ${range.to}`);
    const body = collectHiddenFields(html);
    body.set(fromName, range.from);
    body.set(toName, range.to);
    const nextBtn = findSubmitByValue(html, 'Next >>');
    if (!nextBtn) throw new Error('HTTP: Next >> missing after dates');
    body.set(nextBtn.name, nextBtn.value);
    const afterDates = await client.postForm(url, body);
    if (afterDates.location) {
      url = joinUrl(client.creds.baseUrl, afterDates.location);
      const g = await client.get(url);
      html = g.html;
    } else {
      html = afterDates.html;
    }

    onStep?.('http', `${kind}: Next >> (preview)`);
    const step3 = await clickSubmit(client, url, html, 'Next >>');
    html = step3.html;
    url = step3.url;
  } catch (err) {
    onStep?.(
      'http',
      `${kind}: wizard failed (${err instanceof Error ? err.message : err}); trying direct Export`,
    );
    page = await client.get(pageUrl);
    html = page.html;
    url = pageUrl;
  }

  onStep?.('http', `${kind}: Export to Excel`);
  const exported = await clickSubmit(client, url, html, 'Export to Excel');
  const location = exported.location;
  if (!location || !/Download\.asp/i.test(location)) {
    // Sometimes export returns HTML with a link — try button again or scan
    throw new Error(
      `HTTP export for ${kind} did not redirect to Download.asp (location=${location ?? 'none'})`,
    );
  }
  const downloadUrl = joinUrl(client.creds.baseUrl, location);
  onStep?.('http', `${kind}: GET ${downloadUrl}`);
  const bytes = await client.getBinary(downloadUrl);
  const target = path.join(downloadDir, `${BOT_REPORT_FILENAMES[kind]}.csv`);
  await writeFile(target, bytes);
  onStep?.('http', `${kind}: saved ${target} (${bytes.length} bytes)`);
  return target;
}

/** Download one or more reports via HTTP (requires UserReportId per kind). */
export async function downloadReportsViaHttp(
  options: HttpDownloadOptions,
): Promise<LocalDownloadResult> {
  const reportIds = options.reportIds ?? loadReportUserIds();
  await mkdir(options.downloadDir, { recursive: true });
  const client = new PsHttpClient(options.credentials);
  options.onStep?.('http', 'login');
  await client.login();
  options.onStep?.('http', 'login ok');

  const files: LocalDownloadResult['files'] = {};
  for (const kind of options.kinds) {
    const id = reportIds[kind];
    if (!id) {
      throw new Error(
        `HTTP fallback needs UserReportId for ${kind}. Set PROVIDERSOFT_REPORT_*_ID.`,
      );
    }
    files[kind] = await downloadOneReportHttp(
      client,
      kind,
      id,
      options.downloadDir,
      resolveRange(kind, options),
      options.onStep,
    );
  }
  return { files };
}
