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

async function call(method, inner = '') {
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
    http: res.status,
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    hasContract: /PatientContractInfo/i.test(xml),
    disc: [...xml.matchAll(/<DischargeDate>([^<]*)/gi)].map((m) => m[1]),
    placement: [...xml.matchAll(/<PlacementID>([^<]*)/gi)].map((m) => m[1]),
    preview: xml.replace(/\s+/g, ' ').slice(0, 500),
  };
}

const pid = process.argv[2] || '22854608';
console.log({ URL, pid });
for (const d of ['09/16/2026', '2026-09-16', '9/16/2026', '12/31/2026']) {
  const r = await call(
    'GetPatientContracts',
    `<PatientID>${pid}</PatientID>\n  <VisitDate>${d}</VisitDate>`,
  );
  console.log(JSON.stringify({ d, http: r.http, status: r.status, eid: r.eid, msg: r.msg, fault: r.fault, hasContract: r.hasContract, placements: r.placement, disc: r.disc }));
}
