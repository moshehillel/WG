/**
 * LIVE_OK: remove PT school group 30 → bare PT School Group strip-duration fallback.
 * Keeps AM Group→AM pay, placement cover/-74, Already Billed -401, visitDate cover.
 * Keeps clock-duration + "group not available" note match (not strip-related).
 * Does NOT change HHA_USE_PRODUCTION.
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
const outDir = path.join(__dirname, 'tms-api-remove-school-strip-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-remove-school-strip.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

// Keep AM Group→AM pay fallback in dist.
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
const resolveDistTxt = fs.readFileSync(resolveDist, 'utf8');
if (resolveDistTxt.includes('stripSchoolBillingDurationBucket')) {
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
if (!transferSrc.includes('mandateMinutes ?? clockMinutes')) {
  throw new Error('hha-transfer missing clock duration fallback');
}

const gitSha = `${readGitSha()}-no-school-strip`;
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
assertAmAndPlcBundleMarkers(bundled, 'remove-school-strip bundle');
assertAlreadyBilledBundleMarkers(bundled, 'remove-school-strip bundle');
assertVisitDateCoverBundleMarkers(bundled, 'remove-school-strip bundle');
assertNoSchoolBillingStripFallback(bundled, 'remove-school-strip bundle');
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { cwd: __dirname },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const beforeEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
    { encoding: 'utf8' },
  ),
);
console.log('HHA env before (unchanged by this deploy):', beforeEnv);
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
  'TMS REMOVE school billing strip-duration fallback',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Removed:',
  '- PT school group 30 → bare PT School Group (stripSchoolBillingDurationBucket)',
  '',
  'Kept:',
  '- AM Group → AM pay-code fallback',
  '- Placement cover / -74 recovery',
  '- Already Billed (-401) confirm success',
  '- visitDate cover-date reuse',
  '- Clock duration when mandate duration missing',
  '- "Group not available" solo-group note match',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-remove-school-strip-deploy-out.txt'), summary);
console.log('\n' + summary);
