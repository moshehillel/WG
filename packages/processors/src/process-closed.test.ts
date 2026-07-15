import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { processClosedCases } from './process-closed.js';

describe('processClosedCases', () => {
  it('updates closed case status in HHA', async () => {
    const hha = new MockHhaClient();
    const result = await processClosedCases({
      runId: 'run-c',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [{ caseId: 'C-9', status: 'Closed', closedDate: '2026-07-01' }],
    });
    expect(result.succeeded).toBe(1);
    expect(hha.closedCases.get('C-9')?.status).toBe('Closed');
  });
});
