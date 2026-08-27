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

/** Cron timezone intent — EventBridge Rules in-account use UTC only (no ScheduleExpressionTimezone). */
export const PIPELINE_CRON_TIMEZONE = 'America/New_York';
/**
 * Nightly Gluck open/closure / new services / discharge — ~5:00 PM US/Eastern.
 * 21:00 UTC ≈ 5:00 PM EDT; 4:00 PM EST in winter (same fixed-UTC DST drift as sessions).
 */
export const PIPELINE_NIGHTLY_CASES_CRON = { minute: '0', hour: '21' } as const;
/**
 * Tuesday sessions + Monday preview — ~11:00 PM US/Eastern.
 * 03:00 UTC ≈ 11:00 PM EDT; 10:00 PM EST in winter.
 */
export const PIPELINE_SESSIONS_NIGHT_CRON = { minute: '0', hour: '3' } as const;
/** @deprecated Use PIPELINE_SESSIONS_NIGHT_CRON or PIPELINE_NIGHTLY_CASES_CRON. */
export const PIPELINE_NIGHT_CRON = PIPELINE_SESSIONS_NIGHT_CRON;
