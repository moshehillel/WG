import type { HhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow } from '@white-glove/shared';
import { normalizeHhaGender } from '@white-glove/shared';
import { resolveHhaPatientId } from './resolve-hha-patient.js';

function blank(value: string | undefined): boolean {
  return !value?.trim();
}

function needsDemographicFill(row: OpenedCaseRow): boolean {
  return (
    blank(row.gender) ||
    !normalizeHhaGender(row.gender) ||
    blank(row.address1) ||
    blank(row.city) ||
    blank(row.state) ||
    blank(row.zipCode)
  );
}

export type EnrichOpenedFromHhaResult = {
  row: OpenedCaseRow;
  /**
   * Whether findPatient matched an HHA child.
   * - new_services: always looked up (false → caller fails unmatched).
   * - opened_cases: looked up only when demographics need fill; false = true new intake.
   * - undefined: no lookup (e.g. Gluck row already had address fields).
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
 * opened_cases (Gluck): if blank address/city/state (or gender) and an existing HHA
 * patient is found, backfill those blanks before billing guard. If not found (true
 * new intake), leave ProviderSoft fields as-is — billing guard still requires them.
 */
export async function enrichOpenedRowFromHha(
  row: OpenedCaseRow,
  hha: HhaClient,
): Promise<EnrichOpenedFromHhaResult> {
  const isNewServices = row.sourceReport === 'new_services';
  const isGluck = row.sourceReport === 'opened_cases';

  if (!isNewServices && !isGluck) {
    return { row, patientFound: undefined };
  }

  // Gluck with complete demographics: no HHA lookup (true new intakes keep PS fields).
  if (isGluck && !needsDemographicFill(row)) {
    return { row, patientFound: undefined };
  }

  if (!row.caseId?.trim()) {
    return { row, patientFound: isNewServices ? false : undefined };
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
