import type { FindPatientOptions } from './types.js';

/**
 * True only when `patientId` is a numeric HHA PatientID that is not the
 * ProviderSoft Program Id. Parsers often copy Program Id into patientExternalId;
 * using that as PatientID causes GetPatientContracts ErrorID=-56.
 */
export function isTrustedHhaPatientId(
  patientId: string | undefined,
  caseId?: string,
): boolean {
  const trimmed = patientId?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return false;
  if (caseId?.trim() && trimmed === caseId.trim()) return false;
  return true;
}

/** Build findPatient options: MR/admission via ids, then name+DOB fallback. */
export function toFindPatientOptions(row: {
  caseId?: string;
  patientExternalId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  realDateOfBirth?: string;
}): FindPatientOptions {
  return {
    caseId: row.caseId,
    externalId: row.patientExternalId ?? row.caseId,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth ?? row.realDateOfBirth,
  };
}

/** Message patterns that mean the patient/service is already discharged in HHA. */
export function isAlreadyDischargedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    /No active HHA placements/i.test(msg) ||
    /No active HHA placements to discharge/i.test(msg)
  );
}
