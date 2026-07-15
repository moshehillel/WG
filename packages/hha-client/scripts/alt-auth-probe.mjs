/**
 * Probe alternate HHAeXchange auth transports against SANDBOX only.
 * Requires env: HHA_APP_NAME, HHA_APP_SECRET, HHA_APP_KEY
 * Do not point this at production.
 */
const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';

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
const B64_KEY = required('HHA_APP_KEY').replace(/\s+/g, '');

let PLAIN_KEY = B64_KEY;
try {
  const decoded = Buffer.from(B64_KEY, 'base64').toString('utf16le');
  if (decoded && !/[^\x20-\x7E-]/.test(decoded)) PLAIN_KEY = decoded;
} catch {
  /* keep as-is */
}

const SANDBOX = 'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const SANDBOX_LOWER = 'https://sandbox1.hhaexchange.com/integration/ENT/V1.8/ws.asmx';

function summarize(label, http, txt) {
  const eid = txt.match(/<ErrorID>([^<]+)/)?.[1] ?? '-';
  const msg = txt.match(/<ErrorMessage>([^<]*)/)?.[1];
  const ok =
    txt.includes('<OfficeID>') ||
    txt.includes('"access_token"') ||
    /Status>\s*Success/i.test(txt);
  const snippet = msg ?? (ok ? 'SUCCESS/DATA' : txt.replace(/\s+/g, ' ').slice(0, 160));
  console.log(`${label.padEnd(28)} http=${http} ErrorID=${eid} ${snippet}`);
}

async function soap11(url, key) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetOffices xmlns="${NS}">
      <Authentication>
        <AppName>${APP}</AppName>
        <AppSecret>${SECRET}</AppSecret>
        <AppKey>${key}</AppKey>
      </Authentication>
    </GetOffices>
  </soap:Body>
</soap:Envelope>`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/GetOffices"`,
    },
    body,
  });
  return [res.status, await res.text()];
}

async function soap12(url, key) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <GetOffices xmlns="${NS}">
      <Authentication>
        <AppName>${APP}</AppName>
        <AppSecret>${SECRET}</AppSecret>
        <AppKey>${key}</AppKey>
      </Authentication>
    </GetOffices>
  </soap12:Body>
</soap12:Envelope>`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body,
  });
  return [res.status, await res.text()];
}

async function asmxHttpPost(url, key) {
  const attempts = [
    new URLSearchParams({
      AppName: APP,
      AppSecret: SECRET,
      AppKey: key,
    }).toString(),
    new URLSearchParams({
      'Authentication.AppName': APP,
      'Authentication.AppSecret': SECRET,
      'Authentication.AppKey': key,
    }).toString(),
  ];
  const results = [];
  for (const [i, body] of attempts.entries()) {
    const res = await fetch(`${url}/GetOffices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    results.push([`asmx-http-post-${i + 1}`, res.status, await res.text()]);
  }
  return results;
}

async function oauthToken(clientId, clientSecret, scope) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (scope) body.set('scope', scope);
  const res = await fetch('https://sandbox1.hhaexchange.com/identity/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return [res.status, await res.text()];
}

console.log('Target: SANDBOX only');

for (const [label, fn, url, key] of [
  ['soap11-sandbox-b64', soap11, SANDBOX, B64_KEY],
  ['soap11-sandbox-plain', soap11, SANDBOX, PLAIN_KEY],
  ['soap12-sandbox-b64', soap12, SANDBOX, B64_KEY],
  ['soap12-sandbox-plain', soap12, SANDBOX, PLAIN_KEY],
  ['soap11-sandboxLower-b64', soap11, SANDBOX_LOWER, B64_KEY],
]) {
  const [http, txt] = await fn(url, key);
  summarize(label, http, txt);
}

for (const url of [SANDBOX, SANDBOX_LOWER]) {
  const rows = await asmxHttpPost(url, B64_KEY);
  for (const [label, http, txt] of rows) {
    summarize(`${label}@sandbox`, http, txt);
  }
}

for (const [cid, csec, scope] of [
  [APP, SECRET, undefined],
  [APP, SECRET, 'AggregatorApi'],
  [APP, B64_KEY, undefined],
]) {
  const label = `oauth-sandbox cid=${String(cid).slice(0, 12)}`;
  const [http, txt] = await oauthToken(cid, csec, scope);
  summarize(label.slice(0, 28), http, txt);
}
