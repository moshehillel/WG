/**
 * Deploy API+proof: requireMfa Off sticks through POST → GET (strong GetItem overlay).
 * Root cause: FE re-GET after Save used Scan-hydrated settings (eventually consistent) and
 * could still see requireMfa:true → "Save reported Require MFA still ON".
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-mfa-require-off-get-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-mfa-require-off-get.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const table = 'WhiteGloveStack-TmsStateTable10F38FC9-1OCJ1211NQLHU';
const lambdaUrl = 'https://latakehjufxtl37yvnds5pfjga0bbgby.lambda-url.us-east-1.on.aws';

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/tms-api/src/handler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: true,
  outfile,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);
execSync(`aws lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

function getLambdaEnv() {
  return JSON.parse(
    execSync(
      `aws lambda get-function-configuration --function-name ${fnName} --query Environment.Variables --output json`,
      { encoding: 'utf8' },
    ),
  );
}

function putLambdaEnv(vars) {
  const tmp = path.join(__dirname, 'tms-api-mfa-off-get-env.json');
  fs.writeFileSync(tmp, JSON.stringify({ Variables: vars }));
  execSync(
    `aws lambda update-function-configuration --function-name ${fnName} --environment file://${tmp} --query FunctionName --output text`,
    { stdio: 'inherit' },
  );
  execSync(`aws lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });
  fs.unlinkSync(tmp);
}

const envVars = getLambdaEnv();
const hadDev = envVars.TMS_ALLOW_DEV_HEADERS;
envVars.TMS_ALLOW_DEV_HEADERS = '1';
putLambdaEnv(envVars);

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const key = { pk: 'ENTITY#settings', sk: 'ID#global' };

async function readRequireMfa() {
  const res = await doc.send(new GetCommand({ TableName: table, Key: key }));
  return res.Item?.entity?.requireMfa;
}

async function putSettings(patch) {
  const res = await doc.send(new GetCommand({ TableName: table, Key: key }));
  const entity = { ...(res.Item?.entity || { id: 'global' }), ...patch };
  await doc.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: 'ENTITY#settings',
        sk: 'ID#global',
        collection: 'settings',
        entityId: 'global',
        entity,
      },
    }),
  );
  return entity;
}

async function api(method, pathName, body) {
  const res = await fetch(`${lambdaUrl}${pathName}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-tms-role': 'admin',
      'x-tms-email': 'admin@whiteglove.local',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathName} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

console.log('PROOF dynamo before', await readRequireMfa());
await putSettings({ requireMfa: true });
console.log('PROOF forced true in Dynamo', await readRequireMfa());

const postOff = await api('POST', '/admin/settings', { requireMfa: false, allowSmsMfa: false });
console.log('PROOF POST false →', postOff.settings?.requireMfa, 'mfaClear', postOff.mfaClear);
if (postOff.settings?.requireMfa !== false) {
  throw new Error('POST requireMfa:false did not echo false');
}

const getOff = await api('GET', '/admin/settings');
console.log('PROOF GET after POST false →', getOff.settings?.requireMfa);
if (getOff.settings?.requireMfa !== false) {
  throw new Error('GET /admin/settings still true after POST false (Scan lag / overlay failed)');
}

const dynamoAfter = await readRequireMfa();
console.log('PROOF Dynamo after API Off', dynamoAfter);
if (dynamoAfter !== false) throw new Error('Dynamo requireMfa not false after API Off');

// Leave org MFA Off (Moshe was stuck ON in UI).
await putSettings({ requireMfa: false });

// Restore env: remove temporary dev headers; keep HHA sandbox.
if (hadDev === undefined) delete envVars.TMS_ALLOW_DEV_HEADERS;
else envVars.TMS_ALLOW_DEV_HEADERS = hadDev;
putLambdaEnv(envVars);

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_ALLOW_DEV_HEADERS:Environment.Variables.TMS_ALLOW_DEV_HEADERS,CodeSha256:CodeSha256,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);
const envObj = JSON.parse(env);
const hhaOk =
  envObj.HHA_USE_MOCK === 'false' &&
  envObj.HHA_USE_PRODUCTION === 'false' &&
  envObj.HHA_ALLOW_PRODUCTION === 'false';
if (envObj.TMS_ALLOW_DEV_HEADERS === '1') throw new Error('TMS_ALLOW_DEV_HEADERS left on');
if (!hhaOk) throw new Error('HHA sandbox env drifted');

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-mfa-require-off-get-deploy-out.txt'),
  [
    'TMS MFA: Require Off survives POST→GET (strong settings GetItem overlay)',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    `PROOF: POST false → ${postOff.settings?.requireMfa}; GET → ${getOff.settings?.requireMfa}; Dynamo → ${dynamoAfter}`,
    'Exact bug: after Save, FE re-GET /admin/settings hydrated via Dynamo Scan (eventually consistent).',
    '  Scan could still return requireMfa:true while Put already wrote false → FE error',
    '  "Save reported Require MFA still ON — try again." and org status stayed Yes.',
    '  Secondary: typeof requireMfa==="boolean" ignored string "false" (kept prev true).',
    'Fix: overlay settings from strongly consistent GetItem after every loadTmsState;',
    '  GET /admin/settings uses readLiveSettings; coerce string/number bools on POST;',
    '  FE trusts POST echo when it matches the select; updates #mfaOrgRequires; ?v=77',
    'HHA sandbox: on (USE_MOCK=false, USE_PRODUCTION=false, ALLOW_PRODUCTION=false)',
    'FE: white-glove-tms-web cache bust app.js?v=77 styles.css?v=77',
    'Moshe: hard-refresh → Security (MFA) → Advanced → Require MFA = Off → Save',
    '  → green saved, Organization requires MFA: No, stays Off after reload',
    '',
  ].join('\n'),
);
console.log('wrote cdk-tms-mfa-require-off-get-deploy-out.txt');
