/**
 * LIVE_OK: harden Therapist Activity student-name parse (capture + reject junk).
 * - Reject note scraps / credentials as child names
 * - Also recover LAST, FIRST before ICD/CPT when CBRS missing; lookback before clock
 * - Clearer empty-name upload error + CloudWatch slice head for empty names
 * HHA_USE_PRODUCTION unchanged.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-parse-name-harden-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-parse-name-harden.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const paySrc = path.join(repoRoot, 'packages/hha-client/src/pay-code-resolve.ts');
const payDist = path.join(repoRoot, 'packages/hha-client/dist/pay-code-resolve.js');
sh(
  `npx esbuild ${JSON.stringify(paySrc)} --outfile=${JSON.stringify(payDist)} --format=esm --platform=node --target=node22`,
);

const resolveSrc = path.join(repoRoot, 'packages/hha-client/src/resolve-service-code-order.ts');
const resolveDist = path.join(repoRoot, 'packages/hha-client/dist/resolve-service-code-order.js');
sh(
  `npx esbuild ${JSON.stringify(resolveSrc)} --outfile=${JSON.stringify(resolveDist)} --format=esm --platform=node --target=node22`,
);
if (fs.readFileSync(resolveDist, 'utf8').includes('stripSchoolBillingDurationBucket')) {
  throw new Error('dist still has stripSchoolBillingDurationBucket — abort');
}

const parseSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'),
  'utf8',
);
if (!parseSrc.includes('isPlausibleStudentName') || !parseSrc.includes('NOTE_FRAGMENT_NAME_TOKEN')) {
  throw new Error('session-parse missing plausible-name harden — abort');
}
if (!parseSrc.includes('extractTherapistActivityStudentName')) {
  throw new Error('session-parse missing extractTherapistActivityStudentName — abort');
}
if (!parseSrc.includes('[A-TV-Z]\\d{2}')) {
  throw new Error('session-parse missing ICD/CPT name anchor — abort');
}
if (!parseSrc.includes('activityStudentNameKey') || !parseSrc.includes('CROSSLAND LIPSCOMB')) {
  throw new Error('session-parse missing compound last-name capture — abort');
}

const routerSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/router.ts'), 'utf8');
if (!routerSrc.includes('Could not read the student name from this PDF row')) {
  throw new Error('router missing empty-name upload message — abort');
}
if (!routerSrc.includes('upload-sessions empty-name slice')) {
  throw new Error('router missing empty-name slice logging — abort');
}

const gitSha = `${readGitSha()}-parse-compound-name`;
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
assertAmAndPlcBundleMarkers(bundled, 'parse-name-harden bundle');
assertAlreadyBilledBundleMarkers(bundled, 'parse-name-harden bundle');
assertVisitDateCoverBundleMarkers(bundled, 'parse-name-harden bundle');
assertNoSchoolBillingStripFallback(bundled, 'parse-name-harden bundle');
if (!bundled.includes('Could not read the student name from this PDF row')) {
  throw new Error('bundled missing empty-name upload message — abort');
}
if (!bundled.includes('upload-sessions empty-name slice')) {
  throw new Error('bundled missing empty-name slice logging — abort');
}
if (!bundled.includes('Therapy') || !bundled.includes('Room')) {
  throw new Error('bundled missing compound-name setting guard — abort');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { cwd: __dirname },
);

const beforeEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
    { encoding: 'utf8' },
  ),
);
console.log('HHA env before:', beforeEnv);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${beforeEnv.HHA_USE_PRODUCTION}`);
}

const codeOut = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('code', codeOut.trim());
stampLambdaGitEnv(fnName, { sha: gitSha });

const afterEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT}" --output json`,
    { encoding: 'utf8' },
  ),
);

const summary = [
  'TMS Therapist Activity name-parse capture harden',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Fixes:',
  '1. Reject note scraps / credentials as student names (prior)',
  '2. Capture LAST, FIRST before ICD/CPT when CBRS missing from Tj extract',
  '3. Short lookback before In/Out when Child column is emitted before the clock',
  '4. Walk all name candidates (skip junk, keep real child)',
  '5. Empty-name rows log sliceHead to CloudWatch for triage',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-parse-name-harden-deploy-out.txt'), summary);
console.log('\n' + summary);
