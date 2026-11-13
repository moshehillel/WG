/**
 * Deploy Horizon NJ service-code aliases (OT HC Eval → OT, PT HC Eval → PT).
 * Updates OpenedFn and SessionsFn code only. Does not change EventBridge schedules.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const targets = [
  {
    fnName: 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
    entry: 'packages/processors/src/handlers/opened.ts',
    outDir: 'proc-opened-horizon-nj-asset',
    zip: 'proc-opened-horizon-nj.zip',
  },
  {
    fnName: 'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD',
    entry: 'packages/processors/src/handlers/sessions.ts',
    outDir: 'proc-sessions-horizon-nj-asset',
    zip: 'proc-sessions-horizon-nj.zip',
  },
];

const lines = ['Horizon NJ aliases OT HC Eval→OT, PT HC Eval→PT', new Date().toISOString()];

for (const target of targets) {
  const outDir = path.join(__dirname, target.outDir);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, target.zip);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

  await esbuild.build({
    entryPoints: [path.join(repoRoot, target.entry)],
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
  if (!bundled.includes('Horizon NJ') || !bundled.includes('OT HC Eval') || !bundled.includes('PT HC Eval')) {
    throw new Error(`${target.fnName} bundle missing Horizon NJ HC Eval aliases`);
  }
  console.log(target.fnName, 'bundle', fs.statSync(outfile).size);

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}','${(outfile + '.map').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );

  const out = execSync(
    `aws lambda update-function-code --function-name ${target.fnName} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  );
  console.log(out.trim());
  execSync(`aws lambda wait function-updated --function-name ${target.fnName} --region us-east-1`, {
    stdio: 'inherit',
  });
  lines.push(target.fnName, out.trim(), '');
}

fs.writeFileSync(path.join(__dirname, 'cdk-horizon-nj-aliases-deploy-out.txt'), lines.join('\n'));
console.log('deployed. schedules not changed.');
