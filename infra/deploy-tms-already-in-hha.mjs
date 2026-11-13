/**
 * LIVE: admin can mark a failed HHA triage session as already entered in HHA.
 * Status becomes `manual`, no VisitID, the TMS session stays, and a later send skips it.
 * HHA_USE_PRODUCTION is not changed.
 */
import * as esbuild from 'esbuild';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';
import {
  assertAmAndPlcBundleMarkers,
  assertAlreadyBilledBundleMarkers,
  assertVisitDateCoverBundleMarkers,
  assertNoSchoolBillingStripFallback,
} from './deploy-tms-hha-bundle-gates.mjs';

process.env.AWS_NO_VERIFY_SSL = '1';
const aws = 'aws --no-verify-ssl --region us-east-1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-already-in-hha-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-already-in-hha.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const transferSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'), 'utf8');
if (!transferSrc.includes('Only a failed HHA transfer can be marked already in HHA.')) {
  throw new Error('hha-transfer.ts missing already-in-HHA guard — abort');
}
if (!transferSrc.includes("existing?.status === 'manual'")) {
  throw new Error('hha-transfer.ts missing manual skip — abort');
}
const routerSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/router.ts'), 'utf8');
if (!routerSrc.includes('/hha-already') || !routerSrc.includes('hha-failures')) {
  throw new Error('router.ts missing already-in-HHA routes — abort');
}

console.log('building shared + tms-db…');
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const soapDist = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/dist/soap-adapter.js'),
  'utf8',
);
if (!soapDist.includes('VISIT_ID_READ_RETRY_MS = [5_000, 10_000, 15_000]')) {
  throw new Error('hha-client dist missing 5s/10s/15s visit read waits — abort');
}

const gitSha = `${readGitSha()}-already-in-hha`;
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

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
  define: { 'process.env.TMS_GIT_SHA': JSON.stringify(gitSha) },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

const bundled = fs.readFileSync(outfile, 'utf8');
const map = fs.readFileSync(`${outfile}.map`, 'utf8');
assertAmAndPlcBundleMarkers(bundled, 'already-in-hha bundle');
assertAlreadyBilledBundleMarkers(bundled, 'already-in-hha bundle');
assertVisitDateCoverBundleMarkers(bundled, 'already-in-hha bundle');
assertNoSchoolBillingStripFallback(bundled, 'already-in-hha bundle');
if (!bundled.includes('Only a failed HHA transfer can be marked already in HHA.')) {
  throw new Error('Bundle missing already-in-HHA guard — aborting deploy');
}
if (!bundled.includes('hha-already') || !bundled.includes('hha-failures')) {
  throw new Error('Bundle missing already-in-HHA routes — aborting deploy');
}
if (!map.includes('markSessionAlreadyInHha')) {
  throw new Error('Bundle sourcemap missing markSessionAlreadyInHha — aborting deploy');
}
if (bundled.includes('Diana Kraupner') || bundled.includes('dev-therapist')) {
  throw new Error('Bundle contains local.ts preview seed — aborting deploy');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const zipForPs = zipPath.replace(/'/g, "''");
const outForPs = outfile.replace(/'/g, "''");
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outForPs}' -DestinationPath '${zipForPs}' -Force"`,
  { cwd: __dirname },
);

const beforeEnv = JSON.parse(
  execSync(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
    { encoding: 'utf8' },
  ),
);
console.log('HHA env before:', beforeEnv);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${beforeEnv.HHA_USE_PRODUCTION}`);
}

const zipSha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('base64');
const codeOut = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath.replace(/\\/g, '/')} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('code', codeOut.trim());
const codeJson = JSON.parse(codeOut);
if (codeJson.CodeSha256 !== zipSha) {
  throw new Error(`Uploaded zip sha ${zipSha} does not match Lambda CodeSha256 ${codeJson.CodeSha256}`);
}
stampLambdaGitEnv(fnName, { sha: gitSha, region: 'us-east-1' });
execSync(`${aws} lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

const afterEnv = JSON.parse(
  execSync(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,LastModified:LastModified}" --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION changed: ${JSON.stringify(afterEnv)}`);
}
if (String(afterEnv.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_MOCK is true: ${JSON.stringify(afterEnv)}`);
}
if (String(afterEnv.HHA_ALLOW_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_ALLOW_PRODUCTION is ${afterEnv.HHA_ALLOW_PRODUCTION}`);
}
if (afterEnv.TMS_GIT_SHA !== gitSha) {
  throw new Error(`LIVE_OK failed: TMS_GIT_SHA is ${afterEnv.TMS_GIT_SHA}, expected ${gitSha}`);
}

const summary = [
  'LIVE_OK: admin can mark a failed visit already in HHA (manual, no VisitID)',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `zip sha256: ${zipSha}`,
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  'Bundle contains the already-in-HHA guard and hha-already / hha-failures routes',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-already-in-hha-deploy-out.txt'), summary);
console.log('\n' + summary);
