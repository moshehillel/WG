import { readFileSync } from 'node:fs';
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
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

const visitId = 1282693446;
const start = '2026-07-10T09:00:00';
const end = '2026-07-10T13:00:00';

const cases = [
  ['req=No appr=No', 'No', 'No'],
  ['req=Yes appr=Yes', 'Yes', 'Yes'],
  ['req=Y appr=Y', 'Y', 'Y'],
  ['req=N appr=N', 'N', 'N'],
  ['req=true appr=true', 'true', 'true'],
  ['req=1 appr=1', '1', '1'],
  ['req=No appr=Yes', 'No', 'Yes'],
];

for (const [label, req, appr] of cases) {
  const r = await call(
    'ConfirmVisits',
    `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>${start}</VisitStartTime>
  <VisitEndTime>${end}</VisitEndTime>
  <TimesheetRequired>${req}</TimesheetRequired>
  <TimesheetApproved>${appr}</TimesheetApproved>
  <Duties>
    <Duty>
      <DutyCode>1</DutyCode>
      <AdditionalData>0</AdditionalData>
      <Status>Performed</Status>
    </Duty>
  </Duties>
</VisitInfo>`,
  );
  console.log('Confirm', label, r.status ?? 'fault', r.eid ?? '-', r.msg || r.fault || '');
  if (r.status?.toLowerCase() === 'success') {
    console.log('SUCCESS', r.xml.replace(/\s+/g, ' ').slice(0, 400));
    break;
  }
}

// CreateSchedule without ScheduleType / with patient 24521304 from visit
const patientId = 24521304;
const caregiverId = 4380022;
const scheduleBodies = [
  ['no ScheduleType', `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <VisitType>Daily Fixed</VisitType>
  <ScheduleDurationHours>4</ScheduleDurationHours>
  <ScheduleDurationMinutes>0</ScheduleDurationMinutes>
  <VisitDate>2026-07-20</VisitDate>
  <ScheduleStartTime>09:00</ScheduleStartTime>
  <ScheduleEndTime>13:00</ScheduleEndTime>
  <CaregiverID>${caregiverId}</CaregiverID>
  <PrimaryBillTo>
    <ContractID>10410</ContractID>
    <ServiceCodeID>114535</ServiceCodeID>
    <Hours>4</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`],
  ['VisitType only Hourly', `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <VisitType>Hourly</VisitType>
  <ScheduleDurationHours>4</ScheduleDurationHours>
  <ScheduleDurationMinutes>0</ScheduleDurationMinutes>
  <VisitDate>2026-07-20</VisitDate>
  <ScheduleStartTime>09:00</ScheduleStartTime>
  <ScheduleEndTime>13:00</ScheduleEndTime>
  <CaregiverID>${caregiverId}</CaregiverID>
  <PrimaryBillTo>
    <ContractID>10410</ContractID>
    <ServiceCodeID>114535</ServiceCodeID>
    <Hours>4</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`],
  ['ScheduleType blank', `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <ScheduleType></ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <ScheduleDurationHours>4</ScheduleDurationHours>
  <ScheduleDurationMinutes>0</ScheduleDurationMinutes>
  <VisitDate>2026-07-20</VisitDate>
  <ScheduleStartTime>09:00</ScheduleStartTime>
  <ScheduleEndTime>13:00</ScheduleEndTime>
  <CaregiverID>${caregiverId}</CaregiverID>
  <PrimaryBillTo>
    <ContractID>10410</ContractID>
    <ServiceCodeID>114535</ServiceCodeID>
    <Hours>4</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`],
];

for (const [label, body] of scheduleBodies) {
  const r = await call('CreateSchedule', body);
  console.log('CreateSchedule', label, r.status ?? 'fault', r.eid ?? '-', r.msg || r.fault || '');
}

// UpdateSchedule on existing visit — maybe easier than create
const upd = await call(
  'UpdateSchedule',
  `<ScheduleInfo>
  <VisitID>${visitId}</VisitID>
  <ScheduleStartTime>09:00</ScheduleStartTime>
  <ScheduleEndTime>13:00</ScheduleEndTime>
  <Note>WG probe no-op</Note>
</ScheduleInfo>`,
);
console.log('UpdateSchedule', upd.status ?? 'fault', upd.eid ?? '-', upd.msg || upd.fault || '');
