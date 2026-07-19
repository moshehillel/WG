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
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

function log(label, r) {
  console.log(
    `${r.status?.toLowerCase() === 'success' || r.eid === '0' ? 'PASS' : 'FAIL'} ${label} eid=${r.eid ?? '-'} ${r.msg || r.fault || r.status || ''}`,
  );
  console.log(' ', r.xml.replace(/\s+/g, ' ').slice(0, 350));
  return r;
}

// Service codes for patient 24521304
const sc = await call(
  'GetContractServiceCode',
  `<PatientID>24521304</PatientID>
  <ContractID>2568</ContractID>
  <ScheduleType>Non-Skilled</ScheduleType>
  <IsInternalContract>0</IsInternalContract>`,
);
log('GetContractServiceCode patient visit', sc);
const serviceCodeId = sc.xml.match(/<ServiceCodeID>(\d+)/)?.[1] ?? '114535';

const patientId = 24521304;
const caregiverId = 4380022;
const payCodeId = 12298;
const contractId = 2568;

const r = await call(
  'CreateSchedule',
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
);
log('CreateSchedule doc-correct', r);
if (r.xml.match(/<VisitID>(\d+)/)) {
  console.log('NEW VISIT', r.xml.match(/<VisitID>(\d+)/)?.[1]);
}

writeFileSync(path.join(repoRoot, 'tmp', 'create-schedule-result.xml'), r.xml);

// Also dump service codes from earlier success for 958000
const sc2 = await call(
  'GetContractServiceCode',
  `<PatientID>958000</PatientID>
  <ContractID>10410</ContractID>
  <ScheduleType>Non-Skilled</ScheduleType>
  <IsInternalContract>0</IsInternalContract>`,
);
writeFileSync(path.join(repoRoot, 'tmp', 'service-codes-958000.xml'), sc2.xml);
console.log('service codes count', [...sc2.xml.matchAll(/<ServiceCodeID>/g)].length);
