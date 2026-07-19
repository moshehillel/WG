/**
 * Check alternate reason sources + whether ConfirmVisits can omit ReasonCode
 * when times match schedule (no edit).
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
const URL = process.env.HHA_BASE_URL;
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = process.env.HHA_APP_KEY.replace(/\s+/g, '');

async function call(method, inner = '') {
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
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

function log(label, r) {
  console.log(
    `${r.status?.toLowerCase() === 'success' || r.eid === '0' ? 'PASS' : 'FAIL'} ${label} eid=${r.eid ?? '-'} ${(r.msg || r.fault || r.status || '').slice(0, 140)}`,
  );
}

// Alternate reason lookup methods from guide / ASMX
for (const [method, body] of [
  ['GetScheduleBillInfoEditReasons', ''],
  ['GetVisitDeleteReasons', ''],
  ['GetMissedVisitReasons', ''],
  ['GetMissedVisitReasonsV2', ''],
  ['GetMissedVisitActionTaken', ''],
  ['GetMissedVisitActionTakenV2', ''],
  ['GetRefusedDutyReason', ''],
  ['GetVisitEditReasonActionTaken', `<VisitInfo><VisitId>1298399661</VisitId></VisitInfo>`],
  ['GetVisitEditReasonActionTaken', `<VisitInfo><VisitId>1282693446</VisitId></VisitInfo>`],
]) {
  log(`${method}`, await call(method, body));
}

const bill = await call('GetScheduleBillInfoEditReasons', '');
if (/Status="Success"/i.test(bill.xml)) {
  writeFileSync(path.join(repoRoot, 'tmp', 'schedule-bill-edit-reasons.xml'), bill.xml);
  const ids = [...bill.xml.matchAll(/<ReasonID>(\d+)/g)].map((m) => m[1]);
  console.log('ScheduleBill ReasonIDs', ids.slice(0, 15));
}

// ConfirmVisits: omit ReasonCode entirely when confirming with exact schedule times
const visitId = 1298399661; // our created visit
const cases = [
  [
    'omit reason/action',
    `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>2026-07-22T09:00:00</VisitStartTime>
  <VisitEndTime>2026-07-22T13:00:00</VisitEndTime>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>No</TimesheetApproved>
</VisitInfo>`,
  ],
  [
    'empty reason/action',
    `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>2026-07-22T09:00:00</VisitStartTime>
  <VisitEndTime>2026-07-22T13:00:00</VisitEndTime>
  <ReasonCode></ReasonCode>
  <ActionCode></ActionCode>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>No</TimesheetApproved>
</VisitInfo>`,
  ],
  [
    'reason=0 action=0',
    `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>2026-07-22T09:00:00</VisitStartTime>
  <VisitEndTime>2026-07-22T13:00:00</VisitEndTime>
  <ReasonCode>0</ReasonCode>
  <ActionCode>0</ActionCode>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>No</TimesheetApproved>
</VisitInfo>`,
  ],
];

// If we got bill reason IDs, try first as ReasonCode
if (/Status="Success"/i.test(bill.xml)) {
  const rid = bill.xml.match(/<ReasonID>(\d+)/)?.[1];
  if (rid) {
    cases.push([
      `bill ReasonID=${rid}`,
      `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>2026-07-22T09:00:00</VisitStartTime>
  <VisitEndTime>2026-07-22T13:00:00</VisitEndTime>
  <ReasonCode>${rid}</ReasonCode>
  <ActionCode>${rid}</ActionCode>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>No</TimesheetApproved>
</VisitInfo>`,
    ]);
  }
}

console.log('\n--- ConfirmVisits variants ---');
for (const [label, body] of cases) {
  log(label, await call('ConfirmVisits', body));
}
