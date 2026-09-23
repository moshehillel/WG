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

function parsePlacements(xml) {
  const list = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const placementId = block.match(/<PlacementID>([^<]*)/)?.[1];
    if (!placementId) continue;
    // Capture empty DischargeDate tags too
    const discMatch = block.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i);
    list.push({
      placementId,
      contractId: block.match(/<Contract>\s*<ID>(\d+)/i)?.[1],
      serviceName: block.match(/<ServiceCode>[\s\S]*?<Name>([^<]*)/i)?.[1],
      startDate: block.match(/<ServiceStartDate>([^<]*)/)?.[1],
      dischargeDate: (discMatch?.[1] ?? '').trim(),
      rawHasDischargeTag: /DischargeDate/i.test(block),
      blockSnippet: block.replace(/\s+/g, ' ').slice(0, 350),
    });
  }
  return list;
}

const known = [
  ['Arshad', '22854608', '6812439'],
  ['Galeano', '23012434', '6897698'],
  ['Oliver', '25788276', null],
  ['Porter', '24555059', '7909108'],
  ['Rolon', '24301609', '7802393'],
  ['Asunto', '24617583', '7935330'],
  ['Downs', '24865860', '8045831'],
  ['Navelgas', '22680255', '6711683'],
];

const out = [];
for (const [name, pid, expect] of known) {
  // PatientID only (works) + ISO VisitDate
  const xml1 = await call('GetPatientContracts', `<PatientID>${pid}</PatientID>`);
  const xml2 = await call(
    'GetPatientContracts',
    `<PatientID>${pid}</PatientID><VisitDate>2026-09-15</VisitDate>`,
  );
  const xml3 = await call(
    'GetPatientContracts',
    `<PatientID>${pid}</PatientID><VisitDate>2026-09-16</VisitDate>`,
  );
  const row = {
    name,
    pid,
    expect,
    noDate: parsePlacements(xml1),
    asOf0915: parsePlacements(xml2),
    asOf0916: parsePlacements(xml3),
  };
  out.push(row);
  console.log(
    name,
    'noDate',
    row.noDate.map((p) => `${p.placementId}:${p.dischargeDate || 'ACTIVE'}:${p.serviceName}`),
    '0915',
    row.asOf0915.map((p) => `${p.placementId}:${p.dischargeDate || 'ACTIVE'}`),
    '0916',
    row.asOf0916.map((p) => `${p.placementId}:${p.dischargeDate || 'ACTIVE'}`),
  );
}

// Find Picciuto / Martin Solomon via broader searches
console.log('\n--- search Picciuto / Solomon ---');
for (const [label, filters] of [
  ['Picciuto First Edmund', '<FirstName>Edmund</FirstName><LastName>Picciuto</LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN>'],
  ['Picciuto First EDMUND', '<FirstName>EDMUND</FirstName><LastName>PICCIUTO</LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN>'],
  ['Picciuto Admission padded', '<FirstName></FirstName><LastName></LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID>258272446</AdmissionID><MRNumber>258272446</MRNumber><SSN></SSN>'],
  ['Martin Solomon', '<FirstName>Martin</FirstName><LastName>Solomon</LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN>'],
  ['MARTIN SOLOMON', '<FirstName>MARTIN</FirstName><LastName>SOLOMON</LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN>'],
  ['Solomon Admission', '<FirstName></FirstName><LastName></LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID>06771684</AdmissionID><MRNumber>06771684</MRNumber><SSN></SSN>'],
  ['Solomon Admission no leading zero', '<FirstName></FirstName><LastName></LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID>6771684</AdmissionID><MRNumber>6771684</MRNumber><SSN></SSN>'],
]) {
  const xml = await call('SearchPatients', `<SearchFilters>${filters}</SearchFilters>`);
  const ids = [...new Set([...xml.matchAll(/<PatientID>(\d+)/g)].map((m) => m[1]))];
  const names = [...xml.matchAll(/<FirstName>([^<]*)<\/FirstName>\s*<MiddleName>[^<]*<\/MiddleName>\s*<LastName>([^<]*)<\/LastName>/g)].map(
    (m) => `${m[1]} ${m[2]}`,
  );
  console.log(label, { ids, names: names.slice(0, 5), status: xml.match(/Status="([^"]+)"/)?.[1] });
}

writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/live-status.json'),
  JSON.stringify(out, null, 2),
);
