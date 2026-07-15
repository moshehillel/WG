import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { processVerifiedSessions } from './process-sessions.js';

describe('processVerifiedSessions', () => {
  it('auto-approves, verifies clocking, and skips unknown codes', async () => {
    const hha = new MockHhaClient();
    const result = await processVerifiedSessions({
      runId: 'run-s',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [
        {
          sessionId: 'S-auto',
          patientExternalId: 'p1',
          serviceCode: 'PCA001',
          visitDate: '2026-07-14',
          startTime: '09:00',
          endTime: '10:00',
        },
        {
          sessionId: 'S-verify',
          patientExternalId: 'p1',
          serviceCode: 'HHA001',
          visitDate: '2026-07-14',
          startTime: '11:00',
          endTime: '12:00',
        },
        {
          sessionId: 'S-skip',
          patientExternalId: 'p1',
          serviceCode: 'UNKNOWN',
        },
      ],
    });

    expect(result.succeeded).toBe(2);
    expect(result.skipped).toBe(1);
    expect(hha.calls).toContain('approveVisit');
    expect(hha.calls).toContain('getClockingDetails');
  });
});
