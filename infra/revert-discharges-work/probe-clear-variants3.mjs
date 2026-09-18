import { readFileSync, writeFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');

async function call(method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
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
    xml,
  };
}

function ok(r) {
  return r.status?.toLowerCase() === 'success' || r.eid === '0';
}

const pid = '22854608';
const place = '6812439';

const dis = await call('GetPatientDischargeTo');
const tos = [
  ...dis.xml.matchAll(
    /<PatientDischargeToID>(\d+)<\/PatientDischargeToID>\s*<PatientDischargeToName>([^<]*)<\/PatientDischargeToName>/g,
  ),
].map((m) => ({ id: m[1], name: m[2] }));
const home = tos.find((t) => /home/i.test(t.name)) || tos[0];

const reasons = await call('GetContractDischargeReason', '<Status>Active</Status>');
const reasonRows = [
  ...reasons.xml.matchAll(
    /<ReasonID>(\d+)<\/ReasonID>\s*<Reason>([^<]*)<\/Reason>\s*<ReasonDescription>([^<]*)<\/ReasonDescription>/gi,
  ),
].map((m) => ({ id: m[1], reason: m[2], desc: m[3] }));

const variants = [
  {
    label: 'Update clear with note+to no date',
    method: 'UpdatePatientContract',
    xml: `<PatientContractInfo>
  <PatientID>${pid}</PatientID>
  <PlacementID>${place}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeToID>${home?.id || ''}</DischargeToID>
  <DischargeReasonID>${reasonRows[0]?.id || ''}</DischargeReasonID>
  <DischargeNote>Mistaken auto discharge revert</DischargeNote>
</PatientContractInfo>`,
  },
  {
    label: 'Update with DischargeReason Description element',
    method: 'UpdatePatientContract',
    xml: `<PatientContractInfo>
  <PatientID>${pid}</PatientID>
  <PlacementID>${place}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate></DischargeDate>
  <DischargeToID>${home?.id || ''}</DischargeToID>
  <DischargeReasonID>${reasonRows[0]?.id || ''}</DischargeReasonID>
  <DischargeReason>
    <ID>${reasonRows[0]?.id || ''}</ID>
    <Name>${reasonRows[0]?.reason || 'Other'}</Name>
    <Description>${reasonRows[0]?.desc || 'Other'}</Description>
  </DischargeReason>
  <DischargeNote>Mistaken auto discharge revert</DischargeNote>
</PatientContractInfo>`,
  },
  {
    label: 'AddPatientContract reopen same service from 2026-09-16',
    method: 'AddPatientContract',
    xml: `<PatientContractInfo>
  <PatientID>${pid}</PatientID>
  <ContractID>61591</ContractID>
  <ServiceCodeID>785140</ServiceCodeID>
  <StartDate>2026-09-16</StartDate>
</PatientContractInfo>`,
  },
];

const results = [];
for (const v of variants) {
  const r = await call(v.method, v.xml);
  results.push({
    label: v.label,
    method: v.method,
    ok: ok(r),
    eid: r.eid,
    msg: r.msg,
    status: r.status,
    fault: r.fault,
    preview: r.xml.replace(/\s+/g, ' ').slice(0, 350),
  });
}

const snaps = {};
for (const d of ['2026-09-14', '2026-09-16', '2026-09-20']) {
  const r = await call('GetPatientContracts', `<PatientID>${pid}</PatientID><VisitDate>${d}</VisitDate>`);
  snaps[d] = {
    ok: ok(r),
    placements: [...r.xml.matchAll(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/g)].map((b) => ({
      placementId: b[0].match(/<PlacementID>([^<]*)/)?.[1],
      disc: b[0].match(/<DischargeDate>([^<]*)/)?.[1] ?? '(empty)',
      start: b[0].match(/<ServiceStartDate>([^<]*)/)?.[1] || b[0].match(/<StartDate>([^<]*)/)?.[1],
      svc: b[0].match(/<ServiceCode>\s*<ID>(\d+)/)?.[1],
    })),
  };
}

const out = {
  home,
  reasonSample: reasonRows.slice(0, 5),
  results,
  snaps,
};
writeFileSync('infra/revert-discharges-work/clear-variants-probe3.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
