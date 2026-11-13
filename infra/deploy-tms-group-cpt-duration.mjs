/**
 * LIVE: Group sessions (ratio N:1 N≥2 / Group) — 1 CPT unit covers full clock.
 * Keeps 97165–97168 untimed. HHA_USE_PRODUCTION unchanged.
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

// NetFree MITM currently breaks AWS CLI CA trust on this machine.
process.env.AWS_NO_VERIFY_SSL = '1';
const aws = 'aws --no-verify-ssl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-group-cpt-duration-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-group-cpt-duration.zip');
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
if (!/function cptSessionLooksGroup/.test(validateSrc)) {
  throw new Error('session-upload-validate.ts missing cptSessionLooksGroup — abort');
}
if (!/isGroup && coverage\.totalUnits >= 1/.test(validateSrc)) {
  throw new Error('session-upload-validate.ts missing group 1-unit duration path — abort');
}
for (const code of ['97165', '97166', '97167', '97168', '97150']) {
  if (!new RegExp(`'${code}'`).test(validateSrc) || !new RegExp(`UNTIMED_SESSION_CPT[\\s\\S]*${code}`).test(validateSrc)) {
    throw new Error(`session-upload-validate.ts missing ${code} in UNTIMED_SESSION_CPT — abort`);
  }
}

const routerSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/router.ts'), 'utf8');
if (!/serviceType:\s*session\.serviceType,\s*ratio:\s*row\.ratio/.test(routerSrc)) {
  throw new Error('router.ts missing group ratio opts on cptDurationError — abort');
}

console.log('building @white-glove/tms-db…');
sh('npm run build -w @white-glove/tms-db');
const validateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/session-upload-validate.js'),
  'utf8',
);
if (!validateDist.includes('cptSessionLooksGroup')) {
  throw new Error('packages/tms-db/dist/session-upload-validate.js missing cptSessionLooksGroup — abort');
}
console.log('dist guard: cptSessionLooksGroup present');

const gitSha = `${readGitSha()}-group-cpt-duration`;
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
assertAmAndPlcBundleMarkers(bundled, 'group-cpt-duration bundle');
assertAlreadyBilledBundleMarkers(bundled, 'group-cpt-duration bundle');
assertVisitDateCoverBundleMarkers(bundled, 'group-cpt-duration bundle');
assertNoSchoolBillingStripFallback(bundled, 'group-cpt-duration bundle');
// Minify renames helpers; keep string/regex markers that survive esbuild minify.
if (!bundled.includes('groupSession') || !bundled.includes('totalUnits>=1')) {
  throw new Error('Bundle missing group 1-unit duration path — aborting deploy');
}
if (!/\\bgroup\\b\/i\.test/.test(bundled) || !/\\b\(\\d\+\)\\s\*:\\s\*1\\b/.test(bundled)) {
  throw new Error('Bundle missing group ratio detection regex — aborting deploy');
}
if (!bundled.includes('serviceType') || !/\.ratio/.test(bundled)) {
  throw new Error('Bundle missing serviceType/ratio opts wiring — aborting deploy');
}
for (const code of ['97165', '97150']) {
  if (!bundled.includes(code)) {
    throw new Error(`Bundle missing ${code} — aborting deploy`);
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
  'TMS group CPT duration — 1 unit covers full group visit',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. Group sessions (ratio 2:1/3:1/… or Group service type): 1 CPT unit covers full clock',
  '2. Applies regardless of CPT code (97150, 97165, 97110, etc.)',
  '3. 97165–97168 remain untimed for individual eval visits',
  '4. Individual timed codes still need 1 unit per 15 minutes',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-group-cpt-duration-deploy-out.txt'), summary);
console.log('\n' + summary);
