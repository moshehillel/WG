/**
 * LIVE_OK: block session entry and HHA pay codes when service type is blank.
 * Does not guess the provider discipline (no PT pay code from a PT profile).
 * HHA_USE_PRODUCTION unchanged. Does not revert AllXsd YYYY-MM-DD date formatting.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { assertAmPlcSchoolAnd401BundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-service-type-required-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-service-type-required.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

const dateSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/hha-time.ts'),
  'utf8',
);
if (!dateSrc.includes('yearNum <= 69') || !dateSrc.includes('1900 + yearNum')) {
  throw new Error('hha-time.ts missing two-digit year window — abort so date formatting is not reverted');
}

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
const distDate = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/dist/hha-time.js'),
  'utf8',
);
if (!distDate.includes('yearNum <= 69')) {
  throw new Error('hha-client dist psDateToIso is stale — abort so date formatting is not reverted');
}

const gitSha = execSync('git rev-parse --short HEAD', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

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
    'process.env.TMS_GIT_SHA': JSON.stringify(`${gitSha}-svc-type`),
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile, 'TMS_GIT_SHA=', `${gitSha}-svc-type`);
const bundled = fs.readFileSync(outfile, 'utf8');
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'service-type-required');
if (!bundled.includes('Service type is required.')) {
  throw new Error('Bundle missing service-type gate — aborting deploy');
}
if (!bundled.includes('<=69')) {
  throw new Error('Bundle missing two-digit year window (<=69) — abort so date formatting is not reverted');
}
console.log('bundle guard: service type required + date window + HHA markers OK');

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

execSync(
  `aws lambda wait function-updated --function-name ${fnName}`,
  { stdio: 'inherit', cwd: __dirname },
);

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,Handler:Handler,Runtime:Runtime}" --output json`,
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

const stamped = JSON.parse(out);
fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-service-type-required-deploy-out.txt'),
  [
    'LIVE_OK: service type required before entry and HHA pay code',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}-svc-type`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    '',
    'Changes:',
    '1. Blank session service type does not fall back to provider discipline (no PT pay code)',
    '2. Upload and manual create/edit return "Service type is required."',
    '3. HHA transfer fails that session before pay-code build',
    '4. Clock times are not stored as the service type (9:30 is not a 1:1 ratio)',
    '5. FE: admin manual session requires service type (app.js?v=130)',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', stamped.CodeSize, 'SHA=', stamped.CodeSha256);
console.log('wrote cdk-tms-service-type-required-deploy-out.txt');
