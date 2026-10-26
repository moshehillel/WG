/**
 * LIVE: caseload import keeps one student when program id and date of birth match
 * (including a longer first name such as "Jeremiah Tharin" vs "Jeremiah").
 * The same bundle also carries signature revoke, paid absence as attendance,
 * and GetVisitInfoV2 -415 waits of 5s, then 10s, then 15s.
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
const outDir = path.join(__dirname, 'tms-api-caseload-program-dob-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-caseload-program-dob.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const caseloadSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/caseload-import.ts'),
  'utf8',
);
if (!caseloadSrc.includes('function findStudentByProgramAndDob')) {
  throw new Error('caseload-import.ts missing program-id + DOB matcher — abort');
}
if (!caseloadSrc.includes('Jeremiah Tharin')) {
  throw new Error('caseload-import.ts missing Jeremiah Tharin first-name note — abort');
}

console.log('building shared + tms-db…');
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');
// Full hha-client tsc fails on local-only ENT modules that are not in this repo.
// The SOAP visit retry is already emitted in dist and is what esbuild bundles.
const soapDist = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/dist/soap-adapter.js'),
  'utf8',
);
if (!soapDist.includes('VISIT_ID_READ_RETRY_MS = [5_000, 10_000, 15_000]')) {
  throw new Error('hha-client dist missing 5s/10s/15s visit read waits — abort');
}

const distCaseload = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/caseload-import.js'),
  'utf8',
);
if (!distCaseload.includes('function findStudentByProgramAndDob')) {
  throw new Error('tms-db dist missing findStudentByProgramAndDob — abort');
}

const gitSha = `${readGitSha()}-caseload-program-dob`;
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
assertAmAndPlcBundleMarkers(bundled, 'caseload-program-dob bundle');
assertAlreadyBilledBundleMarkers(bundled, 'caseload-program-dob bundle');
assertVisitDateCoverBundleMarkers(bundled, 'caseload-program-dob bundle');
assertNoSchoolBillingStripFallback(bundled, 'caseload-program-dob bundle');
if (!map.includes('findStudentByProgramAndDob') || !map.includes('extraMiddleFromLongerFirst')) {
  throw new Error('Bundle sourcemap missing program-id + DOB caseload matcher — aborting deploy');
}
if (!bundled.includes('paid_absence') || !bundled.includes(', paid absence')) {
  throw new Error('Bundle missing paid-absence attendance marker — aborting deploy');
}
if (!bundled.includes('Signature revoked. The week is unsigned and can be edited and signed again.')) {
  throw new Error('Bundle missing revoke-signature marker — aborting deploy');
}
if (!bundled.includes('5e3,1e4,15e3') && !bundled.includes('5e3,10e3,15e3')) {
  throw new Error('Bundle missing GetVisitInfoV2 -415 waits of 5s, 10s, 15s — aborting deploy');
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
  'LIVE_OK: caseload keeps one student when program id and date of birth match',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `zip sha256: ${zipSha}`,
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  'Bundle sourcemap contains findStudentByProgramAndDob and extraMiddleFromLongerFirst',
  'Local preview seed Diana Kraupner / dev-therapist is absent from the bundle',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-caseload-program-dob-deploy-out.txt'), summary);
console.log('\n' + summary);
