/**
 * CreateSchedule: a 60-minute visit is Hours=1 Minutes=0.
 * Hours=0 Minutes=60 is HHA ErrorID=-11 Internal Server Error.
 * LIVE_OK — HHA_USE_PRODUCTION unchanged. Do not commit.
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
const outDir = path.join(__dirname, 'tms-api-schedule-hours-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-schedule-hours.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const src = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/schedule-builder.ts'),
  'utf8',
);
if (!src.includes('const hours = Math.floor(totalMinutes / 60)')) {
  throw new Error('schedule-builder.ts missing 60-minute Hours/Minutes split — abort');
}
if (src.includes('<Hours>0</Hours>')) {
  throw new Error('schedule-builder.ts still hardcodes Hours 0 — abort');
}

console.log('building shared + tms-db…');
sh('npm run build -w @white-glove/shared -w @white-glove/tms-db');
// hha-client `tsc` currently fails on unrelated missing ENT modules.
// Transpile only the schedule builder the TMS bundle imports.
const scheduleDist = path.join(repoRoot, 'packages/hha-client/dist/schedule-builder.js');
await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/hha-client/src/schedule-builder.ts')],
  outfile: scheduleDist,
  bundle: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
});

const dist = fs.readFileSync(scheduleDist, 'utf8');
if (!dist.includes('<Hours>${hours}</Hours>') || dist.includes('<Hours>0</Hours>')) {
  throw new Error('hha-client dist schedule-builder.js missing Hours split — abort');
}

const gitSha = `${readGitSha()}-schedule-hours`;
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
assertAmAndPlcBundleMarkers(bundled, 'schedule-hours bundle');
assertAlreadyBilledBundleMarkers(bundled, 'schedule-hours bundle');
assertVisitDateCoverBundleMarkers(bundled, 'schedule-hours bundle');
assertNoSchoolBillingStripFallback(bundled, 'schedule-hours bundle');
if (bundled.includes('<Hours>0</Hours>')) {
  throw new Error('Bundle still hardcodes PrimaryBillTo Hours 0 — aborting deploy');
}
if (!/<Hours>\$\{[^}]+\}<\/Hours>/.test(bundled) || !/<Minutes>\$\{[^}]+\}<\/Minutes>/.test(bundled)) {
  throw new Error('Bundle missing dynamic PrimaryBillTo Hours/Minutes — aborting deploy');
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
  'TMS CreateSchedule 60-minute visits use Hours=1 Minutes=0',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. PrimaryBillTo Minutes stays 0-59. A 60-minute visit is Hours 1, Minutes 0.',
  '2. 30-minute visits stay Hours 0, Minutes 30.',
  '3. Does not create or cancel visits.',
].join('\n');
const summaryPath = path.join(__dirname, 'cdk-tms-schedule-hours-deploy-out.txt');
fs.writeFileSync(summaryPath, summary);
console.log(summary);
