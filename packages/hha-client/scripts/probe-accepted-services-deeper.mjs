/**
 * Deeper sandbox probe: can ANY HHA SOAP method expand AcceptedServices
 * on an existing patient?
 *
 * Uses WSDL UpdatePatientDemographics required fields (nillable ints via xsi:nil)
 * after prior probe failed on incomplete payloads (-70/-74/-73/-315).
 *
 * Usage: node packages/hha-client/scripts/probe-accepted-services-deeper.mjs
 * Optional: HHA_PROBE_PATIENT_ID=958000
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL =
  process.env.HHA_BASE_URL ??
  'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';

loadEnv(path.join(repoRoot, '.env'));

const APP = required('HHA_APP_NAME');
const SECRET = required('HHA_APP_SECRET');
const KEY = required('HHA_APP_KEY').replace(/\s+/g, '');
const PATIENT_ID = Number(process.env.HHA_PROBE_PATIENT_ID ?? '958000');

const results = {
  testedAt: new Date().toISOString(),
  endpoint: URL,
  patientId: PATIENT_ID,
  catalogNote:
    'WSDL has AcceptedServices on UpdatePatientDemographics; no UpdatePatientDisciplines / EditPatient / SavePatient.',
  steps: {},
};

function loadEnv(file) {
  try {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function call(method, innerBody, { xsi = false } = {}) {
  const xsiDecl = xsi
    ? ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
    : '';
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}"${xsiDecl}>
      <Authentication>
        <AppName>${escapeXml(APP)}</AppName>
        <AppSecret>${escapeXml(SECRET)}</AppSecret>
        <AppKey>${escapeXml(KEY)}</AppKey>
      </Authentication>
      ${innerBody}
    </${method}>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/${method}"`,
    },
    body,
  });
  const txt = await res.text();
  const statusAttr = txt.match(/Status="([^"]+)"/i)?.[1];
  const eid =
    txt.match(/<ErrorID>([^<]*)<\/ErrorID>/i)?.[1] ??
    txt.match(/ErrorID>([^<]*)</i)?.[1];
  const msg =
    txt.match(/<ErrorMessage>([^<]*)<\/ErrorMessage>/i)?.[1] ??
    txt.match(/ErrorMessage>([^<]*)</i)?.[1] ??
    txt.match(/<faultstring>([^<]*)<\/faultstring>/i)?.[1];
  return {
    http: res.status,
    ok: String(eid ?? '') === '0' || statusAttr === 'Success',
    errorId: eid ?? null,
    errorMessage: msg ?? null,
    status: statusAttr ?? null,
    preview: txt.replace(/\s+/g, ' ').slice(0, 900),
    raw: txt,
  };
}

function firstTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return m?.[1]?.trim() || '';
}

function allTags(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

function nestedId(xml, parent) {
  return (
    xml.match(new RegExp(`<${parent}>[\\s\\S]*?<ID>([^<]*)</ID>`, 'i'))?.[1] ??
    ''
  );
}

function parseAcceptedServices(xml) {
  const block = xml.match(/<AcceptedServices[\s\S]*?<\/AcceptedServices>/i)?.[0] ?? '';
  return allTags(block || xml, 'Discipline').filter(Boolean);
}

function summarize(r) {
  return {
    http: r.http,
    ok: r.ok,
    errorId: r.errorId,
    errorMessage: r.errorMessage,
    status: r.status,
    preview: r.preview,
  };
}

function nil(tag) {
  return `<${tag} xsi:nil="true" />`;
}

function intOrNil(tag, value) {
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    value === '-1' ||
    value === -1 ||
    value === '0' ||
    value === 0
  ) {
    return nil(tag);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return nil(tag);
  return `<${tag}>${n}</${tag}>`;
}

function dateOr(value, fallback) {
  if (!value) return fallback;
  // Normalize MM/DD/YYYY or ISO to dateTime-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.includes('T') ? value : `${value}T00:00:00`;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}T00:00:00`;
  }
  return value;
}

function acceptedXml(list) {
  return `<AcceptedServices>
${list.map((d) => `    <Discipline>${escapeXml(d)}</Discipline>`).join('\n')}
  </AcceptedServices>`;
}

function addressBlock(demo, { zip4Mode = 'omit', addressId = null } = {}) {
  if (!demo.address1 && !demo.zip5 && !addressId) return '';
  const zip5 = String(demo.zip5 || '11201').replace(/\D/g, '').slice(0, 5) || '11201';
  const rawZip4 = String(demo.zip4 ?? '').replace(/\D/g, '');
  let zip4Xml = '';
  if (zip4Mode === 'include' && rawZip4 && rawZip4 !== '0') {
    zip4Xml = `<Zip4>${escapeXml(rawZip4.padStart(4, '0').slice(0, 4))}</Zip4>`;
  } else if (zip4Mode === 'nil' || zip4Mode === 'omit') {
    // UpdatePatientAddress requires Zip4 (nillable) — always send nil when omitting/invalid
    zip4Xml = `<Zip4 xsi:nil="true" />`;
  } else if (zip4Mode === 'zero') {
    zip4Xml = `<Zip4>0</Zip4>`;
  }
  const idXml = addressId
    ? `<AddressID>${Number(addressId)}</AddressID>`
    : `<AddressID xsi:nil="true" />`;
  return `<Addresses>
  <Address>
    ${idXml}
    <Address1>${escapeXml(demo.address1 || '1 Test St')}</Address1>
    <City>${escapeXml(demo.city || 'Brooklyn')}</City>
    <State>${escapeXml(demo.state || 'NY')}</State>
    <Zip5>${escapeXml(zip5)}</Zip5>
    ${zip4Xml}
    <IsPrimaryAddress>Yes</IsPrimaryAddress>
    <AddressTypes>Home</AddressTypes>
  </Address>
</Addresses>`;
}

function emergencyXml(demo) {
  const mobility =
    demo.mobilityStatusId ||
    process.env.HHA_MOBILITY_STATUS_ID ||
    '2495';
  const zone =
    demo.evacuationZoneId ||
    process.env.HHA_EVACUATION_ZONE_ID ||
    '10003239';
  const loc = demo.evacuationLocationId;
  return `<EmergencyPreparedness>
  ${intOrNil('EvacuationZoneID', zone)}
  ${intOrNil('EvacuationLocationID', loc)}
  ${intOrNil('MobilityStatusID', mobility)}
</EmergencyPreparedness>`;
}

/** WSDL-required UpdatePatientDemographics fields with nillable ints. */
function buildUpdatePatientInfo(
  demo,
  { acceptedServicesList, includeAddress = true, zip4Mode = 'omit', addressId = null } = {},
) {
  const birth = dateOr(demo.birthDate, '1950-01-01T00:00:00');
  const srs = dateOr(demo.serviceRequestStartDate, birth);
  const parts = [
    `<PatientID>${PATIENT_ID}</PatientID>`,
    demo.firstName ? `<FirstName>${escapeXml(demo.firstName)}</FirstName>` : '',
    demo.middleName ? `<MiddleName>${escapeXml(demo.middleName)}</MiddleName>` : '',
    demo.lastName ? `<LastName>${escapeXml(demo.lastName)}</LastName>` : '',
    `<BirthDate>${escapeXml(birth)}</BirthDate>`,
    demo.gender ? `<Gender>${escapeXml(demo.gender)}</Gender>` : '',
    intOrNil('CoordinatorID1', demo.coordinatorId1 || process.env.HHA_COORDINATOR_ID),
    intOrNil('CoordinatorID2', demo.coordinatorId2),
    intOrNil('CoordinatorID3', demo.coordinatorId3),
    intOrNil('PriorityCode', demo.priorityCode),
    `<ServiceRequestStartDate>${escapeXml(srs)}</ServiceRequestStartDate>`,
    intOrNil('NurseID', demo.nurseId),
    intOrNil('MRNumber', demo.mrNumber),
    demo.medicaidNumber
      ? `<MedicaidNumber>${escapeXml(demo.medicaidNumber)}</MedicaidNumber>`
      : '',
    acceptedServicesList ? acceptedXml(acceptedServicesList) : '',
    intOrNil('AllowDuplicate', demo.allowDuplicate ?? 1),
    intOrNil('SourceOfAdmission', demo.sourceOfAdmission || process.env.HHA_SOURCE_OF_ADMISSION),
    intOrNil('TeamID', demo.teamId || process.env.HHA_TEAM_ID),
    intOrNil('BranchID', demo.branchId || process.env.HHA_BRANCH_ID),
    intOrNil('LocationID', demo.locationId || process.env.HHA_LOCATION_ID),
    includeAddress
      ? addressBlock(demo, { zip4Mode, addressId: addressId ?? demo.addressId })
      : '',
    emergencyXml(demo),
    nil('WageParityFromDate1'),
    nil('WageParityToDate1'),
    nil('WageParityFromDate2'),
    nil('WageParityToDate2'),
    demo.homePhone ? `<HomePhone>${escapeXml(demo.homePhone)}</HomePhone>` : '',
  ].filter(Boolean);

  return `<PatientInfo>
${parts.join('\n')}
</PatientInfo>`;
}

async function readAccepted() {
  const after = await call(
    'GetPatientDemographics',
    `<PatientInfo><ID>${PATIENT_ID}</ID></PatientInfo>`,
  );
  return { call: after, services: parseAcceptedServices(after.raw) };
}

console.log(`Deeper AcceptedServices probe patient ${PATIENT_ID} @ ${URL}`);

// --- Reads ---
const beforeDemo = await call(
  'GetPatientDemographics',
  `<PatientInfo><ID>${PATIENT_ID}</ID></PatientInfo>`,
);
const beforeServices = parseAcceptedServices(beforeDemo.raw);

const demo = {
  firstName: firstTag(beforeDemo.raw, 'FirstName'),
  lastName: firstTag(beforeDemo.raw, 'LastName'),
  middleName: firstTag(beforeDemo.raw, 'MiddleName'),
  officeId: firstTag(beforeDemo.raw, 'OfficeID'),
  gender: firstTag(beforeDemo.raw, 'Gender'),
  birthDate: firstTag(beforeDemo.raw, 'BirthDate') || firstTag(beforeDemo.raw, 'DOB'),
  coordinatorId1:
    firstTag(beforeDemo.raw, 'CoordinatorID1') ||
    nestedId(beforeDemo.raw, 'Coordinator1') ||
    nestedId(beforeDemo.raw, 'Coordinator'),
  coordinatorId2: firstTag(beforeDemo.raw, 'CoordinatorID2') || nestedId(beforeDemo.raw, 'Coordinator2'),
  coordinatorId3: firstTag(beforeDemo.raw, 'CoordinatorID3') || nestedId(beforeDemo.raw, 'Coordinator3'),
  serviceRequestStartDate: firstTag(beforeDemo.raw, 'ServiceRequestStartDate'),
  admissionId: firstTag(beforeDemo.raw, 'AdmissionID'),
  medicaidNumber: firstTag(beforeDemo.raw, 'MedicaidNumber'),
  sourceOfAdmission:
    nestedId(beforeDemo.raw, 'SourceOfAdmission') || firstTag(beforeDemo.raw, 'SourceOfAdmission'),
  branchId: nestedId(beforeDemo.raw, 'Branch') || firstTag(beforeDemo.raw, 'BranchID'),
  teamId: nestedId(beforeDemo.raw, 'Team') || firstTag(beforeDemo.raw, 'TeamID'),
  locationId: nestedId(beforeDemo.raw, 'Location') || firstTag(beforeDemo.raw, 'LocationID'),
  priorityCode: firstTag(beforeDemo.raw, 'PriorityCode'),
  nurseId: nestedId(beforeDemo.raw, 'Nurse') || firstTag(beforeDemo.raw, 'NurseID'),
  mrNumber: firstTag(beforeDemo.raw, 'MRNumber'),
  homePhone: firstTag(beforeDemo.raw, 'HomePhone'),
  address1: firstTag(beforeDemo.raw, 'Address1') || firstTag(beforeDemo.raw, 'Street'),
  city: firstTag(beforeDemo.raw, 'City'),
  state: firstTag(beforeDemo.raw, 'State'),
  zip5: firstTag(beforeDemo.raw, 'Zip5') || firstTag(beforeDemo.raw, 'Zip'),
  zip4: firstTag(beforeDemo.raw, 'Zip4'),
  mobilityStatusId:
    nestedId(beforeDemo.raw, 'MobilityStatus') ||
    firstTag(beforeDemo.raw, 'MobilityStatusID'),
  evacuationZoneId:
    nestedId(beforeDemo.raw, 'EvacuationZone') ||
    firstTag(beforeDemo.raw, 'EvacuationZoneID'),
  evacuationLocationId:
    nestedId(beforeDemo.raw, 'EvacuationLocation') ||
    firstTag(beforeDemo.raw, 'EvacuationLocationID'),
};

results.steps.getBefore = {
  ...summarize(beforeDemo),
  acceptedServices: beforeServices,
  demo,
};
console.log('Before AcceptedServices:', beforeServices.join(', ') || '(none)');
console.log('Demo:', JSON.stringify(demo));

const disciplines = await call('GetDisciplines', '');
results.steps.getDisciplines = {
  ...summarize(disciplines),
  names: allTags(disciplines.raw, 'DisciplineName'),
};

const patientDisc = await call('GetPatientDisciplines', `<PatientID>${PATIENT_ID}</PatientID>`);
results.steps.getPatientDisciplines = {
  ...summarize(patientDisc),
  disciplineNames: allTags(patientDisc.raw, 'DisciplineName'),
  disciplineIds: allTags(patientDisc.raw, 'DisciplineID'),
  preview: patientDisc.preview,
};
console.log(
  'GetPatientDisciplines:',
  results.steps.getPatientDisciplines.disciplineNames?.join(', ') ||
    results.steps.getPatientDisciplines.errorMessage,
);

const addrRes = await call('GetPatientAddress', `<PatientID>${PATIENT_ID}</PatientID>`);
const addressIds = allTags(addrRes.raw, 'AddressID');
demo.addressId = addressIds[0] || '';
if (!demo.zip5) demo.zip5 = firstTag(addrRes.raw, 'Zip5');
if (!demo.address1) demo.address1 = firstTag(addrRes.raw, 'Address1');
if (!demo.city) demo.city = firstTag(addrRes.raw, 'City');
if (!demo.state) demo.state = firstTag(addrRes.raw, 'State');
results.steps.getPatientAddress = {
  ...summarize(addrRes),
  addressIds,
  demoAddressId: demo.addressId,
};
console.log('GetPatientAddress AddressIDs:', addressIds.join(', ') || addrRes.errorMessage);

const candidates = ['OT', 'PT', 'ST', 'SP', 'RN', 'PCA'];
const addDiscipline =
  candidates.find((d) => !beforeServices.map((x) => x.toUpperCase()).includes(d)) ?? 'OT';
const merged = [...new Set([...beforeServices, addDiscipline])];
results.intendedAdd = addDiscipline;
results.intendedMerged = merged;

const updates = {};

async function tryUpdate(label, body, { method = 'UpdatePatientDemographics' } = {}) {
  console.log(`\nTrying ${label} via ${method}…`);
  const upd = await call(method, body, { xsi: true });
  const after = await readAccepted();
  const afterServices = after.services;
  const expanded =
    afterServices.map((x) => x.toUpperCase()).includes(addDiscipline.toUpperCase()) &&
    afterServices.length >= beforeServices.length;
  const changed =
    JSON.stringify(afterServices.map((x) => x.toUpperCase()).sort()) !==
    JSON.stringify(beforeServices.map((x) => x.toUpperCase()).sort());
  updates[label] = {
    method,
    update: summarize(upd),
    afterAcceptedServices: afterServices,
    changed,
    expandedWithTarget: expanded,
  };
  console.log(
    `  eid=${upd.errorId} msg=${upd.errorMessage ?? ''} | after=[${afterServices.join(', ')}] changed=${changed} expanded=${expanded}`,
  );
  return updates[label];
}

// G0: schema-complete echo WITHOUT AcceptedServices (control — prove update can succeed)
await tryUpdate(
  'G0_wsdl_required_echo_no_AcceptedServices_zip4_omit',
  buildUpdatePatientInfo(demo, {
    acceptedServicesList: null,
    includeAddress: true,
    zip4Mode: 'omit',
  }),
);

// G0b: Zip4 nil
await tryUpdate(
  'G0b_echo_no_AcceptedServices_zip4_nil',
  buildUpdatePatientInfo(demo, {
    acceptedServicesList: null,
    includeAddress: true,
    zip4Mode: 'nil',
  }),
);

// G1: same AcceptedServices + omit Zip4
await tryUpdate(
  'G1_wsdl_required_echo_same_AcceptedServices',
  buildUpdatePatientInfo(demo, {
    acceptedServicesList: beforeServices,
    includeAddress: true,
    zip4Mode: 'omit',
  }),
);

// G2: expand AcceptedServices
await tryUpdate(
  'G2_wsdl_required_echo_expanded_AcceptedServices',
  buildUpdatePatientInfo(demo, {
    acceptedServicesList: merged,
    includeAddress: true,
    zip4Mode: 'omit',
  }),
);

// G2b: expand with only a harmless HomePhone tweak path if G2 still fails — try OfficeID too
await tryUpdate(
  'G2b_expanded_plus_OfficeID',
  buildUpdatePatientInfo(demo, {
    acceptedServicesList: merged,
    includeAddress: true,
    zip4Mode: 'omit',
  }).replace(
    `<PatientID>${PATIENT_ID}</PatientID>`,
    `<PatientID>${PATIENT_ID}</PatientID>\n  <OfficeID>${escapeXml(demo.officeId || '1025')}</OfficeID>`,
  ),
);

// G3: expanded without Addresses
await tryUpdate(
  'G3_wsdl_required_expanded_no_address',
  buildUpdatePatientInfo(demo, {
    acceptedServicesList: merged,
    includeAddress: false,
  }),
);

// G6: minimal required + address omit zip4 + expanded (no optional names beyond required)
await tryUpdate(
  'G6_minimal_required_plus_address_expanded',
  `<PatientInfo>
  <PatientID>${PATIENT_ID}</PatientID>
  <FirstName>${escapeXml(demo.firstName || 'Probe')}</FirstName>
  <LastName>${escapeXml(demo.lastName || 'Patient')}</LastName>
  <BirthDate>${escapeXml(dateOr(demo.birthDate, '1950-01-01T00:00:00'))}</BirthDate>
  <Gender>${escapeXml(demo.gender || 'Female')}</Gender>
  ${intOrNil('CoordinatorID1', demo.coordinatorId1 || process.env.HHA_COORDINATOR_ID)}
  ${intOrNil('CoordinatorID2', demo.coordinatorId2)}
  ${intOrNil('CoordinatorID3', demo.coordinatorId3)}
  ${intOrNil('PriorityCode', demo.priorityCode || 2)}
  <ServiceRequestStartDate>${escapeXml(dateOr(demo.serviceRequestStartDate, dateOr(demo.birthDate, '1950-01-01T00:00:00')))}</ServiceRequestStartDate>
  ${intOrNil('NurseID', demo.nurseId)}
  ${intOrNil('MRNumber', demo.mrNumber)}
  ${acceptedXml(merged)}
  ${intOrNil('AllowDuplicate', 1)}
  ${intOrNil('SourceOfAdmission', demo.sourceOfAdmission || process.env.HHA_SOURCE_OF_ADMISSION || 9300)}
  ${intOrNil('TeamID', demo.teamId || process.env.HHA_TEAM_ID)}
  ${intOrNil('BranchID', demo.branchId || process.env.HHA_BRANCH_ID)}
  ${intOrNil('LocationID', demo.locationId || process.env.HHA_LOCATION_ID)}
  ${addressBlock(demo, { zip4Mode: 'omit', addressId: demo.addressId })}
  ${emergencyXml(demo)}
  ${nil('WageParityFromDate1')}
  ${nil('WageParityToDate1')}
  ${nil('WageParityFromDate2')}
  ${nil('WageParityToDate2')}
</PatientInfo>`,
);

// G7: AddressID + Zip5 only (no street) to avoid duplicate-address semantics
await tryUpdate(
  'G7_AddressID_zip_only_expanded',
  (() => {
    const base = buildUpdatePatientInfo(demo, {
      acceptedServicesList: merged,
      includeAddress: false,
    });
    if (!demo.addressId) return base;
    const addr = `<Addresses>
  <Address>
    <AddressID>${Number(demo.addressId)}</AddressID>
    <Zip5>${escapeXml(String(demo.zip5 || '10459').slice(0, 5))}</Zip5>
    <Zip4 xsi:nil="true" />
    <IsPrimaryAddress>Yes</IsPrimaryAddress>
  </Address>
</Addresses>`;
    return base.replace('</PatientInfo>', `${addr}\n</PatientInfo>`);
  })(),
);

// G4: string AcceptedServices (GetPatientChangesV2 style)
await tryUpdate(
  'G4_AcceptedServices_as_csv_string',
  buildUpdatePatientInfo(demo, {
    acceptedServicesList: null,
    includeAddress: true,
    zip4Mode: 'omit',
  }).replace(
    '</PatientInfo>',
    `<AcceptedServices>${escapeXml(merged.join(','))}</AcceptedServices>\n</PatientInfo>`,
  ),
);

// G5: DisciplineName instead of Discipline
await tryUpdate(
  'G5_DisciplineName_children',
  buildUpdatePatientInfo(demo, {
    acceptedServicesList: null,
    includeAddress: true,
    zip4Mode: 'omit',
  }).replace(
    '</PatientInfo>',
    `<AcceptedServices>
${merged.map((d) => `    <DisciplineName>${escapeXml(d)}</DisciplineName>`).join('\n')}
  </AcceptedServices>
</PatientInfo>`,
  ),
);

// Alternate methods that cannot update disciplines per WSDL — still probe for honesty
await tryUpdate(
  'H_UpdatePatientClinicalInfo_with_Discipline',
  `<PatientClinicalInfo>
  <PatientID>${PATIENT_ID}</PatientID>
  <Comments>probe AcceptedServices</Comments>
  ${acceptedXml(merged)}
  ${nil('NursingVisitsDue')}
  ${nil('MDOrderDue')}
  ${nil('MDVisitDue')}
</PatientClinicalInfo>`,
  { method: 'UpdatePatientClinicalInfo' },
);

await tryUpdate(
  'I_UpdatePatientPreference_Discipline',
  `<PatientPreference>
  <PatientID>${PATIENT_ID}</PatientID>
  ${acceptedXml(merged)}
</PatientPreference>`,
  { method: 'UpdatePatientPreference' },
);

// Phantom methods (should not exist on ASMX)
for (const method of [
  'UpdatePatient',
  'EditPatient',
  'SavePatient',
  'UpdatePatientInfo',
  'UpdatePatientDisciplines',
  'SetPatientDisciplines',
  'AddPatientDiscipline',
  'UpdateAcceptedServices',
]) {
  const r = await call(
    method,
    `<PatientInfo><PatientID>${PATIENT_ID}</PatientID>${acceptedXml(merged)}</PatientInfo>`,
  );
  updates[`Z_phantom_${method}`] = { method, update: summarize(r), note: 'expect missing/unauthorized' };
  console.log(`\nPhantom ${method}: eid=${r.errorId} msg=${r.errorMessage ?? ''} http=${r.http}`);
}

results.steps.updates = updates;

const anyExpand = Object.values(updates).some((u) => u.expandedWithTarget);
const anySuccessUpdate = Object.values(updates).some(
  (u) => u.update?.ok || String(u.update?.errorId) === '0',
);
results.verdict = anyExpand
  ? 'YES — found a method that expanded AcceptedServices'
  : anySuccessUpdate
    ? 'PARTIAL — UpdatePatientDemographics can succeed but AcceptedServices did not expand'
    : 'NO — no sandbox method expanded AcceptedServices; updates did not succeed or did not change services';

console.log('\nVERDICT:', results.verdict);

mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
const outPath = path.join(repoRoot, 'docs/hha-accepted-services-deeper-probe.json');
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log('Wrote', outPath);
