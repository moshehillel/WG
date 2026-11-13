/**
 * LIVE_OK: Therapist Activity / CPSE "Student Absent" (+ synonyms) map to Frontline
 * missed reasons so Meriwether-style imports are not blocked. Also keep signed+CPT
 * TA rows attended when clinical notes casually say missed/absent.
 * HHA_USE_PRODUCTION left unchanged.
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
const outDir = path.join(__dirname, 'tms-api-ta-missed-reason-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-ta-missed-reason.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const validateSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/session-upload-validate.ts'),
  'utf8',
);
if (!validateSrc.includes('student\\s+absent') || !validateSrc.includes('student\\s+not\\s+in\\s+school')) {
  throw new Error('session-upload-validate missing TA missed-reason synonyms — abort');
}
const parseSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'), 'utf8');
if (!parseSrc.includes('explicitAbsenceLabel')) {
  throw new Error('session-parse missing TA signed+CPT miss guard — abort');
}

sh('npm run build -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-ta-missed-reason`;
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
assertAmAndPlcBundleMarkers(bundled, 'ta-missed-reason bundle');
assertAlreadyBilledBundleMarkers(bundled, 'ta-missed-reason bundle');
assertVisitDateCoverBundleMarkers(bundled, 'ta-missed-reason bundle');
assertNoSchoolBillingStripFallback(bundled, 'ta-missed-reason bundle');
if (!bundled.includes('Student Absence') || !bundled.includes('Missed session needs a Frontline reason')) {
  throw new Error('bundled missing Frontline missed-reason markers — abort');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const packCopy = outfile.replace(/\.mjs$/, '.pack.mjs');
const ps1 = path.join(__dirname, '.zip-ta-missed-reason.ps1');
fs.writeFileSync(
  ps1,
  `
$ErrorActionPreference = 'Stop'
$src = '${outfile.replace(/'/g, "''")}'
$copy = '${packCopy.replace(/'/g, "''")}'
$zipPath = '${zipPath.replace(/'/g, "''")}'
$in = [System.IO.File]::Open($src, 'Open', 'Read', 'ReadWrite')
try {
  $out = [System.IO.File]::Create($copy)
  try { $in.CopyTo($out) } finally { $out.Close() }
} finally { $in.Close() }
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $copy, 'index.mjs') | Out-Null
} finally { $zip.Dispose() }
`,
);
try {
  sh(`powershell -NoProfile -File "${ps1}"`, { cwd: __dirname });
} finally {
  try {
    fs.unlinkSync(ps1);
  } catch {
    /* ignore */
  }
}
if (!fs.existsSync(zipPath)) {
  throw new Error(`Zip was not created: ${zipPath}`);
}

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
  'TMS Therapist Activity missed-reason synonyms (Meriwether / Student Absent)',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Fixes:',
  '1. Student Absent / student not in school / Absent: → Student Absence',
  '2. Provider Absent → Provider Absence',
  '3. Signed+CPT Therapist Activity rows stay attended unless an explicit absence label',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-ta-missed-reason-deploy-out.txt'), summary);
console.log('\n' + summary);
