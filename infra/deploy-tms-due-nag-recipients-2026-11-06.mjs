/**
 * LIVE: due-date alert emails skip *.local addresses and testy@whiteglovecare.net
 * (stops SES bounce mail). moshe@advancedautomations.net still receives them.
 * packages/tms-api/src/due-nags.ts.
 * Does NOT change HHA_USE_PRODUCTION. Does not create or change HHA visits.
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
const outDir = path.join(__dirname, 'tms-api-due-nag-recipients-asset');
const stageDir = path.join(__dirname, '_zip_stage_due_nag_recipients');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-due-nag-recipients-2026-11-06.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: opts.cwd || repoRoot, stdio: opts.stdio || 'inherit' });
}

const nagSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/due-nags.ts'), 'utf8');
for (const m of ['isDueNagRecipient', 'testy@whiteglovecare.net', ".endsWith('.local')"]) {
  if (!nagSrc.includes(m)) throw new Error('due-nags.ts missing ' + m + ' - abort');
}
if (nagSrc.includes('moshe@advancedautomations.net')) {
  throw new Error('due-nags.ts must not exclude moshe@advancedautomations.net - abort');
}
sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-due-nag-recipients-2026-11-06`;
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
assertAmAndPlcBundleMarkers(bundled, 'due-nag bundle');
assertAlreadyBilledBundleMarkers(bundled, 'due-nag bundle');
assertVisitDateCoverBundleMarkers(bundled, 'due-nag bundle');
assertNoSchoolBillingStripFallback(bundled, 'due-nag bundle');
if (!bundled.includes('testy@whiteglovecare.net')) {
  throw new Error('bundled missing marker testy@whiteglovecare.net - abort');
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

const q = (extra = '') =>
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA${extra}}" --output json`;
const beforeEnv = JSON.parse(execSync(q(), { encoding: 'utf8' }));
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

const afterEnv = JSON.parse(execSync(q(',TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT'), { encoding: 'utf8' }));
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is not true after deploy: ${JSON.stringify(afterEnv)}`);
}

const summary = [
  'TMS due-date alert recipients 2026-11-06',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved (unchanged)',
  'No HHA visit created, cancelled, or changed',
  'Netlify not deployed',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-due-nag-recipients-2026-11-06-deploy-out.txt'), summary);
console.log('\n' + summary);
