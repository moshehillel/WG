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

  it('looks up via findPatient when patientExternalId equals Program Id (ErrorID=-56 footgun)', async () => {
    const hha = new MockHhaClient();
    const patient = await hha.upsertPatient({
      caseId: '49247',
      firstName: 'Tianming',
      lastName: 'Chen',
    });
    const placement = await hha.upsertContract({
      patientId: patient.id,
      contractExternalId: 'americare',
      serviceCode: 'PT HC Eval',
      startDate: '07/20/2026',
    });

    const result = await processDischargeService({
      runId: 'run-56',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [
        {
          caseId: '49247',
          patientExternalId: '49247',
          firstName: 'Tianming',
          lastName: 'Chen',
          dateOfBirth: '12/25/1995',
          serviceCode: 'PT HC Eval',
          startDate: '07/20/2026',
          dischargeDate: '08/25/2026',
        },
      ],
    });

    expect(result.failed).toBe(0);
    expect(result.succeeded).toBe(1);
    expect(hha.calls).toContain('findPatient');
    expect(hha.dischargedPlacements.has(placement.id)).toBe(true);
  });

  it('skips duplicate discharge when no active placements remain (Milez pattern)', async () => {
    const hha = new MockHhaClient();
    const patient = await hha.upsertPatient({
      caseId: 'P0100012106301',
      firstName: 'Milez',
      lastName: 'Hall',
    });
    await hha.upsertContract({
      patientId: patient.id,
      contractExternalId: 'americare',
      serviceCode: 'SLP HC EVAL',
      startDate: '07/12/2026',
    });

    const store = new InMemoryIdempotencyStore();
    const first = await processDischargeService({
      runId: 'run-milez',
      hha,
      store,
      rows: [
        {
          caseId: 'P0100012106301',
          firstName: 'Milez',
          lastName: 'Hall',
          serviceCode: 'SLP HC EVAL',
          startDate: '07/12/2026',
          dischargeDate: '08/25/2026',
          programType: 'Americare Certified',
        },
      ],
    });
    expect(first.succeeded).toBe(1);

    const second = await processDischargeService({
      runId: 'run-milez',
      hha,
      store,
      rows: [
        {
          caseId: 'P0100012106301',
          firstName: 'Milez',
          lastName: 'Hall',
          serviceCode: 'SLP HC EVAL',
          startDate: '08/12/2026',
          dischargeDate: '08/25/2026',
          programType: 'Americare Certified',
        },
      ],
    });

    expect(second.failed).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.exceptions[0]?.code).toBe('skipped_by_rule');
    expect(second.exceptions[0]?.details?.triageReason).toBe('already_discharged');
  });
});
