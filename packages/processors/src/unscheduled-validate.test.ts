import { describe, expect, it } from 'vitest';
import type { UnscheduledServiceRow, VerifiedSessionRow } from '@white-glove/shared';
import {
  validateSessionAgainstUnscheduled,
  validateVerifiedSessionTimes,
} from './unscheduled-validate.js';

describe('unscheduled-validate', () => {
  it('errors when API Report has only begin or end time', () => {
    const issue = validateVerifiedSessionTimes({
      sessionId: 'S-partial',
      startTime: '09:00 AM',
    });
    expect(issue?.code).toBe('incomplete_unscheduled_clock');
    expect(issue?.message).toContain('missing End Time');
    expect(issue?.message).not.toMatch(/incomplete clock/i);
  });

  it('errors when matched HHA unscheduled row has only out clock', () => {
    const session: VerifiedSessionRow = {
      sessionId: 'S-1',
      patientExternalId: '4257460',
      caregiverId: '1670638',
      visitDate: '2026-07-30',
      startTime: '08:30 AM',
      endTime: '09:00 AM',
    };
    const unscheduled: UnscheduledServiceRow[] = [
      {
        EVVOutTime: '2026-07-30T08:30:00',
        PatientId: 4257460,
        AideID: 1670638,
      },
    ];

    const issue = validateSessionAgainstUnscheduled(session, unscheduled);
    expect(issue?.code).toBe('incomplete_unscheduled_clock');
    expect(issue?.details?.missingSide).toBe('in');
    expect(issue?.message).toMatch(/missing clock-in/i);
    expect(issue?.message).not.toMatch(/incomplete/i);
  });

  it('says missing clock-out when matched row has only in clock', () => {
    const session: VerifiedSessionRow = {
      sessionId: 'S-out',
      patientExternalId: '4257460',
      caregiverId: '1670638',
      visitDate: '2026-07-30',
      startTime: '08:30 AM',
      endTime: '09:00 AM',
    };
    const unscheduled: UnscheduledServiceRow[] = [
      {
        EVVInTime: '2026-07-30T08:30:00',
        PatientId: 4257460,
        AideID: 1670638,
      },
    ];

    const issue = validateSessionAgainstUnscheduled(session, unscheduled);
    expect(issue?.details?.missingSide).toBe('out');
    expect(issue?.message).toMatch(/missing clock-out/i);
    expect(issue?.message).not.toMatch(/incomplete/i);
  });

  it('says missing clock (not incomplete) when no unscheduled row matches', () => {
    const session: VerifiedSessionRow = {
      sessionId: 'S-none',
      patientExternalId: '999',
      caregiverId: '888',
      visitDate: '2026-07-30',
      startTime: '08:30 AM',
      endTime: '09:00 AM',
    };
    const issue = validateSessionAgainstUnscheduled(session, [], { requireMatch: true });
    expect(issue?.details?.source).toBe('hha_unscheduled_missing');
    expect(issue?.details?.missingSide).toBe('both');
    expect(issue?.message).toMatch(/missing clock/i);
    expect(issue?.message).not.toMatch(/incomplete/i);
    expect(issue?.message).not.toMatch(/missing clock-in/i);
  });

  it('passes when both HHA clocks are present', () => {
    const session: VerifiedSessionRow = {
      sessionId: 'S-2',
      patientExternalId: '100',
      caregiverId: '200',
      visitDate: '2026-07-25',
      startTime: '10:36 AM',
      endTime: '11:06 AM',
    };
    const unscheduled: UnscheduledServiceRow[] = [
      {
        EVVInTime: '2026-07-25T10:36:00',
        EVVOutTime: '2026-07-25T11:06:00',
        PatientId: 100,
        AideID: 200,
      },
    ];

    expect(validateSessionAgainstUnscheduled(session, unscheduled)).toBeUndefined();
  });
});
