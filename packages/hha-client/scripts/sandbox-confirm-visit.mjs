/**
 * Sandbox ConfirmVisits dry-run — search visit, try reason codes, report result.
 */
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

function toIso(dateStr, timeStr) {
  // 2026-07-10 + 09:00 -> 2026-07-10T09:00:00
  const [h, m] = timeStr.trim().split(':');
  return `${dateStr}T${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}:00`;
}

const visitIds = [1298399661, 1282693446];

for (const visitId of visitIds) {
  console.log(`\n=== Visit ${visitId} ===`);
  const info = await call('GetVisitInfoV2', `<VisitInfo><ID>${visitId}</ID></VisitInfo>`);
  if (info.status !== 'Success') {
    console.log('GetVisitInfoV2 FAIL', info.eid, info.msg || info.fault);
    continue;
  }
  const date = info.xml.match(/<VisitDate>([^<]+)/)?.[1];
  const schStart = info.xml.match(/<ScheduleStartTime>([^<]+)/)?.[1];
  const schEnd = info.xml.match(/<ScheduleEndTime>([^<]+)/)?.[1];
  const tsReq = info.xml.match(/<TimesheetRequired>([^<]+)/)?.[1];
  const tsAppr = info.xml.match(/<TimesheetApproved>([^<]+)/)?.[1];
  console.log('before', { date, schStart, schEnd, tsReq, tsAppr });

  const startPart = schStart?.split(' ').pop() ?? '09:00';
  const endPart = schEnd?.split(' ').pop() ?? '13:00';
  const startIso = date ? toIso(date, startPart) : '2026-07-22T09:00:00';
  const endIso = date ? toIso(date, endPart) : '2026-07-22T13:00:00';

  const missed = await call('GetMissedVisitReasons', '');
  const actions = await call('GetMissedVisitActionTaken', '');
  const reasonId = missed.xml.match(/<ReasonID>(\d+)/)?.[1];
  const actionId = actions.xml.match(/<ActionTakenID>(\d+)/)?.[1] ?? actions.xml.match(/<ID>(\d+)/)?.[1];

  const attempts = [
    ['no reason tsReq=No appr=No', 'No', 'No', ''],
    ['no reason tsReq=Yes appr=Yes', 'Yes', 'Yes', ''],
    ['bill707 tsReq=Yes appr=Yes', 'Yes', 'Yes', '<ReasonCode>707</ReasonCode><ActionCode>707</ActionCode>'],
    ['bill707 tsReq=No appr=No', 'No', 'No', '<ReasonCode>707</ReasonCode><ActionCode>707</ActionCode>'],
  ];

  if (reasonId && actionId) {
    attempts.push([
      `missed r=${reasonId} a=${actionId} tsYes`,
      'Yes',
      'Yes',
      `<ReasonCode>${reasonId}</ReasonCode><ActionCode>${actionId}</ActionCode>`,
    ]);
  }

  for (const [label, tsReq, tsAppr, extra] of attempts) {
    const r = await call(
      'ConfirmVisits',
      `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>${startIso}</VisitStartTime>
  <VisitEndTime>${endIso}</VisitEndTime>
  ${extra}
  <TimesheetRequired>${tsReq}</TimesheetRequired>
  <TimesheetApproved>${tsAppr}</TimesheetApproved>
</VisitInfo>`,
    );
    const ok = r.status?.toLowerCase() === 'success' && r.eid === '0';
    console.log(`${ok ? 'SUCCESS' : 'FAIL'} ConfirmVisits ${label}`, r.status ?? 'fault', r.eid ?? '-', (r.msg || r.fault || '').slice(0, 120));
    if (ok) {
      const after = await call('GetVisitInfoV2', `<VisitInfo><ID>${visitId}</ID></VisitInfo>`);
      const approved = after.xml.match(/<TimesheetApproved>([^<]+)/)?.[1];
      console.log('after TimesheetApproved=', approved);
      writeFileSync(path.join(repoRoot, 'docs', 'hha-sandbox-confirm-result.json'), JSON.stringify({ visitId, label, approved, at: new Date().toISOString() }, null, 2));
      process.exit(0);
    }
  }
}

console.log('\nNo ConfirmVisits attempt succeeded in sandbox.');
process.exitCode = 1;
