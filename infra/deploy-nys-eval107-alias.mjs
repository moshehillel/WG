/**
 * Deploy NYS PT EVAL 107 alias fix (sheet name without dash) + dash-tolerant billing name match
 * to Opened / Closed / Validate / Sessions processor Lambdas.
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
    entry: 'packages/processors/src/handlers/opened.ts',
    fnName: 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
  },
  {
    id: 'closed',
    entry: 'packages/processors/src/handlers/closed.ts',
    fnName: 'WhiteGloveStack-ClosedFn618EFC8C-A4srMirJOT3k',
  },
  {
    id: 'validate',
    entry: 'packages/processors/src/handlers/validate.ts',
    fnName: 'WhiteGloveStack-ValidateFn1051E81A-l77AgX8N75Jb',
  },
  {
    id: 'sessions',
    entry: 'packages/processors/src/handlers/sessions.ts',
    fnName: 'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD',
  },
];

const lines = [
  'NYS PT EVAL 107 alias: sheet "PT Eval 97162 107" (no dash); dash-tolerant billing match',
];

// esbuild resolves workspace packages via package.json "main" → dist/
execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });
try {
  execSync('npm run build -w @white-glove/hha-client', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('hha-client full tsc failed; relying on incremental dist for resolve-service-code-order');
}

for (const t of targets) {
  const outDir = path.join(__dirname, `proc-${t.id}-nys-eval107-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-${t.id}-nys-eval107.zip`);

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) {
    fs.unlinkSync(path.join(outDir, f));
  }

  await esbuild.build({
    entryPoints: [path.join(repoRoot, t.entry)],
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

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );

  const out = execSync(
    `aws lambda update-function-code --function-name ${t.fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  );
  console.log(t.id, out.trim());
  lines.push(`${t.id}: ${t.fnName}`, out.trim(), '');
}

fs.writeFileSync(path.join(__dirname, 'cdk-nys-eval107-alias-deploy-out.txt'), lines.join('\n'));
console.log('wrote cdk-nys-eval107-alias-deploy-out.txt');
