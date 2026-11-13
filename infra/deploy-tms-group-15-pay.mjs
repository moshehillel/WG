/**
 * LIVE: provider pay allowlist + selection include a 15-minute group rate.
 * Group mandate bucket 15 → payRateGroup15Min (flat), same fallback as group 30.
 * HHA_USE_PRODUCTION unchanged. Does not remove 30/42/45 group or individual rates.
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
const outDir = path.join(__dirname, 'tms-api-group-15-pay-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-group-15-pay.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const paySrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/provider-pay.ts'), 'utf8');
if (!paySrc.includes('payRateGroup15Min')) {
  throw new Error('provider-pay.ts missing payRateGroup15Min — abort');
}
if (!paySrc.includes("if (bucket === 15) return provider.payRateGroup15Min")) {
  throw new Error('provider-pay.ts missing group-15 bucket selection — abort');
}
const routerSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/router.ts'), 'utf8');
if (!routerSrc.includes("'payRateGroup15Min'")) {
  throw new Error('router.ts pay allowlist missing payRateGroup15Min — abort');
}

console.log('building @white-glove/tms-db…');
sh('npm run build -w @white-glove/tms-db');
const payDist = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/dist/provider-pay.js'), 'utf8');
if (!payDist.includes('payRateGroup15Min')) {
  throw new Error('tms-db dist missing payRateGroup15Min — abort');
}

const gitSha = `${readGitSha()}-group-15-pay`;
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
assertAmAndPlcBundleMarkers(bundled, 'group-15-pay bundle');
assertAlreadyBilledBundleMarkers(bundled, 'group-15-pay bundle');
assertVisitDateCoverBundleMarkers(bundled, 'group-15-pay bundle');
assertNoSchoolBillingStripFallback(bundled, 'group-15-pay bundle');
if (!bundled.includes('payRateGroup15Min')) {
  throw new Error('Bundle missing payRateGroup15Min — aborting deploy');
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
  'TMS provider pay: 15-minute group rate (payRateGroup15Min)',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. Admin can save payRateGroup15Min (Group 15 min / PT school group 15)',
  '2. A group visit whose mandate duration buckets to 15 uses that rate when set',
  '3. Empty group-15 rate falls back to hourly, same as an empty group-30 rate',
  '4. Group 30/42/45 and individual 30/42/45 rates are unchanged',
  '5. A 15-minute clock that still matches a 30-minute mandate keeps the group 30 rate',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-group-15-pay-deploy-out.txt'), summary);
console.log('\n' + summary);
