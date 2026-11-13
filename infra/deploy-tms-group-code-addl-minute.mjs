/**
 * LIVE: group visits keep a group service code (no individual 15 fallback).
 * Additional-service pay codes use minutes/60 × hourly (half hour of $88 → $44).
 * HHA_USE_PRODUCTION unchanged. Does not cancel visits.
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
const outDir = path.join(__dirname, 'tms-api-group-code-addl-minute-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-group-code-addl-minute.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const paySrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/provider-pay.ts'), 'utf8');
if (!paySrc.includes('(mins / 60) * hourly')) {
  throw new Error('provider-pay.ts missing additional minute proration — abort');
}
const billingSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/shared/src/config/school-billing-codes.ts'),
  'utf8',
);
if (billingSrc.includes('names.push(individual)')) {
  throw new Error('school-billing-codes.ts still falls back to individual 15 — abort');
}
const transferSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'), 'utf8');
if (!transferSrc.includes('the service code stays')) {
  throw new Error('hha-transfer.ts missing group-code -11 message — abort');
}

console.log('building shared + tms-db…');
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-group-code-addl-minute`;
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
assertAmAndPlcBundleMarkers(bundled, 'group-code-addl-minute bundle');
assertAlreadyBilledBundleMarkers(bundled, 'group-code-addl-minute bundle');
assertVisitDateCoverBundleMarkers(bundled, 'group-code-addl-minute bundle');
assertNoSchoolBillingStripFallback(bundled, 'group-code-addl-minute bundle');
if (!bundled.includes('the service code stays')) {
  throw new Error('Bundle missing group-code message — aborting deploy');
}
if (!bundled.includes('Do not use an individual')) {
  throw new Error('Bundle missing non-group overlap warning — aborting deploy');
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
  'TMS group visits keep a group service code; additional pay is prorated by minutes',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. A group visit does not fall back to individual PT School 15',
  '2. If the contract has no group 15, use the group code it has (PT school group 30) and report ErrorID=-11',
  '3. Additional-service pay code is (minutes/60) × hourly. 30 min of $88/hour looks up ST $44',
  '4. Confirmed visits are not cancelled or resent',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-group-code-addl-minute-deploy-out.txt'), summary);
console.log('\n' + summary);
