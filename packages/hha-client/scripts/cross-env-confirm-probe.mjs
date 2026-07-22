/**
 * Test: fetch ReasonCode/ActionCode from PROD (read-only),
 * then try ConfirmVisits on SANDBOX with those codes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const PROD_URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const SANDBOX_URL =
  process.env.HHA_BASE_URL ??
  'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = process.env.HHA_APP_KEY.replace(/\s+/g, '');

async function call(url, method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${APP}</AppName>
        <AppSecret>${SECRET}</AppSecret>
        <AppKey>${KEY}</AppKey>
      </Authentication>
      ${inner}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
  const res = await fetch(url, {
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
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

function parseReasonPairs(xml) {
  const pairs = [];
  for (const m of xml.matchAll(
    /<VisitEditReasonID>(\d+)<\/VisitEditReasonID>[\s\S]*?<VisitEditActionTakenReasonID>(\d+)<\/VisitEditActionTakenReasonID>/gi,
  )) {
    pairs.push({ reasonId: m[1], actionId: m[2] });
  }
  const seen = new Set();
  return pairs.filter((p) => {
    const k = `${p.reasonId}:${p.actionId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function toIso(dateStr, timeStr) {
  const [h, m] = timeStr.trim().split(':');
  return `${dateStr}T${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}:00`;
}

const prodVisitId = 1308496385; // read-only prod sample visit
const sandboxVisitId = 1282693446; // past sandbox visit (1298399661 is future → -310)

console.log('1) PROD GetVisitEditReasonActionTaken (read-only)...');
const prodReasons = await call(
  PROD_URL,
  'GetVisitEditReasonActionTaken',
  `<VisitInfo><VisitId>${prodVisitId}</VisitId></VisitInfo>`,
);
console.log('   ', prodReasons.status, 'eid', prodReasons.eid, prodReasons.msg || prodReasons.fault || '');
writeFileSync(path.join(repoRoot, 'tmp', 'prod-visit-edit-reasons.xml'), prodReasons.xml);
const pairs = parseReasonPairs(prodReasons.xml);
console.log('   pairs found:', pairs.slice(0, 5));

if (!pairs.length) {
  console.log('\nNo reason pairs from prod — cannot test cross-env.');
  process.exit(1);
}

console.log('\n2) SANDBOX GetVisitInfoV2...');
const info = await call(
  SANDBOX_URL,
  'GetVisitInfoV2',
  `<VisitInfo><ID>${sandboxVisitId}</ID></VisitInfo>`,
);
const date = info.xml.match(/<VisitDate>([^<]+)/)?.[1] ?? '2026-07-22';
const schStart = info.xml.match(/<ScheduleStartTime>([^<]+)/)?.[1]?.split(' ').pop() ?? '09:00';
const schEnd = info.xml.match(/<ScheduleEndTime>([^<]+)/)?.[1]?.split(' ').pop() ?? '13:00';
const startIso = toIso(date, schStart);
const endIso = toIso(date, schEnd);
console.log('   visit', sandboxVisitId, startIso, endIso);

console.log('\n3) SANDBOX ConfirmVisits using PROD reason pairs...');
for (const p of pairs.slice(0, 5)) {
  for (const [tsReq, tsAppr] of [
    ['No', 'No'],
    ['Yes', 'Yes'],
  ]) {
    const r = await call(
      SANDBOX_URL,
      'ConfirmVisits',
      `<VisitInfo>
  <VisitID>${sandboxVisitId}</VisitID>
  <VisitStartTime>${startIso}</VisitStartTime>
  <VisitEndTime>${endIso}</VisitEndTime>
  <ReasonCode>${p.reasonId}</ReasonCode>
  <ActionCode>${p.actionId}</ActionCode>
  <TimesheetRequired>${tsReq}</TimesheetRequired>
  <TimesheetApproved>${tsAppr}</TimesheetApproved>
</VisitInfo>`,
    );
    const ok = r.status?.toLowerCase() === 'success' && r.eid === '0';
    console.log(
      `${ok ? 'SUCCESS' : 'FAIL'} reason=${p.reasonId} action=${p.actionId} ts=${tsReq}/${tsAppr}`,
      r.eid ?? '-',
      (r.msg || r.fault || '').slice(0, 100),
    );
    if (ok) {
      const after = await call(
        SANDBOX_URL,
        'GetVisitInfoV2',
        `<VisitInfo><ID>${sandboxVisitId}</ID></VisitInfo>`,
      );
      const approved = after.xml.match(/<TimesheetApproved>([^<]+)/)?.[1];
      const status = after.xml.match(/<VisitStatus>([^<]+)/)?.[1];
      console.log('after TimesheetApproved=', approved, 'VisitStatus=', status);
      process.exit(0);
    }
  }
}

console.log('\nProd reason codes did NOT work on sandbox confirm.');
process.exitCode = 1;
