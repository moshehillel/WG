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
process.env.HHA_ALLOW_PRODUCTION = 'true';

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
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
  return {
    http: res.status,
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '',
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

const patientId = '22854608';
const placementId = '6812439';

// Dump raw response for empty clear
const variants = [
  [
    'empty date',
    `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate></DischargeDate>
</PatientContractInfo>`,
  ],
  [
    'nil date 0001',
    `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>0001-01-01</DischargeDate>
</PatientContractInfo>`,
  ],
  [
    'nil date 1900',
    `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>1900-01-01</DischargeDate>
</PatientContractInfo>`,
  ],
  [
    'far future',
    `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>2099-12-31</DischargeDate>
</PatientContractInfo>`,
  ],
  [
    'with reason note empty date',
    `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate></DischargeDate>
  <DischargeNote>Revert mistaken automation discharge</DischargeNote>
</PatientContractInfo>`,
  ],
  [
    'UpdateDischargeDate false only',
    `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>false</UpdateDischargeDate>
</PatientContractInfo>`,
  ],
];

for (const [label, xml] of variants) {
  const r = await call('UpdatePatientContract', xml);
  console.log(
    '\n' + label,
    JSON.stringify({ http: r.http, status: r.status, eid: r.eid, msg: r.msg, fault: r.fault }),
  );
  console.log(r.xml.replace(/\s+/g, ' ').slice(0, 500));
}

// After probes, re-read placement
const after = await call(
  'GetPatientContracts',
  `<PatientID>${patientId}</PatientID><VisitDate>2026-09-16</VisitDate>`,
);
writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/arshad-after-probe.xml'),
  after.xml,
);
const disc = after.xml.match(/<DischargeDate[^>]*>([^<]*)<\/DischargeDate>|<DischargeDate\s*\/>/);
console.log('\nArshad after probes discharge match', disc?.[0]);

// Asunto PatientID-only
for (const [name, pid] of [
  ['Asunto', '24617583'],
  ['Downs', '24865860'],
  ['Navelgas', '22680255'],
]) {
  const r1 = await call('GetPatientContracts', `<PatientID>${pid}</PatientID>`);
  const r2 = await call(
    'GetPatientContracts',
    `<PatientID>${pid}</PatientID><VisitDate>2026-09-09</VisitDate>`,
  );
  const r3 = await call(
    'GetPatientContracts',
    `<PatientID>${pid}</PatientID><VisitDate>2026-09-10</VisitDate>`,
  );
  const count = (xml) => (xml.match(/<PlacementID>/g) || []).length;
  const discs = (xml) => [...xml.matchAll(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/gi)].map((m) => m[1] || 'EMPTY');
  console.log(name, {
    noDate: count(r1.xml),
    d1: discs(r1.xml),
    as0909: count(r2.xml),
    d2: discs(r2.xml),
    as0910: count(r3.xml),
    d3: discs(r3.xml),
    eid1: r1.eid,
    eid2: r2.eid,
  });
}
