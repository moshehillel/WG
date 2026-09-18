import type { HhaPatient } from '@white-glove/shared';
import { psDateToIso } from './hha-time.js';

export { normalizeHhaGender } from '@white-glove/shared';

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

// NOTE: 'SLP' is deliberately NOT a leading-token discipline. HHA AcceptedServices
// rejects "SLP" and "SP" (-411 Invalid Accepted Services). This agency's speech
// discipline is "ST" (same as GetDisciplines / CreateSchedule). Leaving SLP out
// here lets "SLP CHHA" / "SLP HC EVAL" fall through to the → 'ST' rule below.
const KNOWN_DISCIPLINES = ['OT', 'PT', 'ST', 'RN', 'HHA', 'PCA', 'SI', 'COTA', 'PTA'];

export function mapServiceToDiscipline(serviceType: string | undefined): string {
  const s = (serviceType ?? '').toUpperCase().trim();
  const first = s.split(/\s+/)[0] ?? '';
  const token = first.replace(/[^A-Z]/g, '');
  // Prefer the leading discipline token (PT school 30 → PT, COTA → COTA).
  if (token && KNOWN_DISCIPLINES.includes(token)) return token;
  if (first === 'SI' || first.startsWith('SI-')) return 'SI';
  // Word-boundary checks — do NOT use bare includes('OT') (matches COTA).
  if (/\bPT\b/.test(s) || /\bPHYSICAL\b/.test(s)) return 'PT';
  if (/\bOT\b/.test(s) || /\bOCCUPATIONAL\b/.test(s)) return 'OT';
  // ProviderSoft uses SLP; HHA AcceptedServices / GetDisciplines use ST for speech.
  // PR #5 mapped to SP, but prod UpdatePatientDemographics rejects "SP " / "SP".
  if (/\bSLP\b/.test(s) || /\bSPEECH\b/.test(s) || token === 'SP') return 'ST';
  if (/\bST\b/.test(s)) return 'ST';
  if (/\bRN\b/.test(s)) return 'RN';
  if (/\bHHA\b/.test(s)) return 'HHA';
  if (/\bPCA\b/.test(s)) return 'PCA';
  // No silent OT default — callers must pass service/discipline for therapy patients.
  return '';
}

/**
 * Parse US ZIP / ZIP+4 for HHA CreatePatient.
 * When only 5 digits are present, omit Zip4 entirely — HHA rejects `<Zip4>0</Zip4>`
 * with Invalid "ZipCodeLength Zip4" (ErrorID=-74).
 */
export function parseZipCode(zip: string | undefined): { zip5: number; zip4?: string } {
  const m = zip?.replace(/\s/g, '').match(/^(\d{5})(?:-(\d{4}))?/);
  if (!m) return { zip5: 0 };
  return {
    zip5: Number(m[1]),
    ...(m[2] !== undefined ? { zip4: m[2] } : {}),
  };
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

/** Strip leading zeros from an all-digit id (MR / admission) for a second HHA lookup. */
export function stripLeadingZerosFromNumericId(id: string | undefined): string | undefined {
  const value = id?.trim();
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  if (!value.startsWith('0')) return undefined;
  const stripped = value.replace(/^0+/, '');
  return stripped || undefined;
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
  const zip4Xml = zip4 !== undefined ? `\n      <Zip4>${zip4}</Zip4>` : '';
  const acceptedServicesXml = discipline
    ? `
  <AcceptedServices>
    <Discipline>${esc(discipline)}</Discipline>
  </AcceptedServices>`
    : '';

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
  <LocationID>${refs.locationId}</LocationID>${acceptedServicesXml}
  <Addresses>
    <Address>
      <Address1>${esc(patient.address1!)}</Address1>
      <City>${esc(patient.city!)}</City>
      <State>${esc(patient.state!)}</State>
      <Zip5>${zip5 || 11201}</Zip5>${zip4Xml}
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
