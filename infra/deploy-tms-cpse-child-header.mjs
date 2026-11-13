/**
 * LIVE: Notes upload reader accepts CPSE / Child Treatment Log PDFs where the
 * child name is the labeled `Child:` header at the top of each page.
 * Does NOT change HHA_USE_PRODUCTION. Does not create or change HHA visits.
 * Does not change coordinator ids. Netlify not deployed.
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
const outDir = path.join(__dirname, 'tms-api-cpse-child-header-asset');
const stageDir = path.join(__dirname, '_zip_stage_cpse_child_header');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-cpse-child-header.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const parseSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'), 'utf8');
if (!parseSrc.includes('isCpseChildTreatmentLogText')) {
  throw new Error('session-parse missing CPSE Child Treatment Log detector — abort');
}
if (!parseSrc.includes('parseCpseChildTreatmentLogText')) {
  throw new Error('session-parse missing CPSE Child Treatment Log parser — abort');
}
if (!parseSrc.includes('extractCpseChildHeaderName')) {
  throw new Error('session-parse missing CPSE Child: header extractor — abort');
}
if (!parseSrc.includes('sameDistrictSchoolNames')) {
  throw new Error('session-parse missing same-district school peers (do not revert) — abort');
}

sh('npm run build -w @white-glove/shared -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-cpse-child-header`;
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
assertAmAndPlcBundleMarkers(bundled, 'cpse-child-header bundle');
assertAlreadyBilledBundleMarkers(bundled, 'cpse-child-header bundle');
assertVisitDateCoverBundleMarkers(bundled, 'cpse-child-header bundle');
assertNoSchoolBillingStripFallback(bundled, 'cpse-child-header bundle');
// Minify keeps regex sources, not export names.
if (!bundled.includes('Child\\s+Treatment\\s+Log') && !/Child\\s\+Treatment\\s\+Log/.test(bundled)) {
  throw new Error('bundled missing CPSE Child Treatment Log recognition — abort');
}
if (!bundled.includes('ESID\\s*:') || !bundled.includes('Child\\s*:')) {
  throw new Error('bundled missing CPSE ESID / Child: header binding — abort');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

fs.mkdirSync(stageDir, { recursive: true });
for (const f of fs.readdirSync(stageDir)) fs.unlinkSync(path.join(stageDir, f));
fs.copyFileSync(outfile, path.join(stageDir, 'index.mjs'));
const mapPath = `${outfile}.map`;
if (fs.existsSync(mapPath)) fs.copyFileSync(mapPath, path.join(stageDir, 'index.mjs.map'));
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stageDir, '*').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
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
  'TMS CPSE Child Treatment Log: child name from page-top Child: header',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved (unchanged)',
  'No HHA visit created, cancelled, or changed',
  'Coordinator ids unchanged',
  'Netlify not deployed',
  'No git commit',
  '',
  'Re-upload the CPSE Child Treatment Log PDF (child name at top of each page).',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-cpse-child-header-deploy-out.txt'), summary);
console.log('\n' + summary);
