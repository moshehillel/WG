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

const results = [];
function log(label, r) {
  const line = `${r.status?.toLowerCase() === 'success' || r.eid === '0' ? 'PASS' : 'FAIL'} ${label} eid=${r.eid ?? '-'} ${r.msg || r.fault || r.status || ''}`;
  console.log(line);
  results.push({ label, ...r, xml: undefined, preview: r.xml.replace(/\s+/g, ' ').slice(0, 400) });
}

// GetContractServiceCode with doc ScheduleType
for (const st of ['Non-Skilled', 'Skilled']) {
  log(
    `GetContractServiceCode ${st}`,
    await call(
      'GetContractServiceCode',
      `<PatientID>958000</PatientID>
  <ContractID>10410</ContractID>
  <ScheduleType>${st}</ScheduleType>
  <IsInternalContract>0</IsInternalContract>`,
    ),
  );
}

log(
  'GetLinkedContractServiceCodes Non-Skilled',
  await call(
    'GetLinkedContractServiceCodes',
    `<PatientID>958000</PatientID><ScheduleType>Non-Skilled</ScheduleType>`,
  ),
);

// CreateSchedule per Provider Guide v3.38
const patientId = 24521304;
const caregiverId = 4380022;
log(
  'CreateSchedule Non-Skilled Daily Fixed HHMM',
  await call(
    'CreateSchedule',
    `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <ScheduleType>Non-Skilled</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <ScheduleDurationHours>4</ScheduleDurationHours>
  <ScheduleDurationMinutes>0</ScheduleDurationMinutes>
  <VisitDate>2026-07-20</VisitDate>
  <ScheduleStartTime>0900</ScheduleStartTime>
  <ScheduleEndTime>1300</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <CaregiverID>${caregiverId}</CaregiverID>
  <PrimaryBillTo>
    <ContractID>10410</ContractID>
    <ServiceCodeID>114535</ServiceCodeID>
    <Hours>4</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
  ),
);

// Get patient contracts for this patient to get real contract/service code
const pc = await call(
  'GetPatientContracts',
  `<PatientID>${patientId}</PatientID><VisitDate>2026-07-10</VisitDate>`,
);
log('GetPatientContracts for visit patient', pc);
const contractId = pc.xml.match(/<Contract>\s*<ID>(\d+)/)?.[1];
const serviceCodeId = pc.xml.match(/<ServiceCode>\s*<ID>(\d+)/)?.[1];
console.log('placement contract/service', contractId, serviceCodeId);

if (contractId && serviceCodeId && serviceCodeId !== '-1') {
  log(
    'CreateSchedule with patient placement codes',
    await call(
      'CreateSchedule',
      `<ScheduleInfo>
  <PatientID>${patientId}</PatientID>
  <ScheduleType>Non-Skilled</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <VisitDate>2026-07-21</VisitDate>
  <ScheduleStartTime>0900</ScheduleStartTime>
  <ScheduleEndTime>1300</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <CaregiverID>${caregiverId}</CaregiverID>
  <PrimaryBillTo>
    <ContractID>${contractId}</ContractID>
    <ServiceCodeID>${serviceCodeId}</ServiceCodeID>
    <Hours>4</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
    ),
  );
}

// UpdateSchedule with HHMM
log(
  'UpdateSchedule HHMM',
  await call(
    'UpdateSchedule',
    `<ScheduleInfo>
  <VisitID>1282693446</VisitID>
  <ScheduleStartTime>0900</ScheduleStartTime>
  <ScheduleEndTime>1300</ScheduleEndTime>
</ScheduleInfo>`,
  ),
);

writeFileSync(
  path.join(repoRoot, 'docs', 'hha-doc-guided-probe.json'),
  JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
);
