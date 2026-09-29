/**
 * LIVE: Sum timed CPT units across Frontline split rows for the same session.
 * 97110x1 + 97116x1 on a 30-min visit must pass; single 97116x1 still fails;
 * untimed 97150/92507/92508 stay 1-per-session.
 * Keeps Frontline page-break signature fix (Netra Patel). HHA_USE_PRODUCTION unchanged.
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
const outDir = path.join(__dirname, 'tms-api-multi-cpt-duration-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-multi-cpt-duration.zip');
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
if (!/function timedCptUnits/.test(validateSrc) || !/function combineCptCoverages/.test(validateSrc)) {
  throw new Error('session-upload-validate.ts missing timedCptUnits/combineCptCoverages — abort');
}
if (!/'97150'/.test(validateSrc) || !/'92507'/.test(validateSrc)) {
  throw new Error('session-upload-validate.ts missing untimed CPT set — abort');
}

const parseSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'), 'utf8');
if (!/sessionClockWindowKey/.test(parseSrc) || !/combineCptCoverages/.test(parseSrc)) {
  throw new Error('session-parse.ts missing multi-CPT merge clock window — abort');
}
if (
  !parseSrc.includes('isFrontlinePageBreakStudentHeader') ||
  !parseSrc.includes('page-break Student Name')
) {
  throw new Error('session-parse missing page-break signature fix — abort (do not drop Netra fix)');
}

console.log('building @white-glove/tms-db…');
sh('npm run build -w @white-glove/tms-db');

const validateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/session-upload-validate.js'),
  'utf8',
);
if (!validateDist.includes('timedCptUnits') || !validateDist.includes('combineCptCoverages')) {
  throw new Error('dist session-upload-validate.js missing timed CPT helpers — abort');
}
console.log('dist guard: timed CPT helpers present');

const gitSha = `${readGitSha()}-multi-cpt-duration`;
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
assertAmAndPlcBundleMarkers(bundled, 'multi-cpt-duration bundle');
assertAlreadyBilledBundleMarkers(bundled, 'multi-cpt-duration bundle');
assertVisitDateCoverBundleMarkers(bundled, 'multi-cpt-duration bundle');
assertNoSchoolBillingStripFallback(bundled, 'multi-cpt-duration bundle');
if (!bundled.includes('97150') || !bundled.includes('92507')) {
  throw new Error('Bundle missing untimed CPT markers — aborting deploy');
}
// Runtime strings from cptDurationError / merge
if (!bundled.includes('need ') || !bundled.includes('unit(s)')) {
  throw new Error('Bundle missing CPT duration error strings — abort');
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

const summary = [
  'TMS multi-CPT timed units — sum same-session codes for duration',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. Timed CPT rows on the same child+date+clock window are merged; units sum',
  '2. 97110x1 + 97116x1 covers a 30-min session',
  '3. Single 97116x1 on 30 min still fails (need 2)',
  '4. Untimed 97150/92507/92508 still 1 unit per session',
  '5. Frontline page-break signature keep (Netra) preserved',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-multi-cpt-duration-deploy-out.txt'), summary);
console.log('\n' + summary);
