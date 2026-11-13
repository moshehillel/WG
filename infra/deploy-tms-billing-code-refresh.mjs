/**
 * LIVE: on a contract billing-code cache miss, re-read GetBillingServiceCodes once
 * and retry the same case-insensitive name match.
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

process.env.AWS_NO_VERIFY_SSL = '1';
const aws = 'aws --no-verify-ssl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-billing-code-refresh-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-billing-code-refresh.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const MARKER = 'billing codes refreshed after cache miss';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

function fnConfig() {
  return JSON.parse(
    execSync(
      `${aws} lambda get-function-configuration --function-name ${fnName} --query "{LastModified:LastModified,LastUpdateStatus:LastUpdateStatus,State:State,HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
      { encoding: 'utf8' },
    ),
  );
}

const adapterSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/soap-adapter.ts'),
  'utf8',
);
if (!adapterSrc.includes(MARKER)) {
  throw new Error('soap-adapter.ts missing billing-code refresh — abort');
}

console.log('building shared and tms-db…');
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');
// hha-client tsc currently fails on unrelated missing ent-*.ts files.
// Transpile only the adapter so dist/index.js (already built) picks up this change.
sh(
  `npx esbuild packages/hha-client/src/soap-adapter.ts --outfile=packages/hha-client/dist/soap-adapter.js --format=esm --platform=node --target=node22`,
);
const adapterDist = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/dist/soap-adapter.js'),
  'utf8',
);
if (!adapterDist.includes(MARKER)) {
  throw new Error('hha-client dist missing billing-code refresh — abort');
}

const before = fnConfig();
console.log('lambda before:', before);
if (before.LastUpdateStatus === 'InProgress' || before.State !== 'Active') {
  throw new Error(
    `Refusing deploy: function is ${before.State} / ${before.LastUpdateStatus}. Another update is in progress.`,
  );
}
if (String(before.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${before.HHA_USE_PRODUCTION}`);
}

const gitSha = `${readGitSha()}-billing-code-refresh`;
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
assertAmAndPlcBundleMarkers(bundled, 'billing-code-refresh bundle');
assertAlreadyBilledBundleMarkers(bundled, 'billing-code-refresh bundle');
assertVisitDateCoverBundleMarkers(bundled, 'billing-code-refresh bundle');
assertNoSchoolBillingStripFallback(bundled, 'billing-code-refresh bundle');
if (!bundled.includes(MARKER)) {
  throw new Error('Bundle missing billing-code refresh marker — aborting deploy');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

const mid = fnConfig();
if (mid.LastModified !== before.LastModified || mid.TMS_GIT_SHA !== before.TMS_GIT_SHA) {
  throw new Error(
    `Refusing deploy: lambda changed during build (${before.TMS_GIT_SHA} @ ${before.LastModified} → ${mid.TMS_GIT_SHA} @ ${mid.LastModified}). Another deploy landed.`,
  );
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { cwd: __dirname },
);

const codeOut = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('code', codeOut.trim());
stampLambdaGitEnv(fnName, { sha: gitSha });

const after = fnConfig();
const summary = [
  'TMS billing codes: refresh GetBillingServiceCodes once when a cached contract list misses',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(before)}`,
  `HHA after: ${JSON.stringify(after)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. Contract billing codes stay cached for the life of the Lambda process',
  '2. A name miss against that snapshot re-reads HHA once and retries the same name match',
  '3. "PT School eval" matches "PT School Eval"; "PT additional services 60" matches "PT Additional Services 60"',
  '4. A shorter or different code is not accepted (PT School does not match PT School Eval)',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-billing-code-refresh-deploy-out.txt'), summary);
console.log('\n' + summary);
