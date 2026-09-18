/**
 * Retry Picciuto NEW discharge with DischargeToID resolved from HHA refs.
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
    xml,
    preview: xml.replace(/\s+/g, ' ').slice(0, 500),
  };
}

const to = await call('GetPatientDischargeTo', '<Status>Active</Status>');
const reasons = await call('GetContractDischargeReason', '<Status>Active</Status>');
const toIds = [...to.xml.matchAll(/<(?:ID|DischargeToID|PatientDischargeToID)>(\d+)/gi)].map((m) => m[1]);
const reasonIds = [...reasons.xml.matchAll(/<ReasonID>(\d+)/gi)].map((m) => m[1]);
const toNames = [...to.xml.matchAll(/<PatientDischargeToName>([^<]*)/gi)].map((m) => m[1]);
console.log('toIds', toIds.slice(0, 10), 'names', toNames.slice(0, 5));
console.log('reasonIds', reasonIds.slice(0, 5));

const toId = process.env.HHA_DISCHARGE_TO_ID?.trim() || toIds.find((id) => id !== '0') || '341';
const reasonId = process.env.HHA_DISCHARGE_REASON_ID?.trim() || reasonIds[0] || '36883';
const pid = '26372249';

const attempts = [];
for (const [label, place, date] of [
  ['discharge NEW 8596091', '8596091', '2026-09-17'],
  ['discharge NEW 8596091 yesterday', '8596091', '2026-09-16'],
]) {
  const r = await call(
    'UpdatePatientContract',
    `<PatientContractInfo>
  <PatientID>${pid}</PatientID>
  <PlacementID>${place}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>${date}</DischargeDate>
  <DischargeToID>${esc(toId)}</DischargeToID>
  <DischargeReasonID>${esc(reasonId)}</DischargeReasonID>
  <DischargeNote>Ops cleanup: discharge mistaken duplicate placement from new_services overlap remediation</DischargeNote>
</PatientContractInfo>`,
  );
  attempts.push({
    label,
    toId,
    reasonId,
    ok: r.status?.toLowerCase() === 'success' || r.eid === '0',
    eid: r.eid,
    msg: r.msg,
    status: r.status,
  });
  console.log(label, attempts.at(-1));
}

// Also try OLD reactivate with toId
const react = await call(
  'UpdatePatientContract',
  `<PatientContractInfo>
  <PatientID>${pid}</PatientID>
  <PlacementID>8522217</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeToID>${esc(toId)}</DischargeToID>
  <DischargeReasonID>${esc(reasonId)}</DischargeReasonID>
  <DischargeNote>Revert mistaken auto discharge</DischargeNote>
</PatientContractInfo>`,
);
attempts.push({
  label: 'reactivate OLD omit date',
  ok: react.status?.toLowerCase() === 'success' || react.eid === '0',
  eid: react.eid,
  msg: react.msg,
});
console.log('reactivate', attempts.at(-1));

const contracts = await call('GetPatientContracts', `<PatientID>${pid}</PatientID>`);
const placements = [];
for (const block of contracts.xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
  const placementId = block.match(/<PlacementID>([^<]*)/)?.[1];
  if (!placementId) continue;
  const dm = block.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i);
  placements.push({
    placementId,
    disc: (dm?.[1] ?? '').trim() || 'ACTIVE',
  });
}

const payload = {
  runAt: new Date().toISOString(),
  toId,
  reasonId,
  toSample: to.preview,
  attempts,
  contractsAfter: { eid: contracts.eid, msg: contracts.msg, placements },
};
writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/picciuto-discharge-retry.json'),
  JSON.stringify(payload, null, 2),
);
console.log('contractsAfter', payload.contractsAfter);
