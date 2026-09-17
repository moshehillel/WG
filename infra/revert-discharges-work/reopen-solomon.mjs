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
  if (!xml) throw new Error(`Empty response http=${res.status}`);
  return xml;
}

function placements(xml) {
  if (!xml) return [];
  const out = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const id = block.match(/<PlacementID>([^<]*)/)?.[1];
    if (!id) continue;
    const dm = block.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i);
    out.push({
      placementId: id,
      contractId: block.match(/<Contract>\s*<ID>(\d+)/i)?.[1],
      contractName: block.match(/<Contract>[\s\S]*?<Name>([^<]*)/i)?.[1],
      svc: block.match(/<ServiceCode>\s*<ID>(\d+)/i)?.[1],
      svcName: block.match(/<ServiceCode>[\s\S]*?<Name>([^<]*)/i)?.[1],
      start: block.match(/<ServiceStartDate>([^<]*)/)?.[1],
      disc: (dm?.[1] ?? '').trim(),
      raw: block.replace(/\s+/g, ' ').slice(0, 500),
    });
  }
  return out;
}

console.log('creds', { app: !!APP, secret: !!SECRET, key: !!KEY });
const patientId = '26367422';
const beforeXml = await call('GetPatientContracts', `<PatientID>${patientId}</PatientID>`);
console.log('Solomon before raw', beforeXml.replace(/\s+/g, ' ').slice(0, 800));
console.log('Solomon before', placements(beforeXml));
writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/solomon-before.xml'),
  beforeXml,
);

// Meeting: Extended contract 61591; try OT SOC/ROC OASIS 785140 and Occupational Therapy 785137
const tries = [
  ['OT SOC/ROC 785140', '61591', '785140'],
  ['Occupational Therapy 785137', '61591', '785137'],
];
const existing = placements(beforeXml)[0];
if (existing?.contractId && existing?.svc) {
  tries.unshift(['from placement', existing.contractId, existing.svc]);
}

for (const [label, contractId, svc] of tries) {
  const add = await call(
    'AddPatientContract',
    `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <ContractID>${contractId}</ContractID>
  <StartDate>2026-09-16</StartDate>
  <ServiceCodeID>${svc}</ServiceCodeID>
</PatientContractInfo>`,
  );
  console.log(label, {
    status: add.match(/Status="([^"]+)"/)?.[1],
    eid: add.match(/<ErrorID>([^<]*)/)?.[1],
    msg: add.match(/<ErrorMessage>([^<]*)/)?.[1],
    placement: add.match(/<PlacementID>([^<]*)/)?.[1],
  });
  const after = placements(await call('GetPatientContracts', `<PatientID>${patientId}</PatientID>`));
  const active = after.filter((p) => !p.disc);
  console.log('active after', active);
  if (active.length) {
    writeFileSync(
      path.join(repoRoot, 'infra/revert-discharges-work/solomon-reopen.json'),
      JSON.stringify({ label, contractId, svc, active, after }, null, 2),
    );
    break;
  }
}
