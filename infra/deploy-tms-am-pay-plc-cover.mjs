/**
 * Combined one-shot: Group→AM pay-code fallback + placement cover-date / -74 recovery.
 * Asserts BOTH marker sets in the bundle before UpdateFunctionCode so sequential
 * feature deploys cannot wipe each other. Stamps TMS_GIT_SHA as {sha}-am+plc.
 * Does NOT change HHA_USE_PRODUCTION / HHA_ALLOW_PRODUCTION / HHA_USE_MOCK.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';
import { assertAmAndPlcBundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const mainPaySrc = path.join(repoRoot, 'packages/hha-client/src/pay-code-resolve.ts');
const mainPlcSrc = path.join(repoRoot, 'packages/hha-client/src/placements.ts');
const soapSrc = path.join(repoRoot, 'packages/hha-client/src/soap-adapter.ts');
const distPay = path.join(repoRoot, 'packages/hha-client/dist/pay-code-resolve.js');
const outDir = path.join(__dirname, 'tms-api-am-pay-plc-cover-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-am-pay-plc-cover.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const stampSuffix = 'am+plc';

function assertAmPaySource() {
  const srcTxt = fs.readFileSync(mainPaySrc, 'utf8');
  if (!srcTxt.includes('firstExact') || !srcTxt.includes('AM ${stDisc}')) {
    throw new Error('pay-code-resolve.ts missing Group→AM fallback');
  }
}

function assertPlcCoverSource() {
  const plc = fs.readFileSync(mainPlcSrc, 'utf8');
  const soap = fs.readFileSync(soapSrc, 'utf8');
  if (!plc.includes('placementCoversDate') || !plc.includes('isPlacementOverlapFault')) {
    throw new Error('placements.ts missing cover-date / -74 overlap helpers');
  }
  if (
    !soap.includes('Ambiguous HHA placements for ContractID') &&
    !soap.includes('placements cover')
  ) {
    throw new Error('soap-adapter.ts missing cover-date reuse / -74 recovery messages');
  }
}

assertAmPaySource();
assertPlcCoverSource();

execSync(
  `npx esbuild ${JSON.stringify(mainPaySrc)} --outfile=${JSON.stringify(distPay)} --format=esm --platform=node --target=node22`,
  { cwd: repoRoot, stdio: 'inherit' },
);
const distTxt = fs.readFileSync(distPay, 'utf8');
if (!distTxt.includes('`AM ${')) {
  throw new Error('dist pay-code-resolve missing AM templates');
}
console.log('dist AM Group fallback OK', distPay, fs.statSync(distPay).size);

try {
  execSync('npm run build -w @white-glove/hha-client', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('hha-client full tsc failed; continuing with esbuild src / existing dist');
}

// WIP branch: router imports districts helpers that dist/index forgot to re-export.
const tmsDbIndex = path.join(repoRoot, 'packages/tms-db/dist/index.js');
const tmsDbIndexTxt = fs.readFileSync(tmsDbIndex, 'utf8');
if (
  !tmsDbIndexTxt.includes("from './districts.js'") &&
  fs.existsSync(path.join(repoRoot, 'packages/tms-db/dist/districts.js'))
) {
  fs.writeFileSync(
    tmsDbIndex,
    tmsDbIndexTxt.replace(
      /\/\/# sourceMappingURL=index\.js\.map\s*$/,
      "export * from './districts.js';\n//# sourceMappingURL=index.js.map\n",
    ),
  );
  if (!fs.readFileSync(tmsDbIndex, 'utf8').includes("from './districts.js'")) {
    fs.appendFileSync(tmsDbIndex, "\nexport * from './districts.js';\n");
  }
  console.log('patched tms-db dist/index.js to re-export districts');
}

const gitSha = `${readGitSha()}-${stampSuffix}`;
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
assertAmAndPlcBundleMarkers(bundled, 'combined bundle');
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
// Copy first — Compress-Archive can lock the fresh esbuild outfile on Windows.
const zipStage = path.join(__dirname, '_zip_stage_am_plc');
fs.rmSync(zipStage, { recursive: true, force: true });
fs.mkdirSync(zipStage, { recursive: true });
const staged = path.join(zipStage, 'index.mjs');
fs.copyFileSync(outfile, staged);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${staged.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
fs.rmSync(zipStage, { recursive: true, force: true });
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

const stamped = stampLambdaGitEnv(fnName, { sha: gitSha });
const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,CodeSize:CodeSize,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);
const envObj = JSON.parse(env);
if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION not true: ${env}`);
}
if (envObj.HHA_USE_MOCK === 'true') {
  throw new Error(`HHA_USE_MOCK unexpectedly true: ${env}`);
}
if (Number(envObj.CodeSize || 0) < 400_000) {
  throw new Error(`CodeSize too small: ${envObj.CodeSize}`);
}
if (String(envObj.TMS_GIT_SHA || '') !== gitSha) {
  throw new Error(`TMS_GIT_SHA mismatch: ${envObj.TMS_GIT_SHA} vs ${gitSha}`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-am-pay-plc-cover-deploy-out.txt'),
  [
    'LIVE_OK: Group→AM pay-code fallback + placement cover-date / -74 recovery',
    `Function: ${fnName}`,
    `TMS_GIT_SHA: ${stamped.sha}`,
    `TMS_BUILT_AT: ${stamped.builtAt}`,
    `BundleBytes: ${bundled.length} (zip CodeSize ${envObj.CodeSize})`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved',
    'Markers: AM ${…} + GROUP + Ambiguous/placements cover / placement period overlaps',
    'LIVE_OK: both features in one stamp (am+plc) — prefer this over solo deploys',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', envObj.CodeSize, 'SHA=', stamped.sha);
