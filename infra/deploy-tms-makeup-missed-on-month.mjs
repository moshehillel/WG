/**
 * LIVE: "Make up session ... missed on September 24" is a makeup and stores that date.
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
const outDir = path.join(__dirname, 'tms-api-makeup-missed-on-month-asset');
const stageDir = path.join(__dirname, '_zip_stage_makeup_missed_on');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-makeup-missed-on-month.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

process.env.AWS_NO_VERIFY_SSL = '1';
const aws = 'aws --no-verify-ssl';

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
  !makeupDateSrc.includes('September') ||
  !makeupDateSrc.includes('MAKEUP_CLEAR_PHRASE_RE') ||
  !/make\[\\s-\]\?up/.test(makeupDateSrc)
) {
  throw new Error('makeup-date missing missed-on month-name extract — abort');
}

sh('npm run build -w @white-glove/shared -w @white-glove/tms-db');

const makeupDateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/makeup-date.js'),
  'utf8',
);
if (!makeupDateDist.includes('inferMakeupCoveredYear') || !makeupDateDist.includes('sept')) {
  throw new Error('dist/makeup-date.js missing month-name extract — build failed or stale');
}

const gitSha = `${readGitSha()}-makeup-missed-on`;
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
assertAmAndPlcBundleMarkers(bundled, 'makeup-missed-on bundle');
assertAlreadyBilledBundleMarkers(bundled, 'makeup-missed-on bundle');
assertVisitDateCoverBundleMarkers(bundled, 'makeup-missed-on bundle');
assertNoSchoolBillingStripFallback(bundled, 'makeup-missed-on bundle');
if (!bundled.includes('session(?:\\\\s+for)')) {
  throw new Error('bundled missing makeup missed-on month-name marker — abort');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

fs.mkdirSync(stageDir, { recursive: true });
for (const f of fs.readdirSync(stageDir)) fs.unlinkSync(path.join(stageDir, f));
fs.copyFileSync(outfile, path.join(stageDir, 'index.mjs'));
if (fs.existsSync(outfile + '.map')) {
  fs.copyFileSync(outfile + '.map', path.join(stageDir, 'index.mjs.map'));
}
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const mapArg = fs.existsSync(path.join(stageDir, 'index.mjs.map'))
  ? `, '${path.join(stageDir, 'index.mjs.map').replace(/'/g, "''")}'`
  : '';
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stageDir, 'index.mjs').replace(/'/g, "''")}'${mapArg} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
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
execSync(`${aws} lambda wait function-updated --function-name ${fnName}`, {
  stdio: 'inherit',
  cwd: __dirname,
});
stampLambdaGitEnv(fnName, { sha: gitSha });

const afterEnv = JSON.parse(
  execSync(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is ${afterEnv.HHA_USE_PRODUCTION}`);
}
if (String(afterEnv.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error('LIVE_OK failed: HHA_USE_MOCK unexpectedly true');
}
const codeSize = Number(afterEnv.CodeSize || 0);
if (codeSize < 400_000) {
  throw new Error(`CodeSize ${codeSize} looks truncated — abort`);
}

const summary = [
  'TMS: Make up session missed on September 24 is a makeup with that covered date',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved',
  '',
  'Changes:',
  '1. make up / make-up / makeup session inside Service Provided is makeup',
  '2. missed on September 24 / Sept 24 is stored as the covered miss date',
  '3. sick-only notes and "will make up later" are not makeup',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-makeup-missed-on-month-deploy-out.txt'), summary);
console.log('\n' + summary);
console.log('LIVE_OK CodeSize=', codeSize, 'SHA=', gitSha);
