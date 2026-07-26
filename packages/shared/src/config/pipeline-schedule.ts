import type { ReportKind } from '../types/reports.js';

/** All pipeline report kinds (ProviderSoft → HHA). */
export const PIPELINE_REPORT_KINDS: readonly ReportKind[] = [
  'opened_cases',
  'closed_cases',
  'verified_sessions',
];

/** Gluck open + closure — run every night. */
export const NIGHTLY_CASE_REPORT_KINDS: readonly ReportKind[] = [
  'opened_cases',
  'closed_cases',
];

/** Verified sessions (API Report) — live run Tuesday night only. */
export const WEEKLY_SESSION_REPORT_KINDS: readonly ReportKind[] = ['verified_sessions'];

/** Nightly batch window — 2:00 AM US/Eastern (off-peak; bot never runs daytime). */
export const PIPELINE_CRON_TIMEZONE = 'America/New_York';
export const PIPELINE_NIGHT_CRON = { minute: '0', hour: '2' } as const;
