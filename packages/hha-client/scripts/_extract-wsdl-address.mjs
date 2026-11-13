import { readFileSync, writeFileSync } from 'node:fs';

const t = readFileSync('docs/hha-wsdl-v1.8.xml', 'utf8');
const names = [
  'UpdatePatientAddress',
  'UpdateAddressInfo',
  'PatientAddress',
  'AddressDetails',
  'GetPatientAddress',
];
const out = {};
for (const n of names) {
  const m = t.match(new RegExp(`<s:complexType name="${n}"[\\s\\S]*?</s:complexType>`, 'i'));
  out[n] = m ? m[0].replace(/\s+/g, ' ') : null;
}
const idx = t.indexOf('name="GetPatientAddress"');
out.GetPatientAddressRegion = idx >= 0 ? t.slice(idx, idx + 2000).replace(/\s+/g, ' ') : null;
writeFileSync('docs/hha-wsdl-address-extract.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
