/**
 * LIVE: link an existing HHA chart when FirstName is TMS first + middle.
 * Lambda code update (same path as 48335df) plus Timeout 600.
 * Does not change HHA_USE_PRODUCTION and does not disable the Wednesday rule.
 * Does not redeploy the site.
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

const aws = 'aws --region us-east-1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-patient-first-middle-asset');
const stageDir = path.join(__dirname, '_zip_stage_patient_first_middle');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-patient-first-middle.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const ruleName = 'WhiteGlove-TmsHhaAutoTransfer';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const identitySrc = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/patient-identity.ts'),
  'utf8',
);
if (!identitySrc.includes('function chartFirstIsStudentFirstPlusMiddle(')) {
  throw new Error('patient-identity.ts missing first-plus-middle match — abort');
}

console.log('building shared + tms-db…');
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const identityJs = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/dist/patient-identity.js'),
  'utf8',
);
if (!identityJs.includes('function chartFirstIsStudentFirstPlusMiddle(')) {
  throw new Error('hha-client dist missing first-plus-middle match — abort');
}

const soapDist = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/dist/soap-adapter.js'),
  'utf8',
);
if (!soapDist.includes('VISIT_ID_READ_RETRY_MS = [5_000, 10_000, 15_000]')) {
  throw new Error('hha-client dist missing 5s/10s/15s visit read waits — abort');
}

const gitSha = `${readGitSha()}-patient-first-middle`;
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
assertAmAndPlcBundleMarkers(bundled, 'patient-first-middle bundle');
assertAlreadyBilledBundleMarkers(bundled, 'patient-first-middle bundle');
assertVisitDateCoverBundleMarkers(bundled, 'patient-first-middle bundle');
assertNoSchoolBillingStripFallback(bundled, 'patient-first-middle bundle');
if (!map.includes('chartFirstIsStudentFirstPlusMiddle')) {
  throw new Error('Bundle sourcemap missing first-plus-middle match — aborting deploy');
}
if (!bundled.includes('84898') || !bundled.includes('10022046')) {
  throw new Error('Bundle missing Billu Markowitz 84898 or Therapy Team 10022046 — aborting deploy');
}
if (bundled.includes('Diana Kraupner') || bundled.includes('dev-therapist')) {
  throw new Error('Bundle contains local.ts preview seed — aborting deploy');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

fs.mkdirSync(stageDir, { recursive: true });
for (const f of fs.readdirSync(stageDir)) fs.unlinkSync(path.join(stageDir, f));
fs.copyFileSync(outfile, path.join(stageDir, 'index.mjs'));
fs.copyFileSync(`${outfile}.map`, path.join(stageDir, 'index.mjs.map'));
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stageDir, '*').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { cwd: __dirname },
);

const beforeEnv = JSON.parse(
  sh(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{Timeout:Timeout,HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
    { stdio: 'pipe' },
  ),
);
console.log('before:', beforeEnv);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${beforeEnv.HHA_USE_PRODUCTION}`);
}

const zipSha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('base64');
const codeOut = sh(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath.replace(/\\/g, '/')} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { cwd: __dirname, stdio: 'pipe' },
);
console.log('code', codeOut.trim());
const codeJson = JSON.parse(codeOut);
if (codeJson.CodeSha256 !== zipSha) {
  throw new Error(`Uploaded zip sha ${zipSha} does not match Lambda CodeSha256 ${codeJson.CodeSha256}`);
}

sh(`${aws} lambda wait function-updated --function-name ${fnName}`);
stampLambdaGitEnv(fnName, { sha: gitSha, region: 'us-east-1' });
sh(`${aws} lambda wait function-updated --function-name ${fnName}`);

const timeoutOut = sh(
  `${aws} lambda update-function-configuration --function-name ${fnName} --timeout 600 --query "{Timeout:Timeout,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION}" --output json`,
  { stdio: 'pipe' },
);
console.log('timeout', timeoutOut.trim());
sh(`${aws} lambda wait function-updated --function-name ${fnName}`);

const afterEnv = JSON.parse(
  sh(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{Timeout:Timeout,HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,LastModified:LastModified,CodeSha256:CodeSha256}" --output json`,
    { stdio: 'pipe' },
  ),
);
const rule = JSON.parse(
  sh(
    `${aws} events describe-rule --name ${ruleName} --query "{State:State,ScheduleExpression:ScheduleExpression}" --output json`,
    { stdio: 'pipe' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is ${afterEnv.HHA_USE_PRODUCTION}`);
}
if (String(afterEnv.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_MOCK is true`);
}
if (String(afterEnv.HHA_ALLOW_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_ALLOW_PRODUCTION is ${afterEnv.HHA_ALLOW_PRODUCTION}`);
}
if (Number(afterEnv.Timeout) !== 600) {
  throw new Error(`LIVE_OK failed: Timeout is ${afterEnv.Timeout}`);
}
if (afterEnv.TMS_GIT_SHA !== gitSha) {
  throw new Error(`LIVE_OK failed: TMS_GIT_SHA is ${afterEnv.TMS_GIT_SHA}, expected ${gitSha}`);
}
if (afterEnv.CodeSha256 !== zipSha) {
  throw new Error(`LIVE_OK failed: CodeSha256 is ${afterEnv.CodeSha256}, expected ${zipSha}`);
}
if (rule.State !== 'ENABLED' || rule.ScheduleExpression !== 'cron(0 11 ? * WED *)') {
  throw new Error(`LIVE_OK failed: Wednesday rule changed: ${JSON.stringify(rule)}`);
}

const summary = [
  'LIVE_OK: HHA first name of TMS first plus middle links the existing chart',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `zip sha256: ${zipSha}`,
  `before: ${JSON.stringify(beforeEnv)}`,
  `after: ${JSON.stringify(afterEnv)}`,
  `rule: ${JSON.stringify(rule)}`,
  'HHA_USE_PRODUCTION left true',
  'Wednesday rule left enabled',
  'Site was not redeployed',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-patient-first-middle-deploy-out.txt'), summary);
console.log('\n' + summary);
