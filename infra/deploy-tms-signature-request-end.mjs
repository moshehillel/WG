/**
 * LIVE: cancel or retrieve an outstanding SignNow signature request.
 * POST /weeks/:id/cancel-signature (and cancel-approval) and
 * POST /weeks/:id/retrieve-signature.
 * HHA_USE_PRODUCTION / HHA_USE_MOCK / HHA_ALLOW_PRODUCTION unchanged.
 * Does not CreateSchedule. Does not change HHA assignment ids.
 */
import * as esbuild from 'esbuild';
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
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const aws = 'aws --no-verify-ssl --region us-east-1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-signature-request-end-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-signature-request-end.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const routerSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/router.ts'), 'utf8');
if (!routerSrc.includes('async function endWeekSignatureRequest')) {
  throw new Error('router.ts missing endWeekSignatureRequest — abort');
}
if (!routerSrc.includes('retrieve-signature')) {
  throw new Error('router.ts missing retrieve-signature route — abort');
}
if (!routerSrc.includes('cancel-signature')) {
  throw new Error('router.ts missing cancel-signature route — abort');
}
if (!routerSrc.includes('planSignatureRequestEnd')) {
  throw new Error('router.ts missing planSignatureRequestEnd — abort');
}

const esignSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/esign.ts'), 'utf8');
if (!esignSrc.includes('export async function endOpenSignRequest')) {
  throw new Error('esign.ts missing endOpenSignRequest — abort');
}
if (!esignSrc.includes('export function signNowDocumentIsFullySigned')) {
  throw new Error('esign.ts missing signNowDocumentIsFullySigned — abort');
}

const retrySrc = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/soap-adapter.ts'),
  'utf8',
);
if (!retrySrc.includes('VISIT_ID_READ_RETRY_MS = [5_000, 10_000, 15_000]')) {
  throw new Error('soap-adapter.ts missing 5s/10s/15s -415 retry — abort');
}

console.log('building shared + tms-db + hha-client…');
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');
try {
  sh('npm run build -w @white-glove/hha-client');
} catch {
  console.log('hha-client tsc reported existing missing modules; checking emit…');
}
const retryJs = path.join(repoRoot, 'packages/hha-client/dist/soap-adapter.js');
const retryEmitted = fs.existsSync(retryJs) ? fs.readFileSync(retryJs, 'utf8') : '';
if (!retryEmitted.includes('5000, 10000, 15000') && !retryEmitted.includes('5_000, 10_000, 15_000')) {
  throw new Error('dist/soap-adapter.js missing 5s/10s/15s retry — abort');
}

const gitSha = `${readGitSha()}-signature-request-end`;
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
assertAmAndPlcBundleMarkers(bundled, 'signature-request-end bundle');
assertAlreadyBilledBundleMarkers(bundled, 'signature-request-end bundle');
assertVisitDateCoverBundleMarkers(bundled, 'signature-request-end bundle');
assertNoSchoolBillingStripFallback(bundled, 'signature-request-end bundle');
if (!bundled.includes('retrieve-signature')) {
  throw new Error('Bundle missing retrieve-signature — aborting deploy');
}
if (!bundled.includes('cancel-signature')) {
  throw new Error('Bundle missing cancel-signature — aborting deploy');
}
if (!bundled.includes('This signature request is already cancelled.')) {
  throw new Error('Bundle missing already-cancelled no-op — aborting deploy');
}
if (!bundled.includes('already signed')) {
  throw new Error('Bundle missing completed-signature refusal — aborting deploy');
}
if (!bundled.includes('You can only revoke the signature on your own week.')) {
  throw new Error('Bundle missing provider-own-week revoke error — aborting deploy');
}
if (bundled.includes('Diana Kraupner') || bundled.includes('dev-therapist')) {
  throw new Error('Bundle contains local.ts seed data — aborting deploy');
}
if (!bundled.includes('paid_absence')) {
  throw new Error('Bundle missing paid_absence — aborting deploy');
}
const hasSpacedRetry =
  bundled.includes('5e3,1e4,15e3') ||
  bundled.includes('5e3,10e3,15e3') ||
  bundled.includes('5000,10000,15000') ||
  bundled.includes('5000,1e4,15e3');
if (!hasSpacedRetry) {
  throw new Error('Bundle missing 5s/10s/15s GetVisitInfoV2 retry — aborting deploy');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
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
if (String(beforeEnv.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error(`Refusing deploy: HHA_USE_MOCK is ${beforeEnv.HHA_USE_MOCK}`);
}
if (String(beforeEnv.HHA_ALLOW_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_ALLOW_PRODUCTION is ${beforeEnv.HHA_ALLOW_PRODUCTION}`);
}

const codeOut = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('code', codeOut.trim());
stampLambdaGitEnv(fnName, { sha: gitSha });
execSync(`${aws} lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

const afterEnv = JSON.parse(
  execSync(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,LastModified:LastModified,CodeSha256:CodeSha256}" --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true' || afterEnv.HHA_USE_PRODUCTION !== beforeEnv.HHA_USE_PRODUCTION) {
  throw new Error(`HHA_USE_PRODUCTION changed: ${JSON.stringify(afterEnv)}`);
}
if (String(afterEnv.HHA_USE_MOCK || '').toLowerCase() === 'true' || afterEnv.HHA_USE_MOCK !== beforeEnv.HHA_USE_MOCK) {
  throw new Error(`HHA_USE_MOCK changed: ${JSON.stringify(afterEnv)}`);
}
if (String(afterEnv.HHA_ALLOW_PRODUCTION) !== 'true' || afterEnv.HHA_ALLOW_PRODUCTION !== beforeEnv.HHA_ALLOW_PRODUCTION) {
  throw new Error(`HHA_ALLOW_PRODUCTION changed: ${JSON.stringify(afterEnv)}`);
}
if (afterEnv.TMS_GIT_SHA !== gitSha) {
  throw new Error(`TMS_GIT_SHA mismatch: ${afterEnv.TMS_GIT_SHA} vs ${gitSha}`);
}

const summary = [
  'LIVE_OK: cancel and retrieve an outstanding SignNow signature request',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged (true)',
  'HHA_USE_MOCK left unchanged',
  'HHA_ALLOW_PRODUCTION left unchanged (true)',
  'No HHA visit was created, cancelled, or modified by this deploy',
  'local.ts seed data is not in the lambda bundle',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-signature-request-end-deploy-out.txt'), summary);
console.log('\n' + summary);
