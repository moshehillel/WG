/**
 * Broader sandbox exploration: any useful methods, more offices/patients/visits,
 * alternate VisitInfo shapes, caregivers, duties, reason codes, etc.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = process.env.HHA_BASE_URL;
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = process.env.HHA_APP_KEY.replace(/\s+/g, '');

const results = { testedAt: new Date().toISOString(), endpoint: URL, tries: [] };

async function call(method, inner) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${APP}</AppName>
        <AppSecret>${SECRET}</AppSecret>
        <AppKey>${KEY}</AppKey>
      </Authentication>
      ${inner ?? ''}
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
  const xml = await res.text();
  const status = xml.match(/Status="([^"]+)"/i)?.[1];
  const eid = xml.match(/<ErrorID>([^<]*)/)?.[1];
  const msg = xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '';
  const fault = xml.match(/<faultstring>([^<]*)/)?.[1];
  const ok = status?.toLowerCase() === 'success' || eid === '0';
  return { http: res.status, ok, status, eid, msg, fault, xml };
}

function log(label, r, extra = '') {
  const line = `${r.ok ? 'PASS' : 'FAIL'} ${label} eid=${r.eid ?? '-'} ${r.msg || r.fault || r.status || ''} ${extra}`;
  console.log(line);
  results.tries.push({
    label,
    ok: r.ok,
    eid: r.eid,
    msg: r.msg || r.fault,
    status: r.status,
    preview: r.xml.replace(/\s+/g, ' ').slice(0, 350),
  });
  return r;
}

function ids(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'gi'))].map((m) => Number(m[1]));
}

const day = '2026-07-10';
const today = new Date().toISOString().slice(0, 10);

// --- Extra reference methods (not only pipeline) ---
const extras = [
  ['GetOfficesV2', ''],
  ['GetTeams', ''],
  ['GetBranches', ''],
  ['GetNurses', '<SearchFilters />'],
  ['GetCaregiverGender', ''],
  ['GetCaregiverDocumentType', ''],
  ['GetCaregiverNoteSubjects', ''],
  ['GetCaregiverPayCodes', ''],
  ['GetCaregiverReferralSources', ''],
  ['GetReasonCodes', ''],
  ['GetActionCodes', ''],
  ['GetDuties', ''],
  ['GetVisitEditReasons', ''],
  ['GetMissedVisitReasons', ''],
  ['GetMissedVisitActions', ''],
  ['GetPriorityCodes', ''],
  ['GetPatientNoteSubjects', ''],
  ['GetLanguages', ''],
  ['GetStates', ''],
  ['GetPatientStatus', ''],
  ['GetScheduleTypes', ''],
  ['GetVisitTypes', ''],
  ['SearchCaregivers', `<SearchFilters>
  <FirstName></FirstName>
  <LastName></LastName>
  <Status>Active</Status>
</SearchFilters>`],
];

console.log('--- Extra / reference methods ---');
for (const [method, body] of extras) {
  try {
    log(method, await call(method, body));
  } catch (e) {
    console.log('ERR', method, e.message);
  }
}

// ScheduleType / VisitType lists if those methods exist
for (const method of ['GetScheduleTypes', 'GetVisitTypes', 'GetPatientContractScheduleTypes']) {
  // already tried some above
}

// --- Find visits that GetVisitInfoV2 accepts ---
console.log('\n--- Hunt VisitInfo that works ---');
const offices = [1025, 2259, 2933, 7362, 13511, 15453, 16039];
const visitCandidates = [];
for (const officeId of offices) {
  for (const d of [day, '2026-07-01', '2026-06-15', today]) {
    const r = await call(
      'SearchVisits',
      `<SearchFilters>
  <StartDate>${d}</StartDate>
  <EndDate>${d}</EndDate>
  <OfficeID>${officeId}</OfficeID>
</SearchFilters>`,
    );
    if (!r.ok) continue;
    const vids = ids(r.xml, 'VisitID').slice(0, 5);
    for (const vid of vids) visitCandidates.push({ officeId, day: d, visitId: vid });
  }
}
console.log(`Collected ${visitCandidates.length} visit candidates`);

// Dedupe visit IDs
const seen = new Set();
const unique = [];
for (const v of visitCandidates) {
  if (seen.has(v.visitId)) continue;
  seen.add(v.visitId);
  unique.push(v);
}

let workingVisit;
for (const v of unique.slice(0, 40)) {
  // Try several VisitInfo payload shapes
  const shapes = [
    ['V2-VisitID', 'GetVisitInfoV2', `<VisitInfo><VisitID>${v.visitId}</VisitID></VisitInfo>`],
    ['V2-ID', 'GetVisitInfoV2', `<VisitInfo><ID>${v.visitId}</ID></VisitInfo>`],
    [
      'GetVisitInfo',
      'GetVisitInfo',
      `<VisitInfo><VisitID>${v.visitId}</VisitID></VisitInfo>`,
    ],
    [
      'GetVisitInfoV1',
      'GetVisitInfo',
      `<VisitInfo><ID>${v.visitId}</ID></VisitInfo>`,
    ],
  ];
  for (const [label, method, body] of shapes) {
    const r = await call(method, body);
    if (r.ok) {
      log(`${label}(${v.visitId}) office=${v.officeId}`, r, 'FOUND WORKING VISIT');
      workingVisit = { ...v, method, label };
      break;
    }
    // only log non-415 briefly
    if (r.eid && r.eid !== '-415') {
      log(`${label}(${v.visitId})`, r);
    }
  }
  if (workingVisit) break;
}
if (!workingVisit) {
  console.log('No GetVisitInfo* success in first 40 candidates (mostly -415)');
  // log one sample failure
  if (unique[0]) {
    log(
      `sample GetVisitInfoV2(${unique[0].visitId})`,
      await call(
        'GetVisitInfoV2',
        `<VisitInfo><VisitID>${unique[0].visitId}</VisitID></VisitInfo>`,
      ),
    );
  }
}

// Try GetVisitChanges / GetPatientVisitChanges style
console.log('\n--- Visit change / history style methods ---');
for (const [method, body] of [
  [
    'GetVisitChanges',
    `<SearchFilters><ModifiedAfter>2026-07-01</ModifiedAfter><ModifiedBefore>2026-07-16</ModifiedBefore></SearchFilters>`,
  ],
  [
    'GetVisitChangesV2',
    `<SearchFilters><ModifiedAfter>2026-07-01</ModifiedAfter><ModifiedBefore>2026-07-16</ModifiedBefore></SearchFilters>`,
  ],
  [
    'GetPatientChanges',
    `<SearchFilters><ModifiedAfter>2026-07-01</ModifiedAfter><ModifiedBefore>2026-07-16</ModifiedBefore></SearchFilters>`,
  ],
  [
    'SearchVisitsByUpdateDate',
    `<SearchFilters><StartDate>2026-07-01</StartDate><EndDate>2026-07-16</EndDate></SearchFilters>`,
  ],
]) {
  log(method, await call(method, body));
}

// --- Caregivers → maybe visits by caregiver work better ---
console.log('\n--- Caregivers + their visits ---');
const cg = await call(
  'SearchCaregivers',
  `<SearchFilters>
  <FirstName></FirstName>
  <LastName></LastName>
  <Status>Active</Status>
</SearchFilters>`,
);
log('SearchCaregivers', cg);
const caregiverIds = ids(cg.xml, 'CaregiverID').slice(0, 10);
if (!caregiverIds.length) {
  // try alternate id tags
  const alt = ids(cg.xml, 'ID').slice(0, 10);
  console.log('Caregiver alt IDs', alt.slice(0, 5));
  caregiverIds.push(...alt);
}
results.caregiverIds = caregiverIds.slice(0, 10);

for (const cgId of caregiverIds.slice(0, 5)) {
  const r = await call(
    'SearchVisits',
    `<SearchFilters>
  <StartDate>${day}</StartDate>
  <EndDate>${day}</EndDate>
  <CaregiverID>${cgId}</CaregiverID>
</SearchFilters>`,
  );
  const vids = ids(r.xml, 'VisitID').slice(0, 3);
  log(`SearchVisits(caregiver=${cgId})`, r, `visits=${vids.length}`);
  for (const vid of vids.slice(0, 2)) {
    const info = await call(
      'GetVisitInfoV2',
      `<VisitInfo><VisitID>${vid}</VisitID></VisitInfo>`,
    );
    log(`GetVisitInfoV2 via CG ${vid}`, info);
    if (info.ok) {
      workingVisit = { visitId: vid, caregiverId: cgId, method: 'GetVisitInfoV2' };
      break;
    }
  }
  if (workingVisit?.caregiverId) break;
}

// Patient-scoped visits then VisitInfo
console.log('\n--- Patient-scoped visits ---');
const patients = await call(
  'SearchPatients',
  `<SearchFilters>
  <FirstName></FirstName><LastName></LastName><Status>Active</Status>
  <PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN>
</SearchFilters>`,
);
const patientIds = ids(patients.xml, 'PatientID').slice(0, 25);
for (const pid of patientIds) {
  const r = await call(
    'SearchVisits',
    `<SearchFilters>
  <StartDate>2026-06-01</StartDate>
  <EndDate>2026-07-15</EndDate>
  <PatientID>${pid}</PatientID>
</SearchFilters>`,
  );
  if (!r.ok) continue;
  const vids = ids(r.xml, 'VisitID').slice(0, 3);
  if (!vids.length) continue;
  for (const vid of vids) {
    const info = await call(
      'GetVisitInfoV2',
      `<VisitInfo><VisitID>${vid}</VisitID></VisitInfo>`,
    );
    if (info.ok) {
      log(`GetVisitInfoV2 patient=${pid} visit=${vid}`, info, 'FOUND');
      workingVisit = { visitId: vid, patientId: pid, method: 'GetVisitInfoV2' };
      break;
    }
  }
  if (workingVisit?.patientId) break;
}
if (!workingVisit?.patientId && !workingVisit?.method) {
  console.log('No patient-scoped VisitInfo success either');
}

// GetContractServiceCode with real placement contract + schedule types from GetScheduleTypes if any
console.log('\n--- Service code variants ---');
const pc = await call(
  'GetPatientContracts',
  `<PatientID>958000</PatientID><VisitDate>${day}</VisitDate>`,
);
const contractId = pc.xml.match(/<Contract>\s*<ID>(\d+)/)?.[1] ?? '10410';
const scheduleTypes = [
  '1',
  '2',
  '3',
  'D',
  'H',
  'W',
  'DailyFixed',
  'Daily Fixed',
  'daily',
  'Hourly',
  'Weekly',
  'FixedDaily',
  'Permanent',
  'Temporary',
];
// If GetScheduleTypes returned values, parse them
const stTry = results.tries.find((t) => t.label === 'GetScheduleTypes' && t.ok);
if (stTry) {
  console.log('GetScheduleTypes preview', stTry.preview);
}
for (const st of scheduleTypes) {
  const r = await call(
    'GetContractServiceCode',
    `<PatientID>958000</PatientID>
  <ContractID>${contractId}</ContractID>
  <ScheduleType>${st}</ScheduleType>
  <IsInternalContract>0</IsInternalContract>`,
  );
  log(`GetContractServiceCode type=${st}`, r);
  if (r.ok) break;
  if (r.fault) break; // stop on SOAP fault spam
}

// CreateSchedule with PrimaryBillTo using real placement service code
console.log('\n--- Richer CreateSchedule validation ---');
const serviceCodeId = pc.xml.match(/<ServiceCode>\s*<ID>(\d+)/)?.[1] ?? '114535';
const sched = await call(
  'CreateSchedule',
  `<ScheduleInfo>
  <PatientID>958000</PatientID>
  <ScheduleType>Daily</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <ScheduleDurationHours>2</ScheduleDurationHours>
  <ScheduleDurationMinutes>0</ScheduleDurationMinutes>
  <VisitDate>${today}</VisitDate>
  <ScheduleStartTime>09:00</ScheduleStartTime>
  <ScheduleEndTime>11:00</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <PrimaryBillTo>
    <ContractID>${contractId}</ContractID>
    <ServiceCodeID>${serviceCodeId}</ServiceCodeID>
    <Hours>2</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
);
log('CreateSchedule[richer]', sched);

results.workingVisit = workingVisit ?? null;
mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
writeFileSync(
  path.join(repoRoot, 'docs', 'hha-broad-probe-results.json'),
  JSON.stringify(results, null, 2),
);
console.log('\nworkingVisit=', workingVisit);
console.log('Wrote docs/hha-broad-probe-results.json');
