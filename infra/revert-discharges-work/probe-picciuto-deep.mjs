/**
 * Deep probe for Picciuto after seeded PatientID started returning -56.
 */
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
  const ids = [...new Set([...xml.matchAll(/<PatientID>(\d+)/g)].map((m) => m[1]))];
  const placements = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const placementId = block.match(/<PlacementID>([^<]*)/)?.[1];
    if (!placementId) continue;
    const dm = block.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i);
    placements.push({
      placementId,
      disc: (dm?.[1] ?? '').trim() || 'ACTIVE',
      start: block.match(/<ServiceStartDate>([^<]*)/)?.[1],
      svc: block.match(/<ServiceCode>[\s\S]*?<Name>([^<]*)/i)?.[1],
    });
  }
  return {
    method,
    http: res.status,
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '',
    ids,
    placements,
    first: xml.match(/<FirstName>([^<]*)/)?.[1],
    last: xml.match(/<LastName>([^<]*)/)?.[1],
    patientStatus: xml.match(/<Status>([^<]*)/)?.[1],
    preview: xml.replace(/\s+/g, ' ').slice(0, 400),
  };
}

const out = [];
out.push(['Arshad control contracts', await call('GetPatientContracts', '<PatientID>22854608</PatientID>')]);
out.push(['Picciuto contracts 26372249', await call('GetPatientContracts', '<PatientID>26372249</PatientID>')]);
out.push([
  'Picciuto demog 26372249',
  await call('GetPatientDemographics', '<PatientInfo><ID>26372249</ID></PatientInfo>'),
]);

const searches = [
  ['Active Edmund', 'Edmund', 'Picciuto', 'Active', '', ''],
  ['Discharged Edmund', 'Edmund', 'Picciuto', 'Discharged', '', ''],
  ['All Edmund', 'Edmund', 'Picciuto', 'All', '', ''],
  ['Waiting Edmund', 'Edmund', 'Picciuto', 'Waiting', '', ''],
  ['Hospitalized Edmund', 'Edmund', 'Picciuto', 'Hospitalized', '', ''],
  ['Hold last', '', 'Picciuto', 'Hold', '', ''],
  ['All last', '', 'Picciuto', 'All', '', ''],
  ['All admission', '', '', 'All', '258272446', ''],
  ['All MR', '', '', 'All', '', '258272446'],
  ['empty status admission', '', '', '', '258272446', ''],
];

for (const [label, first, last, status, adm, mr] of searches) {
  const r = await call(
    'SearchPatients',
    `<SearchFilters><FirstName>${esc(first)}</FirstName><LastName>${esc(last)}</LastName><Status>${esc(status)}</Status><PhoneNumber></PhoneNumber><AdmissionID>${esc(adm)}</AdmissionID><MRNumber>${esc(mr)}</MRNumber><SSN></SSN></SearchFilters>`,
  );
  out.push([`search ${label}`, r]);
}

// DOB variants from discharge CSV 09/02/2009
for (const dob of ['09/02/2009', '2009-09-02', '9/2/2009']) {
  const r = await call(
    'SearchPatients',
    `<SearchFilters><FirstName></FirstName><LastName>Picciuto</LastName><Status>All</Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN><DateOfBirth>${esc(dob)}</DateOfBirth></SearchFilters>`,
  );
  out.push([`search DOB ${dob}`, r]);
}

// Nearby PatientIDs? unlikely. Try GetPatientContracts on placement-related if any API exists — skip.

const payload = Object.fromEntries(
  out.map(([k, v]) => [
    k,
    {
      status: v.status,
      eid: v.eid,
      msg: v.msg,
      ids: v.ids,
      placements: v.placements,
      first: v.first,
      last: v.last,
      patientStatus: v.patientStatus,
    },
  ]),
);
writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/picciuto-deep-probe.json'),
  JSON.stringify(payload, null, 2),
);
for (const [k, v] of out) {
  console.log(
    k,
    `eid=${v.eid}`,
    v.msg ? `msg=${v.msg}` : '',
    v.ids?.length ? `ids=${v.ids.join(',')}` : '',
    v.placements?.length
      ? `pls=${v.placements.map((p) => p.placementId + ':' + p.disc).join('|')}`
      : '',
  );
}
