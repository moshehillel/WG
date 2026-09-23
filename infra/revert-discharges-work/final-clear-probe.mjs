import { readFileSync } from 'node:fs';
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
const URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(method, inner) {
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
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '',
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

// Dump GetPatientDischargeTo full
for (const inner of ['<Status>Active</Status>', '<Status>All</Status>', '']) {
  const r = await call('GetPatientDischargeTo', inner || '<Status></Status>');
  console.log('DischargeTo', inner, r.status, r.eid, r.xml.replace(/\s+/g, ' ').slice(0, 500));
}

// One more clear attempt on Arshad with known IDs from prior probe
const patientId = '22854608';
const placementId = '6812439';
const variants = [
  `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" />
  <DischargeToID>341</DischargeToID>
  <DischargeReasonID>36883</DischargeReasonID>
  <DischargeNote>clear</DischargeNote>
</PatientContractInfo>`,
  `<PatientContractInfo>
  <PatientID>${patientId}</PatientID>
  <PlacementID>${placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" />
</PatientContractInfo>`,
  // Try setting discharge date equal to start date? no that's not clear
];

for (const xml of variants) {
  const r = await call('UpdatePatientContract', xml);
  console.log('clear try', { status: r.status, eid: r.eid, msg: r.msg, fault: r.fault });
}

// Verify Solomon
const sol = await call('GetPatientContracts', `<PatientID>26367422</PatientID>`);
const blocks = [...(sol.xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) || [])];
for (const b of blocks) {
  console.log('Solomon', {
    id: b.match(/<PlacementID>([^<]*)/)?.[1],
    disc: b.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i)?.[1] || 'ACTIVE',
    start: b.match(/<ServiceStartDate>([^<]*)/)?.[1],
    svc: b.match(/<ServiceCode>\s*<ID>(\d+)/)?.[1],
  });
}
