import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-timesheet-school-bins-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-timesheet-school-bins.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

// esbuild resolves @white-glove/tms-db via package.json "main" → dist/.
console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
const weekSchoolDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/week-school.js'),
  'utf8',
);
if (!weekSchoolDist.includes('timesheetBinKeyForSchool') || !weekSchoolDist.includes('splitWeekBySchoolBins')) {
  throw new Error(
    'packages/tms-db/dist/week-school.js missing timesheet bin helpers — build failed or stale',
  );
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
if (!bundled.includes('timesheetBinKeyForSchool') && !bundled.includes('signer:')) {
  throw new Error('Bundle missing school/signer timesheet bin logic — aborting deploy');
}
if (!bundled.includes('siblingWeeks')) {
  throw new Error('Bundle missing siblingWeeks multi-school week response — aborting deploy');
}
console.log('bundle guard: school/signer timesheet bins OK');

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
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,Handler:Handler,Runtime:Runtime}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-timesheet-school-bins-deploy-out.txt'),
  [
    'TMS timesheets: split by school/signer; allow second send same week',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA: env preserved as configured',
    '',
    'IMPORTANT: rebuilds packages/tms-db dist before esbuild (week-school bins).',
    '',
    'Changes:',
    '1. WeeklyPeriod.schoolId — multiple timesheet bins per provider+Monday',
    '2. Same signer email across buildings stays one timesheet (Madison)',
    '3. Different school signers → separate weeks/envelopes; second send allowed',
    '4. Import routes sessions by child school; mixed weeks auto-split',
    '5. Admin district filter on provider sessions + session-notes report',
    '6. FE: app.js?v=97 school selector for View/Send timesheet',
  ].join('\n') + '\n',
);
console.log('wrote cdk-tms-timesheet-school-bins-deploy-out.txt');
