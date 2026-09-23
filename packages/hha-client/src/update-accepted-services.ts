/**
 * Build UpdatePatientDemographics PatientInfo that can expand AcceptedServices.
 *
 * Sandbox proof (2026-09-16, patient 958000):
 * UpdatePatientDemographics succeeds (ErrorID=0) and expands AcceptedServices when
 * the payload includes WSDL-required fields + existing AddressID + EmergencyPreparedness
 * + Discipline list. Omitting AcceptedServices → -315 Requires AcceptedServices.
 * Sending a new Address without AddressID → -310 duplicate Addresses.
 */

import { psDateToIso } from './hha-time.js';

export interface AcceptedServicesDemoEcho {
  patientId: number;
  firstName: string;
  lastName: string;
  middleName?: string;
  birthDate: string;
  gender?: string;
  coordinatorId1?: string;
  coordinatorId2?: string;
  coordinatorId3?: string;
  priorityCode?: string;
  serviceRequestStartDate?: string;
  nurseId?: string;
  mrNumber?: string;
  medicaidNumber?: string;
  sourceOfAdmission?: string;
  teamId?: string;
  branchId?: string;
  locationId?: string;
  homePhone?: string;
  addressId: string;
  address1?: string;
  city?: string;
  state?: string;
  zip5: string;
  mobilityStatusId?: string;
  evacuationZoneId?: string;
  evacuationLocationId?: string;
  acceptedServices: string[];
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function asDateTime(value: string | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  if (!v) return fallback.includes('T') ? fallback : `${fallback}T00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v;
  const day = psDateToIso(v);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) return `${day}T00:00:00`;
  return v;
}

function intOrNil(tag: string, value: string | undefined): string {
  const n = Number(value);
  if (!value?.trim() || !Number.isFinite(n) || n <= 0) {
    return `<${tag} xsi:nil="true" />`;
  }
  return `<${tag}>${n}</${tag}>`;
}

export function mergeAcceptedServices(
  current: string[],
  ensure: string[],
): { merged: string[]; missing: string[] } {
  const seen = new Set(current.map((d) => d.toUpperCase()));
  const missing = ensure
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !seen.has(d.toUpperCase()));
  const merged = [...current];
  for (const d of missing) {
    merged.push(d);
    seen.add(d.toUpperCase());
  }
  return { merged, missing };
}

export function buildUpdateAcceptedServicesBody(demo: AcceptedServicesDemoEcho): string {
  const birth = asDateTime(demo.birthDate, '1950-01-01T00:00:00');
  const srs = asDateTime(demo.serviceRequestStartDate, birth);
  const disciplines = demo.acceptedServices
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `    <Discipline>${esc(d)}</Discipline>`)
    .join('\n');

  return `<PatientInfo>
  <PatientID>${demo.patientId}</PatientID>
  <FirstName>${esc(demo.firstName)}</FirstName>
  ${demo.middleName ? `<MiddleName>${esc(demo.middleName)}</MiddleName>` : ''}
  <LastName>${esc(demo.lastName)}</LastName>
  <BirthDate>${esc(birth)}</BirthDate>
  ${demo.gender ? `<Gender>${esc(demo.gender)}</Gender>` : ''}
  ${intOrNil('CoordinatorID1', demo.coordinatorId1)}
  ${intOrNil('CoordinatorID2', demo.coordinatorId2)}
  ${intOrNil('CoordinatorID3', demo.coordinatorId3)}
  ${intOrNil('PriorityCode', demo.priorityCode)}
  <ServiceRequestStartDate>${esc(srs)}</ServiceRequestStartDate>
  ${intOrNil('NurseID', demo.nurseId)}
  ${intOrNil('MRNumber', demo.mrNumber)}
  ${demo.medicaidNumber ? `<MedicaidNumber>${esc(demo.medicaidNumber)}</MedicaidNumber>` : ''}
  <AcceptedServices>
${disciplines}
  </AcceptedServices>
  <AllowDuplicate>1</AllowDuplicate>
  ${intOrNil('SourceOfAdmission', demo.sourceOfAdmission)}
  ${intOrNil('TeamID', demo.teamId)}
  ${intOrNil('BranchID', demo.branchId)}
  ${intOrNil('LocationID', demo.locationId)}
  <Addresses>
    <Address>
      <AddressID>${Number(demo.addressId)}</AddressID>
      ${demo.address1 ? `<Address1>${esc(demo.address1)}</Address1>` : ''}
      ${demo.city ? `<City>${esc(demo.city)}</City>` : ''}
      ${demo.state ? `<State>${esc(demo.state)}</State>` : ''}
      <Zip5>${esc(demo.zip5.slice(0, 5))}</Zip5>
      <Zip4 xsi:nil="true" />
      <IsPrimaryAddress>Yes</IsPrimaryAddress>
      <AddressTypes>Home</AddressTypes>
    </Address>
  </Addresses>
  <EmergencyPreparedness>
    ${intOrNil('EvacuationZoneID', demo.evacuationZoneId)}
    ${intOrNil('EvacuationLocationID', demo.evacuationLocationId)}
    ${intOrNil('MobilityStatusID', demo.mobilityStatusId)}
  </EmergencyPreparedness>
  <WageParityFromDate1 xsi:nil="true" />
  <WageParityToDate1 xsi:nil="true" />
  <WageParityFromDate2 xsi:nil="true" />
  <WageParityToDate2 xsi:nil="true" />
  ${demo.homePhone ? `<HomePhone>${esc(demo.homePhone)}</HomePhone>` : ''}
</PatientInfo>`;
}

export function parseAcceptedServiceDisciplines(xml: string): string[] {
  const block = xml.match(/<AcceptedServices[\s\S]*?<\/AcceptedServices>/i)?.[0] ?? '';
  const out: string[] = [];
  const re = /<Discipline[^>]*>([^<]*)<\/Discipline>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block || xml))) {
    const d = m[1]?.trim();
    if (d) out.push(d);
  }
  return out;
}

export function xmlFirstTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return m?.[1]?.trim() || undefined;
}

export function xmlNestedId(xml: string, parent: string): string | undefined {
  return (
    xml.match(new RegExp(`<${parent}>[\\s\\S]*?<ID>([^<]*)</ID>`, 'i'))?.[1]?.trim() ||
    undefined
  );
}

export function parseDemoEchoFromXml(
  patientId: number,
  demographicsXml: string,
  addressXml: string,
  defaults?: {
    mobilityStatusId?: string;
    evacuationZoneId?: string;
    sourceOfAdmission?: string;
    teamId?: string;
    branchId?: string;
    locationId?: string;
    coordinatorId?: string;
  },
): AcceptedServicesDemoEcho {
  const addressId =
    xmlFirstTag(addressXml, 'AddressID') ??
    xmlFirstTag(demographicsXml, 'AddressID');
  if (!addressId) {
    throw new Error(
      `GetPatientAddress returned no AddressID for patient ${patientId} — cannot UpdatePatientDemographics AcceptedServices without existing AddressID`,
    );
  }
  const zip5 =
    xmlFirstTag(addressXml, 'Zip5') ??
    xmlFirstTag(demographicsXml, 'Zip5') ??
    xmlFirstTag(demographicsXml, 'Zip');
  if (!zip5) {
    throw new Error(
      `Patient ${patientId} has no Zip5 — office requires Zip 5 on UpdatePatientDemographics`,
    );
  }

  return {
    patientId,
    firstName: xmlFirstTag(demographicsXml, 'FirstName') || 'Patient',
    lastName: xmlFirstTag(demographicsXml, 'LastName') || 'Unknown',
    middleName: xmlFirstTag(demographicsXml, 'MiddleName'),
    birthDate:
      xmlFirstTag(demographicsXml, 'BirthDate') ||
      xmlFirstTag(demographicsXml, 'DOB') ||
      '1950-01-01',
    gender: xmlFirstTag(demographicsXml, 'Gender'),
    coordinatorId1:
      xmlFirstTag(demographicsXml, 'CoordinatorID1') ||
      xmlNestedId(demographicsXml, 'Coordinator1') ||
      xmlNestedId(demographicsXml, 'Coordinator') ||
      defaults?.coordinatorId,
    coordinatorId2:
      xmlFirstTag(demographicsXml, 'CoordinatorID2') ||
      xmlNestedId(demographicsXml, 'Coordinator2'),
    coordinatorId3:
      xmlFirstTag(demographicsXml, 'CoordinatorID3') ||
      xmlNestedId(demographicsXml, 'Coordinator3'),
    priorityCode: xmlFirstTag(demographicsXml, 'PriorityCode'),
    serviceRequestStartDate: xmlFirstTag(demographicsXml, 'ServiceRequestStartDate'),
    nurseId:
      xmlNestedId(demographicsXml, 'Nurse') || xmlFirstTag(demographicsXml, 'NurseID'),
    mrNumber: xmlFirstTag(demographicsXml, 'MRNumber'),
    medicaidNumber: xmlFirstTag(demographicsXml, 'MedicaidNumber'),
    sourceOfAdmission:
      xmlNestedId(demographicsXml, 'SourceOfAdmission') ||
      xmlFirstTag(demographicsXml, 'SourceOfAdmission') ||
      defaults?.sourceOfAdmission,
    teamId:
      xmlNestedId(demographicsXml, 'Team') ||
      xmlFirstTag(demographicsXml, 'TeamID') ||
      defaults?.teamId,
    branchId:
      xmlNestedId(demographicsXml, 'Branch') ||
      xmlFirstTag(demographicsXml, 'BranchID') ||
      defaults?.branchId,
    locationId:
      xmlNestedId(demographicsXml, 'Location') ||
      xmlFirstTag(demographicsXml, 'LocationID') ||
      defaults?.locationId,
    homePhone: xmlFirstTag(demographicsXml, 'HomePhone'),
    addressId,
    address1:
      xmlFirstTag(addressXml, 'Address1') || xmlFirstTag(demographicsXml, 'Address1'),
    city: xmlFirstTag(addressXml, 'City') || xmlFirstTag(demographicsXml, 'City'),
    state: xmlFirstTag(addressXml, 'State') || xmlFirstTag(demographicsXml, 'State'),
    zip5: zip5.replace(/\D/g, '').slice(0, 5),
    mobilityStatusId:
      xmlNestedId(demographicsXml, 'MobilityStatus') ||
      xmlFirstTag(demographicsXml, 'MobilityStatusID') ||
      defaults?.mobilityStatusId,
    evacuationZoneId:
      xmlNestedId(demographicsXml, 'EvacuationZone') ||
      xmlFirstTag(demographicsXml, 'EvacuationZoneID') ||
      defaults?.evacuationZoneId,
    evacuationLocationId:
      xmlNestedId(demographicsXml, 'EvacuationLocation') ||
      xmlFirstTag(demographicsXml, 'EvacuationLocationID'),
    acceptedServices: parseAcceptedServiceDisciplines(demographicsXml),
  };
}
