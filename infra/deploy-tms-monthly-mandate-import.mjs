import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-monthly-mandate-import-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-monthly-mandate-import.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

// esbuild resolves @white-glove/tms-db via package.json "main" → dist/.
// Always rebuild dist so src-only mandate fixes are not silently skipped.
console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
const mandateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/mandate.js'),
  'utf8',
);
if (!mandateDist.includes('monthAnchorDos')) {
  throw new Error(
    'packages/tms-db/dist/mandate.js missing monthAnchorDos — build failed or stale',
  );
}
if (!mandateDist.includes('Under monthly mandate')) {
  throw new Error(
    'packages/tms-db/dist/mandate.js missing monthly mandate messages — build failed or stale',
  );
}
const caseloadDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/caseload-import.js'),
  'utf8',
);
if (!caseloadDist.includes("'monthly'") && !caseloadDist.includes('"monthly"')) {
  throw new Error(
    'packages/tms-db/dist/caseload-import.js missing monthly period parse — build failed or stale',
  );
}
console.log('dist guard: monthly monthAnchorDos + caseload monthly present');

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
if (!bundled.includes('monthAnchorDos')) {
  throw new Error(
    'Bundle missing monthAnchorDos — monthly import fix not in Lambda zip; aborting deploy',
  );
}
console.log('bundle guard: monthAnchorDos present');

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
  path.join(__dirname, 'cdk-tms-monthly-mandate-import-deploy-out.txt'),
  [
    'TMS monthly mandate Frontline import fix',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA: env preserved as configured',
    '',
    'IMPORTANT: deploy rebuilds packages/tms-db dist before esbuild.',
    '',
    'Root cause: empty monthKey counted all-time history → false over-mandate on dual monthly+weekly.',
    'Fix: require calendar month anchor; pass monthAnchorDos from week DOS; parse caseload Monthly.',
    '',
  ].join('\n'),
);
