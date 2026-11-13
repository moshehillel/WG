/**
 * LIVE_OK: timesheet send lock is per providerId + program + weekStart.
 * Same-name alias twins no longer steal a submitted week and block Provider B.
 * HHA_USE_PRODUCTION unchanged.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { assertAmPlcSchoolAnd401BundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-provider-timesheet-lock-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-provider-timesheet-lock.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const gitSha = execSync('git rev-parse --short HEAD', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
const buildTag = `${gitSha}-prov-ts-lock`;

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

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
  define: {
    'process.env.TMS_GIT_SHA': JSON.stringify(buildTag),
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile, 'TMS_GIT_SHA=', buildTag);
const routerSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-api/src/router.ts'),
  'utf8',
);
if (
  !routerSrc.includes('never fall back onto a submitted/signed/locked alias week') ||
  !routerSrc.includes('Never fold across providers') ||
  !routerSrc.includes('Only retarget editable alias drafts')
) {
  throw new Error('router.ts missing per-provider timesheet lock logic — aborting deploy');
}
const caseloadSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/caseload-import.ts'),
  'utf8',
);
if (!caseloadSrc.includes('Clash only within the same program-type bin')) {
  throw new Error('caseload-import.ts missing program-scoped week clash — aborting deploy');
}
const bundled = fs.readFileSync(outfile, 'utf8');
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'provider-timesheet-lock');
if (!bundled.includes('HHA transfer for this week is already running')) {
  throw new Error('Bundle missing per-week HHA lock — abort so the send lock is not reverted');
}
if (!bundled.includes('draftWeeks') || !bundled.includes('programType')) {
  throw new Error('Bundle missing draftWeeks/programType — aborting deploy');
}
console.log('bundle guard: per-provider timesheet lock source + HHA week lock OK');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

execSync(`aws lambda wait function-updated --function-name ${fnName}`, {
  stdio: 'inherit',
  cwd: __dirname,
});

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,Handler:Handler,Runtime:Runtime,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

const envObj = JSON.parse(env);
if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is not true after deploy: ${env}`);
}
if (String(envObj.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_MOCK unexpectedly true: ${env}`);
}
const codeSize = Number(envObj.CodeSize || 0);
// Minified index.mjs zip is ~0.5–0.6MB; older deploys that included .map were ~2MB.
if (codeSize < 400_000) {
  throw new Error(`LIVE_OK failed: CodeSize too small after deploy: ${codeSize}`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-provider-timesheet-lock-deploy-out.txt'),
  [
    'LIVE_OK: timesheet send lock per providerId + program + weekStart',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${buildTag}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    '',
    'Changes:',
    '1. pickWeekForScope prefers exact providerId; never adopts alias submitted weeks',
    '2. Never reassign ownership of submitted/signed/locked weeks across provider rows',
    '3. foldWeeksOnto refuses cross-provider folds',
    '4. reassignProviderOwnedData clash key includes program type',
    '',
  ].join('\n'),
);
console.log('LIVE_OK HHA_USE_PRODUCTION=true');
