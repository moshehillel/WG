/**
 * LIVE: One Frontline visit printed twice (97110x1 + 97112x1) is one session.
 * Timed units sum. A later visit at a different clock stays separate.
 * Untimed 97150/92507/97165 stay 1 unit. HHA_USE_PRODUCTION unchanged.
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
const outDir = path.join(__dirname, 'tms-api-troy-split-cpt-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-troy-split-cpt.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const aws = process.env.AWS_NO_VERIFY_SSL === '1' ? 'aws --no-verify-ssl' : 'aws';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const parseSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'), 'utf8');
if (!parseSrc.includes('function frontlineLeadingCptStart')) {
  throw new Error('session-parse.ts missing leading CPT attach — abort');
}
if (!parseSrc.includes('function mergeFrontlineSplitCptRows')) {
  throw new Error('session-parse.ts missing same-clock CPT merge — abort');
}
if (!parseSrc.includes('function stripFrontlineContinuedPageBanner')) {
  throw new Error('session-parse.ts missing page-banner strip — abort');
}
if (!parseSrc.includes("bits.push('makeup session')")) {
  throw new Error('session-parse.ts missing makeup-session note keep — abort');
}
if (!parseSrc.includes('function looksLikeFrontlineSessionRowAfterDate')) {
  throw new Error('session-parse.ts missing next-row date keep — abort');
}

const overlapSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-overlap.ts'), 'utf8');
if (!overlapSrc.includes("trim() === '97150'")) {
  throw new Error('session-overlap does not treat CPT 97150 as a group — abort');
}

sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const parseDist = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/dist/session-parse.js'), 'utf8');
if (!parseDist.includes('frontlineLeadingCptStart') || !parseDist.includes('mergeFrontlineSplitCptRows')) {
  throw new Error('tms-db dist missing Troy split-CPT helpers — abort');
}

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

const gitSha = `${readGitSha()}-troy-split-cpt`;
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
assertAmAndPlcBundleMarkers(bundled, 'troy-split-cpt bundle');
assertAlreadyBilledBundleMarkers(bundled, 'troy-split-cpt bundle');
assertVisitDateCoverBundleMarkers(bundled, 'troy-split-cpt bundle');
assertNoSchoolBillingStripFallback(bundled, 'troy-split-cpt bundle');
if (!bundled.includes('need ') || !bundled.includes('unit(s)')) {
  throw new Error('Bundle missing CPT duration error strings — abort');
}
if (!bundled.includes('97150')) {
  throw new Error('Bundle missing CPT 97150 — abort');
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
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION is not true after deploy: ${JSON.stringify(afterEnv)}`);
}

const summary = [
  'TMS Troy split CPT — 97110x1 + 97112x1 is one 30-min session',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Fixed:',
  '- Same child + date + start + end printed once per CPT is one session',
  '- 97110 x1 and 97112 x1 together cover 30 minutes',
  '- A visit at a different time stays separate',
  '- Untimed 97150 / 92507 / 97165 do not cover extra timed minutes',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-troy-split-cpt-deploy-out.txt'), summary);
console.log('\n' + summary);
