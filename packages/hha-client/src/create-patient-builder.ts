import type { HhaPatient } from '@white-glove/shared';
import { psDateToIso } from './hha-time.js';

export interface CreatePatientDefaults {
  officeId: number;
  coordinatorId: number;
  sourceOfAdmission: number;
  branchId: number;
  teamId: number;
  locationId: number;
  mobilityStatusId: number;
  evacuationZoneId: number;
  defaultGender: string;
  admissionIdPrefix?: string;
}

export interface CreatePatientReferenceIds {
  branchId: number;
  teamId: number;
  locationId: number;
  mobilityStatusId: number;
  evacuationZoneId: number;
}

const KNOWN_DISCIPLINES = ['OT', 'PT', 'ST', 'SLP', 'RN', 'HHA', 'PCA', 'SI'];

export function mapServiceToDiscipline(serviceType: string | undefined): string {
  const s = (serviceType ?? '').toUpperCase();
  const first = s.trim().split(/\s+/)[0] ?? '';
  if (first === 'SI' || first.startsWith('SI-')) return 'SI';
  if (s.includes('OT')) return 'OT';
  if (s.includes('PT')) return 'PT';
  if (s.includes('ST') || s.includes('SPEECH') || s.includes('SLP')) return 'ST';
  if (s.includes('RN')) return 'RN';
  if (s.includes('HHA')) return 'HHA';
  if (s.includes('PCA')) return 'PCA';
  const token = first.replace(/[^A-Z]/g, '');
  if (token && KNOWN_DISCIPLINES.includes(token)) return token;
  return 'OT';
}

export function parseZipCode(zip: string | undefined): { zip5: number; zip4: number } {
  const m = zip?.replace(/\s/g, '').match(/^(\d{5})(?:-(\d{4}))?/);
  return { zip5: m ? Number(m[1]) : 0, zip4: m?.[2] ? Number(m[2]) : 0 };
}

/** HHA MedicaidNumber when PS does not supply one (sandbox convention). */
export function formatMedicaidNumber(programId: string | undefined): string {
  const digits = String(programId ?? '')
    .replace(/\D/g, '')
    .padStart(5, '0')
    .slice(-5);
  const suffixLetter = String.fromCharCode(65 + (Number(digits.slice(-1)) % 26));
  return `ZW${digits}${suffixLetter}`;
}

export function formatAdmissionId(
  caseId: string | undefined,
  prefix = 'PS',
): string | undefined {
  if (!caseId?.trim()) return undefined;
  const id = caseId.trim();
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

function formatPhone(digits: string | undefined): string {
  const d = (digits ?? '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return digits?.trim() ?? '';
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function canCreatePatient(
  patient: HhaPatient,
  defaults: Pick<CreatePatientDefaults, 'officeId' | 'coordinatorId'>,
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!defaults.officeId) missing.push('officeId');
  if (!defaults.coordinatorId) missing.push('coordinatorId');
  if (!patient.firstName?.trim()) missing.push('firstName');
  if (!patient.lastName?.trim()) missing.push('lastName');
  if (!patient.dateOfBirth?.trim()) missing.push('dateOfBirth');
  if (!patient.address1?.trim()) missing.push('address1');
  if (!patient.city?.trim()) missing.push('city');
  if (!patient.state?.trim()) missing.push('state');
  if (!patient.zipCode?.trim()) missing.push('zipCode');
  if (!patient.caseId?.trim() && !patient.externalId?.trim()) missing.push('caseId');
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

export function buildCreatePatientBody(
  patient: HhaPatient,
  defaults: CreatePatientDefaults,
  refs: CreatePatientReferenceIds,
): string {
  const admissionId = formatAdmissionId(patient.caseId ?? patient.externalId, defaults.admissionIdPrefix);
  if (!admissionId) {
    throw new Error('CreatePatient requires caseId or externalId for AdmissionID');
  }

  const birthDate = psDateToIso(patient.dateOfBirth) ?? patient.dateOfBirth!;
  const serviceRequestStartDate =
    psDateToIso(patient.intakeDate) ?? psDateToIso(patient.dateOfBirth) ?? birthDate;
  const { zip5, zip4 } = parseZipCode(patient.zipCode);
  const phone = patient.homePhone ? formatPhone(patient.homePhone) : '';
  const discipline = mapServiceToDiscipline(patient.serviceCode);
  const gender = patient.gender?.trim() || defaults.defaultGender;

  return `<PatientInfo>
  <OfficeID>${defaults.officeId}</OfficeID>
  <FirstName>${esc(patient.firstName)}</FirstName>
  <LastName>${esc(patient.lastName)}</LastName>
  <BirthDate>${esc(birthDate)}</BirthDate>
  <Gender>${esc(gender)}</Gender>
  <CoordinatorID1>${defaults.coordinatorId}</CoordinatorID1>
  <ServiceRequestStartDate>${esc(serviceRequestStartDate)}</ServiceRequestStartDate>
  <AdmissionID>${esc(admissionId)}</AdmissionID>
  <MedicaidNumber>${esc(formatMedicaidNumber(patient.caseId ?? patient.externalId))}</MedicaidNumber>
  <AllowDuplicate>1</AllowDuplicate>
  <SourceOfAdmission>${defaults.sourceOfAdmission}</SourceOfAdmission>
  <BranchID>${refs.branchId}</BranchID>
  <TeamID>${refs.teamId}</TeamID>
  <LocationID>${refs.locationId}</LocationID>
  <AcceptedServices>
    <Discipline>${esc(discipline)}</Discipline>
  </AcceptedServices>
  <Addresses>
    <Address>
      <Address1>${esc(patient.address1!)}</Address1>
      <City>${esc(patient.city!)}</City>
      <State>${esc(patient.state!)}</State>
      <Zip5>${zip5 || 11201}</Zip5>
      <Zip4>${zip4}</Zip4>
      <IsPrimaryAddress>Yes</IsPrimaryAddress>
      <AddressTypes>Home</AddressTypes>
    </Address>
  </Addresses>
  ${phone ? `<HomePhone>${esc(phone)}</HomePhone>` : ''}
  ${
    patient.emergencyContactName?.trim()
      ? `<EmergencyContacts>
    <EmergencyContact>
      <Name>${esc(patient.emergencyContactName)}</Name>
      <RelationshipID>-2</RelationshipID>
      ${phone ? `<Phone1>${esc(phone)}</Phone1>` : ''}
    </EmergencyContact>
  </EmergencyContacts>`
      : ''
  }
  <EmergencyPreparedness>
    <EvacuationZoneID>${refs.evacuationZoneId}</EvacuationZoneID>
    <MobilityStatusID>${refs.mobilityStatusId}</MobilityStatusID>
  </EmergencyPreparedness>
</PatientInfo>`;
}

export function createPatientDefaultsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CreatePatientDefaults {
  return {
    officeId: Number(env.HHA_OFFICE_ID || 1025),
    coordinatorId: Number(env.HHA_COORDINATOR_ID || 81103),
    sourceOfAdmission: Number(env.HHA_SOURCE_OF_ADMISSION || 9300),
    branchId: Number(env.HHA_BRANCH_ID || 10073742),
    teamId: Number(env.HHA_TEAM_ID || 2036),
    locationId: Number(env.HHA_LOCATION_ID || 12284),
    mobilityStatusId: Number(env.HHA_MOBILITY_STATUS_ID || 2495),
    evacuationZoneId: Number(env.HHA_EVACUATION_ZONE_ID || 10003239),
    defaultGender: env.HHA_DEFAULT_GENDER?.trim() || 'Male',
    admissionIdPrefix: env.HHA_ADMISSION_ID_PREFIX?.trim() || 'PS',
  };
}

export function defaultReferenceIds(env: NodeJS.ProcessEnv = process.env): CreatePatientReferenceIds {
  const d = createPatientDefaultsFromEnv(env);
  return {
    branchId: d.branchId,
    teamId: d.teamId,
    locationId: d.locationId,
    mobilityStatusId: d.mobilityStatusId,
    evacuationZoneId: d.evacuationZoneId,
  };
}
