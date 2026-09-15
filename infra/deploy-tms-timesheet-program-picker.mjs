import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-timesheet-program-picker-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-timesheet-program-picker.zip');
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
if (
  !reportsDist.includes('buildTimesheetProgramOptions') ||
  !reportsDist.includes('timesheetProgramOptions')
) {
  throw new Error(
    'packages/tms-db/dist/reports.js missing timesheetProgramOptions — build failed or stale',
  );
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
if (!bundled.includes('timesheetProgramOptions') && !bundled.includes('buildTimesheetProgramOptions')) {
  throw new Error('Bundle missing timesheetProgramOptions — aborting deploy');
}
if (!bundled.includes('timesheetBinKeyForParts') && !bundled.includes('program:')) {
  throw new Error('Bundle missing program-type timesheet bin logic — aborting deploy');
}
console.log('bundle guard: timesheet program picker OK');

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
  throw new Error(`HHA_USE_PRODUCTION is not true after deploy: ${env}`);
}

const codeSize = JSON.parse(out).CodeSize;
if (typeof codeSize === 'number' && codeSize < 1_800_000) {
  throw new Error(`CodeSize ${codeSize} looks rolled back (expected ~2.05MB)`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-timesheet-program-picker-deploy-out.txt'),
  [
    'TMS admin Generate timesheet: program-type / school-signer picker options',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved',
    '',
    'Changes:',
    '1. adminProviderDetail.timesheetProgramOptions = program type (+ signer only when split)',
    '2. No standalone school-building options in the picker payload',
    '3. FE app.js?v=105 uses timesheetProgramOptions with program-type fallback',
  ].join('\n') + '\n',
);
console.log('wrote cdk-tms-timesheet-program-picker-deploy-out.txt');
