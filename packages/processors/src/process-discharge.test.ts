import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { processDischargeService } from './process-discharge.js';

describe('processDischargeService', () => {
  it('discharges the placement identified by report service type and begin date', async () => {
    const hha = new MockHhaClient();
    const patient = await hha.upsertPatient({
      caseId: '1068547',
      firstName: 'Kid',
      lastName: 'One',
    });
    const siPlacement = await hha.upsertContract({
      patientId: patient.id,
      contractExternalId: '10410',
      serviceCode: 'SI',
      startDate: '05/08/2026',
    });
    await hha.upsertContract({
      patientId: patient.id,
      contractExternalId: '10410',
      serviceCode: 'OT EI',
      startDate: '05/27/2026',
    });

    const result = await processDischargeService({
      runId: 'run-d',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [
        {
          caseId: '1068547',
          serviceCode: 'SI',
          startDate: '05/08/2026',
          dischargeDate: '07/14/2026',
        },
      ],
    });

    expect(result.succeeded).toBe(1);
    expect(hha.dischargedPlacements.has(siPlacement.id)).toBe(true);
    const stillActive = (await hha.listPatientPlacements(patient.id)).filter((p) => !p.dischargeDate);
    expect(stillActive).toHaveLength(1);
  });
});
