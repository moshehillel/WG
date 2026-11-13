import { describe, expect, it } from 'vitest';
import { compactProcessorResultForSfn, compactValidateResultForSfn } from './compact-processor-result.js';
import type { ProcessorResult, ValidateResult } from '@white-glove/shared';

function sessionsResult(): ProcessorResult {
  return {
    runId: 'run-1',
    reportKind: 'verified_sessions',
    processed: 2,
    succeeded: 1,
    skipped: 0,
    failed: 1,
    timedOut: false,
    successes: [
      { rowId: 's1', patientName: 'Child One', caregiverName: 'Aide One', programType: 'Horizon NJ' },
    ],
    exceptions: [
      {
        code: 'incomplete_unscheduled_clock',
        message: 'missing clock for a long patient and caregiver name',
        reportKind: 'verified_sessions',
        rowId: 's2',
      },
    ],
  };
}

describe('compactProcessorResultForSfn', () => {
  it('keeps counts and drops row names and exception text', () => {
    const compact = compactProcessorResultForSfn(sessionsResult(), 0);
    expect(compact).toEqual({
      runId: 'run-1',
      reportKind: 'verified_sessions',
      processed: 2,
      succeeded: 1,
      skipped: 0,
      failed: 1,
      timedOut: false,
      exceptions: [],
    });
    expect(JSON.stringify(compact).length).toBeLessThan(500);
  });
});

describe('compactValidateResultForSfn', () => {
  it('does not return the sessions row list to Step Functions', () => {
    const full: ValidateResult = {
      runId: 'run-1',
      ok: false,
      exceptionCount: 1,
      exceptions: sessionsResult().exceptions,
      summary: { sessions: sessionsResult() },
    };
    const compact = compactValidateResultForSfn(full);
    expect(compact.exceptions).toEqual([]);
    expect(compact.summary.sessions?.succeeded).toBe(1);
    expect(compact.summary.sessions?.successes).toBeUndefined();
    expect(compact.summary.sessions?.exceptions).toEqual([]);
  });
});
