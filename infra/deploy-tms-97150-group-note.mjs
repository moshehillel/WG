/**
 * LIVE_OK: Frontline 2:1 (or other N:1) and CPT 97150 are group sessions.
 * They do not require a no-peer note when the partner is not in this file.
 * True 1:1 / individual CPT still does. HHA_USE_PRODUCTION unchanged.
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
const outDir = path.join(__dirname, 'tms-api-97150-group-note-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-97150-group-note.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const aws = process.env.AWS_NO_VERIFY_SSL === '1' ? 'aws --no-verify-ssl' : 'aws';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const paySrc = path.join(repoRoot, 'packages/hha-client/src/pay-code-resolve.ts');
const payDist = path.join(repoRoot, 'packages/hha-client/dist/pay-code-resolve.js');
sh(
  `npx esbuild ${JSON.stringify(paySrc)} --outfile=${JSON.stringify(payDist)} --format=esm --platform=node --target=node22`,
);

const resolveSrc = path.join(repoRoot, 'packages/hha-client/src/resolve-service-code-order.ts');
const resolveDist = path.join(repoRoot, 'packages/hha-client/dist/resolve-service-code-order.js');
sh(
  `npx esbuild ${JSON.stringify(resolveSrc)} --outfile=${JSON.stringify(resolveDist)} --format=esm --platform=node --target=node22`,
);
if (fs.readFileSync(resolveDist, 'utf8').includes('stripSchoolBillingDurationBucket')) {
  throw new Error('dist still has stripSchoolBillingDurationBucket — abort');
}

const overlapSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/session-overlap.ts'),
  'utf8',
);
if (!overlapSrc.includes("trim() === '97150'")) {
  throw new Error('session-overlap does not treat CPT 97150 as a group — abort');
}
if (!overlapSrc.includes('looks === false) return false')) {
  throw new Error('session-overlap lets 1:1 override 97150 — abort');
}

const parseSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'),
  'utf8',
);
if (!parseSrc.includes('frontlineRatioBeforeServiceDate')) {
  throw new Error('session-parse does not read a ratio printed before the service date — abort');
}
if (!parseSrc.includes('serviceTypeForFrontlineRow')) {
  throw new Error('session-parse does not mark 97150 rows as group — abort');
}
const parseDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/session-parse.js'),
  'utf8',
);
if (!parseDist.includes('frontlineRatioBeforeServiceDate')) {
  throw new Error('tms-db dist missing ratio-before-date reader — abort');
}

const gitSha = `${readGitSha()}-97150-group-note`;
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
assertAmAndPlcBundleMarkers(bundled, '97150-group-note bundle');
assertAlreadyBilledBundleMarkers(bundled, '97150-group-note bundle');
assertVisitDateCoverBundleMarkers(bundled, '97150-group-note bundle');
assertNoSchoolBillingStripFallback(bundled, '97150-group-note bundle');
if (!bundled.includes('seen individually')) {
  throw new Error('bundled missing #38 locker message — abort');
}
if (!bundled.includes('97150')) {
  throw new Error('bundled missing CPT 97150 group marker — abort');
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
  'TMS 2:1 and CPT 97150 count as group for locker #38',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Fixed:',
  '- Ratio N:1 with N>=2, including a ratio printed before the service date, is a group session',
  '- CPT 97150 with no 1:1 tag is a group session and does not demand a no-peer sentence',
  '- True 1:1 / individual CPT still requires the no-peer note',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-97150-group-note-deploy-out.txt'), summary);
console.log('\n' + summary);
