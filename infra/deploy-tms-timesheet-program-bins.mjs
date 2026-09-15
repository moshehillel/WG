import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-timesheet-program-bins-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-timesheet-program-bins.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
const weekSchoolDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/week-school.js'),
  'utf8',
);
if (
  !weekSchoolDist.includes('timesheetBinKeyForParts') ||
  !weekSchoolDist.includes('normalizeProgramTypeKey') ||
  !weekSchoolDist.includes('splitWeekBySchoolBins')
) {
  throw new Error(
    'packages/tms-db/dist/week-school.js missing program-type timesheet bin helpers — build failed or stale',
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
if (!bundled.includes('timesheetBinKeyForParts') && !bundled.includes('program:')) {
  throw new Error('Bundle missing program-type timesheet bin logic — aborting deploy');
}
if (!bundled.includes('siblingWeeks')) {
  throw new Error('Bundle missing siblingWeeks multi-bin week response — aborting deploy');
}
if (!bundled.includes('session-notes') && !bundled.includes('sessionNotes')) {
  // Route path may be minified; require reports marker that ships with current API.
  if (!bundled.includes('districtOptions')) {
    throw new Error('Bundle missing session-notes / districtOptions canary — aborting deploy');
  }
}
console.log('bundle guard: program-type timesheet bins OK');

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

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-timesheet-program-bins-deploy-out.txt'),
  [
    'TMS timesheets: split by program type (+ same-signer merge within program)',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved',
    '',
    'IMPORTANT: rebuilds packages/tms-db dist before esbuild (program-type bins).',
    '',
    'Changes:',
    '1. Timesheet bin key = programType + signer/school (Island Park vs Carle Place separate)',
    '2. Within same programType, same signer email still merges buildings (Madison)',
    '3. Import / add-session / submit route and repair mixed weeks by program bin',
    '4. WeeklyPeriod.programType stamped; siblingWeeks includes programType',
    '5. FE: admin program/school picker + therapist copy (app.js?v=104)',
  ].join('\n') + '\n',
);
console.log('wrote cdk-tms-timesheet-program-bins-deploy-out.txt');
