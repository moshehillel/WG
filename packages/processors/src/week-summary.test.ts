import { describe, expect, it } from 'vitest';
import {
  aggregateWeekSummaries,
  isSandboxRunId,
  previousEasternWeekWindow,
  runIdFromValidateSummaryKey,
  zonedTimeToUtc,
  type ListedValidateSummary,
} from './week-summary.js';

describe('previousEasternWeekWindow', () => {
  it('from Wednesday returns the Mon-Sun week containing yesterday', () => {
    // Wed Aug 12, 2026 -> yesterday Tue Aug 11 -> week Mon Aug 10 - Sun Aug 16
    const window = previousEasternWeekWindow(new Date('2026-08-12T15:00:00Z'));
    expect(window.startDate).toBe('2026-08-10');
    expect(window.endDate).toBe('2026-08-16');
  });

  it('on Sunday includes the current Mon-Sun week (Tuesday transfer week)', () => {
    const window = previousEasternWeekWindow(new Date('2026-08-16T18:00:00Z'));
    expect(window.startDate).toBe('2026-08-10');
    expect(window.endDate).toBe('2026-08-16');
  });
});

describe('runId helpers', () => {
  it('parses validate-summary keys', () => {
    expect(runIdFromValidateSummaryKey('runs/abc-123/validate-summary.json')).toBe('abc-123');
    expect(runIdFromValidateSummaryKey('runs/abc/exceptions.json')).toBeNull();
  });

  it('detects sandbox run ids', () => {
    expect(isSandboxRunId('sandbox-2026-08-01')).toBe(true);
    expect(isSandboxRunId('sandbox-live-x')).toBe(true);
    expect(isSandboxRunId('28b5e15f-57e3-0665-a9ad-db496ca607e6')).toBe(false);
  });
});

describe('aggregateWeekSummaries', () => {
  const window = previousEasternWeekWindow(new Date('2026-08-12T15:00:00Z'));

  function item(
    runId: string,
    lastModified: string,
    artifact: ListedValidateSummary['artifact'],
  ): ListedValidateSummary {
    return {
      key: `runs/${runId}/validate-summary.json`,
      runId,
      lastModified: new Date(lastModified),
      artifact: { runId, ...artifact },
    };
  }

  it('sums case/closure counts and uses live sessions only', () => {
    const result = aggregateWeekSummaries(
      [
        item('night-1', '2026-08-11T04:00:00Z', {
          dryRun: false,
          exceptionCount: 1,
          summary: {
            opened: { succeeded: 2, failed: 1, skipped: 0, processed: 3 },
            closed: { succeeded: 1, failed: 0, skipped: 0, processed: 1 },
          },
        }),
        item('monday-preview', '2026-08-12T04:00:00Z', {
          dryRun: true,
          exceptionCount: 5,
          summary: {
            sessions: { succeeded: 40, failed: 10, skipped: 2, processed: 52 },
          },
        }),
        item('tuesday-live', '2026-08-13T04:00:00Z', {
          dryRun: false,
          exceptionCount: 3,
          summary: {
            sessions: { succeeded: 38, failed: 8, skipped: 2, processed: 48 },
            newServices: { succeeded: 4, failed: 1, skipped: 0, processed: 5 },
          },
        }),
        item('sandbox-2026-08-07', '2026-08-14T12:00:00Z', {
          sandbox: true,
          dryRun: true,
          summary: {
            opened: { succeeded: 99, failed: 0, skipped: 0, processed: 99 },
            sessions: { succeeded: 99, failed: 0, skipped: 0, processed: 99 },
          },
        }),
        item('outside', '2026-07-20T04:00:00Z', {
          dryRun: false,
          summary: {
            opened: { succeeded: 50, failed: 0, skipped: 0, processed: 50 },
          },
        }),
      ],
      window,
    );

    expect(result.counts.runsIncluded).toBe(3);
    expect(result.counts.newCasesEntered).toBe(2);
    expect(result.counts.newCasesFailed).toBe(1);
    expect(result.counts.closuresCompleted).toBe(1);
    expect(result.counts.newServicesSucceeded).toBe(4);
    expect(result.counts.sessionsApproved).toBe(38);
    expect(result.counts.sessionsFailed).toBe(8);
    expect(result.counts.sessionsSkipped).toBe(2);
    expect(result.counts.sessionsFromDryRunOnly).toBe(false);
    expect(result.counts.exceptionCount).toBe(9);
  });

  it('falls back to latest legacy sessions run when dryRun flag missing', () => {
    const result = aggregateWeekSummaries(
      [
        item('older', '2026-08-11T04:00:00Z', {
          summary: {
            sessions: { succeeded: 10, failed: 1, skipped: 0, processed: 11 },
          },
        }),
        item('newer', '2026-08-13T04:00:00Z', {
          summary: {
            sessions: { succeeded: 20, failed: 2, skipped: 0, processed: 22 },
          },
        }),
      ],
      window,
    );
    expect(result.counts.sessionsApproved).toBe(20);
    expect(result.counts.sessionsFailed).toBe(2);
  });
});
