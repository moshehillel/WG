/**
 * Re-apply: CPT 92507 (and 92508) are untimed — 1 unit per session.
 * Keep source+live aligned so later deploys cannot revive timed-unit checks.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-cpt-92507-untimed-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-cpt-92507-untimed.zip');
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
if (!/'92507'/.test(validateSrc) || !/UNTIMED_SESSION_CPT[\s\S]*92507/.test(validateSrc)) {
  throw new Error('session-upload-validate.ts missing 92507 in UNTIMED_SESSION_CPT — abort');
}
if (!/'92508'/.test(validateSrc) || !/UNTIMED_SESSION_CPT[\s\S]*92508/.test(validateSrc)) {
  throw new Error('session-upload-validate.ts missing 92508 in UNTIMED_SESSION_CPT — abort');
}

console.log('building @white-glove/tms-db…');
sh('npm run build -w @white-glove/tms-db');
const validateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/session-upload-validate.js'),
  'utf8',
);
if (!validateDist.includes('92507') || !validateDist.includes('92508')) {
  throw new Error('packages/tms-db/dist/session-upload-validate.js missing 92507/92508 — abort');
}
console.log('dist guard: 92507 + 92508 present');

const gitSha = `${readGitSha()}-cpt-92507-untimed`;
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
assertAmAndPlcBundleMarkers(bundled, 'cpt-92507-untimed bundle');
assertAlreadyBilledBundleMarkers(bundled, 'cpt-92507-untimed bundle');
assertVisitDateCoverBundleMarkers(bundled, 'cpt-92507-untimed bundle');
assertNoSchoolBillingStripFallback(bundled, 'cpt-92507-untimed bundle');
if (!bundled.includes('92507') || !/92507.{0,80}92508/.test(bundled)) {
  throw new Error('Bundle missing 92507/92508 untimed pair — aborting deploy');
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

const summary = [
  'TMS CPT 92507 untimed — single unit covers session duration',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. 92507/92508 treated as untimed/session-based (1 unit per visit)',
  '2. Individual speech visits with CPT 92507x1 pass duration locker for any length',
  '3. Timed codes (97110 etc.) still need 1 unit per 15 minutes',
  '4. Non-therapy NxN tokens (room/case ids) no longer eclipse 92507',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-cpt-92507-untimed-deploy-out.txt'), summary);
console.log('\n' + summary);
