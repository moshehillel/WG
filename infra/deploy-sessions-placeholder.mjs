/**
 * Deploy SessionsFn: after an EVV visit is approved, delete the 1:00–1:30 AM placeholder.
 * Lambda code only. Does not change EventBridge schedules.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const fnName = 'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD';
const outDir = path.join(__dirname, 'proc-sessions-placeholder-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'proc-sessions-placeholder.zip');

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/processors/src/handlers/sessions.ts')],
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
if (!bundled.includes('DeleteVisitInfo') || !bundled.includes('removeEvvPlaceholder')) {
  throw new Error('Sessions bundle missing placeholder removal');
}
console.log('bundle', fs.statSync(outfile).size);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}','${(outfile + '.map').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(fnName, out.trim());
execSync(`aws lambda wait function-updated --function-name ${fnName} --region us-east-1`, {
  stdio: 'inherit',
});

fs.writeFileSync(
  path.join(__dirname, 'cdk-sessions-placeholder-deploy-out.txt'),
  ['SessionsFn placeholder removal', new Date().toISOString(), fnName, out.trim(), ''].join('\n'),
);
console.log('deployed. schedules not changed by this script.');
