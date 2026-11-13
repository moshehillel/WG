/**
 * LIVE: Accept "Group Mandate- seen individually" as a solo-group note.
 * Clears the individual-visit locker. Explicit 2:1 / 3:1 still does not need it.
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
const outDir = path.join(__dirname, 'tms-api-group-mandate-seen-individually-asset');
const stageDir = path.join(__dirname, '_zip_stage_group_mandate_seen');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-group-mandate-seen-individually.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
function hasSeenIndividuallyMatcher(text) {
  const oneSlash = text.includes('group\\s+mandate') && text.includes('seen\\s+individually');
  const twoSlash = text.includes('group\\\\s+mandate') && text.includes('seen\\\\s+individually');
  return oneSlash || twoSlash;
}

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const mandateSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/mandate.ts'),
  'utf8',
);
if (!mandateSrc.includes('Group Mandate- seen individually') || !hasSeenIndividuallyMatcher(mandateSrc)) {
  throw new Error('mandate.ts missing Group Mandate- seen individually matcher — abort');
}

sh('npm run build -w @white-glove/shared -w @white-glove/tms-db');

const mandateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/mandate.js'),
  'utf8',
);
if (!hasSeenIndividuallyMatcher(mandateDist)) {
  throw new Error('packages/tms-db/dist/mandate.js missing group-mandate phrase — build failed or stale');
}

const gitSha = `${readGitSha()}-group-mandate-seen`;
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
assertAmAndPlcBundleMarkers(bundled, 'group-mandate-seen bundle');
assertAlreadyBilledBundleMarkers(bundled, 'group-mandate-seen bundle');
assertVisitDateCoverBundleMarkers(bundled, 'group-mandate-seen bundle');
assertNoSchoolBillingStripFallback(bundled, 'group-mandate-seen bundle');
if (!hasSeenIndividuallyMatcher(bundled)) {
  throw new Error('bundled missing group mandate seen-individually matcher — abort');
}
if (!bundled.includes('seen individually')) {
  throw new Error('bundled missing #38 locker message — abort');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

fs.mkdirSync(stageDir, { recursive: true });
for (const f of fs.readdirSync(stageDir)) fs.unlinkSync(path.join(stageDir, f));
fs.copyFileSync(outfile, path.join(stageDir, 'index.mjs'));
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stageDir, 'index.mjs').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
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
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is ${afterEnv.HHA_USE_PRODUCTION}`);
}
if (String(afterEnv.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error('LIVE_OK failed: HHA_USE_MOCK unexpectedly true');
}
const codeSize = Number(afterEnv.CodeSize || 0);
if (codeSize < 400_000) {
  throw new Error(`CodeSize ${codeSize} looks truncated — abort`);
}

const summary = [
  'TMS: accept "Group Mandate- seen individually" as a solo-group note',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved',
  '',
  'Changes:',
  '1. notesMentionNoPeerAvailable accepts Group Mandate- seen individually',
  '2. Variants: hyphen, en dash, em dash, colon, extra spaces, case insensitive',
  '3. True 1:1 / no group ratio clears the no-peer locker; 2:1 and 3:1 still do not need the phrase',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-group-mandate-seen-individually-deploy-out.txt'), summary);
console.log('\n' + summary);
console.log('LIVE_OK CodeSize=', codeSize, 'SHA=', gitSha);
