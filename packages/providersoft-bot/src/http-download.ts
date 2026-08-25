import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderSoftCredentials } from './credentials.js';
import {
  BOT_REPORT_FILENAMES,
  defaultDateRange,
  isDailyReport,
  loadReportUserIds,
  REFERENCE_REPORT_KINDS,
  REPORT_DATE_FILTER_LABELS,
  REPORT_DATE_INPUTS,
  REPORT_LINK_NAMES,
  reportViewUrl,
  type BotReportKind,
  type ReportUserIds,
} from './report-config.js';
import {
  collectFormFields,
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

/** ProviderSoft M/D/YYYY → Telerik validationText / valueAsString. */
export function formatTelerikDateValue(psDate: string): string {
  const m = psDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    throw new Error(`HTTP: expected M/D/YYYY date, got "${psDate}"`);
  }
  const yyyy = m[3]!;
  const mm = m[1]!.padStart(2, '0');
  const dd = m[2]!.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-00-00-00`;
}

/** M/D/YYYY → YYYY-MM-DD for the visually-hidden RadDatePicker field. */
export function formatIsoDate(psDate: string): string {
  const m = psDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    throw new Error(`HTTP: expected M/D/YYYY date, got "${psDate}"`);
  }
  return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

/** Map dateInput form name → companion `_ClientState` hidden field name. */
export function clientStateNameForDateInput(dateInputName: string): string {
  return `${dateInputName.replace(/\$/g, '_')}_ClientState`;
}

/**
 * Set dateInput text + hidden RadDatePicker ISO value + Telerik ClientState.
 * Browser HAR posts all three; dateInput text alone is not enough.
 * `*_datePicker_ClientState` is often JS-only (empty in raw HTML) — must synthesize.
 */
export function applyDateFilterToBody(
  body: URLSearchParams,
  dateInputName: string,
  displayDate: string,
): void {
  body.set(dateInputName, displayDate);
  // Visually-hidden companion: ...$datePicker (no $dateInput) = YYYY-MM-DD
  if (/\$dateInput$/i.test(dateInputName)) {
    const pickerName = dateInputName.replace(/\$dateInput$/i, '');
    body.set(pickerName, formatIsoDate(displayDate));
    const pickerState = `${pickerName.replace(/\$/g, '_')}_ClientState`;
    body.set(
      pickerState,
      JSON.stringify({
        minDateStr: '1753-01-01-00-00-00',
        maxDateStr: '9999-12-31-00-00-00',
      }),
    );
  }
  const stateName = clientStateNameForDateInput(dateInputName);
  const existing = body.get(stateName);
  let state: Record<string, unknown> = {};
  if (existing) {
    try {
      state = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      state = {};
    }
  }
  const telerik = formatTelerikDateValue(displayDate);
  body.set(
    stateName,
    JSON.stringify({
      enabled: true,
      emptyMessage: '',
      minDateStr: '1753-01-01-00-00-00',
      maxDateStr: '9999-12-31-00-00-00',
      ...state,
      validationText: telerik,
      valueAsString: telerik,
      lastSetTextBoxValue: displayDate,
    }),
  );
}

const EMPTY_DATE_INPUT_STATE = JSON.stringify({
  enabled: true,
  emptyMessage: '',
  validationText: '',
  valueAsString: '',
  minDateStr: '1753-01-01-00-00-00',
  maxDateStr: '9999-12-31-00-00-00',
  lastSetTextBoxValue: '',
});

const DEFAULT_PICKER_STATE = JSON.stringify({
  minDateStr: '1753-01-01-00-00-00',
  maxDateStr: '9999-12-31-00-00-00',
});

/**
 * Clear sticky date values and restore Telerik ClientState defaults.
 * Raw HTML often has empty datePicker_ClientState (JS fills it in the browser).
 */
export function clearAllDateFiltersOnBody(body: URLSearchParams): void {
  for (const key of [...body.keys()]) {
    if (/\$datePicker\$dateInput$/i.test(key)) {
      body.set(key, '');
      const picker = key.replace(/\$dateInput$/i, '');
      body.set(picker, '');
      body.set(clientStateNameForDateInput(key), EMPTY_DATE_INPUT_STATE);
      body.set(`${picker.replace(/\$/g, '_')}_ClientState`, DEFAULT_PICKER_STATE);
    } else if (/datePicker_dateInput_ClientState$/i.test(key)) {
      body.set(key, EMPTY_DATE_INPUT_STATE);
    } else if (/datePicker_ClientState$/i.test(key) && !/dateInput/i.test(key)) {
      body.set(key, DEFAULT_PICKER_STATE);
    }
  }
}

/**
 * Prefer label-matched datePicker inputs (IDs drift when Gender:/columns change).
 * Falls back to REPORT_DATE_INPUTS hard-coded ids.
 */
export function resolveDateFilterFieldNames(
  html: string,
  kind: BotReportKind,
): { fromName?: string; toName?: string; via: 'label' | 'id' | 'none' } {
  const label = REPORT_DATE_FILTER_LABELS[kind];
  const byLabel = pickDateInputNamesByLabel(html, label);
  if (byLabel.from && byLabel.to) {
    return { fromName: byLabel.from, toName: byLabel.to, via: 'label' };
  }
  const fromId = REPORT_DATE_INPUTS[kind].from;
  const toId = REPORT_DATE_INPUTS[kind].to;
  const fromName = pickNameById(html, fromId);
  const toName = pickNameById(html, toId);
  if (fromName && toName) return { fromName, toName, via: 'id' };
  return { fromName, toName, via: 'none' };
}

/** Match from/to datePicker `name`s whose surrounding markup contains the filter label. */
export function pickDateInputNamesByLabel(
  html: string,
  label: string,
): { from?: string; to?: string } {
  const want = label.trim().toLowerCase();
  if (!want) return {};

  // Prefer: find label text, then the next two dateInput names.
  // Each RadDatePicker embeds a large calendar (~10KB), so use a wide window.
  const labelIdx = html.toLowerCase().indexOf(want);
  if (labelIdx >= 0) {
    const window = html.slice(labelIdx, labelIdx + 50_000);
    const names: string[] = [];
    const tagRe =
      /<input\b[^>]*\bid=["']([^"']*datePicker_dateInput)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(window))) {
      const tag = m[0]!;
      const id = m[1]!;
      if (/ClientState/i.test(id)) continue;
      const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
      names.push(nameMatch?.[1] ?? id.replace(/_/g, '$'));
      if (names.length >= 2) break;
    }
    if (names.length >= 2) return { from: names[0], to: names[1] };
    // From found but to beyond window: derive _2 from _1.
    if (names.length === 1 && /_1\$datePicker\$dateInput$/i.test(names[0]!)) {
      return {
        from: names[0],
        to: names[0]!.replace(
          /_1\$datePicker\$dateInput$/i,
          '_2$datePicker$dateInput',
        ),
      };
    }
  }

  // Fallback: look back from each dateInput for the label.
  const tagRe =
    /<input\b[^>]*\bid=["']([^"']*datePicker_dateInput)["'][^>]*>/gi;
  const matches: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[0]!;
    const id = m[1]!;
    if (/ClientState/i.test(id)) continue;
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    const name = nameMatch?.[1] ?? id.replace(/_/g, '$');
    const lookBack = html.slice(Math.max(0, m.index - 3000), m.index).toLowerCase();
    if (!lookBack.includes(want)) continue;
    matches.push({ name, index: m.index });
  }
  if (matches.length < 2) return {};
  return { from: matches[0]!.name, to: matches[1]!.name };
}

/**
 * Validate HTTP export bytes look like CSV (not an HTML/error page).
 * Header-only / 0 data rows is a legitimate empty result (e.g. no closed/
 * discharge that day) — do NOT treat as failure or trigger Playwright fallback.
 * Returns the number of data rows (excluding header).
 */
export function assertHttpCsvHasDataRows(
  bytes: Uint8Array,
  kind: BotReportKind,
): number {
  const text = Buffer.from(bytes).toString('utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const dataRows = Math.max(0, lines.length - (lines.length > 0 ? 1 : 0));

  if (REFERENCE_REPORT_KINDS.includes(kind)) return dataRows;

  // Real HTTP failures already throw earlier (auth, 4xx/5xx, missing Download.asp).
  // Here we only refuse clearly malformed non-CSV bodies (e.g. HTML error page).
  const head = text.trimStart().slice(0, 256).toLowerCase();
  if (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.includes('<html') ||
    (head.startsWith('<?xml') && head.includes('<html'))
  ) {
    throw new Error(
      `${kind}: HTTP export returned non-CSV HTML/error page (${bytes.length} bytes)`,
    );
  }

  return dataRows;
}

async function followPost(
  client: PsHttpClient,
  pageUrl: string,
  res: { html: string; location?: string },
): Promise<{ html: string; url: string; location?: string }> {
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
  const body = collectFormFields(html);
  body.set(submit.name, submit.value);
  const res = await client.postForm(pageUrl, body);
  return followPost(client, pageUrl, res);
}

/**
 * ASP.NET `__doPostBack` (Report Wizard Step4 "Next >>" is type=button).
 * HAR posts __EVENTTARGET=ctl00$Content$btnNext — not btnNext=Next >>.
 * Step4 also requires a non-empty report name (4566 rebuild had blank name → 200 stay).
 */
async function clickEventTarget(
  client: PsHttpClient,
  pageUrl: string,
  html: string,
  eventTarget: string,
  extras?: URLSearchParams,
): Promise<{ html: string; url: string; location?: string }> {
  const body = collectFormFields(html);
  if (extras) {
    for (const [k, v] of extras) body.set(k, v);
  }
  body.set('__EVENTTARGET', eventTarget);
  body.set('__EVENTARGUMENT', '');
  body.delete(eventTarget);
  const res = await client.postForm(pageUrl, body);
  return followPost(client, pageUrl, res);
}

/** Step4 Next is type=button — post via EVENTTARGET (browser __doPostBack). */
async function clickWizardNext(
  client: PsHttpClient,
  pageUrl: string,
  html: string,
  kind?: BotReportKind,
): Promise<{ html: string; url: string; location?: string }> {
  const extras = new URLSearchParams();
  // ReportWizardStep4 validates report name; rebuilt reports can have it blank.
  if (/ReportWizardStep4/i.test(pageUrl)) {
    const nameField = 'ctl00$Content$txtReportName';
    const current = collectFormFields(html).get(nameField)?.trim() ?? '';
    if (!current && kind) {
      extras.set(nameField, REPORT_LINK_NAMES[kind]);
    }
  }

  const submit = findSubmitByValue(html, 'Next >>');
  if (submit?.type === 'button') {
    return clickEventTarget(client, pageUrl, html, submit.name, extras);
  }
  if (submit) {
    if ([...extras.keys()].length) {
      const body = collectFormFields(html);
      for (const [k, v] of extras) body.set(k, v);
      body.set(submit.name, submit.value);
      return followPost(client, pageUrl, await client.postForm(pageUrl, body));
    }
    return clickSubmit(client, pageUrl, html, 'Next >>');
  }
  if (/name=["']ctl00\$Content\$btnNext["']/i.test(html)) {
    return clickEventTarget(client, pageUrl, html, 'ctl00$Content$btnNext', extras);
  }
  throw new Error(`HTTP: Next >> not found on ${pageUrl}`);
}

/**
 * ProviderSoft backend (HTTP) download for a single report that has a UserReportId.
 * Mirrors browser HAR: Modify → Step2 Next → Step3 dates+ClientState+Next →
 * Step4 EVENTTARGET Next → ReportView Export → Download.asp.
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

  if (REFERENCE_REPORT_KINDS.includes(kind)) {
    onStep?.('http', `${kind}: reference — direct Export`);
  } else {
    try {
      onStep?.('http', `${kind}: Modify Report`);
      const modified = await clickSubmit(client, url, html, 'Modify Report');
      html = modified.html;
      url = modified.url;

      onStep?.('http', `${kind}: Next >> (columns → filters)`);
      const step1 = await clickWizardNext(client, url, html, kind);
      html = step1.html;
      url = step1.url;

      const resolved = resolveDateFilterFieldNames(html, kind);
      if (!resolved.fromName || !resolved.toName) {
        throw new Error(
          `HTTP: date inputs not found for ${kind} (label=${REPORT_DATE_FILTER_LABELS[kind]})`,
        );
      }
      onStep?.(
        'http',
        `${kind}: dates ${range.from} → ${range.to} (via ${resolved.via}; ${resolved.fromName})`,
      );
      const body = collectFormFields(html);
      clearAllDateFiltersOnBody(body);
      applyDateFilterToBody(body, resolved.fromName, range.from);
      applyDateFilterToBody(body, resolved.toName, range.to);
      const nextBtn = findSubmitByValue(html, 'Next >>');
      if (!nextBtn) throw new Error('HTTP: Next >> missing after dates');
      if (nextBtn.type === 'button') {
        body.set('__EVENTTARGET', nextBtn.name);
        body.set('__EVENTARGUMENT', '');
        body.delete(nextBtn.name);
      } else {
        body.set(nextBtn.name, nextBtn.value);
      }
      const afterDates = await client.postForm(url, body);
      const followed = await followPost(client, url, afterDates);
      html = followed.html;
      url = followed.url;

      onStep?.('http', `${kind}: Next >> (preview → ReportView)`);
      const step4 = await clickWizardNext(client, url, html, kind);
      html = step4.html;
      url = step4.url;
      if (!/ReportView\.aspx/i.test(url)) {
        throw new Error(
          `${kind}: after Step4 Next expected ReportView, got ${url}`,
        );
      }
    } catch (err) {
      throw new Error(
        `${kind}: HTTP date filter wizard failed — refusing unfiltered export (${err instanceof Error ? err.message : err})`,
      );
    }
  }

  onStep?.('http', `${kind}: Export to Excel`);
  let exported: { html: string; url: string; location?: string };
  try {
    exported = await clickSubmit(client, url, html, 'Export to Excel');
  } catch (err) {
    // Do NOT fall back to unfiltered ReportView — empty Gender: headers.
    throw new Error(
      `${kind}: HTTP Export missing after date wizard (url=${url}) — ${err instanceof Error ? err.message : err}`,
    );
  }
  const location = exported.location;
  if (!location || !/Download\.asp/i.test(location)) {
    throw new Error(
      `HTTP export for ${kind} did not redirect to Download.asp (location=${location ?? 'none'})`,
    );
  }
  const downloadUrl = joinUrl(client.creds.baseUrl, location);
  onStep?.('http', `${kind}: GET ${downloadUrl}`);
  const bytes = await client.getBinary(downloadUrl);
  const dataRows = assertHttpCsvHasDataRows(bytes, kind);
  if (dataRows === 0) {
    onStep?.(
      'http',
      `${kind}: HTTP export empty (0 data rows) — treating as success`,
    );
  }
  const target = path.join(downloadDir, `${BOT_REPORT_FILENAMES[kind]}.csv`);
  await writeFile(target, bytes);
  onStep?.(
    'http',
    `${kind}: saved ${target} (${bytes.length} bytes, ${dataRows} data rows)`,
  );
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
