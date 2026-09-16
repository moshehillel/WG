/**
 * Sandbox probe: can UpdatePatientDemographics expand AcceptedServices?
 * Loads repo-root .env. Writes docs/hha-accepted-services-update-probe.json
 *
 * Usage: node packages/hha-client/scripts/probe-accepted-services-update.mjs
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

async function call(method, innerBody) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
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
  const eid =
    txt.match(/<ErrorID>([^<]*)<\/ErrorID>/i)?.[1] ??
    txt.match(/ErrorID>([^<]*)</i)?.[1];
  const msg =
    txt.match(/<ErrorMessage>([^<]*)<\/ErrorMessage>/i)?.[1] ??
    txt.match(/ErrorMessage>([^<]*)</i)?.[1];
  return {
    http: res.status,
    ok: String(eid ?? '') === '0' || statusAttr === 'Success',
    errorId: eid ?? null,
    errorMessage: msg ?? null,
    status: statusAttr ?? null,
    preview: txt.slice(0, 1200),
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

console.log(`Probe AcceptedServices update on patient ${PATIENT_ID} @ ${URL}`);

const disciplines = await call('GetDisciplines', '');
results.steps.getDisciplines = {
  ...summarize(disciplines),
  names: allTags(disciplines.raw, 'DisciplineName'),
};
console.log(
  'GetDisciplines:',
  results.steps.getDisciplines.ok ? 'OK' : results.steps.getDisciplines.errorMessage,
  results.steps.getDisciplines.names?.join(', '),
);

const before = await call(
  'GetPatientDemographics',
  `<PatientInfo><ID>${PATIENT_ID}</ID></PatientInfo>`,
);
const beforeServices = parseAcceptedServices(before.raw);
const nestedId = (xml, parent) =>
  xml.match(new RegExp(`<${parent}>[\\s\\S]*?<ID>([^<]*)</ID>`, 'i'))?.[1] ?? '';
const demo = {
  firstName: firstTag(before.raw, 'FirstName'),
  lastName: firstTag(before.raw, 'LastName'),
  middleName: firstTag(before.raw, 'MiddleName'),
  officeId: firstTag(before.raw, 'OfficeID'),
  gender: firstTag(before.raw, 'Gender'),
  birthDate: firstTag(before.raw, 'BirthDate') || firstTag(before.raw, 'DOB'),
  coordinatorId1:
    firstTag(before.raw, 'CoordinatorID1') || nestedId(before.raw, 'Coordinator1') || nestedId(before.raw, 'Coordinator'),
  serviceRequestStartDate: firstTag(before.raw, 'ServiceRequestStartDate'),
  admissionId: firstTag(before.raw, 'AdmissionID'),
  medicaidNumber: firstTag(before.raw, 'MedicaidNumber'),
  sourceOfAdmission: nestedId(before.raw, 'SourceOfAdmission') || firstTag(before.raw, 'SourceOfAdmission'),
  branchId: nestedId(before.raw, 'Branch') || firstTag(before.raw, 'BranchID'),
  teamId: nestedId(before.raw, 'Team') || firstTag(before.raw, 'TeamID'),
  locationId: nestedId(before.raw, 'Location') || firstTag(before.raw, 'LocationID'),
  priorityCode: firstTag(before.raw, 'PriorityCode'),
  homePhone: firstTag(before.raw, 'HomePhone'),
};
results.steps.getBefore = {
  ...summarize(before),
  acceptedServices: beforeServices,
  demo,
};
console.log('Before AcceptedServices:', beforeServices.join(', ') || '(none)');
console.log('Demo fields:', JSON.stringify(demo));

// Prefer adding a therapy discipline not already present.
const candidates = ['OT', 'PT', 'ST', 'SP', 'RN'];
const addDiscipline =
  candidates.find((d) => !beforeServices.map((x) => x.toUpperCase()).includes(d)) ?? 'PT';
const merged = [...new Set([...beforeServices, addDiscipline])];

const fn = demo.firstName || 'Probe';
const ln = demo.lastName || 'Patient';
const gender = demo.gender || 'Female';
const birth = demo.birthDate || '1950-01-01';
const office = demo.officeId || process.env.HHA_OFFICE_ID || '1025';
const coord = demo.coordinatorId1 || process.env.HHA_COORDINATOR_ID || '81103';

function acceptedXml(list) {
  return `<AcceptedServices>
${list.map((d) => `    <Discipline>${escapeXml(d)}</Discipline>`).join('\n')}
  </AcceptedServices>`;
}

const attempts = [];

// Attempt A: PatientID + AcceptedServices only
attempts.push({
  label: 'A_acceptedServices_only',
  body: `<PatientInfo>
  <PatientID>${PATIENT_ID}</PatientID>
  ${acceptedXml(merged)}
</PatientInfo>`,
});

// Attempt B: ID tag instead of PatientID
attempts.push({
  label: 'B_ID_acceptedServices_only',
  body: `<PatientInfo>
  <ID>${PATIENT_ID}</ID>
  ${acceptedXml(merged)}
</PatientInfo>`,
});

// Attempt C: echo core demographics + AcceptedServices
attempts.push({
  label: 'C_echo_demo_plus_acceptedServices',
  body: `<PatientInfo>
  <PatientID>${PATIENT_ID}</PatientID>
  <OfficeID>${escapeXml(office)}</OfficeID>
  <FirstName>${escapeXml(fn)}</FirstName>
  <LastName>${escapeXml(ln)}</LastName>
  <BirthDate>${escapeXml(birth)}</BirthDate>
  <Gender>${escapeXml(gender)}</Gender>
  ${acceptedXml(merged)}
</PatientInfo>`,
});

// Attempt D: single new Discipline only
attempts.push({
  label: 'D_single_new_discipline_only',
  body: `<PatientInfo>
  <PatientID>${PATIENT_ID}</PatientID>
  <FirstName>${escapeXml(fn)}</FirstName>
  <LastName>${escapeXml(ln)}</LastName>
  ${acceptedXml([addDiscipline])}
</PatientInfo>`,
});

// Attempt E: fuller CreatePatient-like echo (required refs) + AcceptedServices
attempts.push({
  label: 'E_full_echo_plus_acceptedServices',
  body: `<PatientInfo>
  <PatientID>${PATIENT_ID}</PatientID>
  <OfficeID>${escapeXml(office)}</OfficeID>
  <FirstName>${escapeXml(fn)}</FirstName>
  ${demo.middleName ? `<MiddleName>${escapeXml(demo.middleName)}</MiddleName>` : ''}
  <LastName>${escapeXml(ln)}</LastName>
  <BirthDate>${escapeXml(birth)}</BirthDate>
  <Gender>${escapeXml(gender)}</Gender>
  <CoordinatorID1>${escapeXml(coord)}</CoordinatorID1>
  ${demo.serviceRequestStartDate ? `<ServiceRequestStartDate>${escapeXml(demo.serviceRequestStartDate)}</ServiceRequestStartDate>` : ''}
  ${demo.admissionId ? `<AdmissionID>${escapeXml(demo.admissionId)}</AdmissionID>` : ''}
  ${demo.medicaidNumber ? `<MedicaidNumber>${escapeXml(demo.medicaidNumber)}</MedicaidNumber>` : ''}
  ${demo.sourceOfAdmission ? `<SourceOfAdmission>${escapeXml(demo.sourceOfAdmission)}</SourceOfAdmission>` : ''}
  ${demo.branchId ? `<BranchID>${escapeXml(demo.branchId)}</BranchID>` : ''}
  ${demo.teamId ? `<TeamID>${escapeXml(demo.teamId)}</TeamID>` : ''}
  ${demo.locationId ? `<LocationID>${escapeXml(demo.locationId)}</LocationID>` : ''}
  ${demo.priorityCode ? `<PriorityCode>${escapeXml(demo.priorityCode)}</PriorityCode>` : ''}
  ${acceptedXml(merged)}
</PatientInfo>`,
});

// Attempt F: same as E but Discipline as repeated AcceptedService/ServiceCode styles if any
attempts.push({
  label: 'F_full_echo_DisciplineName_attr_style',
  body: `<PatientInfo>
  <PatientID>${PATIENT_ID}</PatientID>
  <OfficeID>${escapeXml(office)}</OfficeID>
  <FirstName>${escapeXml(fn)}</FirstName>
  <LastName>${escapeXml(ln)}</LastName>
  <BirthDate>${escapeXml(birth)}</BirthDate>
  <Gender>${escapeXml(gender)}</Gender>
  <CoordinatorID1>${escapeXml(coord)}</CoordinatorID1>
  ${demo.sourceOfAdmission ? `<SourceOfAdmission>${escapeXml(demo.sourceOfAdmission)}</SourceOfAdmission>` : ''}
  ${demo.branchId ? `<BranchID>${escapeXml(demo.branchId)}</BranchID>` : ''}
  ${demo.teamId ? `<TeamID>${escapeXml(demo.teamId)}</TeamID>` : ''}
  ${demo.locationId ? `<LocationID>${escapeXml(demo.locationId)}</LocationID>` : ''}
  <AcceptedServices>
${merged.map((d) => `    <AcceptedService><Discipline>${escapeXml(d)}</Discipline></AcceptedService>`).join('\n')}
  </AcceptedServices>
</PatientInfo>`,
});

results.intendedAdd = addDiscipline;
results.intendedMerged = merged;
results.steps.updates = {};

for (const attempt of attempts) {
  console.log(`\nTrying ${attempt.label} (add ${addDiscipline})…`);
  const upd = await call('UpdatePatientDemographics', attempt.body);
  const after = await call(
    'GetPatientDemographics',
    `<PatientInfo><ID>${PATIENT_ID}</ID></PatientInfo>`,
  );
  const afterServices = parseAcceptedServices(after.raw);
  const expanded =
    afterServices.map((x) => x.toUpperCase()).includes(addDiscipline.toUpperCase()) &&
    afterServices.length >= beforeServices.length;
  const changed =
    JSON.stringify(afterServices.map((x) => x.toUpperCase()).sort()) !==
    JSON.stringify(beforeServices.map((x) => x.toUpperCase()).sort());

  results.steps.updates[attempt.label] = {
    update: summarize(upd),
    afterAcceptedServices: afterServices,
    changed,
    expandedWithTarget: expanded,
  };
  console.log(
    `  update: eid=${upd.errorId} msg=${upd.errorMessage ?? ''} | after=[${afterServices.join(', ')}] changed=${changed} expanded=${expanded}`,
  );

  // Restore original AcceptedServices if we changed them (best-effort).
  if (changed && beforeServices.length) {
    const restoreBody = `<PatientInfo>
  <PatientID>${PATIENT_ID}</PatientID>
  <FirstName>${escapeXml(fn)}</FirstName>
  <LastName>${escapeXml(ln)}</LastName>
  <AcceptedServices>
${beforeServices.map((d) => `    <Discipline>${escapeXml(d)}</Discipline>`).join('\n')}
  </AcceptedServices>
</PatientInfo>`;
    const restore = await call('UpdatePatientDemographics', restoreBody);
    const verify = await call(
      'GetPatientDemographics',
      `<PatientInfo><ID>${PATIENT_ID}</ID></PatientInfo>`,
    );
    results.steps.updates[attempt.label].restore = {
      update: summarize(restore),
      acceptedServices: parseAcceptedServices(verify.raw),
    };
    console.log(
      `  restore: eid=${restore.errorId} services=[${parseAcceptedServices(verify.raw).join(', ')}]`,
    );
    // Stop after first successful expand — we have proof.
    if (expanded) break;
  } else if (expanded) {
    break;
  }
}

const anyExpand = Object.values(results.steps.updates).some((u) => u.expandedWithTarget);
results.verdict = anyExpand
  ? 'YES — UpdatePatientDemographics can expand AcceptedServices'
  : 'NO / UNCLEAR — UpdatePatientDemographics did not expand AcceptedServices in these attempts';

console.log('\nVERDICT:', results.verdict);

mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
const outPath = path.join(repoRoot, 'docs/hha-accepted-services-update-probe.json');
// Drop full raw XML from saved file
const toSave = JSON.parse(JSON.stringify(results));
writeFileSync(outPath, JSON.stringify(toSave, null, 2));
console.log('Wrote', outPath);
