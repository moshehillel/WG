import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = process.env.HHA_BASE_URL || 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<${method} xmlns="${NS}"><Authentication><AppName>${esc(APP)}</AppName><AppSecret>${esc(SECRET)}</AppSecret><AppKey>${esc(KEY)}</AppKey></Authentication>${inner}</${method}>
</soap:Body></soap:Envelope>`;
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/${method}"`,
    },
    body,
  });
  return await res.text();
}

function placements(xml) {
  const out = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const id = block.match(/<PlacementID>([^<]*)/)?.[1];
    if (!id) continue;
    out.push({
      placementId: id,
      start:
        block.match(/<ServiceStartDate>([^<]*)/)?.[1] ||
        block.match(/<StartDate>([^<]*)/)?.[1],
      disc: block.match(/<DischargeDate>([^<]*)/)?.[1] || '',
      svc:
        block.match(/<ServiceCodeID>([^<]*)/)?.[1] ||
        block.match(/<ServiceCode>\s*<ID>(\d+)/)?.[1],
    });
  }
  return out;
}

async function search(label, filterXml) {
  const xml = await call('SearchPatients', `<SearchFilters>${filterXml}</SearchFilters>`);
  const ids = [...new Set([...xml.matchAll(/<PatientID>(\d+)/g)].map((m) => m[1]))];
  console.log(
    label,
    JSON.stringify({
      status: xml.match(/Status="([^"]+)"/)?.[1],
      eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
      ids,
      names: [...xml.matchAll(/<(?:FirstName|LastName)>([^<]*)/g)].map((m) => m[0]).slice(0, 8),
    }),
  );
  return ids;
}

const searches = [
  ['Picciuto AdmissionID', '<AdmissionID>258272446</AdmissionID>'],
  ['Picciuto MRNumber', '<MRNumber>258272446</MRNumber>'],
  ['Picciuto full SearchPatients shape', `<FirstName></FirstName><LastName></LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID>258272446</AdmissionID><MRNumber></MRNumber><SSN></SSN>`],
  ['Picciuto name', '<FirstName>Edmund</FirstName><LastName>Picciuto</LastName>'],
  ['Picciuto last', '<LastName>Picciuto</LastName>'],
  ['Solomon AdmissionID', '<AdmissionID>06771684</AdmissionID>'],
  ['Solomon MRNumber', '<MRNumber>06771684</MRNumber>'],
  ['Solomon full shape', `<FirstName></FirstName><LastName></LastName><Status></Status><PhoneNumber></PhoneNumber><AdmissionID>06771684</AdmissionID><MRNumber></MRNumber><SSN></SSN>`],
  ['Solomon name', '<FirstName>Martin</FirstName><LastName>Solomon</LastName>'],
  ['Solomon last', '<LastName>Solomon</LastName>'],
];

for (const [label, f] of searches) await search(label, f);

const check = [
  ['Arshad', '22854608'],
  ['Oliver', '25788276'],
  ['Porter', '24555059'],
  ['Rolon', '24301609'],
  ['Asunto', '24617583'],
  ['Downs', '24865860'],
  ['Navelgas', '22680255'],
  ['Galeano', '23012434'],
];

for (const [name, pid] of check) {
  for (const d of ['09/01/2026', '09/15/2026', '09/16/2026', '12/31/2026']) {
    const xml = await call(
      'GetPatientContracts',
      `<PatientID>${pid}</PatientID><VisitDate>${d}</VisitDate>`,
    );
    const pls = placements(xml);
    const disc = pls.filter((p) => p.disc);
    console.log(
      `${name} VisitDate=${d} n=${pls.length} discharged=${disc.length}`,
      disc.length ? disc : pls,
    );
  }
}
