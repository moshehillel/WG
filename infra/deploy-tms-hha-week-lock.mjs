/**
 * LIVE_OK: one HHA transfer per week, and link VisitID when a parallel send loses with overlap -310.
 * Confirmed / sent+VisitID / -401 skips stay. HHA_USE_PRODUCTION unchanged.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { assertAmPlcSchoolAnd401BundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-hha-week-lock-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-hha-week-lock.zip');
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
    'process.env.TMS_GIT_SHA': JSON.stringify(`${gitSha}-hha-week-lock`),
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
  plugins: [
    {
      name: 'hha-soap-adapter-src',
      setup(build) {
        // dist/hha-client tsc is stale (missing ent modules). Bundle the overlap fix from source.
        build.onResolve({ filter: /soap-adapter\.js$/ }, () => ({
          path: path.join(repoRoot, 'packages/hha-client/src/soap-adapter.ts'),
        }));
      },
    },
  ],
});

console.log('bundled', outfile, 'TMS_GIT_SHA=', `${gitSha}-hha-week-lock`);
const bundled = fs.readFileSync(outfile, 'utf8');
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'hha-week-lock');
if (!bundled.includes('HHA transfer for this week is already running')) {
  throw new Error('Bundle missing week transfer lock — aborting deploy');
}
if (!bundled.includes('CreateSchedule overlap linked VisitID')) {
  throw new Error('Bundle missing overlap VisitID link — aborting deploy');
}
if (!bundled.includes('d{4}|d{2}') && !bundled.includes('d{4}|\\d{2}')) {
  throw new Error('Bundle missing two-digit year date pattern — abort so date formatting is not reverted');
}
console.log('bundle guard: week lock + overlap VisitID link + date window + HHA markers OK');

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
  path.join(__dirname, 'cdk-tms-hha-week-lock-deploy-out.txt'),
  [
    'LIVE_OK: one HHA transfer per week; overlap -310 links VisitID',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}-hha-week-lock`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    '',
    'Changes:',
    '1. Overlapping transfers of the same week cannot both CreateSchedule',
    '2. Confirmed / sent+VisitID / -401 still skip CreateSchedule',
    '3. Overlap -310 after a sibling CreateSchedule saves that VisitID',
    '4. FE Send/Retry stays disabled until the transfer request finishes (app.js?v=133)',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', stamped.CodeSize, 'SHA=', stamped.CodeSha256);
console.log('wrote cdk-tms-hha-week-lock-deploy-out.txt');
