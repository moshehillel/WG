/**
 * LIVE: provider Revoke signature on the provider's own signed week.
 * POST /admin/weeks/:id/reopen is no longer admin-only.
 * HHA_USE_PRODUCTION / HHA_USE_MOCK / HHA_ALLOW_PRODUCTION unchanged.
 * Does not CreateSchedule. Does not change HHA assignment ids.
 *
 * The same handler bundle also ships undeployed paid-absence transfer
 * and the GetVisitInfoV2 -415 reads spaced 5s / 10s / 15s.
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
const outDir = path.join(__dirname, 'tms-api-revoke-signature-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-revoke-signature.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const routerSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/router.ts'), 'utf8');
if (!routerSrc.includes('async function revokeWeekSignature')) {
  throw new Error('router.ts missing revokeWeekSignature — abort');
}
if (!routerSrc.includes('You can only revoke the signature on your own week.')) {
  throw new Error('router.ts missing provider-own-week revoke error — abort');
}
if (!routerSrc.includes("req.method === 'POST' && /^\\/admin\\/weeks\\/[^/]+\\/reopen$/")) {
  throw new Error('router.ts missing reopen route — abort');
}
const reopenCall = routerSrc.match(
  /if \(req\.method === 'POST' && \/\^\\\/admin\\\/weeks\\\/\[\^\/\]\+\\\/reopen\$\/\.test\(path\)\) \{\s*return ([^;(]+)/,
);
if (!reopenCall || !reopenCall[1].includes('revokeWeekSignature')) {
  throw new Error('reopen route is not revokeWeekSignature — abort');
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

const gitSha = `${readGitSha()}-revoke-signature`;
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
assertAmAndPlcBundleMarkers(bundled, 'revoke-signature bundle');
assertAlreadyBilledBundleMarkers(bundled, 'revoke-signature bundle');
assertVisitDateCoverBundleMarkers(bundled, 'revoke-signature bundle');
assertNoSchoolBillingStripFallback(bundled, 'revoke-signature bundle');
if (!bundled.includes('You can only revoke the signature on your own week.')) {
  throw new Error('Bundle missing provider-own-week revoke error — aborting deploy');
}
if (!bundled.includes('revoke_signature')) {
  throw new Error('Bundle missing revoke_signature audit — aborting deploy');
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
console.log('local.ts seed not in bundle (no Diana Kraupner / dev-therapist)');

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
  'LIVE_OK: provider can revoke the signature on their own signed week',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged (true)',
  'HHA_USE_MOCK left unchanged',
  'HHA_ALLOW_PRODUCTION left unchanged (true)',
  'local.ts seed data is not in the lambda bundle',
  '',
  'Also in this handler bundle (already in the working tree, not split out):',
  '1. Paid absence HHA transfer',
  '2. GetVisitInfoV2 -415 confirm reads wait 5s, then 10s, then 15s',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-revoke-signature-deploy-out.txt'), summary);
console.log('\n' + summary);
