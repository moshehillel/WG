/**
 * LIVE: CreatePatient when no HHA chart matches the child's name and date of birth.
 * A mismatched MR hit is still refused. HHA_USE_PRODUCTION unchanged.
 * Does not CreatePatient or CreateSchedule for Max Campbell.
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
const outDir = path.join(__dirname, 'tms-api-create-missing-child-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-create-missing-child.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const transferSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'), 'utf8');
if (!transferSrc.includes('formatHhaPatientMismatch')) {
  throw new Error('hha-transfer.ts missing patient identity refusal — abort');
}
if (!transferSrc.includes('patientIdentityMatches')) {
  throw new Error('hha-transfer.ts missing name/DOB guard — abort');
}
if (!transferSrc.includes('createPatientWhenUnmatched')) {
  throw new Error('hha-transfer.ts missing create-when-unmatched — abort');
}
if (!transferSrc.includes('missing required field(s)')) {
  throw new Error('hha-transfer.ts missing required-field failure — abort');
}
const identitySrc = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/patient-identity.ts'),
  'utf8',
);
if (!identitySrc.includes('patientIdentityMatches')) {
  throw new Error('patient-identity.ts missing matcher — abort');
}

console.log('building shared + tms-db + hha-client…');
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');
try {
  sh('npm run build -w @white-glove/hha-client');
} catch {
  console.log('hha-client tsc reported existing missing modules; checking emit…');
}
const identityJs = path.join(repoRoot, 'packages/hha-client/dist/patient-identity.js');
if (!fs.existsSync(identityJs) || !fs.readFileSync(identityJs, 'utf8').includes('patientIdentityMatches')) {
  throw new Error('dist/patient-identity.js missing matcher — abort');
}

const gitSha = `${readGitSha()}-create-missing-child`;
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
assertAmAndPlcBundleMarkers(bundled, 'create-missing-child bundle');
assertAlreadyBilledBundleMarkers(bundled, 'create-missing-child bundle');
assertVisitDateCoverBundleMarkers(bundled, 'create-missing-child bundle');
assertNoSchoolBillingStripFallback(bundled, 'create-missing-child bundle');
if (!bundled.includes('Refusing to transfer.')) {
  throw new Error('Bundle missing patient identity refusal — aborting deploy');
}
if (!bundled.includes('missing required field(s)')) {
  throw new Error('Bundle missing CreatePatient required-field error — aborting deploy');
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
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,CodeSize:CodeSize,State:State,LastUpdateStatus:LastUpdateStatus}" --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION changed: ${JSON.stringify(afterEnv)}`);
}
if (afterEnv.TMS_GIT_SHA !== gitSha) {
  throw new Error(`TMS_GIT_SHA mismatch: ${afterEnv.TMS_GIT_SHA} vs ${gitSha}`);
}

const summary = [
  'HHA transfer creates a child when no chart matches name and date of birth',
  'A mismatched chart is still refused and is not scheduled',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  'Did not CreatePatient or Send for Max Campbell',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-create-missing-child-deploy-out.txt'), summary);
console.log('\n' + summary);
