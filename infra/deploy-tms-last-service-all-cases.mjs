/**
 * Last-service report: every TMS child, blank Last DOS when never serviced.
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
const outDir = path.join(__dirname, 'tms-api-last-service-all-cases-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-last-service-all-cases.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const marker = 'Never serviced (no attended/makeup) keeps a blank last DOS';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const reportsSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/reports.ts'), 'utf8');
if (!reportsSrc.includes(marker)) {
  throw new Error('reports.ts missing never-serviced last-DOS marker — aborting deploy');
}
const reportsDist = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/dist/reports.js'), 'utf8');
if (!reportsDist.includes(marker)) {
  throw new Error('packages/tms-db/dist/reports.js missing never-serviced marker — build failed or stale');
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
    'process.env.TMS_GIT_SHA': JSON.stringify(gitSha),
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile, 'TMS_GIT_SHA=', gitSha);
const bundled = fs.readFileSync(outfile, 'utf8');
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'last-service-all-cases');
if (!bundled.includes('/admin/reports/last-service')) {
  throw new Error('Bundle missing /admin/reports/last-service — aborting deploy');
}
console.log('bundle guard: last-service route + HHA markers OK');

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

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-last-service-all-cases-deploy-out.txt'),
  [
    'LIVE_OK: last-service report includes every TMS child',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    '',
    'Changes:',
    '1. GET /admin/reports/last-service includes every child, not only attended/makeup',
    '2. Never serviced (including missed-only) has a blank Last DOS',
    '3. Excel export uses the same rows',
    '4. Provider filter still limits to that provider (sessions or mandate)',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK HHA_USE_PRODUCTION=true');
