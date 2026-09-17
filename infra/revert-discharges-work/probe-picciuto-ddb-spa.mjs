/**
 * Look up Picciuto in DynamoDB TMS state + try ENT SPA patient search if token works.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

function awsJson(args) {
  const out = execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 30_000_000 });
  return JSON.parse(out || 'null');
}

const STATE_TABLE = 'WhiteGloveStack-TmsStateTable10F38FC9-1OCJ1211NQLHU';
const IDEM_TABLE = 'WhiteGloveStack-IdempotencyTable22A5A209-RQ9QSY4WK01Z';

const exprFile = path.join(repoRoot, 'infra/revert-discharges-work/expr-picciuto.json');
writeFileSync(exprFile, JSON.stringify({ ':c': { S: '258272446' } }));

const results = { state: null, idem: null, stateByName: null, spa: null };

try {
  results.state = awsJson([
    'dynamodb',
    'scan',
    '--table-name',
    STATE_TABLE,
    '--filter-expression',
    'contains(pk, :c) OR contains(sk, :c) OR contains(caseId, :c)',
    '--expression-attribute-values',
    `file://${exprFile.replace(/\\/g, '/')}`,
    '--region',
    'us-east-1',
    '--max-items',
    '20',
  ]);
} catch (e) {
  results.state = { error: String(e.message || e) };
}

try {
  results.idem = awsJson([
    'dynamodb',
    'scan',
    '--table-name',
    IDEM_TABLE,
    '--filter-expression',
    'contains(pk, :c) OR contains(sk, :c)',
    '--expression-attribute-values',
    `file://${exprFile.replace(/\\/g, '/')}`,
    '--region',
    'us-east-1',
    '--max-items',
    '20',
  ]);
} catch (e) {
  results.idem = { error: String(e.message || e) };
}

writeFileSync(exprFile, JSON.stringify({ ':c': { S: 'PICCIUTO' } }));
try {
  results.stateByName = awsJson([
    'dynamodb',
    'scan',
    '--table-name',
    STATE_TABLE,
    '--filter-expression',
    'contains(pk, :c) OR contains(sk, :c)',
    '--expression-attribute-values',
    `file://${exprFile.replace(/\\/g, '/')}`,
    '--region',
    'us-east-1',
    '--max-items',
    '10',
  ]);
} catch (e) {
  results.stateByName = { error: String(e.message || e) };
}

// ENT SPA — try existing token; if expired, note only (no password spam in logs)
const token = process.env.HHA_ENT_SPA_ACCESS_TOKEN;
const cookies = process.env.HHA_ENT_HHAMFA_COOKIES;
async function spaTry(url, opts = {}) {
  const headers = {
    Accept: 'application/json',
    ...(opts.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookies) headers.Cookie = cookies;
  try {
    const res = await fetch(url, { ...opts, headers });
    const text = await res.text();
    return { http: res.status, preview: text.slice(0, 400) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

results.spa = {
  hasToken: Boolean(token),
  hasCookies: Boolean(cookies),
  tokenLen: token?.length || 0,
  patientSearch: await spaTry(
    'https://app.hhaexchange.com/api/ent/patients/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Edmund',
        lastName: 'Picciuto',
        status: 'All',
      }),
    },
  ),
  patientById: await spaTry(`https://app.hhaexchange.com/api/ent/patients/26372249`),
  contracts: await spaTry(
    'https://app.hhaexchange.com/api/ent/patients/contracts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: 26372249 }),
    },
  ),
};

writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/picciuto-ddb-spa-probe.json'),
  JSON.stringify(
    {
      stateCount: results.state?.Items?.length ?? results.state,
      idemCount: results.idem?.Items?.length ?? results.idem,
      stateByNameCount: results.stateByName?.Items?.length ?? results.stateByName,
      stateItems: results.state?.Items?.slice(0, 5),
      idemItems: results.idem?.Items?.slice(0, 5),
      spa: results.spa,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      stateItems: results.state?.Items?.length,
      stateErr: results.state?.error,
      idemItems: results.idem?.Items?.length,
      idemErr: results.idem?.error,
      nameItems: results.stateByName?.Items?.length,
      spa: results.spa,
      sampleState: results.state?.Items?.[0],
    },
    null,
    2,
  ),
);
