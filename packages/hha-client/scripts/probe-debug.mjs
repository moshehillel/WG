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

const lines = [];
function log(...args) {
  const s = args.join(' ');
  console.log(s);
  lines.push(s);
}

const pid = 958000;
for (const shape of [
  `<PatientID>${pid}</PatientID><VisitDate></VisitDate>`,
  `<PatientID>${pid}</PatientID><VisitDate>2026-07-10</VisitDate>`,
  `<PatientContracts><PatientID>${pid}</PatientID><VisitDate>2026-07-10</VisitDate></PatientContracts>`,
]) {
  const xml = await call('GetPatientContracts', shape);
  log('PC', shape.replace(/\s+/g, ' ').slice(0, 80), '=>', xml.replace(/\s+/g, ' ').slice(0, 400));
}

const offices = [2259, 1025, 2933];
for (const officeId of offices) {
  const vxml = await call(
    'SearchVisits',
    `<SearchFilters><StartDate>2026-07-10</StartDate><EndDate>2026-07-10</EndDate><OfficeID>${officeId}</OfficeID></SearchFilters>`,
  );
  const vids = [...vxml.matchAll(/<VisitID>(\d+)<\/VisitID>/g)].map((m) => m[1]).slice(0, 3);
  log(`office ${officeId} visits`, vids.join(','));
  for (const vid of vids) {
    const xml = await call('GetVisitInfoV2', `<VisitInfo><VisitID>${vid}</VisitID></VisitInfo>`);
    log(
      'V2',
      vid,
      xml.match(/Status="([^"]+)"/)?.[1],
      xml.match(/ErrorID>([^<]+)/)?.[1],
      xml.match(/ErrorMessage>([^<]*)/)?.[1],
    );
    if (/Status="Success"/i.test(xml)) {
      log('SUCCESS preview', xml.replace(/\s+/g, ' ').slice(0, 600));
      break;
    }
  }
}

// Demographics of patient to see OfficeID
const demo = await call('GetPatientDemographics', `<PatientInfo><ID>${pid}</ID></PatientInfo>`);
log('DEMO office/admission', demo.match(/OfficeID>([^<]+)/)?.[1], demo.match(/AdmissionID>([^<]+)/)?.[1]);
log('DEMO preview', demo.replace(/\s+/g, ' ').slice(0, 700));

writeFileSync(path.join(repoRoot, 'tmp', 'probe-debug.txt'), lines.join('\n'));
