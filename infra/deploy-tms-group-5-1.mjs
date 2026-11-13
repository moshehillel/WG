/**
 * LIVE: 5:1 (and any N:1, N>=2) bills and pays as a group when peers are present.
 * A 5:1 row was going out as individual PT school 30 and HHA rejected the overlap.
 * HHA_USE_PRODUCTION left unchanged.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';
import { assertAmPlcSchoolAnd401BundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-group-5-1-asset');
const stageDir = path.join(__dirname, '_zip_stage_group_5_1');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-group-5-1.zip');
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

const paySrc = fs.readFileSync(path.join(repoRoot, 'packages/shared/src/config/pay-codes.ts'), 'utf8');
if (!paySrc.includes('n >= 2')) {
  throw new Error('pay-codes.ts missing N:1 >= 2 group detection — abort');
}
const providerPay = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/provider-pay.ts'), 'utf8');
if (!providerPay.includes('serviceTypeLooksGroup')) {
  throw new Error('provider-pay.ts missing serviceTypeLooksGroup — abort');
}

sh('npm run build -w @white-glove/shared -w @white-glove/tms-db');

const payDist = fs.readFileSync(path.join(repoRoot, 'packages/shared/dist/config/pay-codes.js'), 'utf8');
if (!payDist.includes('n >= 2')) {
  throw new Error('shared dist pay-codes.js missing N:1 >= 2 — build failed or stale');
}

const gitSha = `${readGitSha()}-group-5-1`;
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
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'group-5-1 bundle');
if (!hasSeenIndividuallyMatcher(bundled)) {
  throw new Error('bundled missing group mandate seen-individually matcher — abort');
}
if (!bundled.includes('\\d+)\\s*:\\s*1') || !bundled.includes('n>=2')) {
  throw new Error('bundled missing N:1 group ratio — abort');
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
if (String(afterEnv.TMS_GIT_SHA || '') !== gitSha) {
  throw new Error(`TMS_GIT_SHA mismatch: ${afterEnv.TMS_GIT_SHA} vs ${gitSha}`);
}

const summary = [
  'TMS: treat 5:1 (any N:1 with N>=2) as a group for HHA billing and pay',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-group-5-1-deploy-out.txt'), summary);
console.log('\n' + summary);
console.log('LIVE_OK CodeSize=', codeSize, 'SHA=', gitSha);
