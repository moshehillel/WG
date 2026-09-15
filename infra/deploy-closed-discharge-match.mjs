/**
 * Deploy discharge placement-match fix to ClosedFn only.
 * - Parse HHA ServiceStartDate
 * - Use program-scoped resolved ServiceCodeIDs (incl. duplicate billing names)
 * - Pass programType into discharge resolveServiceCodeId
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const fnName = 'WhiteGloveStack-ClosedFn618EFC8C-A4srMirJOT3k';
const outDir = path.join(__dirname, 'proc-closed-discharge-match-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'proc-closed-discharge-match.zip');

execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });
try {
  execSync('npm run build -w @white-glove/hha-client', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('hha-client full tsc failed; relying on incremental dist');
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/processors/src/handlers/closed.ts')],
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

const bundle = fs.readFileSync(outfile, 'utf8');
for (const needle of ['ServiceStartDate', 'resolvedServiceCodeIds', 'resolveServiceCodeIds']) {
  if (!bundle.includes(needle)) {
    throw new Error(`ClosedFn bundle missing expected string: ${needle}`);
  }
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
console.log('closed', out.trim());
fs.writeFileSync(
  path.join(__dirname, 'cdk-closed-discharge-match-deploy-out.txt'),
  [
    'ClosedFn discharge placement match: ServiceStartDate + program-scoped ServiceCodeIDs',
    fnName,
    out.trim(),
  ].join('\n'),
);
console.log('wrote cdk-closed-discharge-match-deploy-out.txt');
