/**
 * Follow-up: find VisitIDs + agency-valid patients for GetPatientContracts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const envPath = path.join(repoRoot, '.env');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

function ids(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'gi'))].map((m) => Number(m[1]));
}

function err(xml) {
  return {
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    status: xml.match(/Status="([^"]+)"/)?.[1],
  };
}

const out = { testedAt: new Date().toISOString() };

// Visits: 1-day window per office
const offices = [1025, 2259, 7362, 2933];
const day = '2026-07-10';
out.visits = {};
let visitId;
for (const officeId of offices) {
  const xml = await call(
    'SearchVisits',
    `<SearchFilters>
  <StartDate>${day}</StartDate>
  <EndDate>${day}</EndDate>
  <OfficeID>${officeId}</OfficeID>
</SearchFilters>`,
  );
  const e = err(xml);
  const visitIds = ids(xml, 'VisitID');
  const alt = ids(xml, 'ID');
  out.visits[officeId] = {
    ...e,
    visitIds: visitIds.slice(0, 5),
    sampleTags: [...xml.matchAll(/<\/([A-Za-z0-9]+)>/g)]
      .map((m) => m[1])
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 40),
    preview: xml.replace(/\s+/g, ' ').slice(0, 500),
  };
  console.log(
    `SearchVisits office=${officeId} status=${e.status} eid=${e.eid} visits=${visitIds.length} msg=${e.msg}`,
  );
  if (!visitId && visitIds[0]) visitId = visitIds[0];
  if (!visitId && /Success/i.test(e.status || '') && xml.includes('Visit')) {
    console.log('  preview:', xml.replace(/\s+/g, ' ').slice(0, 600));
  }
}

if (visitId) {
  for (const method of ['GetVisitInfoV2', 'GetVisitInfoV3']) {
    const inner =
      method === 'GetVisitInfoV3'
        ? `<VisitInfo><ID>${visitId}</ID></VisitInfo>`
        : `<VisitInfo><VisitID>${visitId}</VisitID></VisitInfo>`;
    const xml = await call(method, inner);
    const e = err(xml);
    out[method] = { visitId, ...e, preview: xml.replace(/\s+/g, ' ').slice(0, 400) };
    console.log(`${method}(${visitId}) status=${e.status} eid=${e.eid} msg=${e.msg}`);
  }
}

// Patient contracts: scan Active patients
const sp = await call(
  'SearchPatients',
  `<SearchFilters>
  <FirstName></FirstName><LastName></LastName><Status>Active</Status>
  <PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN>
</SearchFilters>`,
);
const patientIds = ids(sp, 'PatientID');
console.log(`Scanning GetPatientContracts for ${Math.min(50, patientIds.length)} patients…`);
out.patientContractsOk = [];
for (const pid of patientIds.slice(0, 50)) {
  const xml = await call(
    'GetPatientContracts',
    `<PatientID>${pid}</PatientID><VisitDate></VisitDate>`,
  );
  const e = err(xml);
  if (e.status?.toLowerCase() === 'success' || e.eid === '0') {
    const row = {
      patientId: pid,
      contractIds: ids(xml, 'ContractID').slice(0, 5),
      placementIds: ids(xml, 'PlacementID').slice(0, 5),
    };
    out.patientContractsOk.push(row);
    console.log('PC OK', row);
    if (out.patientContractsOk.length >= 5) break;
  }
}

// Linked service codes with ScheduleType
if (out.patientContractsOk[0]) {
  const pid = out.patientContractsOk[0].patientId;
  for (const st of ['Daily', 'Weekly', 'Hourly', 'Daily Fixed', '1']) {
    const xml = await call(
      'GetLinkedContractServiceCodes',
      `<PatientID>${pid}</PatientID><ScheduleType>${st}</ScheduleType>`,
    );
    const e = err(xml);
    console.log(`GetLinkedContractServiceCodes type=${st} eid=${e.eid} msg=${e.msg} status=${e.status}`);
    if (e.status?.toLowerCase() === 'success') {
      out.linkedServiceCodes = { patientId: pid, scheduleType: st, ...e };
      break;
    }
  }

  const cid = out.patientContractsOk[0].contractIds[0];
  if (cid) {
    const xml = await call(
      'GetContractServiceCode',
      `<PatientID>${pid}</PatientID>
  <ContractID>${cid}</ContractID>
  <ScheduleType></ScheduleType>
  <IsInternalContract>0</IsInternalContract>`,
    );
    const e = err(xml);
    out.getContractServiceCode = { patientId: pid, contractId: cid, ...e };
    console.log(`GetContractServiceCode p=${pid} c=${cid} eid=${e.eid} msg=${e.msg}`);
  }
}

const outFile = path.join(repoRoot, 'docs', 'hha-endpoint-probe-followup.json');
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log('Wrote', outFile);
