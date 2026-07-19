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

async function call(method, inner) {
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
    xml,
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
  };
}

const visitId = 1282693446;
const formats = [
  ['iso', '2026-07-10T09:00:00', '2026-07-10T13:00:00'],
  ['isoZ', '2026-07-10T09:00:00Z', '2026-07-10T13:00:00Z'],
  ['space', '2026-07-10 09:00:00', '2026-07-10 13:00:00'],
  ['slash', '07/10/2026 09:00:00', '07/10/2026 13:00:00'],
];

for (const [label, start, end] of formats) {
  const r = await call(
    'ConfirmVisits',
    `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>${start}</VisitStartTime>
  <VisitEndTime>${end}</VisitEndTime>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>Yes</TimesheetApproved>
</VisitInfo>`,
  );
  console.log(
    'ConfirmVisits',
    label,
    r.status ?? 'fault',
    r.eid ?? '-',
    r.msg || r.fault || '',
  );
}

// ScheduleType from Provider Guide common values — try integers and names from visit XML
const info = readFileSync(path.join(repoRoot, 'tmp', 'visit-info-v2.xml'), 'utf8');
const patientId = info.match(/<PatientID>(\d+)/)?.[1] ?? '958000';
writeFileSync(path.join(repoRoot, 'tmp', 'confirm-last.txt'), '');

// Try CreateSchedule ScheduleType values seen in HHA docs
const types = [
  ['ScheduleType', '1'],
  ['ScheduleType', 'Daily'],
  ['ScheduleType', 'Daily Fixed'],
  ['ScheduleType', 'Fixed'],
  ['ScheduleType', 'Master'],
  ['ScheduleType', 'One Time'],
  ['ScheduleType', 'OneTime'],
  ['ScheduleType', 'Temporary'],
];
for (const [_, st] of types) {
  const r = await call(
    'CreateSchedule',
    `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <ScheduleType>${st}</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <ScheduleDurationHours>2</ScheduleDurationHours>
  <ScheduleDurationMinutes>0</ScheduleDurationMinutes>
  <VisitDate>2026-07-20</VisitDate>
  <ScheduleStartTime>09:00</ScheduleStartTime>
  <ScheduleEndTime>11:00</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <PrimaryBillTo>
    <ContractID>10410</ContractID>
    <ServiceCodeID>114535</ServiceCodeID>
    <Hours>2</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
  );
  console.log('CreateSchedule', st, r.status ?? 'fault', r.eid ?? '-', r.msg || r.fault || '');
  if (r.status?.toLowerCase() === 'success') break;
  if (r.eid === '-74' && /ScheduleType/i.test(r.msg || '') === false) break;
}
