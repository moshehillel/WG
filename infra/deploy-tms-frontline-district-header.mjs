/**
 * Re-apply: Frontline Setting "Student is Parentally Placed in a Nonpublic School"
 * is not a school. Match District/Agency/BOCES (e.g. Hicksville UFSD) to the
 * child's program type / school.district.
 * Prior live deploy gets overwritten by later bundles that lack this source change.
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
const outDir = path.join(__dirname, 'tms-api-frontline-district-header-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-frontline-district-header.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const parseSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'),
  'utf8',
);
if (!/parentally placed/.test(parseSrc) || !/extractDistrictAgencyHeader/.test(parseSrc)) {
  throw new Error('session-parse.ts missing district-header / parental-placement guard — abort');
}
if (!/location \|\| reportSchool \|\| districtHeader/.test(parseSrc)) {
  throw new Error('session-parse.ts missing districtHeader fallback — abort');
}

console.log('building @white-glove/tms-db…');
sh('npm run build -w @white-glove/tms-db');
const parseDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/session-parse.js'),
  'utf8',
);
if (!parseDist.includes('parentally placed') || !parseDist.includes('extractDistrictAgencyHeader')) {
  throw new Error('packages/tms-db/dist/session-parse.js missing district header parser — abort');
}
console.log('dist guard: district header + parental placement present');

const gitSha = `${readGitSha()}-frontline-district-header`;
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
assertAmAndPlcBundleMarkers(bundled, 'frontline-district-header bundle');
assertAlreadyBilledBundleMarkers(bundled, 'frontline-district-header bundle');
assertVisitDateCoverBundleMarkers(bundled, 'frontline-district-header bundle');
assertNoSchoolBillingStripFallback(bundled, 'frontline-district-header bundle');
if (!bundled.includes('parentally placed') || !bundled.includes('nonpublic school')) {
  throw new Error('Bundle missing parental-placement Setting guard — aborting deploy');
}
if (!bundled.includes('District\\s*\\/\\s*Agency')) {
  throw new Error('Bundle missing District/Agency header extractor — aborting deploy');
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
  'TMS Frontline district header — ignore parental-placement Setting',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Rules:',
  '1. Setting "Student is Parentally Placed in a Nonpublic School" is not a school name',
  '2. District/Agency/BOCES header (e.g. Hicksville UFSD) is used when no building is present',
  '3. Match accepts when that district matches program type or school.district',
  '4. A real building name still has to match the child school',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-frontline-district-header-deploy-out.txt'), summary);
console.log('\n' + summary);
