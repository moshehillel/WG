/**
 * LIVE_OK: solo/no-peer → individual service code AND individual pay
 * (never group-bill + individual-pay). Keeps AM+plc+401; no school bare-Group strip.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-solo-individual-billing-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-solo-individual-billing.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

sh('npm run build -w @white-glove/shared');

const paySrc = path.join(repoRoot, 'packages/hha-client/src/pay-code-resolve.ts');
const payDist = path.join(repoRoot, 'packages/hha-client/dist/pay-code-resolve.js');
const payTxt = fs.readFileSync(paySrc, 'utf8');
if (!payTxt.includes('firstExact') || !payTxt.includes('AM ${stDisc}')) {
  throw new Error('pay-code-resolve missing Group→AM fallback — abort');
}
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

const mandateSrc = path.join(repoRoot, 'packages/tms-db/src/mandate.ts');
const mandateDist = path.join(repoRoot, 'packages/tms-db/dist/mandate.js');
sh(
  `npx esbuild ${JSON.stringify(mandateSrc)} --outfile=${JSON.stringify(mandateDist)} --format=esm --platform=node --target=node22 --packages=external`,
);

const transferSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'),
  'utf8',
);
if (!transferSrc.includes('useGroupBilling') || !transferSrc.includes('never bill group while paying individual')) {
  throw new Error('hha-transfer missing solo→individual billing alignment — abort');
}
if (!transferSrc.includes('mandateMinutes ?? clockMinutes')) {
  throw new Error('hha-transfer missing clock duration fallback');
}

const gitSha = `${readGitSha()}-solo-indiv-bill`;
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
assertAmAndPlcBundleMarkers(bundled, 'solo-indiv-bill bundle');
assertAlreadyBilledBundleMarkers(bundled, 'solo-indiv-bill bundle');
assertVisitDateCoverBundleMarkers(bundled, 'solo-indiv-bill bundle');
assertNoSchoolBillingStripFallback(bundled, 'solo-indiv-bill bundle');
// useGroupBilling is a local; minify renames it — source gate above is the check.
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
  'TMS solo/no-peer → individual service + individual pay',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Fixed:',
  '- Solo/no-peer (individual pay path) now uses PT school 30 (not PT school group 30)',
  '- Multi-peer groups still use group billing + group/AM pay',
  '',
  'Still removed:',
  '- Valley Stream PT school group 30 → bare PT School Group strip fallback',
  '',
  'Kept: AM pay, placement cover/-74, Already Billed -401, visitDate cover, clock duration fallback',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-solo-individual-billing-deploy-out.txt'), summary);
console.log('\n' + summary);
