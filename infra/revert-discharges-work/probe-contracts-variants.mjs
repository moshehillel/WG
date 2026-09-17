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
  const xml = await res.text();
  return { http: res.status, xml };
}

const pid = '22854608'; // Arshad
const variants = [
  ['VisitDate mm/dd/yyyy', `<PatientID>${pid}</PatientID><VisitDate>09/16/2026</VisitDate>`],
  ['VisitDate yyyy-mm-dd', `<PatientID>${pid}</PatientID><VisitDate>2026-09-16</VisitDate>`],
  ['StartDate mm/dd', `<PatientID>${pid}</PatientID><StartDate>09/16/2026</StartDate>`],
  ['PatientID only', `<PatientID>${pid}</PatientID>`],
  [
    'PatientInfo wrap',
    `<PatientInfo><PatientID>${pid}</PatientID><VisitDate>09/16/2026</VisitDate></PatientInfo>`,
  ],
];

for (const [label, inner] of variants) {
  const r = await call('GetPatientContracts', inner);
  const compact = r.xml.replace(/\s+/g, ' ').slice(0, 800);
  const n = (r.xml.match(/<PlacementID>/g) || []).length;
  const status = r.xml.match(/Status="([^"]+)"/)?.[1];
  const eid = r.xml.match(/<ErrorID>([^<]*)/)?.[1];
  const msg = r.xml.match(/<ErrorMessage>([^<]*)/)?.[1];
  console.log('\n' + label, { http: r.http, status, eid, msg, placementTags: n });
  console.log(compact);
  writeFileSync(
    path.join(repoRoot, 'infra/revert-discharges-work', `arshad-${label.replace(/\W+/g, '_')}.xml`),
    r.xml,
  );
}

// Solomon candidate from last-name search
const sol = await call(
  'GetPatientDemographics',
  `<PatientInfo><ID>24238104</ID></PatientInfo>`,
);
console.log('\nSolomon candidate demos', sol.xml.replace(/\s+/g, ' ').slice(0, 600));

// Try Picciuto DOB from CSV 09/02/2009
const pic = await call(
  'SearchPatients',
  `<SearchFilters><FirstName></FirstName><LastName>Picciuto</LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN><DateOfBirth>09/02/2009</DateOfBirth></SearchFilters>`,
);
console.log('\nPicciuto DOB search', pic.xml.replace(/\s+/g, ' ').slice(0, 600));
