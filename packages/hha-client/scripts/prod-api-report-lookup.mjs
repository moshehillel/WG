/**
 * Read-only production lookup for one API Report session row.
 * No Create/Update/Confirm calls.
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
const URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = process.env.HHA_APP_KEY.replace(/\s+/g, '');

const sample = {
  programId: '02877125',
  lastName: 'ELSAYED',
  firstName: 'MUNIR',
  dob: '04/10/2006',
  sessionDate: '2026-07-08',
  begin: '4:00 PM',
  end: '4:30 PM',
  provider: 'PERETZ DEBRA',
  serviceType: 'OT HC Eval',
};

async function call(method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${APP}</AppName>
        <AppSecret>${SECRET}</AppSecret>
        <AppKey>${KEY}</AppKey>
      </Authentication>
      ${inner}
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
  return {
    http: res.status,
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

function log(label, r) {
  console.log(
    `${label}: http=${r.http} status=${r.status ?? '-'} eid=${r.eid ?? '-'} ${r.msg || r.fault || ''}`,
  );
}

function ids(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'gi'))].map((m) => Number(m[1]));
}

function toMinutes(t) {
  // "4:00 PM" -> minutes from midnight
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function extractHhaTimeMinutes(s) {
  // "2026-07-08 16:00" or "2026-07-08T16:00:00"
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

console.log('READ-ONLY production lookup');
console.log('Endpoint:', URL);
console.log('Sample:', sample);
console.log('');

const attempts = [
  [
    'SearchPatients AdmissionID',
    `<SearchFilters>
  <FirstName></FirstName><LastName></LastName><Status></Status>
  <PhoneNumber></PhoneNumber>
  <AdmissionID>${sample.programId}</AdmissionID>
  <MRNumber></MRNumber><SSN></SSN>
</SearchFilters>`,
  ],
  [
    'SearchPatients AdmissionID no leading 0',
    `<SearchFilters>
  <FirstName></FirstName><LastName></LastName><Status></Status>
  <PhoneNumber></PhoneNumber>
  <AdmissionID>${Number(sample.programId)}</AdmissionID>
  <MRNumber></MRNumber><SSN></SSN>
</SearchFilters>`,
  ],
  [
    'SearchPatients MRNumber',
    `<SearchFilters>
  <FirstName></FirstName><LastName></LastName><Status></Status>
  <PhoneNumber></PhoneNumber>
  <AdmissionID></AdmissionID>
  <MRNumber>${Number(sample.programId)}</MRNumber><SSN></SSN>
</SearchFilters>`,
  ],
  [
    'SearchPatients by name',
    `<SearchFilters>
  <FirstName>${sample.firstName}</FirstName>
  <LastName>${sample.lastName}</LastName>
  <Status></Status>
  <PhoneNumber></PhoneNumber>
  <AdmissionID></AdmissionID>
  <MRNumber></MRNumber><SSN></SSN>
</SearchFilters>`,
  ],
];

let patientIds = [];
const out = { testedAt: new Date().toISOString(), endpoint: URL, sample, attempts: [] };

for (const [label, body] of attempts) {
  const r = await call('SearchPatients', body);
  log(label, r);
  const found = ids(r.xml, 'PatientID');
  console.log('  PatientIDs:', found.slice(0, 10));
  out.attempts.push({
    label,
    status: r.status,
    eid: r.eid,
    msg: r.msg || r.fault,
    patientIds: found.slice(0, 20),
    preview: r.xml.replace(/\s+/g, ' ').slice(0, 400),
  });
  if (found.length && !patientIds.length) patientIds = found;
}

if (!patientIds.length) {
  console.log('\nNo patient found — cannot search visits.');
  writeFileSync(path.join(repoRoot, 'docs', 'hha-api-report-prod-lookup.json'), JSON.stringify(out, null, 2));
  process.exit(0);
}

const patientId = patientIds[0];
console.log('\nUsing PatientID', patientId);

const demo = await call('GetPatientDemographics', `<PatientInfo><ID>${patientId}</ID></PatientInfo>`);
log('GetPatientDemographics', demo);
console.log(
  '  name',
  demo.xml.match(/<FirstName>([^<]*)/)?.[1],
  demo.xml.match(/<LastName>([^<]*)/)?.[1],
  'admission',
  demo.xml.match(/<AdmissionID>([^<]*)/)?.[1],
  'MR',
  demo.xml.match(/<MRNumber>([^<]*)/)?.[1],
  'DOB',
  demo.xml.match(/<BirthDate>([^<]*)/)?.[1],
);
out.demographics = {
  patientId,
  status: demo.status,
  eid: demo.eid,
  firstName: demo.xml.match(/<FirstName>([^<]*)/)?.[1],
  lastName: demo.xml.match(/<LastName>([^<]*)/)?.[1],
  admissionId: demo.xml.match(/<AdmissionID>([^<]*)/)?.[1],
  mrNumber: demo.xml.match(/<MRNumber>([^<]*)/)?.[1],
  birthDate: demo.xml.match(/<BirthDate>([^<]*)/)?.[1],
};

const visits = await call(
  'SearchVisits',
  `<SearchFilters>
  <StartDate>${sample.sessionDate}</StartDate>
  <EndDate>${sample.sessionDate}</EndDate>
  <PatientID>${patientId}</PatientID>
</SearchFilters>`,
);
log('SearchVisits that day', visits);
const visitIds = ids(visits.xml, 'VisitID');
console.log('  VisitIDs:', visitIds.slice(0, 20));
out.visitsSearch = {
  status: visits.status,
  eid: visits.eid,
  msg: visits.msg,
  visitIds: visitIds.slice(0, 20),
  preview: visits.xml.replace(/\s+/g, ' ').slice(0, 600),
};

const expectedStart = toMinutes(sample.begin);
const expectedEnd = toMinutes(sample.end);
out.expected = { startMin: expectedStart, endMin: expectedEnd, begin: sample.begin, end: sample.end };

const matches = [];
for (const vid of visitIds.slice(0, 10)) {
  const info = await call('GetVisitInfoV2', `<VisitInfo><ID>${vid}</ID></VisitInfo>`);
  const start =
    info.xml.match(/<VisitStartTime>([^<]*)/)?.[1] ||
    info.xml.match(/<ScheduleStartTime>([^<]*)/)?.[1] ||
    info.xml.match(/<EVVStartTime>([^<]*)/)?.[1] ||
    '';
  const end =
    info.xml.match(/<VisitEndTime>([^<]*)/)?.[1] ||
    info.xml.match(/<ScheduleEndTime>([^<]*)/)?.[1] ||
    info.xml.match(/<EVVEndTime>([^<]*)/)?.[1] ||
    '';
  const cg =
    info.xml.match(/<Caregiver>[\s\S]*?<LastName>([^<]*)/)?.[1] ||
    info.xml.match(/<CaregiverLastName>([^<]*)/)?.[1] ||
    '';
  const cgFirst =
    info.xml.match(/<Caregiver>[\s\S]*?<FirstName>([^<]*)/)?.[1] ||
    info.xml.match(/<CaregiverFirstName>([^<]*)/)?.[1] ||
    '';
  const sMin = extractHhaTimeMinutes(start);
  const eMin = extractHhaTimeMinutes(end);
  const startDiff =
    sMin != null && expectedStart != null ? Math.abs(sMin - expectedStart) : null;
  const endDiff = eMin != null && expectedEnd != null ? Math.abs(eMin - expectedEnd) : null;
  const within5 =
    startDiff != null && endDiff != null && startDiff <= 5 && endDiff <= 5;
  const row = {
    visitId: vid,
    status: info.status,
    eid: info.eid,
    start,
    end,
    caregiver: `${cgFirst} ${cg}`.trim(),
    startDiffMin: startDiff,
    endDiffMin: endDiff,
    within5,
  };
  matches.push(row);
  console.log(
    `  Visit ${vid}: ${start} - ${end} caregiver=${row.caregiver} startDiff=${startDiff} endDiff=${endDiff} within5=${within5}`,
  );
}

out.visitMatches = matches;
out.conclusion = {
  patientFound: true,
  patientId,
  visitsFound: visitIds.length,
  within5Count: matches.filter((m) => m.within5).length,
};

writeFileSync(
  path.join(repoRoot, 'docs', 'hha-api-report-prod-lookup.json'),
  JSON.stringify(out, null, 2),
);
console.log('\nWrote docs/hha-api-report-prod-lookup.json');
console.log('Conclusion:', out.conclusion);
