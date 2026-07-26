import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { processOpenedCases } from './process-opened.js';

describe('processOpenedCases', () => {
  it('creates patient/contract/auth and skips EI', async () => {
    const hha = new MockHhaClient();
    const result = await processOpenedCases({
      runId: 'run1',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [
        {
          caseId: 'ei1',
          firstName: 'Kid',
          lastName: 'One',
          isEarlyIntervention: true,
        },
        {
          caseId: 'c2',
          firstName: 'Pat',
          lastName: 'Two',
          programType: 'Extended Home Care Therapy',
          serviceCode: 'OT CHHA EXTENDED',
          authorizationNumber: 'A1',
          dateOfBirth: '01/01/2020',
          address1: '1 Main St',
          city: 'Brooklyn',
          state: 'NY',
          zipCode: '11201',
        },
      ],
    });
    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(hha.calls.filter((c) => c === 'upsertPatient')).toHaveLength(1);
    expect(hha.calls).toContain('upsertContract');
    expect(hha.calls).toContain('upsertAuthorization');
  });
});
