/**
 * Deploy admin HHA transfers report.
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
const outDir = path.join(__dirname, 'tms-api-hha-transfers-report-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-hha-transfers-report.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const reportsDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/reports.js'),
  'utf8',
);
if (!reportsDist.includes('hhaTransfersReport') || !reportsDist.includes('America/New_York')) {
  throw new Error('packages/tms-db/dist/reports.js missing hhaTransfersReport — aborting');
}

const gitSha = readGitSha();

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

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
  define: {
    'process.env.TMS_GIT_SHA': JSON.stringify(gitSha),
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

const bundled = fs.readFileSync(outfile, 'utf8');
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'hha-transfers-report');
if (!bundled.includes('/admin/reports/hha-transfers')) {
  throw new Error('Bundle missing /admin/reports/hha-transfers — aborting deploy');
}
console.log('bundle guard: hha-transfers report + HHA markers OK', 'TMS_GIT_SHA=', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const zipStage = path.join(outDir, 'zip-stage');
fs.mkdirSync(zipStage, { recursive: true });
const staged = path.join(zipStage, 'index.mjs');
fs.copyFileSync(outfile, staged);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${staged.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { cwd: __dirname, stdio: 'inherit' },
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
if (String(beforeEnv.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error('Refusing deploy: HHA_USE_PRODUCTION is not true');
}

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
if (String(envObj.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error(`HHA_USE_MOCK unexpectedly true: ${env}`);
}
if (String(envObj.TMS_GIT_SHA || '') !== gitSha) {
  throw new Error(`TMS_GIT_SHA mismatch: ${envObj.TMS_GIT_SHA} != ${gitSha}`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-hha-transfers-report-deploy-out.txt'),
  [
    'LIVE_OK: Admin HHA transfers report (transfer date, America/New_York)',
    `Function: ${fnName}`,
    `TMS_GIT_SHA: ${gitSha}`,
    `stamp: ${JSON.stringify(stamped)}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    '',
    'Changes:',
    '1. GET /admin/reports/hha-transfers — successful transfers in inclusive ET date range',
    '2. GET /admin/reports/hha-transfers.xlsx',
    '3. FE: Admin → Reports → HHA transfers (app.js?v=144)',
    '',
  ].join('\n'),
);
console.log('LIVE_OK wrote cdk-tms-hha-transfers-report-deploy-out.txt');
