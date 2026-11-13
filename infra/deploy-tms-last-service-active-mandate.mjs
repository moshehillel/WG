/**
 * Code deploy: Last date of service report keeps only students with an
 * active mandate (endOn unset or after today). Does not change
 * HHA_USE_PRODUCTION, coordinator ids, or create visits.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-last-service-active-mandate-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-last-service-active-mandate.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
const reportsDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/reports.js'),
  'utf8',
);
const start = reportsDist.indexOf('function studentHasActiveMandate');
const next = reportsDist.indexOf('function sessionProviderId', start);
const body = start >= 0 && next > start ? reportsDist.slice(start, next) : '';
if (!body.includes('mandateDischargedForWeek')) {
  throw new Error('packages/tms-db/dist/reports.js lastServiceByStudent missing active-mandate filter — build failed or stale');
}
if (!body.includes('studentHasActiveMandate')) {
  throw new Error('packages/tms-db/dist/reports.js lastServiceByStudent missing studentHasActiveMandate');
}
if (!body.includes('One row per child')) {
  throw new Error('packages/tms-db/dist/reports.js lastServiceByStudent is still split by mandate');
}
if (body.includes('${s.studentId}|')) {
  throw new Error('packages/tms-db/dist/reports.js last service still keys a row per provider');
}

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
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile);
const bundled = fs.readFileSync(outfile, 'utf8');
if (!bundled.includes('/admin/reports/last-service')) {
  throw new Error('Bundle missing /admin/reports/last-service — aborting deploy');
}
if (!bundled.includes('active mandate as of today')) {
  throw new Error('Bundle missing last-service active-mandate knowledge — aborting deploy');
}
if (!bundled.includes('one row per child')) {
  throw new Error('Bundle missing one-row-per-child last-service rule — aborting deploy');
}
console.log('bundle guard: last-service active mandate OK');

const aws = 'aws --no-verify-ssl';
const envQuery =
  '{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,Handler:Handler,Runtime:Runtime}';
const envBefore = execSync(
  `${aws} lambda get-function-configuration --function-name ${fnName} --query "${envQuery}" --output json`,
  { encoding: 'utf8' },
);
console.log('env before', envBefore);
const before = JSON.parse(envBefore);
if (before.HHA_USE_PRODUCTION !== true && before.HHA_USE_PRODUCTION !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${before.HHA_USE_PRODUCTION}`);
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

const env = execSync(
  `${aws} lambda get-function-configuration --function-name ${fnName} --query "${envQuery}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);
const after = JSON.parse(env);
if (after.HHA_USE_PRODUCTION !== true && after.HHA_USE_PRODUCTION !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION changed: ${after.HHA_USE_PRODUCTION}`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-last-service-active-mandate-deploy-out.txt'),
  [
    'TMS last date of service: only students with an active mandate',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION left true; no visit or coordinator changes',
    '',
  ].join('\n'),
);
