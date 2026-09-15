import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-week-progress-school-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-week-progress-school.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

// esbuild resolves @white-glove/tms-db via package.json "main" → dist/.
// Rebuild so school-column deploy cannot silently drop solo-group mandate fix.
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
if (!bundled.includes('School') || !/schoolName/.test(bundled)) {
  throw new Error('Bundle missing School / schoolName week-progress column — aborting deploy');
}
console.log('bundle guard: school column + solo-group mandate bridge OK');

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
  path.join(__dirname, 'cdk-tms-week-progress-school-deploy-out.txt'),
  [
    'TMS weekly session progress: School column (was Program type)',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA: env preserved as configured',
    '',
    'IMPORTANT: rebuilds packages/tms-db dist before esbuild (keeps solo-group mandate fix).',
    '',
    'Changes:',
    '1. week-progress.xlsx: Program type → School (schoolName)',
    '2. Provider column kept',
    '3. FE: app.js?v=92 School column',
    '4. solo-group / no-partner → group mandate matching (sessionIsSoloGroupViaNote)',
    '',
  ].join('\n'),
);
