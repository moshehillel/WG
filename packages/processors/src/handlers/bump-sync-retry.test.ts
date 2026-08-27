import { describe, expect, it } from 'vitest';
import { handler } from './bump-sync-retry.js';

describe('bump-sync-retry', () => {
  it('increments syncRetryCount and drops prior results', async () => {
    const result = await handler(
      {
        runId: 'r1',
        syncRetryCount: 0,
        download: { bucket: 'b' },
        parse: { runId: 'r1' },
        results: { opened: { timedOut: true } },
      },
      {} as never,
      () => undefined,
    );
    expect(result).toEqual({
      runId: 'r1',
      syncRetryCount: 1,
      download: { bucket: 'b' },
      parse: { runId: 'r1' },
    });
  });
});
