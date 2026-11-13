/**
 * LIVE_OK: yellow week warning lists missed sessions missing a note.
 * Noted attended + missed fill the weekly mandate (no "N of M this week").
 * Attended/makeup "Service note is required" stays a red submit blocker.
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
const outDir = path.join(__dirname, 'tms-api-missing-note-yellow-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-missing-note-yellow.zip');
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
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'missing-note-yellow');
const mandateSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/mandate.ts'),
  'utf8',
);
if (mandateSrc.includes('Under mandate${who}: ${used} of ${allowed} this week.')) {
  throw new Error('mandate.ts still builds weekly N-of-M under warning — aborting deploy');
}
if (!mandateSrc.includes('Missing note for')) {
  throw new Error('mandate.ts missing yellow missing-note line — aborting deploy');
}
if (!bundled.includes('Missing note for')) {
  throw new Error('Bundle missing Missing note for marker — aborting deploy');
}
if (!bundled.includes('Service note is required')) {
  throw new Error('Bundle missing red Service note is required locker — aborting deploy');
}
console.log('bundle guard: missing-note yellow + red note locker OK');

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

const stamped = JSON.parse(out);
fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-missing-note-yellow-deploy-out.txt'),
  [
    'LIVE_OK: yellow week warning lists missing notes on missed sessions',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    '',
    'Changes:',
    '1. Weekly yellow no longer says "N of M this week" from attended count',
    '2. Noted attended + noted missed fill the weekly mandate (no yellow)',
    '3. Yellow lists missed sessions missing a note (child, date, missed)',
    '4. Attended/makeup "Service note is required" stays red and blocks submit',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', stamped.CodeSize, 'SHA=', stamped.CodeSha256);
console.log('wrote cdk-tms-missing-note-yellow-deploy-out.txt');
