/**
 * Probe App Key / App Secret combinations against HHA sandbox GetOffices.
 * Requires env: HHA_APP_NAME, HHA_APP_SECRET, HHA_APP_KEY
 * Optional: HHA_BASE_URL (defaults to sandbox)
 */
const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL =
  process.env.HHA_BASE_URL ??
  'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env ${name}`);
    process.exit(1);
  }
  return value;
}

const APP = required('HHA_APP_NAME');
const SECRET = required('HHA_APP_SECRET');
const KEY = required('HHA_APP_KEY').replace(/\s+/g, '');

let PLAIN_KEY = KEY;
try {
  PLAIN_KEY = Buffer.from(KEY, 'base64').toString('utf16le');
  if (!PLAIN_KEY || /[^\x20-\x7E-]/.test(PLAIN_KEY)) PLAIN_KEY = KEY;
} catch {
  PLAIN_KEY = KEY;
}

const B64_SECRET_UTF16 = Buffer.from(SECRET, 'utf16le').toString('base64');
const B64_SECRET_UTF8 = Buffer.from(SECRET, 'utf8').toString('base64');

const cases = [
  ['guide-as-printed', APP, SECRET, KEY],
  ['plain-key', APP, SECRET, PLAIN_KEY],
  ['swapped', APP, KEY, SECRET],
  ['swapped-plain', APP, PLAIN_KEY, SECRET],
  ['secret-b64utf16', APP, B64_SECRET_UTF16, KEY],
  ['secret-b64utf8', APP, B64_SECRET_UTF8, KEY],
  ['secret-upper', APP, SECRET.toUpperCase(), KEY],
  ['key-in-both', APP, KEY, KEY],
  ['secret-in-both', APP, SECRET, SECRET],
];

async function call(appName, appSecret, appKey) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetOffices xmlns="${NS}">
      <Authentication>
        <AppName>${appName}</AppName>
        <AppSecret>${appSecret}</AppSecret>
        <AppKey>${appKey}</AppKey>
      </Authentication>
    </GetOffices>
  </soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/GetOffices"`,
    },
    body,
  });
  const txt = await res.text();
  const eid = txt.match(/<ErrorID>([^<]+)/)?.[1] ?? '-';
  const msg = txt.match(/<ErrorMessage>([^<]*)/)?.[1];
  const hasOffices = txt.includes('<OfficeID>');
  return {
    http: res.status,
    eid,
    msg: msg ?? (hasOffices ? 'OFFICES RETURNED' : txt.slice(0, 120)),
  };
}

console.log(`Target: ${URL}`);
for (const [label, name, secret, key] of cases) {
  const { http, eid, msg } = await call(name, secret, key);
  console.log(`${label.padEnd(18)} http=${http} ErrorID=${eid} msg=${msg}`);
}
