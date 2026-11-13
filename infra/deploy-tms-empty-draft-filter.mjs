/**
 * Hide empty failed-import drafts from Provider status; discard empty weeks on blocked upload.
 * LIVE_OK — HHA_USE_PRODUCTION unchanged. No coordinator / visit changes.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { assertAmPlcSchoolAnd401BundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-empty-draft-filter-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-empty-draft-filter.zip');
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
const stamp = `empty-draft-filter-${new Date().toISOString()}`;

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
    'process.env.TMS_GIT_SHA': JSON.stringify(gitSha),
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile, 'TMS_GIT_SHA=', gitSha, 'stamp=', stamp);
const bundled = fs.readFileSync(outfile, 'utf8');
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'empty-draft-filter');
if (!bundled.includes('/admin/weeks') || !bundled.includes('/week/upload-sessions')) {
  throw new Error('Bundle missing admin weeks / upload-sessions routes — aborting deploy');
}
if (!bundled.includes('sessionCount')) {
  throw new Error('Bundle missing sessionCount marker — aborting deploy');
}
console.log('bundle guard: empty-draft-filter + HHA markers OK');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const beforeEnvRaw = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_COORDINATOR_ID:Environment.Variables.HHA_COORDINATOR_ID}" --output json`,
  { encoding: 'utf8' },
);
const beforeEnv = JSON.parse(beforeEnvRaw);
if (String(beforeEnv.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is not true: ${beforeEnvRaw}`);
}
const beforeCoordinator = beforeEnv.HHA_COORDINATOR_ID;

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

execSync(`aws lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,HHA_COORDINATOR_ID:Environment.Variables.HHA_COORDINATOR_ID,Handler:Handler,Runtime:Runtime}" --output json`,
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
if (String(envObj.HHA_COORDINATOR_ID || '') !== String(beforeCoordinator || '')) {
  throw new Error(`LIVE_OK failed: HHA_COORDINATOR_ID changed: ${beforeCoordinator} → ${envObj.HHA_COORDINATOR_ID}`);
}

const stamped = JSON.parse(out);
fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-empty-draft-filter-deploy-out.txt'),
  [
    'LIVE_OK: Empty failed-import drafts hidden from Provider status',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}`,
    `TMS_DEPLOY_STAMP: ${stamp}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    'HHA_COORDINATOR_ID unchanged',
    '',
    'Changes:',
    '1. adminWeeksList excludes draft/reopened weeks with sessionCount === 0',
    '2. upload-sessions discards empty weeks created during a blocked import',
    '3. Week record is no longer created before validation needs one',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', stamped.CodeSize, 'SHA=', stamped.CodeSha256);
console.log('wrote cdk-tms-empty-draft-filter-deploy-out.txt');
