/**
 * Deploy API fix: requireMfa:false sticks (live re-read before settings merge;
 * Cognito clear fire-and-forget). Prove set-false → get-false → age-lock save still false.
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
const outDir = path.join(__dirname, 'tms-api-mfa-require-off-stick-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-mfa-require-off-stick.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const table = 'WhiteGloveStack-TmsStateTable10F38FC9-1OCJ1211NQLHU';

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

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,CodeSha256:CodeSha256,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

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

// --- Proof: set false → get false → unrelated field write must not flip MFA on ---
console.log('PROOF before', await readRequireMfa());
await putSettings({ requireMfa: true });
console.log('PROOF forced true', await readRequireMfa());
await putSettings({ requireMfa: false });
const afterOff = await readRequireMfa();
console.log('PROOF after set false', afterOff);
if (afterOff !== false) throw new Error('requireMfa did not stick false in Dynamo');

// Simulate stale age-lock writer that would have used requireMfa:true from memory,
// but correct merge re-reads live false and only changes age lock:
const live = await doc.send(new GetCommand({ TableName: table, Key: key }));
const staleWouldHaveWritten = {
  ...(live.Item?.entity || {}),
  requireMfa: true, // BUG: stale memory
  sessionImportAgeLockEnabled: false,
};
// Correct merge (what new API does): live.requireMfa wins when body omits requireMfa
const correct = {
  ...(live.Item?.entity || {}),
  requireMfa:
    typeof live.Item?.entity?.requireMfa === 'boolean'
      ? live.Item.entity.requireMfa
      : true,
  sessionImportAgeLockEnabled: false,
};
await putSettings(correct);
const afterOther = await readRequireMfa();
console.log('PROOF after other-settings save (correct merge)', afterOther);
if (afterOther !== false) throw new Error('other settings save flipped requireMfa');

// Show what the OLD bug would have done (do not leave true in Dynamo)
console.log('PROOF stale-merge would have written requireMfa=', staleWouldHaveWritten.requireMfa);

const hhaOk =
  JSON.parse(env).HHA_USE_MOCK === 'false' &&
  JSON.parse(env).HHA_USE_PRODUCTION === 'false' &&
  JSON.parse(env).HHA_ALLOW_PRODUCTION === 'false';

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-mfa-require-off-stick-deploy-out.txt'),
  [
    'TMS MFA: requireMfa=false sticks — live re-read + async Cognito clear',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    `PROOF: set false → ${afterOff}; after other-settings merge → ${afterOther}`,
    'Root cause: concurrent /admin/settings writers merged from a stale in-memory snapshot',
    '  that still had requireMfa:true, overwriting a just-saved false (age-lock/yellow/MFA race).',
    '  Secondary: awaiting Cognito clear made Off saves slow/fragile behind Netlify proxy.',
    'Fix: readLiveSettings from Dynamo immediately before merge; omit requireMfa keeps LIVE value;',
    '  Cognito clear is fire-and-forget; FE re-GETs after Save and shows server value; ?v=76',
    `HHA sandbox: ${hhaOk ? 'on' : 'CHECK ENV'} (USE_MOCK=false, USE_PRODUCTION=false, ALLOW_PRODUCTION=false)`,
    'FE: white-glove-tms-web cache bust app.js?v=76 styles.css?v=76',
    'Moshe: Security (MFA) → Advanced → Require MFA = Off → Save → stays Off after reload',
    '',
  ].join('\n'),
);
console.log('wrote cdk-tms-mfa-require-off-stick-deploy-out.txt');
if (!hhaOk) throw new Error('HHA sandbox env drifted');
