/**
 * LIVE: Upload school match uses district membership (school.district /
 * programType directory peers), not building-name equality alone.
 * Same-district buildings (Westbury Middle vs Drexel Avenue) allowed.
 * Cross-district (Elmont vs Valley Stream) still blocked.
 * Homeschooled allowance unchanged. Overlap / makeup rules unchanged.
 * Does NOT change HHA_USE_PRODUCTION. Does not create or change HHA visits.
 * Netlify not deployed.
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
const outDir = path.join(__dirname, 'tms-api-district-school-match-asset');
const stageDir = path.join(__dirname, '_zip_stage_district_school_match');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-district-school-match.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const parseSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'), 'utf8');
if (!parseSrc.includes('sameDistrictSchoolNames')) {
  throw new Error('session-parse missing sameDistrictSchoolNames peer opts — abort');
}
if (!parseSrc.includes('isHomeschooledSchoolName')) {
  throw new Error('session-parse missing homeschooled school allowance — abort');
}

const districtsSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/districts.ts'), 'utf8');
if (!districtsSrc.includes('export function sameDistrictSchoolNames')) {
  throw new Error('districts.ts missing sameDistrictSchoolNames — abort');
}

sh('npm run build -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-district-school-match`;
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
assertAmAndPlcBundleMarkers(bundled, 'district-school-match bundle');
assertAlreadyBilledBundleMarkers(bundled, 'district-school-match bundle');
assertVisitDateCoverBundleMarkers(bundled, 'district-school-match bundle');
assertNoSchoolBillingStripFallback(bundled, 'district-school-match bundle');
if (!bundled.includes('sameDistrictSchoolNames')) {
  throw new Error('bundled missing sameDistrictSchoolNames — abort');
}
if (!bundled.includes("does not match child's school")) {
  throw new Error('bundled missing ordinary school-mismatch error — abort');
}
if (!bundled.includes('homeschooled')) {
  throw new Error('bundled missing homeschooled school allowance — abort');
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
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT}" --output json`,
    { encoding: 'utf8' },
  ),
);

if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is not true after deploy: ${JSON.stringify(afterEnv)}`);
}

const summary = [
  'TMS upload school match uses district membership',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved (unchanged)',
  'No HHA visit created, cancelled, or changed',
  'Netlify not deployed',
  '',
  'Rule: report school does not conflict when it is a peer building in the',
  "child's district (school.district / programType via district directory).",
  'Westbury Middle School + Drexel Avenue (both Westbury) = allowed.',
  'Elmont vs Valley Stream = still blocked. Homeschooled still allowed.',
  'Overlap and makeup capacity rules unchanged.',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-district-school-match-deploy-out.txt'), summary);
console.log('\n' + summary);
