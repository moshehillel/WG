import { describe, expect, it } from 'vitest';
import {
  consumeTimeBudgetStop,
  flagExhaustedSyncTimeouts,
  MAX_SYNC_RETRY_COUNT,
  resultStoppedForTimeBudget,
  shouldYieldFromLambdaContext,
  timeBudgetException,
} from './time-budget.js';

describe('time budget', () => {
  it('yields when remaining time is inside the reserve', () => {
    const shouldYield = shouldYieldFromLambdaContext({ getRemainingTimeInMillis: () => 10_000 });
    expect(shouldYield?.()).toBe(true);
  });

  it('keeps going when remaining time is above the reserve', () => {
    const shouldYield = shouldYieldFromLambdaContext({ getRemainingTimeInMillis: () => 200_000 });
    expect(shouldYield?.()).toBe(false);
  });

  it('records one timeout exception and remaining failed count', () => {
    const exceptions: ReturnType<typeof timeBudgetException>[] = [];
    const stop = consumeTimeBudgetStop(() => true, 12, 3, 'opened_cases', exceptions);
    expect(stop).toEqual({ stop: true, extraFailed: 12 });
    expect(exceptions[0]?.details?.timedOut).toBe(true);
    expect(exceptions[0]?.message).toContain('12 row(s) left');
    expect(exceptions[0]?.message).toContain('auto-retry');
  });

  it('detects a time-budget stop on a processor result', () => {
    const result = {
      runId: 'r1',
      reportKind: 'opened_cases' as const,
      processed: 4,
      succeeded: 3,
      skipped: 0,
      failed: 1,
      exceptions: [timeBudgetException({ reportKind: 'opened_cases', remainingRows: 1, completedRows: 3 })],
    };
    expect(resultStoppedForTimeBudget(result)).toBe(true);
  });

  it('flags exhausted retries when validate sees a still-timed-out branch', () => {
    const mid = {
      runId: 'r1',
      reportKind: 'verified_sessions' as const,
      processed: 100,
      succeeded: 40,
      skipped: 0,
      failed: 60,
      timedOut: true,
      exceptions: [
        timeBudgetException({ reportKind: 'verified_sessions', remainingRows: 60, completedRows: 40 }),
      ],
    };
    const exhausted = flagExhaustedSyncTimeouts(mid);
    expect(exhausted.exceptions[0]?.details?.retriesExhausted).toBe(true);
    expect(exhausted.exceptions[0]?.details?.maxSyncRetryCount).toBe(MAX_SYNC_RETRY_COUNT);
    expect(exhausted.exceptions[0]?.message).toContain('max auto-retries');
    expect(exhausted.exceptions[0]?.message).toContain('60 row(s) still not entered');
  });
});
