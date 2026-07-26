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
    from: '#ctl00_Content_dlREportColumns_ctl33_DLColumControl_32_1_datePicker_dateInput',
    to: '#ctl00_Content_dlREportColumns_ctl33_DLColumControl_32_2_datePicker_dateInput',
  },
  verified_sessions: {
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

/** Daily Gluck / discharge reports — always “today → today”. */
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

/**
 * Computed date windows (never hardcode calendar days):
 * - Daily reports: today → today
 * - API Report (verified_sessions): past 7 days → today
 */
export function defaultDateRange(
  kind: BotReportKind,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (kind === 'verified_sessions') {
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    return { from: formatPsDate(from), to: formatPsDate(today) };
  }
  const s = formatPsDate(today);
  return { from: s, to: s };
}

export function isDailyReport(kind: BotReportKind): boolean {
  return DAILY_REPORT_KINDS.includes(kind);
}
