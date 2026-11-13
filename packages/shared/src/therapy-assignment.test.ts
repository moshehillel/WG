import { describe, expect, it } from 'vitest';
import {
  BILLU_COORDINATOR_ID,
  GRACE_COORDINATOR_ID,
  THERAPY_TEAM_ID,
  applyCoordinatorWrite,
  formatHhaCoordinatorRef,
  formatHhaTeamRef,
  resolveCaseCoordinators,
  resolveTherapyAssignment,
  therapyCoordinator2VerifyMismatchMessage,
  therapyCoordinatorVerifyMismatchMessage,
  therapyTeamVerifyMismatchMessage,
} from './therapy-assignment.js';

describe('therapy assignment verify messages', () => {
  it('includes human team names for known TeamID mismatch', () => {
    expect(therapyTeamVerifyMismatchMessage(10021466, 10022046)).toBe(
      'UpdatePatientDemographics reported success but TeamID is 10021466 (WGCC Therapy Services) instead of 10022046 (Therapy Team).',
    );
    expect(formatHhaTeamRef(10022046)).toBe('10022046 (Therapy Team)');
    expect(formatHhaTeamRef(10021466)).toBe('10021466 (WGCC Therapy Services)');
    expect(formatHhaTeamRef(2036)).toBe('2036 (Manager Wendy Ext. 3238)');
  });

  it('includes human coordinator names for known CoordinatorID1 mismatch', () => {
    expect(therapyCoordinatorVerifyMismatchMessage(6573, 67321)).toBe(
      'UpdatePatientDemographics reported success but CoordinatorID1 is 6573 (New Case) instead of 67321 (Grace Greenfeld).',
    );
    expect(formatHhaCoordinatorRef(84898)).toBe('84898 (Billu Markowitz)');
    expect(formatHhaCoordinatorRef(67321)).toBe('67321 (Grace Greenfeld)');
  });

  it('includes human coordinator names for a CoordinatorID2 mismatch', () => {
    expect(therapyCoordinator2VerifyMismatchMessage(6573, 84898)).toBe(
      'UpdatePatientDemographics reported success but CoordinatorID2 is 6573 (New Case) instead of 84898 (Billu Markowitz).',
    );
    expect(therapyCoordinator2VerifyMismatchMessage(undefined, 67321)).toBe(
      'UpdatePatientDemographics reported success but CoordinatorID2 is (missing) instead of 67321 (Grace Greenfeld).',
    );
  });

  it('marks unknown ids and missing actual values', () => {
    expect(therapyTeamVerifyMismatchMessage(undefined, THERAPY_TEAM_ID)).toBe(
      'UpdatePatientDemographics reported success but TeamID is (missing) instead of 10022046 (Therapy Team).',
    );
    expect(formatHhaTeamRef(99999999)).toBe('99999999 (name unknown)');
    expect(formatHhaCoordinatorRef('12345')).toBe('12345 (name unknown)');
  });
});

describe('resolveTherapyAssignment', () => {
  it('sends Therapy Team and Grace for last-name initials A through Q', () => {
    for (const name of ['ADAMS JANE', 'quinn, lee', 'Qadir Nora']) {
      const assignment = resolveTherapyAssignment(name);
      expect(assignment.ok).toBe(true);
      if (!assignment.ok) return;
      expect(assignment.teamId).toBe(THERAPY_TEAM_ID);
      expect(assignment.teamId).toBe(10022046);
      expect(assignment.coordinatorId).toBe(GRACE_COORDINATOR_ID);
      expect(assignment.coordinatorId).toBe(67321);
    }
  });

  it('sends Therapy Team and Billu for last-name initials R through Z', () => {
    for (const name of ['ROBERTS LEE', 'zimmerman ann', 'Rivera, Ana']) {
      const assignment = resolveTherapyAssignment(name);
      expect(assignment.ok).toBe(true);
      if (!assignment.ok) return;
      expect(assignment.teamId).toBe(10022046);
      expect(assignment.coordinatorId).toBe(BILLU_COORDINATOR_ID);
      expect(assignment.coordinatorId).toBe(84898);
    }
  });

  it('keeps the A/Q and R/Z boundaries', () => {
    expect(resolveTherapyAssignment('ADAMS JANE')).toMatchObject({
      ok: true,
      coordinatorId: 67321,
      teamId: 10022046,
    });
    expect(resolveTherapyAssignment('QUINN LEE')).toMatchObject({
      ok: true,
      coordinatorId: 67321,
      teamId: 10022046,
    });
    expect(resolveTherapyAssignment('ROBERTS LEE')).toMatchObject({
      ok: true,
      coordinatorId: 84898,
      teamId: 10022046,
    });
    expect(resolveTherapyAssignment('ZIMMERMAN ANN')).toMatchObject({
      ok: true,
      coordinatorId: 84898,
      teamId: 10022046,
    });
  });

  it('does not guess a coordinator when the provider last name is missing', () => {
    for (const name of [undefined, '', '   ', '—', 'JOHANA', '123 Aide']) {
      expect(resolveTherapyAssignment(name)).toEqual({
        ok: false,
        reason: 'missing_provider_last_name',
      });
    }
  });

  it('leaves Coordinator 2 empty when every therapist maps to Grace', () => {
    expect(resolveCaseCoordinators(['ADAMS JANE'])).toEqual({
      ok: true,
      teamId: 10022046,
      coordinatorId: 67321,
    });
    expect(resolveCaseCoordinators(['ADAMS JANE', 'QUINN LEE'])).toEqual({
      ok: true,
      teamId: 10022046,
      coordinatorId: 67321,
    });
  });

  it('leaves Coordinator 2 empty when every therapist maps to Billu', () => {
    expect(resolveCaseCoordinators(['ROBERTS LEE'])).toEqual({
      ok: true,
      teamId: 10022046,
      coordinatorId: 84898,
    });
    expect(resolveCaseCoordinators(['ROBERTS LEE', 'ZIMMERMAN ANN'])).toEqual({
      ok: true,
      teamId: 10022046,
      coordinatorId: 84898,
    });
  });

  it('puts the other coordinator in Coordinator 2, with Coordinator 1 from the first therapist', () => {
    expect(resolveCaseCoordinators(['ADAMS JANE', 'ROBERTS LEE'])).toEqual({
      ok: true,
      teamId: 10022046,
      coordinatorId: GRACE_COORDINATOR_ID,
      coordinatorId2: BILLU_COORDINATOR_ID,
    });
    expect(resolveCaseCoordinators(['ROBERTS LEE', 'ADAMS JANE'])).toEqual({
      ok: true,
      teamId: 10022046,
      coordinatorId: BILLU_COORDINATOR_ID,
      coordinatorId2: GRACE_COORDINATOR_ID,
    });
  });

  it('stops the case write when any grouped therapist has no last name', () => {
    expect(resolveCaseCoordinators(['ADAMS JANE', undefined])).toEqual({
      ok: false,
      reason: 'missing_provider_last_name',
    });
    expect(resolveCaseCoordinators(['JOHANA'])).toEqual({
      ok: false,
      reason: 'missing_provider_last_name',
    });
    expect(resolveCaseCoordinators([])).toEqual({
      ok: false,
      reason: 'missing_provider_last_name',
    });
  });

  it('keeps an existing Coordinator 1 and adds the other person as Coordinator 2', () => {
    expect(
      applyCoordinatorWrite(
        {
          teamId: THERAPY_TEAM_ID,
          coordinatorId: BILLU_COORDINATOR_ID,
          preserveExistingCoordinator1: true,
        },
        { coordinatorId1: GRACE_COORDINATOR_ID },
      ),
    ).toEqual({
      coordinatorId: GRACE_COORDINATOR_ID,
      coordinatorId2: BILLU_COORDINATOR_ID,
      clearCoordinator2: false,
    });
    expect(
      applyCoordinatorWrite(
        {
          teamId: THERAPY_TEAM_ID,
          coordinatorId: GRACE_COORDINATOR_ID,
          preserveExistingCoordinator1: true,
        },
        { coordinatorId1: '67321' },
      ),
    ).toEqual({
      coordinatorId: GRACE_COORDINATOR_ID,
      clearCoordinator2: false,
    });
  });

  it('does not assign Esty, Abigail, or the other Grace id', () => {
    const assignment = resolveTherapyAssignment('FORTUNE JOHANA');
    expect(assignment.ok).toBe(true);
    if (!assignment.ok) return;
    expect(assignment.coordinatorId).not.toBe(67322);
    expect(assignment.coordinatorId).not.toBe(68033);
    expect(assignment.coordinatorId).not.toBe(81103);
  });
});
