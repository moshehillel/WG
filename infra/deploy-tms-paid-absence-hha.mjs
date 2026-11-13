/**
 * LIVE: paid absences stored as missed are sent to HHA.
 * Real child → that patient. No child → new "no child" patient.
 * Unpaid misses stay off. Existing visits are not cancelled.
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

process.env.AWS_NO_VERIFY_SSL = '1';
const aws = 'aws --no-verify-ssl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-paid-absence-hha-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-paid-absence-hha.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const transferSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'),
  'utf8',
);
if (!transferSrc.includes('isHhaTransferSession') || !transferSrc.includes(', paid absence')) {
  throw new Error('hha-transfer.ts missing paid-absence HHA inclusion — abort');
}

console.log('building shared + tms-db…');
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-paid-absence-hha`;
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
assertAmAndPlcBundleMarkers(bundled, 'paid-absence-hha bundle');
assertAlreadyBilledBundleMarkers(bundled, 'paid-absence-hha bundle');
assertVisitDateCoverBundleMarkers(bundled, 'paid-absence-hha bundle');
assertNoSchoolBillingStripFallback(bundled, 'paid-absence-hha bundle');
if (!bundled.includes(', paid absence') || !bundled.includes('paid_absence')) {
  throw new Error('Bundle missing paid-absence HHA marker — aborting deploy');
}
if (!bundled.includes('1 Placeholder St') || !bundled.includes('createPatient')) {
  throw new Error('Bundle missing no-child patient path — aborting deploy');
}
if (!bundled.includes('the service code stays') || !bundled.includes('Do not use an individual')) {
  throw new Error('Bundle missing group-code markers — aborting deploy');
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
execSync(`${aws} lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

const afterEnv = JSON.parse(
  execSync(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT}" --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION changed: ${JSON.stringify(afterEnv)}`);
}
if (String(afterEnv.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_MOCK is true: ${JSON.stringify(afterEnv)}`);
}
if (afterEnv.TMS_GIT_SHA !== gitSha) {
  throw new Error(`LIVE_OK failed: TMS_GIT_SHA is ${afterEnv.TMS_GIT_SHA}, expected ${gitSha}`);
}

const summary = [
  'LIVE_OK: paid absences stored as missed are sent to HHA',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. Attended and makeup sessions still transfer',
  '2. Paid absence (additional service, or notes/service labeled paid absence) transfers even when attendance is missed',
  '3. A real child is scheduled on that child; no child creates a new "no child" patient on that week contract',
  '4. Pay is the additional-services hourly rate prorated by minutes (30 min of $88/hour → $44)',
  '5. Unpaid misses stay off. Existing HHA visits are not cancelled',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-paid-absence-hha-deploy-out.txt'), summary);
console.log('\n' + summary);
