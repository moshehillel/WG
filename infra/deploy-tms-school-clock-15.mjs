/**
 * LIVE: school billing service code follows an exact session clock bucket.
 * 15-minute group on Valley Stream Thirty resolves to PT school 15
 * (contract has no PT school group 15). HHA_USE_PRODUCTION unchanged.
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
const aws = 'aws --no-verify-ssl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-school-clock-15-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-school-clock-15.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const billingSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/shared/src/config/school-billing-codes.ts'),
  'utf8',
);
if (!billingSrc.includes('exactSchoolDurationBucket')) {
  throw new Error('school-billing-codes.ts missing exactSchoolDurationBucket — abort');
}
if (!billingSrc.includes('schoolBillingServiceNameCandidates')) {
  throw new Error('school-billing-codes.ts missing schoolBillingServiceNameCandidates — abort');
}
const transferSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'),
  'utf8',
);
if (!transferSrc.includes('15-minute school billing follows the session clock')) {
  throw new Error('hha-transfer.ts missing clock-duration billing marker — abort');
}
if (!/clockExact \?\? mandateMinutes/.test(transferSrc)) {
  throw new Error('hha-transfer.ts missing clock-exact billing duration — abort');
}

console.log('building @white-glove/shared…');
sh('npm run build -w @white-glove/shared');
const billingDist = fs.readFileSync(
  path.join(repoRoot, 'packages/shared/dist/config/school-billing-codes.js'),
  'utf8',
);
if (!billingDist.includes('exactSchoolDurationBucket') || !billingDist.includes('function schoolBillingServiceNameCandidates')) {
  throw new Error('shared dist missing clock billing helpers — abort');
}

const gitSha = `${readGitSha()}-school-clock-15`;
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
assertAmAndPlcBundleMarkers(bundled, 'school-clock-15 bundle');
assertAlreadyBilledBundleMarkers(bundled, 'school-clock-15 bundle');
assertVisitDateCoverBundleMarkers(bundled, 'school-clock-15 bundle');
assertNoSchoolBillingStripFallback(bundled, 'school-clock-15 bundle');
if (!bundled.includes('15-minute school billing follows the session clock')) {
  throw new Error('Bundle missing clock-duration billing marker — aborting deploy');
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

const codeOut = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('code', codeOut.trim());
stampLambdaGitEnv(fnName, { sha: gitSha });

const afterEnv = JSON.parse(
  execSync(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT}" --output json`,
    { encoding: 'utf8' },
  ),
);

const summary = [
  'TMS school billing code follows exact session clock (15 → 15)',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. Exact clock 15/30/42/45/60 selects that school billing duration',
  '2. Group 15 prefers PT school group 15; Valley Stream Thirty falls back to PT school 15',
  '3. Pay rate still uses the mandate duration bucket (no 15-minute pay rate)',
  '4. 30-minute clocks still send the 30-minute code',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-school-clock-15-deploy-out.txt'), summary);
console.log('\n' + summary);
