import type { HhaClient } from '@white-glove/hha-client';
import { toFindPatientOptions } from '@white-glove/hha-client';

export type PatientLookupRow = {
  caseId?: string;
  patientExternalId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  realDateOfBirth?: string;
};

/**
 * Shared HHA patient lookup for all report processors (opened / closed /
 * discharge / sessions). Uses MR → admission → zero-strip → name+DOB.
 */
export async function resolveHhaPatientId(
  hha: HhaClient,
  row: PatientLookupRow,
): Promise<string | undefined> {
  return hha.findPatient(toFindPatientOptions(row));
}
