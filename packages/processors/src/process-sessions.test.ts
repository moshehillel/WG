import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { processVerifiedSessions } from './process-sessions.js';

describe('processVerifiedSessions', () => {
  it('auto-approves, verifies clocking, and errors on unknown service types', async () => {
    const hha = new MockHhaClient();
    hha.patients.set('p1', {
      id: 'patient-p1',
      externalId: 'p1',
      firstName: 'Test',
      lastName: 'Patient',
    });
    hha.pendingCalls.set('patient-p1:2026-07-14:mock-caregiver-1', {
      callDashboardId: 'clock-1',
    });
    hha.placeholderVisits.push(
      {
        id: 'placeholder-1',
        patientId: 'patient-p1',
        caregiverId: 'mock-caregiver-1',
        startTime: '0100',
        endTime: '0130',
      },
      {
        id: 'daytime',
        patientId: 'patient-p1',
        caregiverId: 'mock-caregiver-1',
        startTime: '0900',
        endTime: '1000',
      },
    );
    const result = await processVerifiedSessions({
      runId: 'run-s',
      hha,
      store: new InMemoryIdempotencyStore(),
      // Legacy SOAP pending-call path (not ENT unscheduled fetch).
      unscheduledFetchActive: false,
      rows: [
        {
          sessionId: 'S-auto',
          patientExternalId: 'p1',
          serviceCode: 'OT CHHA EXTENDED',
          programType: 'Garden City UFSD Therapy',
          visitDate: '2026-07-14',
          startTime: '09:00 AM',
          endTime: '10:00 AM',
          providerName: 'FORTUNE JOHANA',
          payRate: '72',
        },
        {
          sessionId: 'S-verify',
          patientExternalId: 'p1',
          serviceCode: 'OT CHHA EXTENDED',
          programType: 'Extended Home Care Therapy',
          visitDate: '2026-07-14',
          startTime: '11:00 AM',
          endTime: '12:00 PM',
          providerName: 'FORTUNE JOHANA',
          payRate: '72',
        },
        {
          sessionId: 'S-fail',
          patientExternalId: 'p1',
          serviceCode: 'OT CHHA EXTENDED',
          programType: 'Unknown Payer XYZ',
          visitDate: '2026-07-14',
        },
      ],
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(hha.calls).toContain('findPatient');
    expect(hha.calls).toContain('upsertAuthorization');
    expect(hha.calls).toContain('approveVisit');
    expect(hha.calls).toContain('removeEvvPlaceholderVisits');
    expect(hha.placeholderVisits.map((visit) => visit.id)).toEqual(['daytime']);
    expect(hha.calls).toContain('getClockingDetails');
    expect(hha.calls).toContain('resolveCaregiverId');
    expect(hha.patientAssignments).toEqual([
      expect.objectContaining({ patientId: 'patient-p1', teamId: 10022046, coordinatorId: 67321 }),
      expect.objectContaining({ patientId: 'patient-p1', teamId: 10022046, coordinatorId: 67321 }),
    ]);
  });

  it('does not write a visit when the provider last name is missing', async () => {
    const hha = new MockHhaClient();
    hha.patients.set('p1', {
      id: 'patient-p1',
      externalId: 'p1',
      firstName: 'Test',
      lastName: 'Patient',
    });
    const result = await processVerifiedSessions({
      runId: 'run-no-last',
      hha,
      store: new InMemoryIdempotencyStore(),
      unscheduledFetchActive: false,
      rows: [
        {
          sessionId: 'S-nolast',
          patientExternalId: 'p1',
          serviceCode: 'OT CHHA EXTENDED',
          programType: 'Garden City UFSD Therapy',
          visitDate: '2026-07-14',
          startTime: '09:00 AM',
          endTime: '10:00 AM',
          providerName: 'JOHANA',
          payRate: '72',
        },
      ],
    });
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.exceptions[0]?.code).toBe('missing_field');
    expect(hha.calls).not.toContain('ensureAcceptedServices');
    expect(hha.calls).not.toContain('approveVisit');
    expect(hha.patientAssignments).toHaveLength(0);
  });
});
