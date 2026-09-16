/**
 * Restore sandbox patient 958000 AcceptedServices to PCA, RN, PA after expand probe.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';

function loadEnv(file) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv(path.join(repoRoot, '.env'));

const URL = process.env.HHA_BASE_URL;
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = process.env.HHA_APP_KEY.replace(/\s+/g, '');
const PID = 958000;
const RESTORE = ['PCA', 'RN', 'PA'];

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function call(method, inner) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${esc(APP)}</AppName>
        <AppSecret>${esc(SECRET)}</AppSecret>
        <AppKey>${esc(KEY)}</AppKey>
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

function tag(xml, t) {
  return xml.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`, 'i'))?.[1] || '';
}
function nested(xml, p) {
  return xml.match(new RegExp(`<${p}>[\\s\\S]*?<ID>([^<]*)</ID>`, 'i'))?.[1] || '';
}
function services(xml) {
  const block = xml.match(/<AcceptedServices[\s\S]*?<\/AcceptedServices>/i)?.[0] ?? '';
  return [...(block || xml).matchAll(/<Discipline>([^<]*)/gi)].map((m) => m[1]);
}

const before = await call('GetPatientDemographics', `<PatientInfo><ID>${PID}</ID></PatientInfo>`);
console.log('before', services(before));
const addr = await call('GetPatientAddress', `<PatientID>${PID}</PatientID>`);
const addressId = tag(addr, 'AddressID') || '2966779';

const birth = tag(before, 'BirthDate') || '1960-03-25';
const srs = tag(before, 'ServiceRequestStartDate') || '2012-03-09';
const body = `<PatientInfo>
  <PatientID>${PID}</PatientID>
  <FirstName>${esc(tag(before, 'FirstName'))}</FirstName>
  <LastName>${esc(tag(before, 'LastName'))}</LastName>
  <BirthDate>${esc(birth.includes('T') ? birth : birth + 'T00:00:00')}</BirthDate>
  <Gender>${esc(tag(before, 'Gender'))}</Gender>
  <CoordinatorID1>${tag(before, 'CoordinatorID1') || nested(before, 'Coordinator1') || '25164'}</CoordinatorID1>
  <CoordinatorID2 xsi:nil="true" />
  <CoordinatorID3 xsi:nil="true" />
  <PriorityCode>${tag(before, 'PriorityCode') || '2'}</PriorityCode>
  <ServiceRequestStartDate>${esc(srs.includes('T') ? srs : srs + 'T00:00:00')}</ServiceRequestStartDate>
  <NurseID>${nested(before, 'Nurse') || tag(before, 'NurseID') || '4652126'}</NurseID>
  <MRNumber xsi:nil="true" />
  <MedicaidNumber>${esc(tag(before, 'MedicaidNumber'))}</MedicaidNumber>
  <AcceptedServices>
${RESTORE.map((d) => `    <Discipline>${d}</Discipline>`).join('\n')}
  </AcceptedServices>
  <AllowDuplicate>1</AllowDuplicate>
  <SourceOfAdmission>${nested(before, 'SourceOfAdmission') || '9300'}</SourceOfAdmission>
  <TeamID>${nested(before, 'Team') || '2036'}</TeamID>
  <BranchID>${nested(before, 'Branch') || '10073742'}</BranchID>
  <LocationID>${nested(before, 'Location') || '12284'}</LocationID>
  <Addresses>
    <Address>
      <AddressID>${addressId}</AddressID>
      <Address1>${esc(tag(before, 'Address1'))}</Address1>
      <City>${esc(tag(before, 'City'))}</City>
      <State>${esc(tag(before, 'State'))}</State>
      <Zip5>${tag(before, 'Zip5') || '10459'}</Zip5>
      <Zip4 xsi:nil="true" />
      <IsPrimaryAddress>Yes</IsPrimaryAddress>
      <AddressTypes>Home</AddressTypes>
    </Address>
  </Addresses>
  <EmergencyPreparedness>
    <EvacuationZoneID>${nested(before, 'EvacuationZone') || tag(before, 'EvacuationZoneID') || '10003239'}</EvacuationZoneID>
    <EvacuationLocationID xsi:nil="true" />
    <MobilityStatusID>${nested(before, 'MobilityStatus') || tag(before, 'MobilityStatusID') || '2495'}</MobilityStatusID>
  </EmergencyPreparedness>
  <WageParityFromDate1 xsi:nil="true" />
  <WageParityToDate1 xsi:nil="true" />
  <WageParityFromDate2 xsi:nil="true" />
  <WageParityToDate2 xsi:nil="true" />
  <HomePhone>${esc(tag(before, 'HomePhone'))}</HomePhone>
</PatientInfo>`;

const upd = await call('UpdatePatientDemographics', body);
const eid = upd.match(/<ErrorID>([^<]*)/)?.[1];
console.log('restore eid', eid, upd.match(/<ErrorMessage>([^<]*)/)?.[1] || '');
const after = await call('GetPatientDemographics', `<PatientInfo><ID>${PID}</ID></PatientInfo>`);
console.log('after', services(after));
