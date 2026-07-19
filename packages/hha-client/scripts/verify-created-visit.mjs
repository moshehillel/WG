import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const vid = 1298399661;
const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetVisitInfoV2 xmlns="${NS}">
      <Authentication>
        <AppName>${process.env.HHA_APP_NAME}</AppName>
        <AppSecret>${process.env.HHA_APP_SECRET}</AppSecret>
        <AppKey>${process.env.HHA_APP_KEY.replace(/\s+/g, '')}</AppKey>
      </Authentication>
      <VisitInfo><ID>${vid}</ID></VisitInfo>
    </GetVisitInfoV2>
  </soap:Body>
</soap:Envelope>`;

const res = await fetch(process.env.HHA_BASE_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'text/xml; charset=utf-8',
    SOAPAction: `"${NS}/GetVisitInfoV2"`,
  },
  body,
});
const xml = await res.text();
console.log(
  'status',
  xml.match(/Status="([^"]+)"/)?.[1],
  'eid',
  xml.match(/<ErrorID>([^<]*)/)?.[1],
);
console.log(
  'patient',
  xml.match(/<Patient><ID>(\d+)/)?.[1],
  'date',
  xml.match(/<VisitDate>([^<]+)/)?.[1],
  'start',
  xml.match(/<ScheduleStartTime>([^<]+)/)?.[1],
  'end',
  xml.match(/<ScheduleEndTime>([^<]+)/)?.[1],
);
