import { describe, expect, it } from 'vitest';
import { buildRowException } from '@white-glove/shared';
import { runProcessorBranchSafely } from './safe-handler.js';

describe('runProcessorBranchSafely', () => {
  it('returns structured failure when branch crashes', async () => {
    const result = await runProcessorBranchSafely('opened', 'run-1', async () => {
      throw new Error('S3 read failed');
    });

    expect(result.failed).toBe(1);
    expect(result.exceptions[0]?.code).toBe('pipeline_step_error');
    expect(result.exceptions[0]?.message).toContain('S3 read failed');
  });

  it('passes through successful branch results', async () => {
    const ok = {
      runId: 'run-1',
      reportKind: 'opened_cases' as const,
      processed: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      exceptions: [buildRowException({ code: 'other', message: 'test' })],
    };
    const result = await runProcessorBranchSafely('opened', 'run-1', async () => ok);
    expect(result).toEqual(ok);
  });
});
