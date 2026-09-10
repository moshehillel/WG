import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-internal-notes-report-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-internal-notes-report.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

// esbuild resolves @white-glove/tms-db via package.json "main" → dist/.
// Rebuild so this deploy cannot silently drop prior mandate / report fixes.
console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
const mandateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/mandate.js'),
  'utf8',
);
if (!mandateDist.includes('sessionIsSoloGroupViaNote')) {
  throw new Error(
    'packages/tms-db/dist/mandate.js missing sessionIsSoloGroupViaNote — build failed or stale',
  );
}
const reportsDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/reports.js'),
  'utf8',
);
if (!reportsDist.includes('adminInternalNotesReport')) {
  throw new Error(
    'packages/tms-db/dist/reports.js missing adminInternalNotesReport — build failed or stale',
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
const oldBroken =
  /function \w+\(e,t\)\{let r=\w+\(e\.serviceType\);if\(t\.discipline&&r&&t\.discipline!==r\)return!1;let o=\w+\(e\.serviceType\);return!\(o!=null&&o!==!!t\.ratioGroup\)\}/.test(
    bundled,
  );
if (oldBroken) {
  throw new Error(
    'Bundle still has OLD sessionMatchesMandate without solo-group note bridge — aborting deploy',
  );
}
if (!bundled.includes('adminInternalNotesReport') && !bundled.includes('/admin/reports/internal-notes')) {
  throw new Error('Bundle missing internal-notes report — aborting deploy');
}
if (!bundled.includes('internal-notes')) {
  throw new Error('Bundle missing internal-notes path string — aborting deploy');
}
console.log('bundle guard: internal-notes report + solo-group mandate bridge OK');

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
  path.join(__dirname, 'cdk-tms-internal-notes-report-deploy-out.txt'),
  [
    'TMS admin Internal notes report (all providers)',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA: env preserved as configured',
    '',
    'IMPORTANT: rebuilds packages/tms-db + shared dist before esbuild (keeps solo-group mandate fix).',
    '',
    'Changes:',
    '1. GET /admin/reports/internal-notes — filter by from/to + providerId',
    '2. GET /admin/reports/internal-notes.xlsx — Excel export',
    '3. FE: Admin → Reports → Internal notes (app.js?v=93)',
    '4. Columns: When, Provider, Author, Tags, Note',
    '',
  ].join('\n'),
);
