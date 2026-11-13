import { stripProviderDisciplineSuffixes } from './utils/name-match.js';

/**
 * Therapy Team on White Glove Community (office 1025).
 * Same id as CREATE_PATIENT_TEAM_ID in hha-client create-patient-builder.ts.
 * Named 2026-10-28. 2036 is Manager Wendy and is not this team.
 */
export const THERAPY_TEAM_ID = 10022046;

/**
 * Grace Greenfeld, sessions coordinator.
 * The unscheduled-visit client falls back to 67321 alone
 * (entGraphqlConfigFromEnv). 67322 is the other Grace id on the
 * fetch list. This repo does not choose between them by office.
 */
export const GRACE_COORDINATOR_ID = 67321;

/** Billu Markowitz. Same coordinator as TMS CreatePatient (84898). */
export const BILLU_COORDINATOR_ID = 84898;

/** Manager Wendy Ext. 3238 on office 1025. Never write this TeamID. */
export const MANAGER_WENDY_TEAM_ID = 2036;

/**
 * Static HHA TeamID → Name for verify/ops messages.
 * 10021466 comes from prod GetPatientDemographics dumps
 * (WGCC Therapy Services). 10022046 is Therapy Team (required write target).
 * No GetTeams catalog is cached in-repo.
 */
export const KNOWN_HHA_TEAM_NAMES: Readonly<Record<number, string>> = {
  10022046: 'Therapy Team',
  10021466: 'WGCC Therapy Services',
  2036: 'Manager Wendy Ext. 3238',
};

/**
 * Static CoordinatorID → Name for verify/ops messages.
 * 6573 appears as New Case on WGCC Therapy Services charts in demog dumps.
 */
export const KNOWN_HHA_COORDINATOR_NAMES: Readonly<Record<number, string>> = {
  67321: 'Grace Greenfeld',
  84898: 'Billu Markowitz',
  6573: 'New Case',
};

export interface TherapyAssignmentIds {
  teamId: number;
  coordinatorId: number;
  /**
   * Coordinator 2 when another therapist on the same case maps to the other person.
   * Omit when Coordinator 2 stays empty. Never copy Coordinator 1 into this field.
   */
  coordinatorId2?: number;
  /**
   * Later new-service update. Keep Coordinator 1 when the chart already has
   * Grace Greenfeld (67321) or Billu Markowitz (84898).
   */
  preserveExistingCoordinator1?: boolean;
  /**
   * New-child write with only one coordinator. Send Coordinator 2 empty.
   * Leave this unset when an existing Coordinator 2 should stay as it is.
   */
  clearCoordinator2?: boolean;
}

/** `10022046 (Therapy Team)` or `999 (name unknown)` or `(missing)`. */
export function formatHhaTeamRef(id: string | number | null | undefined): string {
  return formatKnownHhaRef(id, KNOWN_HHA_TEAM_NAMES);
}

/** `67321 (Grace Greenfeld)` or `999 (name unknown)` or `(missing)`. */
export function formatHhaCoordinatorRef(id: string | number | null | undefined): string {
  return formatKnownHhaRef(id, KNOWN_HHA_COORDINATOR_NAMES);
}

function formatKnownHhaRef(
  id: string | number | null | undefined,
  names: Readonly<Record<number, string>>,
): string {
  if (id == null || id === '' || id === '(missing)') return '(missing)';
  const n = typeof id === 'number' ? id : Number(String(id).trim());
  if (!Number.isFinite(n)) return `${id} (name unknown)`;
  const name = names[n];
  return name ? `${n} (${name})` : `${n} (name unknown)`;
}

/** Post-UpdatePatientDemographics TeamID verify failure (ids + known names). */
export function therapyTeamVerifyMismatchMessage(
  actualId: string | number | null | undefined,
  expectedId: string | number | null | undefined,
): string {
  return (
    `UpdatePatientDemographics reported success but TeamID is ${formatHhaTeamRef(actualId)} ` +
    `instead of ${formatHhaTeamRef(expectedId)}.`
  );
}

/** Post-UpdatePatientDemographics CoordinatorID1 verify failure (ids + known names). */
export function therapyCoordinatorVerifyMismatchMessage(
  actualId: string | number | null | undefined,
  expectedId: string | number | null | undefined,
): string {
  return (
    `UpdatePatientDemographics reported success but CoordinatorID1 is ${formatHhaCoordinatorRef(actualId)} ` +
    `instead of ${formatHhaCoordinatorRef(expectedId)}.`
  );
}

/** Post-UpdatePatientDemographics CoordinatorID2 verify failure (ids + known names). */
export function therapyCoordinator2VerifyMismatchMessage(
  actualId: string | number | null | undefined,
  expectedId: string | number | null | undefined,
): string {
  return (
    `UpdatePatientDemographics reported success but CoordinatorID2 is ${formatHhaCoordinatorRef(actualId)} ` +
    `instead of ${formatHhaCoordinatorRef(expectedId)}.`
  );
}

export type TherapyAssignment =
  | { ok: true; teamId: number; coordinatorId: number; lastName: string }
  | { ok: false; reason: 'missing_provider_last_name' };

/**
 * ProviderSoft provider names are LAST FIRST. "Last, First" is also accepted.
 * A single token has no last name.
 */
export function providerLastName(providerName: string | undefined): string | undefined {
  const raw = (providerName ?? '').trim();
  if (!raw || raw === '—') return undefined;

  const comma = raw.indexOf(',');
  const last =
    comma > 0
      ? stripProviderDisciplineSuffixes(raw.slice(0, comma))
      : lastFirstSurname(stripProviderDisciplineSuffixes(raw));
  return last.trim() || undefined;
}

function lastFirstSurname(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  return parts[0] ?? '';
}

/** A–Q → Grace. R–Z → Billu. Missing or non-letter last name does not guess. */
export function resolveTherapyAssignment(providerName: string | undefined): TherapyAssignment {
  const lastName = providerLastName(providerName);
  if (!lastName) return { ok: false, reason: 'missing_provider_last_name' };
  const initial = lastName.charAt(0).toUpperCase();
  if (initial < 'A' || initial > 'Z') return { ok: false, reason: 'missing_provider_last_name' };
  return {
    ok: true,
    teamId: THERAPY_TEAM_ID,
    coordinatorId: initial <= 'Q' ? GRACE_COORDINATOR_ID : BILLU_COORDINATOR_ID,
    lastName,
  };
}

export function assertTherapyAssignment(assignment: TherapyAssignmentIds): void {
  if (assignment.teamId !== THERAPY_TEAM_ID) {
    throw new Error(
      `Refusing HHA write: team ${assignment.teamId} is not Therapy Team (${THERAPY_TEAM_ID}).`,
    );
  }
  if (
    assignment.coordinatorId !== GRACE_COORDINATOR_ID &&
    assignment.coordinatorId !== BILLU_COORDINATOR_ID
  ) {
    throw new Error(
      `Refusing HHA write: coordinator ${assignment.coordinatorId} is not Grace Greenfeld (${GRACE_COORDINATOR_ID}) or Billu Markowitz (${BILLU_COORDINATOR_ID}).`,
    );
  }
  if (assignment.coordinatorId2 == null) return;
  if (
    assignment.coordinatorId2 !== GRACE_COORDINATOR_ID &&
    assignment.coordinatorId2 !== BILLU_COORDINATOR_ID
  ) {
    throw new Error(
      `Refusing HHA write: Coordinator 2 ${assignment.coordinatorId2} is not Grace Greenfeld (${GRACE_COORDINATOR_ID}) or Billu Markowitz (${BILLU_COORDINATOR_ID}).`,
    );
  }
  if (assignment.coordinatorId2 === assignment.coordinatorId) {
    throw new Error(
      `Refusing HHA write: Coordinator 2 must stay empty instead of copying Coordinator 1 (${formatHhaCoordinatorRef(assignment.coordinatorId)}).`,
    );
  }
}

export type CaseCoordinatorAssignment =
  | {
      ok: true;
      teamId: number;
      coordinatorId: number;
      coordinatorId2?: number;
    }
  | { ok: false; reason: 'missing_provider_last_name' };

/**
 * Group therapists on one case.
 * The first name is the existing primary row, otherwise the first row, and sets Coordinator 1.
 * A later therapist whose last name maps to the other person sets Coordinator 2.
 * One therapist, or every therapist mapping to the same person, leaves Coordinator 2 empty.
 * A missing last name stops the write.
 */
export function resolveCaseCoordinators(
  providerNames: Array<string | undefined>,
): CaseCoordinatorAssignment {
  if (!providerNames.length) return { ok: false, reason: 'missing_provider_last_name' };
  const resolved: Array<Extract<TherapyAssignment, { ok: true }>> = [];
  for (const name of providerNames) {
    const assignment = resolveTherapyAssignment(name);
    if (!assignment.ok) return assignment;
    resolved.push(assignment);
  }
  const coordinatorId = resolved[0]!.coordinatorId;
  const coordinatorId2 = resolved.slice(1).find((row) => row.coordinatorId !== coordinatorId)?.coordinatorId;
  return {
    ok: true,
    teamId: THERAPY_TEAM_ID,
    coordinatorId,
    ...(coordinatorId2 ? { coordinatorId2 } : {}),
  };
}

export interface CoordinatorChartSnapshot {
  coordinatorId1?: string | number | null;
  coordinatorId2?: string | number | null;
}

export interface AppliedCoordinatorWrite {
  coordinatorId: number;
  coordinatorId2?: number;
  /** True when this write sends Coordinator 2 empty. */
  clearCoordinator2: boolean;
}

function knownTherapyCoordinatorId(id: string | number | null | undefined): number | undefined {
  if (id == null || id === '') return undefined;
  const n = typeof id === 'number' ? id : Number(String(id).trim());
  if (n === GRACE_COORDINATOR_ID || n === BILLU_COORDINATOR_ID) return n;
  return undefined;
}

/**
 * Chart write for UpdatePatientDemographics.
 * On a later new-service update, an existing Grace or Billu Coordinator 1 stays.
 * The new therapist is added as Coordinator 2 when they map to the other person.
 */
export function applyCoordinatorWrite(
  assignment: TherapyAssignmentIds,
  chart: CoordinatorChartSnapshot = {},
): AppliedCoordinatorWrite {
  const chartCoordinator1 = knownTherapyCoordinatorId(chart.coordinatorId1);
  const keepExisting =
    assignment.preserveExistingCoordinator1 === true && chartCoordinator1 != null;
  const coordinatorId = keepExisting ? chartCoordinator1 : assignment.coordinatorId;
  const seen: number[] = [];
  for (const id of [assignment.coordinatorId, assignment.coordinatorId2]) {
    if (id == null || seen.includes(id)) continue;
    if (id !== GRACE_COORDINATOR_ID && id !== BILLU_COORDINATOR_ID) continue;
    seen.push(id);
  }
  const coordinatorId2 = seen.find((id) => id !== coordinatorId);
  if (coordinatorId2) {
    return { coordinatorId, coordinatorId2, clearCoordinator2: false };
  }
  return {
    coordinatorId,
    clearCoordinator2: assignment.clearCoordinator2 === true,
  };
}

/**
 * Coordinator on CreatePatient.
 * An explicit Grace (67321) or Billu (84898) id is kept.
 * TMS CreatePatient passes none, so it stays Billu.
 * 67322, Abigail Creech (81103), and Esty Neuman (68033) are not used.
 */
export function coordinatorIdForNewChild(explicit?: number): number {
  if (explicit === GRACE_COORDINATOR_ID || explicit === BILLU_COORDINATOR_ID) return explicit;
  return BILLU_COORDINATOR_ID;
}

/**
 * Coordinator 2 on the new-child CreatePatient.
 * Set only when it is the other of Grace (67321) or Billu (84898).
 * TMS CreatePatient passes none. 67322, 68033, and 81103 are not used.
 */
export function coordinatorId2ForNewChild(
  explicit: number | undefined,
  coordinatorId1: number,
): number | undefined {
  if (explicit !== GRACE_COORDINATOR_ID && explicit !== BILLU_COORDINATOR_ID) return undefined;
  if (explicit === coordinatorId1) return undefined;
  return explicit;
}
