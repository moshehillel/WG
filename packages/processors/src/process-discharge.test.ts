import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { InMemoryServiceMappingStore } from './service-mapping.js';
import { processDischargeService } from './process-discharge.js';

describe('processDischargeService', () => {
  it('discharges mapped placement only', async () => {
    const hha = new MockHhaClient();
    const mappingStore = new InMemoryServiceMappingStore();
    const patient = await hha.upsertPatient({
      caseId: '1068547',
      firstName: 'Kid',
      lastName: 'One',
    });
    const contract = await hha.upsertContract({
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
    await mappingStore.put({
      caseId: '1068547',
      serviceCode: 'SI',
      startDate: '05/08/2026',
      patientId: patient.id,
      placementId: contract.id,
      updatedAt: new Date().toISOString(),
    });

    const result = await processDischargeService({
      runId: 'run-d',
      hha,
      store: new InMemoryIdempotencyStore(),
      mappingStore,
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
    expect(hha.dischargedPlacements.has(contract.id)).toBe(true);
    const stillActive = (await hha.listPatientPlacements(patient.id)).filter((p) => !p.dischargeDate);
    expect(stillActive).toHaveLength(1);
  });
});
