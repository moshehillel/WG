import { readFileSync, writeFileSync } from 'node:fs';

const t = readFileSync('docs/hha-wsdl-v1.8.xml', 'utf8');

function extractType(name) {
  const re = new RegExp(`<s:complexType name="${name}"[\\s\\S]*?</s:complexType>`, 'i');
  const m = t.match(re);
  return m ? m[0].replace(/\s+/g, ' ') : null;
}

const types = [
  'UpdatePatientDemographics',
  'PatientDemographicsAcceptedServices',
  'PatientDemographicAcceptedServices',
  'AcceptedService',
  'DisciplineInfo',
  'CreatePatient',
  'GetPatientDisciplines',
  'GetPatientDisciplinesResponse',
  'UpdatePatientClinicalInfo',
  'UpdatePatientPreference',
];

const out = {};
for (const n of types) {
  out[n] = extractType(n);
}

const idx = t.indexOf('name="UpdatePatientDemographics"');
out.UpdatePatientDemographicsRegion = t.slice(idx, idx + 4000).replace(/\s+/g, ' ');

const createIdx = t.indexOf('name="CreatePatient"');
// find CreatePatient complexType after the element
const createTypeIdx = t.indexOf('<s:complexType name="CreatePatient"');
out.CreatePatientType = createTypeIdx >= 0
  ? t.slice(createTypeIdx, createTypeIdx + 4000).replace(/\s+/g, ' ')
  : null;

// All Accepted* complex types
const re = /<s:complexType name="([^"]+)"[\s\S]*?<\/s:complexType>/g;
const acceptedTypes = [];
let m;
while ((m = re.exec(t))) {
  if (/Accepted/i.test(m[1]) || (/AcceptedService|Discipline/i.test(m[0]) && /Accepted/i.test(m[0]))) {
    acceptedTypes.push({ name: m[1], body: m[0].replace(/\s+/g, ' ').slice(0, 1200) });
  }
}
out.acceptedRelatedTypes = acceptedTypes;

const ops = [...t.matchAll(/<wsdl:operation name="([^"]+)"/g)].map((x) => x[1]);
out.patientOps = ops.filter((o) => /Patient|Discipline|Accepted/i.test(o));
const missing = [
  'UpdatePatient',
  'EditPatient',
  'SavePatient',
  'UpdatePatientInfo',
  'UpdatePatientDisciplines',
  'SetPatientDisciplines',
  'AddPatientDiscipline',
  'UpdateAcceptedServices',
];
out.missingOps = Object.fromEntries(missing.map((n) => [n, ops.includes(n)]));

// GetPatientDisciplines schema
const gpIdx = t.indexOf('name="GetPatientDisciplines"');
out.GetPatientDisciplinesRegion = t.slice(gpIdx, gpIdx + 2500).replace(/\s+/g, ' ');

writeFileSync('docs/hha-wsdl-accepted-services-extract.json', JSON.stringify(out, null, 2));
console.log('Wrote docs/hha-wsdl-accepted-services-extract.json');
console.log('UpdatePatientDemographics AcceptedServices excerpt:');
const upd = out.UpdatePatientDemographics || '';
const am = upd.match(/AcceptedServices[^<]*<\/s:element>|AcceptedServices.{0,200}/);
console.log(am?.[0] ?? upd.slice(0, 1500));
console.log('\nPatientDemographicAcceptedServices:', out.PatientDemographicAcceptedServices?.slice(0, 800));
console.log('\nPatientDemographicsAcceptedServices:', out.PatientDemographicsAcceptedServices?.slice(0, 800));
console.log('\nAcceptedService:', out.AcceptedService?.slice(0, 800));
console.log('\nDisciplineInfo:', out.DisciplineInfo?.slice(0, 800));
console.log('\nmissingOps', out.missingOps);
console.log('\npatientOps count', out.patientOps.length);
