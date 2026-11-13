/**
 * LIVE: Note screen calls Claude Haiku 4.5 only when an attended note
 * contains absence wording the keyword rules cannot already decide.
 * Also adds POST /week/read-notes, a read-only Claude pass for an uploaded PDF.
 * Does NOT change HHA_USE_PRODUCTION. The read route does not create sessions or visits.
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
const outDir = path.join(__dirname, 'tms-api-note-fallback-asset');
const stageDir = path.join(__dirname, '_zip_stage_note_fallback');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-note-fallback.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const screenSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/ai-screen.ts'), 'utf8');
if (!screenSrc.includes('export function noteNeedsAbsenceFallback')) {
  throw new Error('ai-screen missing absence fallback — abort');
}
const bedrockSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/bedrock.ts'), 'utf8');
if (!bedrockSrc.includes(MODEL_ID)) {
  throw new Error('bedrock.ts is not pointed at Claude Haiku 4.5 — abort');
}

sh('npm run build -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-note-read`;
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
assertAmAndPlcBundleMarkers(bundled, 'note-fallback bundle');
assertAlreadyBilledBundleMarkers(bundled, 'note-fallback bundle');
assertVisitDateCoverBundleMarkers(bundled, 'note-fallback bundle');
assertNoSchoolBillingStripFallback(bundled, 'note-fallback bundle');
if (!bundled.includes('This note reads as a missed visit')) {
  throw new Error('bundled missing missed-visit warning — abort');
}
if (!bundled.includes('/week/read-notes')) {
  throw new Error('bundled missing Claude note-read route — abort');
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
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BEDROCK_MODEL_ID:Environment.Variables.TMS_BEDROCK_MODEL_ID}" --output json`,
    { encoding: 'utf8' },
  ),
);
console.log('env before:', beforeEnv);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${beforeEnv.HHA_USE_PRODUCTION}`);
}

const codeOut = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('code', codeOut.trim());
stampLambdaGitEnv(fnName, { sha: gitSha });
execSync(`aws lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

const prevRaw = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query Environment.Variables --output json`,
  { encoding: 'utf8' },
);
const prev = JSON.parse(prevRaw);
const envFile = path.join(__dirname, '.note-fallback-env.json');
fs.writeFileSync(envFile, JSON.stringify({ Variables: { ...prev, TMS_BEDROCK_MODEL_ID: MODEL_ID } }));
try {
  execSync(
    `aws lambda update-function-configuration --function-name ${fnName} --environment file://${envFile} --query "{Model:Environment.Variables.TMS_BEDROCK_MODEL_ID,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION}" --output json`,
    { stdio: 'inherit' },
  );
} finally {
  fs.unlinkSync(envFile);
}

const afterEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BEDROCK_MODEL_ID:Environment.Variables.TMS_BEDROCK_MODEL_ID}" --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is not true after deploy: ${JSON.stringify(afterEnv)}`);
}
if (afterEnv.TMS_BEDROCK_MODEL_ID !== MODEL_ID) {
  throw new Error(`LIVE_OK failed: model is ${afterEnv.TMS_BEDROCK_MODEL_ID}`);
}
console.log('env after:', afterEnv);
console.log('HHA_USE_PRODUCTION=true preserved. No sessions or HHA visits changed.');
