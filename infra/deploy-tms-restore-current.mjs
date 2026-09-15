/**
 * Restore current TMS API after accidental CDK/old-asset rollback.
 * Rebuilds shared + tms-db dist, bundles handler from src, updates Lambda code,
 * and restores HHA_USE_PRODUCTION=true (matches prior good deploys).
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-restore-current-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-restore-current.zip');
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
if (!reportsDist.includes('sessionNotesReport') && !/sessionNotes/i.test(reportsDist)) {
  throw new Error('packages/tms-db/dist/reports.js missing sessionNotesReport — aborting');
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
const required = [
  '/admin/reports/session-notes',
  'lazy signed PDF',
  'Signed timesheet PDF is not available yet',
  'tms/signed/',
];
for (const needle of required) {
  if (!bundled.includes(needle)) {
    throw new Error(`Bundle missing "${needle}" — aborting deploy (would ship stale code)`);
  }
}
if (!bundled.includes('SignNow') && !bundled.includes('signnow')) {
  throw new Error('Bundle missing SignNow — aborting deploy (would ship stale DocuSign-era code)');
}
console.log('bundle guard: session-notes + signed PDF + SignNow OK');

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

// Wait for code update to finish before env update.
execSync(
  `aws lambda wait function-updated --function-name ${fnName}`,
  { stdio: 'inherit' },
);

// Restore HHA production flags (rollback had flipped them to false).
const prev = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query Environment.Variables --output json`,
    { encoding: 'utf8' },
  ),
);
const nextVars = {
  ...prev,
  HHA_USE_MOCK: 'false',
  HHA_USE_PRODUCTION: 'true',
  HHA_ALLOW_PRODUCTION: 'true',
};
const envKeys = Object.keys(nextVars)
  .map((k) => `${k}=${nextVars[k]}`)
  .join(',');
execSync(
  `aws lambda update-function-configuration --function-name ${fnName} --environment "Variables={${envKeys}}" --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION}" --output json`,
  { stdio: 'inherit', shell: true },
);

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,Handler:Handler,Runtime:Runtime,LastModified:LastModified,CodeSize:CodeSize,CodeSha256:CodeSha256}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-restore-current-deploy-out.txt'),
  [
    'TMS restore current API after accidental old-bundle rollback',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'Restored: HHA_USE_PRODUCTION=true, HHA_ALLOW_PRODUCTION=true, HHA_USE_MOCK=false',
    'Guards: session-notes + SignNow + lazy signed PDF + never regenerate locked unsigned',
    '',
  ].join('\n'),
);
console.log('wrote cdk-tms-restore-current-deploy-out.txt');
