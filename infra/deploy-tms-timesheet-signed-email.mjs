import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-timesheet-signed-email-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-timesheet-signed-email.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

// esbuild resolves @white-glove/tms-db via package.json "main" → dist/.
console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

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
if (!bundled.includes('Timesheet signed and finalized')) {
  throw new Error('Bundle missing new email subject — aborting deploy');
}
if (!bundled.includes('Payment will be processed accordingly')) {
  throw new Error('Bundle missing new email body — aborting deploy');
}
if (bundled.includes('you will be paid')) {
  throw new Error('Bundle still has old "you will be paid" copy — aborting deploy');
}
console.log('bundle guard: timesheet signed email copy OK');

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

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-timesheet-signed-email-deploy-out.txt'),
  [
    'TMS timesheet signed email copy (Billu Markowitz)',
    `Function: ${fnName}`,
    out.trim(),
    '',
    'Old subject: Timesheet signed — you will be paid',
    'Old body: Success. This week is signed and locked. You will be paid.',
    'New subject: Timesheet signed and finalized',
    'New body: Your submission for this week has been signed and finalized. Payment will be processed accordingly.',
    '',
    'IMPORTANT: deploy rebuilds packages/tms-db + shared dist before esbuild.',
    '',
  ].join('\n'),
);
console.log('wrote cdk-tms-timesheet-signed-email-deploy-out.txt');
