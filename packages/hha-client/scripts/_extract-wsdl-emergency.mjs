import { readFileSync, writeFileSync } from 'node:fs';

const t = readFileSync('docs/hha-wsdl-v1.8.xml', 'utf8');
const names = [
  'PatientDemographicsEmergencyPreparedness',
  'UpdatePatientDemographicsEmergencyPreparedness',
  'EmergencyPreparedness',
  'UpdateAddressInfo',
  'Address',
];
const out = {};
for (const n of names) {
  const m = t.match(new RegExp(`<s:complexType name="${n}"[\\s\\S]*?</s:complexType>`, 'i'));
  out[n] = m ? m[0].replace(/\s+/g, ' ') : null;
}
// also find EmergencyPreparedness element inside UpdatePatientDemographics region
const idx = t.indexOf('EmergencyPreparedness');
out.snippet = t.slice(Math.max(0, idx - 200), idx + 800).replace(/\s+/g, ' ');
writeFileSync('docs/hha-wsdl-emergency-extract.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
