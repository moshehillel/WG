/**
 * Deploy: group-mate -310 says do not cancel the other child.
 * Keeps AM pay + plc cover + school billing + -401 markers.
 * Does NOT change HHA_USE_PRODUCTION / HHA_ALLOW_PRODUCTION / HHA_USE_MOCK.
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
const mainPaySrc = path.join(repoRoot, 'packages/hha-client/src/pay-code-resolve.ts');
const visitConfirmSrc = path.join(repoRoot, 'packages/hha-client/src/visit-confirm.ts');
const soapSrc = path.join(repoRoot, 'packages/hha-client/src/soap-adapter.ts');
const transferSrc = path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts');
const distPay = path.join(repoRoot, 'packages/hha-client/dist/pay-code-resolve.js');
const distVisit = path.join(repoRoot, 'packages/hha-client/dist/visit-confirm.js');
const outDir = path.join(__dirname, 'tms-api-group-overlap-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-group-overlap.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const stampSuffix = 'group-overlap';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const payTxt = fs.readFileSync(mainPaySrc, 'utf8');
if (!payTxt.includes('firstExact') || !payTxt.includes('AM ${stDisc}')) {
  throw new Error('pay-code-resolve missing Group→AM fallback');
}
const vcTxt = fs.readFileSync(visitConfirmSrc, 'utf8');
if (!vcTxt.includes('isAlreadyBilledConfirmFault') || !vcTxt.includes('-401')) {
  throw new Error('visit-confirm missing Already Billed (-401) helpers');
}
const soapTxt = fs.readFileSync(soapSrc, 'utf8');
if (!soapTxt.includes('isAlreadyBilledConfirmFault') || !soapTxt.includes('isVisitAlreadyPayConfirmedXml')) {
  throw new Error('soap-adapter missing -401 / pay-confirmed skip');
}
if (!soapTxt.includes('coverDate') || !soapTxt.includes('contract.visitDate')) {
  throw new Error('soap-adapter missing visitDate cover-date reuse');
}
const xferTxt = fs.readFileSync(transferSrc, 'utf8');
if (!xferTxt.includes('isAlreadyBilledConfirmFault') || !xferTxt.includes('priorVisitIdOk')) {
  throw new Error('hha-transfer missing confirmed skip / -401 heal');
}
if (!xferTxt.includes('visitDate: session.dateOfService')) {
  throw new Error('hha-transfer missing visitDate pass-through for cover reuse');
}
if (!xferTxt.includes('Do not cancel the group mate')) {
  throw new Error('hha-transfer missing group-mate overlap guidance');
}

sh(
  `npx esbuild ${JSON.stringify(mainPaySrc)} --outfile=${JSON.stringify(distPay)} --format=esm --platform=node --target=node22`,
);
sh(
  `npx esbuild ${JSON.stringify(visitConfirmSrc)} --outfile=${JSON.stringify(distVisit)} --format=esm --platform=node --target=node22`,
);
const distSoap = path.join(repoRoot, 'packages/hha-client/dist/soap-adapter.js');
sh(
  `npx esbuild ${JSON.stringify(soapSrc)} --outfile=${JSON.stringify(distSoap)} --format=esm --platform=node --target=node22 --packages=external`,
);

// Keep school strip helper in dist so mainFields resolve it.
const resolveSrc = path.join(repoRoot, 'packages/hha-client/src/resolve-service-code-order.ts');
const resolveDist = path.join(repoRoot, 'packages/hha-client/dist/resolve-service-code-order.js');
sh(
  `npx esbuild ${JSON.stringify(resolveSrc)} --outfile=${JSON.stringify(resolveDist)} --format=esm --platform=node --target=node22`,
);

try {
  sh('npm run build -w @white-glove/shared');
} catch {
  console.warn('shared tsc failed; continuing');
}
try {
  sh('npm run build -w @white-glove/hha-client');
} catch {
  console.warn('hha-client full tsc failed; continuing with esbuild src / existing dist');
}
try {
  sh('npm run build -w @white-glove/tms-db');
} catch {
  console.warn('tms-db tsc failed; esbuild will use src via tms-api resolve if needed');
}

// WIP branch: router imports districts helpers that dist/index forgot to re-export.
const tmsDbIndex = path.join(repoRoot, 'packages/tms-db/dist/index.js');
if (fs.existsSync(tmsDbIndex)) {
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
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'group-overlap bundle');
if (!bundled.includes('Do not cancel the group mate')) {
  throw new Error('bundle missing group-mate overlap guidance');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const zipStage = path.join(__dirname, '_zip_stage_group_overlap');
fs.rmSync(zipStage, { recursive: true, force: true });
fs.mkdirSync(zipStage, { recursive: true });
const staged = path.join(zipStage, 'index.mjs');
fs.copyFileSync(outfile, staged);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${staged.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { cwd: __dirname },
);
fs.rmSync(zipStage, { recursive: true, force: true });
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const beforeEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
    { encoding: 'utf8' },
  ),
);
console.log('HHA env before:', beforeEnv);

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
  path.join(__dirname, 'cdk-tms-group-overlap-deploy-out.txt'),
  [
    'LIVE_OK: group-mate -310 tells ops not to cancel the other child',
    `Function: ${fnName}`,
    `TMS_GIT_SHA: ${stamped.sha}`,
    `TMS_BUILT_AT: ${stamped.builtAt}`,
    `BundleBytes: ${bundled.length} (zip CodeSize ${envObj.CodeSize})`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved',
    'Markers: AM+plc+school+401',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', envObj.CodeSize, 'SHA=', stamped.sha);
