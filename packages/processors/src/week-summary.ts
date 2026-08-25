/**
 * Aggregate pipeline validate-summary.json artifacts into dashboard week stats.
 *
 * Week window: Mon–Sun in America/New_York for the week that contains yesterday.
 * Mid-week this is the current calendar week; on Monday morning it is still the
 * week that ended Sunday (matches Monday dry-run / Tuesday live sessions schedule).
 * It is NOT always the prior completed week — UI should label This week vs Last week.
 */

export const WEEK_SUMMARY_TIMEZONE = 'America/New_York';

export type BranchCounts = {
  succeeded: number;
  failed: number;
  skipped: number;
  processed: number;
};

export type ValidateSummaryArtifact = {
  runId: string;
  ok?: boolean;
  dryRun?: boolean;
  sandbox?: boolean;
  exceptionCount?: number;
  summary?: {
    opened?: Partial<BranchCounts>;
    closed?: Partial<BranchCounts>;
    sessions?: Partial<BranchCounts>;
    newServices?: Partial<BranchCounts>;
  };
};

export type ListedValidateSummary = {
  key: string;
  runId: string;
  lastModified: Date;
  artifact: ValidateSummaryArtifact;
};

export type WeekWindow = {
  /** Inclusive start (Monday 00:00:00.000 Eastern). */
  start: Date;
  /** Exclusive end (next Monday 00:00:00.000 Eastern). */
  end: Date;
  label: string;
  startDate: string;
  endDate: string;
};

export type WeekSummaryCounts = {
  sessionsApproved: number;
  sessionsFailed: number;
  sessionsSkipped: number;
  newCasesEntered: number;
  newCasesFailed: number;
  newServicesSucceeded: number;
  newServicesFailed: number;
  closuresCompleted: number;
  closuresFailed: number;
  exceptionCount: number;
  runsIncluded: number;
  sessionsFromDryRunOnly: boolean;
};

export type WeekSummaryResult = {
  window: WeekWindow;
  counts: WeekSummaryCounts;
  runIds: string[];
  summariesScanned: number;
};

type EasternParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
};

function easternParts(date: Date): EasternParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WEEK_SUMMARY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayMap[get('weekday')] ?? 0,
  };
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
  timeZone = WEEK_SUMMARY_TIMEZONE,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const asParts = Object.fromEntries(
    dtf
      .formatToParts(new Date(utcGuess))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(asParts.year),
    Number(asParts.month) - 1,
    Number(asParts.day),
    Number(asParts.hour),
    Number(asParts.minute),
    Number(asParts.second),
    ms,
  );
  return new Date(utcGuess - (asUtc - utcGuess));
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function formatEasternDateLabel(year: number, month: number, day: number): string {
  const instant = zonedTimeToUtc(year, month, day, 12, 0, 0);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: WEEK_SUMMARY_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(instant);
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Pipeline Mon–Sun week in America/New_York for dashboard week stats.
 * Anchored on yesterday so Monday morning still shows the week that ended Sunday,
 * and Sunday still includes the week with that Tuesday live session transfer.
 * Mid-week (Tue–Sun) this returns the current calendar week, not the prior one.
 */
export function previousEasternWeekWindow(now: Date = new Date()): WeekWindow {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const anchor = easternParts(yesterday);
  const daysSinceMonday = (anchor.weekday + 6) % 7;
  const weekMonday = addCalendarDays(anchor.year, anchor.month, anchor.day, -daysSinceMonday);
  const weekSunday = addCalendarDays(weekMonday.year, weekMonday.month, weekMonday.day, 6);
  const nextMonday = addCalendarDays(weekMonday.year, weekMonday.month, weekMonday.day, 7);

  const start = zonedTimeToUtc(weekMonday.year, weekMonday.month, weekMonday.day, 0, 0, 0, 0);
  const end = zonedTimeToUtc(nextMonday.year, nextMonday.month, nextMonday.day, 0, 0, 0, 0);

  return {
    start,
    end,
    startDate: ymd(weekMonday.year, weekMonday.month, weekMonday.day),
    endDate: ymd(weekSunday.year, weekSunday.month, weekSunday.day),
    label: `${formatEasternDateLabel(weekMonday.year, weekMonday.month, weekMonday.day)} - ${formatEasternDateLabel(weekSunday.year, weekSunday.month, weekSunday.day)} (Eastern)`,
  };
}

export function runIdFromValidateSummaryKey(key: string): string | null {
  const match = /^runs\/([^/]+)\/validate-summary\.json$/.exec(key);
  return match?.[1] ?? null;
}

export function isSandboxRunId(runId: string): boolean {
  return /^sandbox(-|$)/i.test(runId);
}

function emptyBranch(): BranchCounts {
  return { succeeded: 0, failed: 0, skipped: 0, processed: 0 };
}

function addBranch(target: BranchCounts, source?: Partial<BranchCounts>): void {
  if (!source) return;
  target.succeeded += Number(source.succeeded ?? 0);
  target.failed += Number(source.failed ?? 0);
  target.skipped += Number(source.skipped ?? 0);
  target.processed += Number(source.processed ?? 0);
}

/**
 * Aggregate listed summaries that fall inside the window.
 * - Excludes sandbox runs.
 * - Nightly case/closure counts are summed.
 * - Session counts use live (dryRun=false) runs when present; otherwise the
 *   latest sessions-bearing run only (avoids double-counting Mon preview + Tue live).
 */
export function aggregateWeekSummaries(
  listed: ListedValidateSummary[],
  window: WeekWindow,
): WeekSummaryResult {
  const inWindow = listed.filter(
    (item) =>
      item.lastModified >= window.start &&
      item.lastModified < window.end &&
      !isSandboxRunId(item.runId) &&
      item.artifact.sandbox !== true,
  );

  const opened = emptyBranch();
  const closed = emptyBranch();
  const newServices = emptyBranch();
  let exceptionCount = 0;

  for (const item of inWindow) {
    addBranch(opened, item.artifact.summary?.opened);
    addBranch(closed, item.artifact.summary?.closed);
    addBranch(newServices, item.artifact.summary?.newServices);
    exceptionCount += Number(item.artifact.exceptionCount ?? 0);
  }

  const withSessions = inWindow
    .filter((item) => item.artifact.summary?.sessions)
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  const liveSessionRuns = withSessions.filter((item) => item.artifact.dryRun === false);
  const drySessionRuns = withSessions.filter((item) => item.artifact.dryRun === true);

  let sessionSource: ListedValidateSummary[] = [];
  let sessionsFromDryRunOnly = false;
  if (liveSessionRuns.length > 0) {
    sessionSource = liveSessionRuns;
  } else if (withSessions.some((item) => item.artifact.dryRun === undefined)) {
    sessionSource = withSessions.slice(0, 1);
  } else if (drySessionRuns.length > 0) {
    sessionSource = drySessionRuns.slice(0, 1);
    sessionsFromDryRunOnly = true;
  }

  const sessions = emptyBranch();
  for (const item of sessionSource) {
    addBranch(sessions, item.artifact.summary?.sessions);
  }

  return {
    window,
    counts: {
      sessionsApproved: sessions.succeeded,
      sessionsFailed: sessions.failed,
      sessionsSkipped: sessions.skipped,
      newCasesEntered: opened.succeeded,
      newCasesFailed: opened.failed,
      newServicesSucceeded: newServices.succeeded,
      newServicesFailed: newServices.failed,
      closuresCompleted: closed.succeeded,
      closuresFailed: closed.failed,
      exceptionCount,
      runsIncluded: inWindow.length,
      sessionsFromDryRunOnly,
    },
    runIds: inWindow.map((item) => item.runId),
    summariesScanned: listed.length,
  };
}
