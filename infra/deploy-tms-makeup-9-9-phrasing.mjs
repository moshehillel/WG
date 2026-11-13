/**
 * LIVE: Recognize "9/9 makeup session" (date before makeup, yearless M/D).
 * Lucas Martinez Giron / Fatimah Dawan Frontline note shape.
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
const outDir = path.join(__dirname, 'tms-api-makeup-9-9-phrasing-asset');
const stageDir = path.join(__dirname, '_zip_stage_makeup_99');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-makeup-9-9-phrasing.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const makeupDateSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/makeup-date.ts'),
  'utf8',
);
if (
  !makeupDateSrc.includes('inferMakeupCoveredYear') ||
  !makeupDateSrc.includes('DATE_OPT_YEAR') ||
  !/makeup session/.test(makeupDateSrc)
) {
  throw new Error('makeup-date missing yearless / date-before-makeup extract — abort');
}

sh('npm run build -w @white-glove/shared -w @white-glove/tms-db');

const makeupDateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/makeup-date.js'),
  'utf8',
);
if (
  !makeupDateDist.includes('inferMakeupCoveredYear') ||
  !makeupDateDist.includes('extractMakeupForDate')
) {
  throw new Error('packages/tms-db/dist/makeup-date.js missing new extract — build failed or stale');
}

const gitSha = `${readGitSha()}-makeup-9-9-phrasing`;
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
assertAmAndPlcBundleMarkers(bundled, 'makeup-9-9-phrasing bundle');
assertAlreadyBilledBundleMarkers(bundled, 'makeup-9-9-phrasing bundle');
assertVisitDateCoverBundleMarkers(bundled, 'makeup-9-9-phrasing bundle');
assertNoSchoolBillingStripFallback(bundled, 'makeup-9-9-phrasing bundle');
if (
  !bundled.includes('inferMakeupCoveredYear') &&
  !/9\/9 makeup|makeupCoveredYear|DATE_OPT/i.test(bundled)
) {
  // Minify may rename — require makeup covered-date + session markers still present.
  if (!bundled.includes('MAKEUP_COVERED_DATE_PREFIX') && !/make.?up.?session/i.test(bundled)) {
    throw new Error('bundled missing makeup covered-date markers — abort');
  }
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
  throw new Error(`LIVE_OK failed: HHA_USE_MOCK unexpectedly true`);
}
const codeSize = Number(afterEnv.CodeSize || 0);
// Modern esbuild+Compress-Archive zips land ~500–600KB (see frontline-miss-next-dos).
if (codeSize < 400_000) {
  throw new Error(`CodeSize ${codeSize} looks truncated — abort`);
}

const summary = [
  'TMS: recognize "9/9 makeup session" yearless date-before phrasing',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved',
  '',
  'Changes:',
  '1. extractMakeupForDate accepts "9/9 makeup session" (date before makeup)',
  '2. Yearless M/D infers year from the makeup session DOS',
  '3. notesContainMissedDate / dateTokens match bare M/D against full miss DOS',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-makeup-9-9-phrasing-deploy-out.txt'), summary);
console.log('\n' + summary);
console.log('LIVE_OK CodeSize=', codeSize, 'SHA=', gitSha);
