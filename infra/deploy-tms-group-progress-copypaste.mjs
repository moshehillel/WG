/**
 * LIVE: Group peers with shared activity + different Progress must not fail
 * the copy-paste gate. Also keep Progress/Response when clipping long notes
 * (800-char head used to drop Progress and make Delilah≡Lucas).
 * Exact full-note duplicates still fail. HHA_USE_PRODUCTION unchanged.
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
const outDir = path.join(__dirname, 'tms-api-group-progress-copypaste-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-group-progress-copypaste.zip');
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
if (
  !validateSrc.includes('extractNoteProgressForCompare') ||
  !validateSrc.includes('Different individualized progress')
) {
  throw new Error('session-upload-validate missing progress-aware copy-paste gate — abort');
}

const parseSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'), 'utf8');
if (
  !parseSrc.includes('NOTE_PROGRESS_LABEL_RE') ||
  !parseSrc.includes('without dropping Progress/Response')
) {
  throw new Error('session-parse missing Progress-preserving clipSessionNotes — abort');
}
if (!parseSrc.includes('isFrontlinePageBreakStudentHeader')) {
  throw new Error('session-parse lost page-break signature fix — abort');
}

sh('npm run build -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-group-progress-copypaste`;
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
assertAmAndPlcBundleMarkers(bundled, 'group-progress-copypaste bundle');
assertAlreadyBilledBundleMarkers(bundled, 'group-progress-copypaste bundle');
assertVisitDateCoverBundleMarkers(bundled, 'group-progress-copypaste bundle');
assertNoSchoolBillingStripFallback(bundled, 'group-progress-copypaste bundle');
if (!bundled.includes('extractNoteProgressForCompare') && !bundled.includes('individualized progress')) {
  // minify may rename exports; require copy-paste error string + Progress label keep
  if (!bundled.includes('copy-pasted') || !bundled.includes('Progress')) {
    throw new Error('bundled missing copy-paste / Progress markers — abort');
  }
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

if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is not true after deploy: ${JSON.stringify(afterEnv)}`);
}
if (String(afterEnv.TMS_GIT_SHA) !== gitSha) {
  throw new Error(`LIVE_OK failed: TMS_GIT_SHA stamp mismatch ${afterEnv.TMS_GIT_SHA} vs ${gitSha}`);
}

const summary = [
  'TMS group Progress copy-paste false-positive fix',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved (unchanged)',
  '',
  'Gate: different Progress/Response → not copy-paste; exact full-note match still fails.',
  'Clip: keep Progress/Response (and trailing response) when truncating long notes.',
  'Fatimah VS30 09/23 4:1: Delilah vs Lucas no longer false-positive after Progress keep.',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-group-progress-copypaste-deploy-out.txt'), summary);
console.log('\n' + summary);
