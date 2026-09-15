/**
 * Deploy OpenedFn only: EVV new_services placeholder CreateSchedule shift-overlap (-310)
 * treated as success (visit already present for unscheduled clocks).
 * Does not change SessionsFn / verified session overlap handling.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const fnName = 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC';
const outDir = path.join(__dirname, 'proc-opened-evv-overlap-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'proc-opened-evv-overlap.zip');
const deployOut = path.join(__dirname, 'cdk-opened-evv-overlap-deploy-out.txt');

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/processors/src/handlers/opened.ts')],
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

const bundled = fs.readFileSync(outfile, 'utf8');
const hasOverlapSuccess =
  bundled.includes('overlap-existing') ||
  bundled.includes('EVV placeholder visit already present') ||
  (bundled.includes('Overlapping shifts are not allowed') &&
    bundled.includes('overlap-existing'));
console.log(
  `opened: size=${fs.statSync(outfile).size} hasOverlapSuccess=${Boolean(hasOverlapSuccess)}`,
);
if (!bundled.includes('Overlapping shifts are not allowed')) {
  throw new Error('Opened bundle missing overlap detector string');
}
if (!bundled.includes('overlap-existing') && !bundled.includes('already present')) {
  throw new Error('Opened bundle missing overlap→success marker');
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);

const lines = [
  'OpenedFn: EVV new_services CreateSchedule shift-overlap → success (visit already present)',
  `fn: ${fnName}`,
  out.trim(),
];
fs.writeFileSync(deployOut, lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`Wrote ${path.basename(deployOut)}`);
