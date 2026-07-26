import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { processClosedCases } from './process-closed.js';

describe('processClosedCases', () => {
  it('discharges all active placements when case closes', async () => {
    const hha = new MockHhaClient();
    const patient = await hha.upsertPatient({
      caseId: 'C-9',
      firstName: 'Pat',
      lastName: 'Closed',
    });
    await hha.upsertContract({
      patientId: patient.id,
      contractExternalId: '10410',
      startDate: '2026-01-01',
    });
    await hha.upsertContract({
      patientId: patient.id,
      contractExternalId: '10411',
      startDate: '2026-02-01',
    });

    const result = await processClosedCases({
      runId: 'run-c',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [{ caseId: 'C-9', status: 'Closed', closedDate: '2026-07-01', programType: 'Garden City UFSD Therapy' }],
    });
    expect(result.succeeded).toBe(1);
    expect(hha.closedCases.get('C-9')?.status).toBe('Closed');
    const placements = await hha.listPatientPlacements(patient.id);
    expect(placements.every((p) => p.dischargeDate)).toBe(true);
  });

  it('ignores Early Intervention closed cases', async () => {
    const hha = new MockHhaClient();
    const result = await processClosedCases({
      runId: 'run-ei',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [
        {
          caseId: 'EI-9',
          status: 'Closed',
          programType: 'Early Intervention',
          isEarlyIntervention: true,
        },
      ],
    });
    expect(result.succeeded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(hha.closedCases.size).toBe(0);
  });
});
