import type { HhaPatient, OpenedCaseRow } from '@white-glove/shared';

/** Map Gluck opened-case row → HHA patient payload for search / CreatePatient. */
export function openedCaseToHhaPatient(row: OpenedCaseRow): HhaPatient {
  const dateOfBirth = row.dateOfBirth ?? row.realDateOfBirth;
  return {
    externalId: row.patientExternalId ?? row.caseId,
    caseId: row.caseId,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth,
    intakeDate: row.intakeDate ?? row.startDate,
    serviceCode: row.serviceCode,
    address1: row.address1,
    city: row.city,
    state: row.state,
    zipCode: row.zipCode,
    homePhone: row.homePhone ?? row.childPhone,
    emergencyContactName: row.emergencyContactName,
  };
}
