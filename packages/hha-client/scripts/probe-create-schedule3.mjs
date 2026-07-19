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
    ok: /Status="Success"/i.test(xml) && !/<ErrorID>-?[1-9]/.test(xml),
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

function log(label, r) {
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'} ${label} eid=${r.eid ?? '-'} ${r.msg || r.fault || r.status || ''}`,
  );
}

const patientId = 958000;
const contractId = 10410;
const serviceCodeId = 114535; // PCA Hourly U1 from placement
const caregiverId = 4380022;
const payCodeId = 12298;

// Try create without caregiver first, then with
const attempts = [
  [
    'no caregiver',
    `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <ScheduleType>Non-Skilled</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <VisitDate>2026-07-22</VisitDate>
  <ScheduleStartTime>0900</ScheduleStartTime>
  <ScheduleEndTime>1300</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <PrimaryBillTo>
    <ContractID>${contractId}</ContractID>
    <ServiceCodeID>${serviceCodeId}</ServiceCodeID>
    <Hours>4</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
  ],
  [
    'with caregiver+pay',
    `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <ScheduleType>Non-Skilled</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <VisitDate>2026-07-22</VisitDate>
  <ScheduleStartTime>0900</ScheduleStartTime>
  <ScheduleEndTime>1300</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <CaregiverID>${caregiverId}</CaregiverID>
  <PayCodeID>${payCodeId}</PayCodeID>
  <IsCaregiverTemporary>No</IsCaregiverTemporary>
  <PrimaryBillTo>
    <ContractID>${contractId}</ContractID>
    <ServiceCodeID>${serviceCodeId}</ServiceCodeID>
    <Hours>4</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
  ],
  [
    'Skilled',
    `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <ScheduleType>Skilled</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <VisitDate>2026-07-23</VisitDate>
  <ScheduleStartTime>0900</ScheduleStartTime>
  <ScheduleEndTime>1000</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <PrimaryBillTo>
    <ContractID>45571</ContractID>
    <ServiceCodeID>${serviceCodeId}</ServiceCodeID>
    <Hours>1</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
  ],
];

for (const [label, body] of attempts) {
  const r = await call('CreateSchedule', body);
  log(`CreateSchedule ${label}`, r);
  console.log(' ', r.xml.replace(/\s+/g, ' ').slice(0, 400));
  const vid = r.xml.match(/<VisitID>(\d+)/)?.[1];
  if (vid && vid !== '0') {
    console.log('CREATED VisitID', vid);
    writeFileSync(path.join(repoRoot, 'tmp', 'created-schedule.xml'), r.xml);
    break;
  }
}
