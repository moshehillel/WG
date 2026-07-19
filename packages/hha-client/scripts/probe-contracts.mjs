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
  return res.text();
}

const pid = 958000;
const day = '2026-07-10';
const pc = await call(
  'GetPatientContracts',
  `<PatientID>${pid}</PatientID><VisitDate>${day}</VisitDate>`,
);
console.log(pc.replace(/\s+/g, ' ').slice(0, 2000));

const cid = pc.match(/<ContractID>(\d+)/)?.[1];
const sc = await call(
  'GetContractServiceCode',
  `<PatientID>${pid}</PatientID>
  <ContractID>${cid}</ContractID>
  <ScheduleType></ScheduleType>
  <IsInternalContract>0</IsInternalContract>`,
);
console.log('\nGetContractServiceCode', sc.match(/Status="([^"]+)"/)?.[1], sc.match(/ErrorID>([^<]+)/)?.[1], sc.match(/ErrorMessage>([^<]*)/)?.[1]);
console.log(sc.replace(/\s+/g, ' ').slice(0, 800));

for (const st of ['Daily', 'Daily Fixed', 'Hourly', 'Weekly', 'Fixed']) {
  const xml = await call(
    'GetLinkedContractServiceCodes',
    `<PatientID>${pid}</PatientID><ScheduleType>${st}</ScheduleType>`,
  );
  console.log(
    'Linked',
    st,
    xml.match(/Status="([^"]+)"/)?.[1],
    xml.match(/ErrorID>([^<]+)/)?.[1],
    xml.match(/ErrorMessage>([^<]*)/)?.[1],
  );
}

writeFileSync(
  path.join(repoRoot, 'tmp', 'patient-contracts-958000.xml'),
  pc,
);
