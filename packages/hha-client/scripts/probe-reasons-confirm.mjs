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
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

const visitId = 1282693446;
const reasons = await call(
  'GetVisitEditReasonActionTaken',
  `<VisitInfo><VisitId>${visitId}</VisitId></VisitInfo>`,
);
console.log('reasons', reasons.status, reasons.eid, reasons.msg || reasons.fault);
writeFileSync(path.join(repoRoot, 'tmp', 'visit-edit-reasons.xml'), reasons.xml);
console.log(reasons.xml.replace(/\s+/g, ' ').slice(0, 1500));

// parse reason/action pairs
const pairs = [];
const re =
  /<Reason[^>]*>[\s\S]*?<ID>(\d+)<\/ID>[\s\S]*?(?:<Name>([^<]*)<\/Name>)?[\s\S]*?<Action[\s\S]*?<ID>(\d+)<\/ID>[\s\S]*?(?:<Name>([^<]*)<\/Name>)?/gi;
let m;
while ((m = re.exec(reasons.xml)) && pairs.length < 10) {
  pairs.push({ reasonId: m[1], reasonName: m[2], actionId: m[3], actionName: m[4] });
}
console.log('pairs', pairs);

const reasonIds = [...reasons.xml.matchAll(/<ReasonCode>(\d+)/g)].map((x) => x[1]);
const actionIds = [...reasons.xml.matchAll(/<ActionCode>(\d+)/g)].map((x) => x[1]);
const allIds = [...reasons.xml.matchAll(/<ID>(\d+)/g)].map((x) => x[1]);
console.log('ReasonCode', reasonIds.slice(0, 5), 'ActionCode', actionIds.slice(0, 5), 'IDs', allIds.slice(0, 10));

const reason = reasonIds[0] || pairs[0]?.reasonId || allIds[0] || '1';
const action = actionIds[0] || pairs[0]?.actionId || allIds[1] || '1';

const confirm = await call(
  'ConfirmVisits',
  `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>2026-07-10T09:00:00</VisitStartTime>
  <VisitEndTime>2026-07-10T13:00:00</VisitEndTime>
  <ReasonCode>${reason}</ReasonCode>
  <ActionCode>${action}</ActionCode>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>No</TimesheetApproved>
  <Duties>
    <Duty>
      <DutyCode>1</DutyCode>
      <AdditionalData>0</AdditionalData>
      <Status>Performed</Status>
    </Duty>
  </Duties>
</VisitInfo>`,
);
console.log(
  'ConfirmVisits',
  `reason=${reason} action=${action}`,
  confirm.status ?? 'fault',
  confirm.eid ?? '-',
  confirm.msg || confirm.fault || '',
);
console.log(confirm.xml.replace(/\s+/g, ' ').slice(0, 600));
