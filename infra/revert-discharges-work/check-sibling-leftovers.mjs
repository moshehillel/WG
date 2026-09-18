/**
 * Quick leftover-NEW check for Porter / Asunto / Rolon (siblings of same mess).
 * Read-only — discharge only if NEW still ACTIVE (opt-in via APPLY=1).
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

const APPLY = process.env.APPLY === '1';
const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = process.env.HHA_BASE_URL || 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');
const TODAY = new Date().toISOString().slice(0, 10);
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
  const pls = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const placementId = block.match(/<PlacementID>([^<]*)/)?.[1];
    if (!placementId) continue;
    const dm = block.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i);
    pls.push({
      placementId,
      disc: (dm?.[1] ?? '').trim(),
      active: !(dm?.[1] ?? '').trim(),
    });
  }
  return {
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '',
    status: xml.match(/Status="([^"]+)"/)?.[1],
    pls,
  };
}

const SIBLINGS = [
  { name: 'Roy-Al Porter', patientId: '24555059', old: '7909108', neu: '8596092' },
  { name: 'Michael Asunto', patientId: '24617583', old: '7935330', neu: '8596094' },
  { name: 'Caleb Rolon', patientId: '24301609', old: '7802393', neu: '8596093' },
];

const reasons = await call('GetContractDischargeReason', '<Status>Active</Status>');
const reasonId =
  process.env.HHA_DISCHARGE_REASON_ID?.trim() ||
  reasons.xml?.match?.(/<ReasonID>(\d+)/)?.[1] ||
  [...(reasons.pls ? [] : []), ...(reasons.msg ? [] : [])];
// parse reason from raw — call returns structured without xml; redo:
async function callRaw(method, inner) {
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
const reasonXml = await callRaw('GetContractDischargeReason', '<Status>Active</Status>');
const reasonIdResolved =
  process.env.HHA_DISCHARGE_REASON_ID?.trim() ||
  reasonXml.match(/<ReasonID>(\d+)/)?.[1] ||
  '36883';

const rows = [];
for (const s of SIBLINGS) {
  const before = await call('GetPatientContracts', `<PatientID>${s.patientId}</PatientID>`);
  const oldP = before.pls.find((p) => p.placementId === s.old);
  const newP = before.pls.find((p) => p.placementId === s.neu);
  let discharge = null;
  if (APPLY && newP?.active) {
    const xml = await callRaw(
      'UpdatePatientContract',
      `<PatientContractInfo>
  <PatientID>${esc(s.patientId)}</PatientID>
  <PlacementID>${esc(s.neu)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>${esc(TODAY)}</DischargeDate>
  <DischargeReasonID>${esc(reasonIdResolved)}</DischargeReasonID>
  <DischargeNote>Ops cleanup: discharge mistaken duplicate placement</DischargeNote>
</PatientContractInfo>`,
    );
    discharge = {
      ok: /Status="Success"/i.test(xml) || /<ErrorID>0</.test(xml),
      eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
      msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '',
    };
  }
  const after = APPLY
    ? await call('GetPatientContracts', `<PatientID>${s.patientId}</PatientID>`)
    : before;
  const row = {
    name: s.name,
    patientId: s.patientId,
    before: before.pls.map((p) => `#${p.placementId}:${p.disc || 'ACTIVE'}`),
    old: oldP ? (oldP.active ? 'ACTIVE' : `DISC ${oldP.disc}`) : 'missing',
    neu: newP ? (newP.active ? 'ACTIVE' : `DISC ${newP.disc}`) : 'missing',
    discharge,
    after: after.pls.map((p) => `#${p.placementId}:${p.disc || 'ACTIVE'}`),
    leftoverNewActive: Boolean(newP?.active),
  };
  rows.push(row);
  console.log(s.name, 'old=', row.old, 'new=', row.neu, 'leftover=', row.leftoverNewActive);
}

writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/sibling-leftover-check.json'),
  JSON.stringify({ runAt: new Date().toISOString(), APPLY, rows }, null, 2),
);
