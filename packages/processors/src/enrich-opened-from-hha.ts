import type { HhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow } from '@white-glove/shared';
import { normalizeHhaGender } from '@white-glove/shared';
import { resolveHhaPatientId } from './resolve-hha-patient.js';

function blank(value: string | undefined): boolean {
  return !value?.trim();
}

export type EnrichOpenedFromHhaResult = {
  row: OpenedCaseRow;
  /**
   * new_services only: whether findPatient matched an HHA child.
   * undefined for Gluck open (no pre-lookup).
   */
  patientFound: boolean | undefined;
  /** HHA patient id when patientFound === true. */
  hhaPatientId?: string;
};

/**
 * new_services: always look up the child in HHA first (MR / admission / zero-strip /
 * name+DOB). If missing → patientFound false (caller fails with not-found — do not
 * treat blank Gender/City as the primary error). If found → fill blank demographics
 * from GetPatientDemographics, then caller may run billing guard.
 *
 * Gluck open is a new intake — fields must come from ProviderSoft, not HHA.
 */
export async function enrichOpenedRowFromHha(
  row: OpenedCaseRow,
  hha: HhaClient,
): Promise<EnrichOpenedFromHhaResult> {
  if (row.sourceReport !== 'new_services') {
    return { row, patientFound: undefined };
  }

  if (!row.caseId?.trim()) {
    return { row, patientFound: false };
  }

  const patientId = await resolveHhaPatientId(hha, row);
  if (!patientId) {
    return { row, patientFound: false };
  }

  const needsGender = blank(row.gender) || !normalizeHhaGender(row.gender);
  const needsAddress1 = blank(row.address1);
  const needsCity = blank(row.city);
  const needsState = blank(row.state);
  const needsZip = blank(row.zipCode);
  if (!needsGender && !needsAddress1 && !needsCity && !needsState && !needsZip) {
    return { row, patientFound: true, hhaPatientId: patientId };
  }

  const demo = await hha.getPatientDemographicsFields(patientId);
  const next: OpenedCaseRow = { ...row };

  if (needsGender && demo.gender) next.gender = demo.gender;
  if (needsAddress1 && demo.address1) next.address1 = demo.address1;
  if (needsCity && demo.city) next.city = demo.city;
  if (needsState && demo.state) next.state = demo.state;
  if (needsZip && demo.zipCode) next.zipCode = demo.zipCode;

  return { row: next, patientFound: true, hhaPatientId: patientId };
}
