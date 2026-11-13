/**
 * Dry run reads sessions only. OpenedFn and ClosedFn return empty on dryRun
 * and do not call HHA. Does not change EventBridge schedules.
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
    id: 'opened',
    fnName: 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
    entry: 'packages/processors/src/handlers/opened.ts',
    needles: ['dry run reads sessions only', 'Horizon NJ', 'OT HC Eval', 'PT HC Eval'],
  },
  {
    id: 'closed',
    fnName: 'WhiteGloveStack-ClosedFn618EFC8C-A4srMirJOT3k',
    entry: 'packages/processors/src/handlers/closed.ts',
    needles: ['dry run reads sessions only', 'ServiceStartDate', 'resolvedServiceCodeIds'],
  },
];

execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });

for (const target of targets) {
  const outDir = path.join(__dirname, `proc-${target.id}-dry-run-sessions-only-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-${target.id}-dry-run-sessions-only.zip`);
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
  for (const needle of target.needles) {
    if (!bundled.includes(needle)) throw new Error(`${target.id} bundle missing ${needle}`);
  }
  console.log(target.id, 'bundle', fs.statSync(outfile).size);

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}','${(outfile + '.map').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );

  const out = execSync(
    `aws lambda update-function-code --function-name ${target.fnName} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  );
  console.log(target.id, out.trim());
  execSync(`aws lambda wait function-updated --function-name ${target.fnName} --region us-east-1`, {
    stdio: 'inherit',
  });
}

console.log('deployed. schedules not changed.');
