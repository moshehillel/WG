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
 * From codegen / Network: open=4526, API Report=4026.
 */
export type ReportUserIds = Partial<Record<BotReportKind, string>>;

export function loadReportUserIds(env: NodeJS.ProcessEnv = process.env): ReportUserIds {
  return {
    opened_cases: env.PROVIDERSOFT_REPORT_OPENED_ID ?? '4526',
    closed_cases: env.PROVIDERSOFT_REPORT_CLOSED_ID ?? '4527',
    verified_sessions: env.PROVIDERSOFT_REPORT_SESSIONS_ID ?? '4026',
    discharge_service: env.PROVIDERSOFT_REPORT_DISCHARGE_ID ?? '4528',
    caregiver_codes: env.PROVIDERSOFT_REPORT_CAREGIVER_CODES_ID ?? '4541',
    new_services: env.PROVIDERSOFT_REPORT_NEW_SERVICES_ID ?? '4544',
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
 * Date filter inputs after "Modify Report" → "Next >>".
 * Gluck-style reports share ctl04…3_*; API Report uses ctl07…6_*.
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
    from: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_2_datePicker_dateInput',
  },
  discharge_service: {
    from: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_2_datePicker_dateInput',
  },
  new_services: {
    /** Service Begin Date — lookback window catches rows whose begin date predates auth approval. */
    from: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_2_datePicker_dateInput',
  },
  verified_sessions: {
    /** Verified Date — sessions verified in the window (not Session Date). */
    from: '#ctl00_Content_dlREportColumns_ctl07_DLColumControl_6_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl07_DLColumControl_6_2_datePicker_dateInput',
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
 * Default 0 = same Eastern calendar day (nightly run at ~11 PM Eastern, before midnight).
 * Set to 1 only if the pipeline runs after midnight Eastern.
 */
export function dailyLookbackDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PROVIDERSOFT_DAILY_LOOKBACK_DAYS ?? '0';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** How many days back the API Report Verified Date filter spans (default 7). */
export function verifiedSessionLookbackDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PROVIDERSOFT_SESSION_LOOKBACK_DAYS ?? '7';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 7;
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
 * Computed date windows (never hardcode calendar days) — used for both live and sandbox downloads:
 * - Gluck open / closure / discharge: Eastern calendar day minus lookback (default same day)
 * - new_services: Service Begin Date from N days ago through business day (default 14)
 * - API Report (verified_sessions): Verified Date, 7 days ending on business day
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
    const from = addCalendarDays(businessDay, -verifiedSessionLookbackDays(env));
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
