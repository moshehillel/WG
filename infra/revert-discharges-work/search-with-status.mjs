import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = process.env.HHA_BASE_URL || 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<${method} xmlns="${NS}"><Authentication><AppName>${esc(APP)}</AppName><AppSecret>${esc(SECRET)}</AppSecret><AppKey>${esc(KEY)}</AppKey></Authentication>${inner}</${method}>
</soap:Body></soap:Envelope>`;
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/${method}"`,
    },
    body,
  });
  return await res.text();
}

function summarizePatients(xml) {
  const blocks = xml.match(/<PatientInfo>[\s\S]*?<\/PatientInfo>/gi) ?? [];
  // some responses nest differently
  const ids = [...new Set([...xml.matchAll(/<PatientID>(\d+)/g)].map((m) => m[1]))];
  const status = xml.match(/Status="([^"]+)"/)?.[1];
  const eid = xml.match(/<ErrorID>([^<]*)/)?.[1];
  const msg = xml.match(/<ErrorMessage>([^<]*)/)?.[1];
  const names = [];
  for (const b of blocks) {
    names.push({
      id: b.match(/<PatientID>(\d+)/)?.[1],
      first: b.match(/<FirstName>([^<]*)/)?.[1],
      last: b.match(/<LastName>([^<]*)/)?.[1],
      status: b.match(/<Status>([^<]*)/)?.[1],
      admission: b.match(/<AdmissionID>([^<]*)/)?.[1],
      mr: b.match(/<MRNumber>([^<]*)/)?.[1],
    });
  }
  return { status, eid, msg, ids, names, patientsTagEmpty: /<Patients\s*\/>/.test(xml) || /<Patients><\/Patients>/.test(xml) };
}

const statuses = ['', 'Active', 'Inactive', 'Discharged', 'Pending', 'All', '0', '1'];
const tries = [];
for (const status of statuses) {
  for (const [label, first, last, admission] of [
    ['Picciuto', 'EDMUND', 'PICCIUTO', '258272446'],
    ['Solomon', 'MARTIN', 'SOLOMON', '06771684'],
  ]) {
    const filters = `<FirstName>${first}</FirstName><LastName>${last}</LastName><Status>${status}</Status><PhoneNumber></PhoneNumber><AdmissionID>${admission}</AdmissionID><MRNumber></MRNumber><SSN></SSN>`;
    const xml = await call('SearchPatients', `<SearchFilters>${filters}</SearchFilters>`);
    const s = summarizePatients(xml);
    tries.push({ label, status, ...s });
    console.log(label, `Status="${status}"`, JSON.stringify({ ids: s.ids, names: s.names, eid: s.eid, empty: s.patientsTagEmpty }));
  }
}

// Also try GetPatientDemographics over a range? too expensive.
// Try known placement approach: SearchVisits? no.
// Try GetPatientContracts with wrong IDs from nearby? no.

writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/search-status-variants.json'),
  JSON.stringify(tries, null, 2),
);

// Dump raw XML for one Picciuto search from meeting era style (PatientID only from new_services maybe stored elsewhere)
// Check Dynamo? skip.
// Try DOB from CSV
const picDob = await call(
  'SearchPatients',
  `<SearchFilters><FirstName></FirstName><LastName>Picciuto</LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN></SearchFilters>`,
);
console.log('Picciuto last only raw snippet', picDob.replace(/\s+/g, ' ').slice(0, 500));

const solDob = await call(
  'SearchPatients',
  `<SearchFilters><FirstName></FirstName><LastName>Solomon</LastName><Status>Active</Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN></SearchFilters>`,
);
const solIds = [...new Set([...solDob.matchAll(/<PatientID>(\d+)/g)].map((m) => m[1]))];
console.log('Solomon last Active ids', solIds);
for (const id of solIds.slice(0, 10)) {
  const demo = await call('GetPatientDemographics', `<PatientInfo><ID>${id}</ID></PatientInfo>`);
  const first = demo.match(/<FirstName>([^<]*)/)?.[1];
  const last = demo.match(/<LastName>([^<]*)/)?.[1];
  const adm = demo.match(/<AdmissionID>([^<]*)/)?.[1];
  const dob = demo.match(/<(?:DOB|BirthDate|DateOfBirth)>([^<]*)/)?.[1];
  console.log({ id, first, last, adm, dob });
}
