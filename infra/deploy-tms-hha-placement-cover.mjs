/**
 * Deploy TMS API: AddPatientContract cover-date reuse + -74 overlap recovery.
 * Reuses same-ContractID placements that cover the visit date (not only exact start).
 * Prefer deploy-tms-am-pay-plc-cover.mjs when also shipping Group→AM pay fallback.
 * This script asserts BOTH marker sets so it cannot wipe am-pay.
 * Does NOT change HHA_USE_PRODUCTION / HHA_ALLOW_PRODUCTION / HHA_USE_MOCK.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';
import { assertAmAndPlcBundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-hha-placement-cover-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-hha-placement-cover.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

try {
  execSync('npm run build -w @white-glove/hha-client', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('hha-client full tsc failed; continuing with existing dist / esbuild src');
}
try {
  execSync('npm run build -w @white-glove/tms-api', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('tms-api full tsc failed; esbuild will bundle from src');
}

const gitSha = `${readGitSha()}-plc-cover`;

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
assertAmAndPlcBundleMarkers(bundled, 'plc-cover bundle');
console.log('bundled', outfile, 'SHA', gitSha, fs.statSync(outfile).size);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

const stamped = stampLambdaGitEnv(fnName, { sha: gitSha });

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,Handler:Handler,Runtime:Runtime,CodeSize:CodeSize,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

const envObj = JSON.parse(env);
if (envObj.HHA_USE_PRODUCTION !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION=${envObj.HHA_USE_PRODUCTION}`);
}
if (envObj.HHA_USE_MOCK === 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_MOCK=${envObj.HHA_USE_MOCK}`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-hha-placement-cover-deploy-out.txt'),
  [
    'TMS HHA AddPatientContract cover-date reuse + -74 overlap recovery',
    `Function: ${fnName}`,
    `GitSHA: ${stamped.sha}`,
    `BuiltAt: ${stamped.builtAt}`,
    out.trim(),
    env.trim(),
    'LIVE_OK: HHA prod preserved (USE_MOCK=false, USE_PRODUCTION=true)',
    '',
  ].join('\n'),
);
console.log('LIVE_OK wrote cdk-tms-hha-placement-cover-deploy-out.txt');
