/**
 * Create one sandbox patient from Gluck open.csv shape (or defaults).
 * Loads repo-root .env. Writes docs/hha-create-patient-sandbox.json
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

const OFFICE_ID = Number(process.env.HHA_OFFICE_ID || 1025);
const COORDINATOR_ID = Number(process.env.HHA_COORDINATOR_ID || 81103);
const SOURCE_OF_ADMISSION = Number(process.env.HHA_SOURCE_OF_ADMISSION || 9300);

const gluckCsv =
  process.env.GLUCK_OPEN_CSV ??
  path.join(repoRoot, 'docs/samples/gluck-open.csv');

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

function pickEvacuationZoneId(xml) {
  const blocks = [...xml.matchAll(/<EvacuationZone[^>]*>([\s\S]*?)<\/EvacuationZone>/gi)];
  for (const block of blocks) {
    const inner = block[1];
    const name = inner.match(/<Name>([^<]*)<\/Name>/i)?.[1]?.trim().toLowerCase();
    const id = Number(inner.match(/<ID>(\d+)<\/ID>/i)?.[1]);
    if (id && name === 'none') return id;
  }
  for (const block of blocks) {
    const id = Number(block[1].match(/<ID>(\d+)<\/ID>/i)?.[1]);
    if (id > 10000) return id;
  }
  return 10003239;
}

function pickMobilityStatusId(xml) {
  const blocks = [...xml.matchAll(/<MobilityStatus[^>]*>([\s\S]*?)<\/MobilityStatus>/gi)];
  for (const block of blocks) {
    const id = Number(
      block[1].match(/<MobilityStatusID>(\d+)<\/MobilityStatusID>/i)?.[1] ??
        block[1].match(/<ID>(\d+)<\/ID>/i)?.[1],
    );
    if (id) return id;
  }
  return 2495;
}

function parseGluckName(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: full, lastName: 'Unknown' };
  return { lastName: parts[0], firstName: parts.slice(1).join(' ') };
}

function parseUsDate(s) {
  const m = s?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function parseZip(zip) {
  const m = zip?.replace(/\s/g, '').match(/^(\d{5})(?:-(\d{4}))?/);
  return { zip5: m ? Number(m[1]) : 0, zip4: m?.[2] ? Number(m[2]) : 0 };
}

function parsePhone(phone) {
  return phone?.replace(/[^\d]/g, '').replace(/^1(\d{10})$/, '$1') ?? '';
}

function formatMedicaidNumber(programId) {
  const digits = String(programId ?? '').replace(/\D/g, '').padStart(5, '0').slice(-5);
  const suffixLetter = String.fromCharCode(65 + (Number(digits.slice(-1)) % 26));
  return `ZW${digits}${suffixLetter}`;
}

function loadGluckRow() {
  try {
    const text = readFileSync(gluckCsv, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = lines[0].split(',').map((h) => h.trim());
    const values = splitCsvLine(lines[1]);
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
    const { firstName, lastName } = parseGluckName(row["Child's Name"] ?? '');
    const zip = parseZip(row["Child's Zip Code"]);
    const suffix = Date.now().toString().slice(-6);
    return {
      officeId: OFFICE_ID,
      firstName: `${firstName}WG${suffix}`,
      lastName,
      birthDate: parseUsDate(row['Date of Birth']),
      gender: 'Male',
      coordinatorId: COORDINATOR_ID,
      admissionId: `PS${row['Program Id'] ?? suffix}`,
      medicaidNumber: formatMedicaidNumber(row['Program Id'] ?? suffix),
      serviceRequestStartDate: parseUsDate(row['Date of Intake']),
      sourceOfAdmission: SOURCE_OF_ADMISSION,
      address1: row["Child's Address"] ?? '1 Test St',
      city: row["Child's City"] ?? 'Brooklyn',
      state: row["Child's State"] ?? 'NY',
      zip5: zip.zip5 || 11201,
      zip4: zip.zip4 || 0,
      homePhone: parsePhone(row['Primary Contact Phone']),
      emergencyName: row['Primary Contact Name'] ?? '',
      programType: row['Program Type'] ?? '',
      serviceType: row['Service Type'] ?? '',
      gluckProgramId: row['Program Id'] ?? '',
    };
  } catch (e) {
    const suffix = Date.now().toString().slice(-6);
    return {
      officeId: OFFICE_ID,
      firstName: `WGAuto${suffix}`,
      lastName: 'SandboxTest',
      birthDate: '2023-12-19',
      gender: 'Male',
      coordinatorId: COORDINATOR_ID,
      admissionId: `WG${suffix}`,
      medicaidNumber: formatMedicaidNumber(suffix),
      serviceRequestStartDate: '2026-07-16',
      sourceOfAdmission: SOURCE_OF_ADMISSION,
      address1: '75 COOPER DR APT 1B',
      city: 'New Rochelle',
      state: 'NY',
      zip5: 10801,
      zip4: 4721,
      homePhone: '3473244088',
      emergencyName: 'Test Contact',
      programType: 'Early Intervention',
      serviceType: 'SI',
      gluckProgramId: '1012074',
      csvError: String(e),
    };
  }
}

/** Minimal CSV split (handles quoted fields with commas). */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ',' && !q) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function mapServiceToDiscipline(serviceType) {
  const s = (serviceType ?? '').toUpperCase();
  if (s.includes('OT')) return 'OT';
  if (s.includes('PT')) return 'PT';
  if (s.includes('ST') || s.includes('SPEECH')) return 'ST';
  if (s.includes('RN')) return 'RN';
  if (s.includes('HHA')) return 'HHA';
  if (s.includes('PCA')) return 'PCA';
  return 'OT';
}

function buildCreatePatientBody(p, refs) {
  const phone = p.homePhone ? formatPhone(p.homePhone) : '';
  const discipline = mapServiceToDiscipline(p.serviceType);
  return `<PatientInfo>
  <OfficeID>${p.officeId}</OfficeID>
  <FirstName>${escapeXml(p.firstName)}</FirstName>
  <LastName>${escapeXml(p.lastName)}</LastName>
  <BirthDate>${escapeXml(p.birthDate)}</BirthDate>
  <Gender>${escapeXml(p.gender)}</Gender>
  <CoordinatorID1>${p.coordinatorId}</CoordinatorID1>
  <ServiceRequestStartDate>${escapeXml(p.serviceRequestStartDate)}</ServiceRequestStartDate>
  <AdmissionID>${escapeXml(p.admissionId)}</AdmissionID>
  <MedicaidNumber>${escapeXml(p.medicaidNumber)}</MedicaidNumber>
  <AllowDuplicate>1</AllowDuplicate>
  <SourceOfAdmission>${p.sourceOfAdmission}</SourceOfAdmission>
  <BranchID>${refs.branchId}</BranchID>
  <TeamID>${refs.teamId}</TeamID>
  <LocationID>${refs.locationId}</LocationID>
  <AcceptedServices>
    <Discipline>${escapeXml(discipline)}</Discipline>
  </AcceptedServices>
  <Addresses>
    <Address>
      <Address1>${escapeXml(p.address1)}</Address1>
      <City>${escapeXml(p.city)}</City>
      <State>${escapeXml(p.state)}</State>
      <Zip5>${p.zip5}</Zip5>
      <Zip4>${p.zip4}</Zip4>
      <IsPrimaryAddress>Yes</IsPrimaryAddress>
      <AddressTypes>Home</AddressTypes>
    </Address>
  </Addresses>
  ${phone ? `<HomePhone>${escapeXml(phone)}</HomePhone>` : ''}
  ${
    p.emergencyName
      ? `<EmergencyContacts>
    <EmergencyContact>
      <Name>${escapeXml(p.emergencyName)}</Name>
      <RelationshipID>-2</RelationshipID>
      <Phone1>${escapeXml(phone)}</Phone1>
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

function formatPhone(digits) {
  const d = digits.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return digits;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

async function call(method, innerBody) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
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
  const eid = txt.match(/<ErrorID>([^<]*)<\/ErrorID>/i)?.[1];
  const msg = txt.match(/<ErrorMessage>([^<]*)<\/ErrorMessage>/i)?.[1] ?? '';
  const patientId =
    txt.match(/<PatientID>([^<]*)<\/PatientID>/i)?.[1] ??
    txt.match(/PatientID>([^<]*)</i)?.[1];
  const ok =
    statusAttr?.toLowerCase() === 'success' ||
    (String(eid) === '0' && !/failure/i.test(statusAttr ?? ''));

  return { http: res.status, ok, errorId: eid, errorMessage: msg, patientId, bodyXml: txt };
}

async function loadReferenceIds() {
  // Known-good values from sandbox patient 958000 (GetPatientDemographics).
  const defaults = {
    mobilityStatusId: 2495,
    evacuationZoneId: 10003239,
    branchId: 10073742,
    teamId: 2036,
    locationId: 12284,
  };
  try {
    const mobility = await call('GetMobilityStatuses', '');
    const evacuation = await call('GetEvacuationZones', '');
    const mobilityStatusId = pickMobilityStatusId(mobility.bodyXml) || defaults.mobilityStatusId;
    const parsedZone = pickEvacuationZoneId(evacuation.bodyXml);
    const evacuationZoneId =
      parsedZone > 100000 ? parsedZone : defaults.evacuationZoneId;
    return { ...defaults, mobilityStatusId, evacuationZoneId };
  } catch {
    return defaults;
  }
}

const patient = loadGluckRow();
const refs = await loadReferenceIds();
console.log('Reference IDs:', refs);
console.log('Creating sandbox patient from Gluck shape:', {
  name: `${patient.firstName} ${patient.lastName}`,
  admissionId: patient.admissionId,
  officeId: patient.officeId,
  gluckProgramId: patient.gluckProgramId,
  medicaidNumber: patient.medicaidNumber,
});

const create = await call('CreatePatient', buildCreatePatientBody(patient, refs));
console.log(
  create.ok ? 'SUCCESS' : 'FAIL',
  `eid=${create.errorId}`,
  create.errorMessage || '',
  create.patientId ? `PatientID=${create.patientId}` : '',
);
if (!create.ok) {
  console.log('Response preview:', create.bodyXml?.replace(/\s+/g, ' ').slice(0, 500));
}

let verify = null;
if (create.ok && create.patientId) {
  verify = await call(
    'GetPatientDemographics',
    `<PatientInfo><PatientID>${create.patientId}</PatientID></PatientInfo>`,
  );
}

const out = {
  testedAt: new Date().toISOString(),
  endpoint: URL,
  referenceIds: refs,
  input: patient,
  create: {
    ok: create.ok,
    errorId: create.errorId,
    errorMessage: create.errorMessage,
    patientId: create.patientId ?? null,
  },
  verify: verify
    ? {
        ok: verify.ok,
        errorId: verify.errorId,
        errorMessage: verify.errorMessage,
      }
    : null,
};

const outDir = path.join(repoRoot, 'docs');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'hha-create-patient-sandbox.json'),
  JSON.stringify(out, null, 2),
);
console.log('Wrote docs/hha-create-patient-sandbox.json');

process.exit(create.ok ? 0 : 1);
