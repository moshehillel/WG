/**
 * Blind UpdatePatientContract attempts for Picciuto even when GetPatientContracts returns -56.
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

async function call(method, inner) {
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
    preview: xml.replace(/\s+/g, ' ').slice(0, 300),
  };
}

const pid = '26372249';
const results = {
  dischargeNew: await call(
    'UpdatePatientContract',
    `<PatientContractInfo>
  <PatientID>${pid}</PatientID>
  <PlacementID>8596091</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>2026-09-17</DischargeDate>
  <DischargeReasonID>36883</DischargeReasonID>
  <DischargeNote>Ops cleanup: discharge mistaken duplicate placement</DischargeNote>
</PatientContractInfo>`,
  ),
  reactivateOld: await call(
    'UpdatePatientContract',
    `<PatientContractInfo>
  <PatientID>${pid}</PatientID>
  <PlacementID>8522217</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeReasonID>36883</DischargeReasonID>
  <DischargeNote>Revert mistaken auto discharge</DischargeNote>
</PatientContractInfo>`,
  ),
  contractsAgain: await call('GetPatientContracts', `<PatientID>${pid}</PatientID>`),
};

writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/picciuto-blind-update.json'),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
