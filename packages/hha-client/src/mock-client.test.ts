import { describe, expect, it } from 'vitest';
import { MockHhaClient } from './mock-client.js';

describe('MockHhaClient', () => {
  it('upserts patient idempotently by external id', async () => {
    const client = new MockHhaClient();
    const first = await client.upsertPatient({
      externalId: 'p1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const second = await client.upsertPatient({
      externalId: 'p1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it('approves visits and validates transfers', async () => {
    const client = new MockHhaClient();
    const patient = await client.upsertPatient({
      firstName: 'Grace',
      lastName: 'Hopper',
      caseId: 'c1',
    });
    const visit = await client.locateOrScheduleVisit({
      patientId: patient.id,
      visitDate: '2026-07-14',
      startTime: '09:00',
      endTime: '10:00',
    });
    const clocking = await client.getClockingDetails(visit.id, {
      patientId: patient.id,
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(clocking.matchesExpected).toBe(true);
    await client.approveVisit(visit.id);
    const validation = await client.validateTransfer([patient.id, visit.id]);
    expect(validation.ok).toBe(true);
  });
});
