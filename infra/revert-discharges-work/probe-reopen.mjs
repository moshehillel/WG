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
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body>
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

function placements(xml) {
  const out = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const id = block.match(/<PlacementID>([^<]*)/)?.[1];
    if (!id) continue;
    const dm = block.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i);
    out.push({
      placementId: id,
      contractId: block.match(/<Contract>\s*<ID>(\d+)/i)?.[1],
      svc: block.match(/<ServiceCode>\s*<ID>(\d+)/i)?.[1],
      start: block.match(/<ServiceStartDate>([^<]*)/)?.[1],
      disc: (dm?.[1] ?? '').trim(),
    });
  }
  return out;
}

const patientId = '22854608';
const placementId = '6812439';

// 1) xsi:nil clear
const nil = await call(
  'UpdatePatientContract',
  `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate xsi:nil="true" />
</PatientContractInfo>`,
);
console.log('xsi:nil', { status: nil.status, eid: nil.eid, msg: nil.msg, fault: nil.fault });

// 2) GetContractDischargeReason / DischargeTo for completeness
const reasons = await call('GetContractDischargeReason', '<Status>Active</Status>');
console.log('reasons sample', reasons.xml.replace(/\s+/g, ' ').slice(0, 400));

// 3) Try AddPatientContract reopen (same contract/service, start = day after old disc)
const before = await call('GetPatientContracts', `<PatientID>${patientId}</PatientID>`);
console.log('before', placements(before.xml));

const add = await call(
  'AddPatientContract',
  `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <ContractID>61591</ContractID>
  <StartDate>2026-09-16</StartDate>
  <ServiceCodeID>785140</ServiceCodeID>
</PatientContractInfo>`,
);
console.log('AddPatientContract', {
  status: add.status,
  eid: add.eid,
  msg: add.msg,
  placement: add.xml.match(/<PlacementID>([^<]*)/)?.[1],
});
console.log(add.xml.replace(/\s+/g, ' ').slice(0, 600));

const after = await call('GetPatientContracts', `<PatientID>${patientId}</PatientID>`);
console.log('after', placements(after.xml));
writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/arshad-reopen-probe.json'),
  JSON.stringify(
    {
      nil: { status: nil.status, eid: nil.eid, msg: nil.msg, fault: nil.fault },
      add: { status: add.status, eid: add.eid, msg: add.msg },
      before: placements(before.xml),
      after: placements(after.xml),
    },
    null,
    2,
  ),
);
