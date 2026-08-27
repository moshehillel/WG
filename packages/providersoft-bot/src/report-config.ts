import type { ReportKind } from '@white-glove/shared';
import { REPORT_FILENAMES } from '@white-glove/shared';

/** Pipeline report kinds plus PS reference reports not yet in every pipeline branch. */
export type BotReportKind = ReportKind | 'discharge_service' | 'caregiver_codes' | 'new_services';

export const BOT_REPORT_FILENAMES: Record<BotReportKind, string> = {
  ...REPORT_FILENAMES,
  discharge_service: 'discharge-service',
  caregiver_codes: 'caregiver-codes',
  new_services: 'new-services',
};

/**
 * ProviderSoft saved-report IDs (ReportView.aspx?UserReportId=…).
 * Defaults (Aug 2026): Gluck open=4566, new service=4559, closure=4527,
 * discharge=4528, caregiver=4541, API/sessions=4026.
 * HAR of UI exports used open=4558 temporarily — prefer 4566 (Gender: rebuild).
 */
export type ReportUserIds = Partial<Record<BotReportKind, string>>;

export function loadReportUserIds(env: NodeJS.ProcessEnv = process.env): ReportUserIds {
  return {
    opened_cases: env.PROVIDERSOFT_REPORT_OPENED_ID ?? '4566',
    closed_cases: env.PROVIDERSOFT_REPORT_CLOSED_ID ?? '4527',
    verified_sessions: env.PROVIDERSOFT_REPORT_SESSIONS_ID ?? '4026',
    discharge_service: env.PROVIDERSOFT_REPORT_DISCHARGE_ID ?? '4528',
    caregiver_codes: env.PROVIDERSOFT_REPORT_CAREGIVER_CODES_ID ?? '4541',
    new_services: env.PROVIDERSOFT_REPORT_NEW_SERVICES_ID ?? '4559',
  };
}

/** Exact link accessible names from Playwright codegen. */
export const REPORT_LINK_NAMES: Record<BotReportKind, string> = {
  opened_cases: 'Gluck open',
  closed_cases: 'gluck closure',
  discharge_service: 'discharge service',
  new_services: 'new service',
  verified_sessions: 'API Report',
  caregiver_codes: 'caregiver codes',
};

/**
 * Human filter label on Report Wizard Step 3 (preferred over brittle ctl* ids).
 * Bot fills the from/to date pickers in the row matching this label.
 */
export const REPORT_DATE_FILTER_LABELS: Record<BotReportKind, string> = {
  opened_cases: 'Date of Intake',
  closed_cases: 'Closure Date',
  discharge_service: 'Service Discharge Date',
  new_services: 'Service Begin Date',
  verified_sessions: 'Verified Date',
  caregiver_codes: 'Date of Birth',
};

/**
 * Fallback date filter input ids after "Modify Report" → "Next >>".
 * Prefer REPORT_DATE_FILTER_LABELS; these ids drift when saved-report columns change.
 * Always target `..._datePicker_dateInput` (fill text) — not calendar popupButton clicks.
 * Codegen Aug 2026: Gluck open/closure/discharge stay ctl04/DLColumControl_3;
 * new_services Service Begin → ctl33/DLColumControl_32; API Verified Date → ctl28/DLColumControl_27.
 * (Gluck closure codegen may also show ctl11 — prefer label fill; ctl04 is Closure Date.)
 */
export const REPORT_DATE_INPUTS: Record<
  BotReportKind,
  { from: string; to: string }
> = {
  opened_cases: {
    from: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_2_datePicker_dateInput',
  },
  closed_cases: {
    /** Closure Date — HAR Aug 2026: ctl11 / DLColumControl_10 (not Date of Intake ctl04). */
    from: '#ctl00_Content_dlREportColumns_ctl11_DLColumControl_10_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl11_DLColumControl_10_2_datePicker_dateInput',
  },
  discharge_service: {
    /** Service Discharge Date — HAR: ctl35 / DLColumControl_34. */
    from: '#ctl00_Content_dlREportColumns_ctl35_DLColumControl_34_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl35_DLColumControl_34_2_datePicker_dateInput',
  },
  new_services: {
    /** Service Begin Date — lookback window catches rows whose begin date predates auth approval. */
    from: '#ctl00_Content_dlREportColumns_ctl33_DLColumControl_32_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl33_DLColumControl_32_2_datePicker_dateInput',
  },
  verified_sessions: {
    /** Verified Date — sessions verified in the window (not Session Date). */
    from: '#ctl00_Content_dlREportColumns_ctl28_DLColumControl_27_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl28_DLColumControl_27_2_datePicker_dateInput',
  },
  caregiver_codes: {
    from: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_2_datePicker_dateInput',
  },
};

export const ALL_BOT_KINDS: BotReportKind[] = [
  'opened_cases',
  'closed_cases',
  'discharge_service',
  'new_services',
  'verified_sessions',
  'caregiver_codes',
];

/** Reference exports — no date filter; re-download when lookup misses. */
export const REFERENCE_REPORT_KINDS: BotReportKind[] = ['caregiver_codes'];

export function reportViewUrl(baseUrl: string, userReportId: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/ReportWizard/ReportView.aspx?UserReportId=${encodeURIComponent(userReportId)}`;
}

export function loginUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/security/login.aspx`;
}

/** Daily Gluck / discharge reports — Eastern calendar day (default same day for ~11 PM run). */
export const DAILY_REPORT_KINDS: BotReportKind[] = [
  'opened_cases',
  'closed_cases',
  'discharge_service',
  'new_services',
];

/** Format a Date as ProviderSoft expects in the date pickers (M/D/YYYY). */
export function formatPsDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export const DEFAULT_PROVIDERSOFT_TIMEZONE = 'America/New_York';

/** Calendar Y/M/D in a timezone (e.g. Eastern — coordinators work in local dates). */
export function datePartsInTimeZone(
  date: Date,
  timeZone: string = DEFAULT_PROVIDERSOFT_TIMEZONE,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function calendarDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

export function addCalendarDays(base: Date, delta: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + delta);
  return d;
}

/**
 * How many Eastern calendar days to look back for daily report filters.
 * Default 0 = same Eastern calendar day (nightly cases ~5 PM Eastern; sessions ~11 PM).
 * Set to 1 only if the pipeline runs after midnight Eastern.
 */
export function dailyLookbackDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PROVIDERSOFT_DAILY_LOOKBACK_DAYS ?? '0';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * API Report Verified Date lookback ending today (TO-anchored).
 * Default 14 days so mid-week fixes still fall inside next Tuesday's download.
 */
export function verifiedSessionLookbackDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PROVIDERSOFT_SESSION_LOOKBACK_DAYS ?? '14';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 14;
}

/**
 * Service Begin Date lookback for new-service report.
 * Auth can arrive days after the request date stored as Service Begin Date.
 */
export function newServiceLookbackDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PROVIDERSOFT_NEW_SERVICE_LOOKBACK_DAYS ?? '14';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 14;
}

/**
 * Legacy API Report Verified Date window: Tuesday through Monday (7 calendar days).
 * Prefer TO-anchored lookback via defaultDateRange (catches mid-week re-verifies / fixes).
 *
 * Week starts Tuesday in Eastern business-day terms:
 * - if businessDay is Sun or Mon → go back to the previous Tuesday
 * - if businessDay is Tue–Sat → use this week's Tuesday
 * - to = that Tuesday + 6 days (the Monday that closes the week)
 */
export function verifiedSessionsTueMonRange(businessDay: Date): { from: Date; to: Date } {
  const dow = businessDay.getDay(); // Sun=0 … Sat=6
  // Days since Tuesday: Tue→0, Wed→1, …, Mon→6
  const daysSinceTuesday = (dow + 5) % 7;
  // On Tuesday live night, use the week that just closed (prev Tue → Mon) so the
  // window matches Monday dry-run preview — not the empty week starting today.
  if (dow === 2) {
    const to = addCalendarDays(businessDay, -1);
    const from = addCalendarDays(to, -6);
    return { from, to };
  }
  const from = addCalendarDays(businessDay, -daysSinceTuesday);
  const to = addCalendarDays(from, 6);
  return { from, to };
}

/**
 * If a codegen selector points at the calendar popup button, map to the text input.
 * Prefer filling `..._datePicker_dateInput` over clicking popupButton + day cells.
 */
export function preferDateInputSelector(selector: string): string {
  return selector
    .replace(/_datePicker_popupButton$/, '_datePicker_dateInput')
    .replace(/_popupButton$/, '_dateInput');
}

/**
 * Computed date windows (never hardcode calendar days) — used for both live and sandbox downloads:
 * - Gluck open / closure / discharge: Eastern calendar day minus lookback (default same day)
 * - new_services: Service Begin Date from today−14 through today (default 14-day lookback)
 * - API Report (verified_sessions): Verified Date from (today − lookback) through today (TO-anchored;
 *   default 14 days so mid-week fixes / re-verifies still appear on next Tuesday)
 */
export function defaultDateRange(
  kind: BotReportKind,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): { from: string; to: string } {
  const timeZone = env.PROVIDERSOFT_TIMEZONE ?? DEFAULT_PROVIDERSOFT_TIMEZONE;
  const { year, month, day } = datePartsInTimeZone(now, timeZone);
  const lookback = dailyLookbackDays(env);
  const businessDay = addCalendarDays(calendarDate(year, month, day), -lookback);

  if (kind === 'verified_sessions') {
    // Anchor on Verified Date TO (= business day). FROM is lookback — not Session Date.
    const sessionLookback = verifiedSessionLookbackDays(env);
    const from = addCalendarDays(businessDay, -sessionLookback);
    return { from: formatPsDate(from), to: formatPsDate(businessDay) };
  }

  if (kind === 'new_services') {
    const from = addCalendarDays(businessDay, -newServiceLookbackDays(env));
    return { from: formatPsDate(from), to: formatPsDate(businessDay) };
  }

  const s = formatPsDate(businessDay);
  return { from: s, to: s };
}

export function isDailyReport(kind: BotReportKind): boolean {
  return DAILY_REPORT_KINDS.includes(kind);
}
