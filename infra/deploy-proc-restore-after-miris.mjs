/**
 * Restore processor Lambdas after cdk-alert-miris CFN rollback wiped out-of-band code.
 * Code-only updates — does NOT touch EventBridge rules or TmsApiFn / HHA_USE_PRODUCTION.
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
    mustInclude: ['overlap-existing', 'Overlapping shifts are not allowed'],
  },
  {
    id: 'closed',
    entry: 'packages/processors/src/handlers/closed.ts',
    fnName: 'WhiteGloveStack-ClosedFn618EFC8C-A4srMirJOT3k',
    mustInclude: ['ServiceStartDate', 'resolvedServiceCodeIds'],
  },
  {
    id: 'sessions',
    entry: 'packages/processors/src/handlers/sessions.ts',
    fnName: 'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD',
    mustInclude: ['AuthorizationID', 'CreatePatientAuthorization'],
  },
  {
    id: 'validate',
    entry: 'packages/processors/src/handlers/validate.ts',
    fnName: 'WhiteGloveStack-ValidateFn1051E81A-l77AgX8N75Jb',
    mustInclude: ['provider not eligible for that service', 'invalid service code'],
  },
  {
    id: 'notify',
    entry: 'packages/processors/src/handlers/notify-failure.ts',
    fnName: 'WhiteGloveStack-NotifyFailureFn6B706429-vJFpbEMjz1g4',
    mustInclude: [],
  },
];

console.log('building @white-glove/shared…');
execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });
try {
  execSync('npm run build -w @white-glove/hha-client', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('hha-client full tsc failed; relying on dist');
}

const report = [];
for (const t of targets) {
  const outDir = path.join(__dirname, `proc-restore-${t.id}-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-restore-${t.id}.zip`);

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

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

  const bundled = fs.readFileSync(outfile, 'utf8');
  for (const needle of t.mustInclude) {
    if (!bundled.includes(needle)) {
      throw new Error(`${t.id} bundle missing required string: ${needle}`);
    }
  }
  console.log(`${t.id}: bundled ${fs.statSync(outfile).size} bytes OK`);

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );

  const out = execSync(
    `aws lambda update-function-code --region us-east-1 --function-name ${t.fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  ).trim();
  console.log(t.id, out);
  try {
    const { stampLambdaGitEnv } = await import('./deploy-stamp.mjs');
    stampLambdaGitEnv(t.fnName);
  } catch (err) {
    console.warn(`${t.id} TMS_GIT_SHA stamp skipped:`, err?.message || err);
  }
  report.push(`${t.id} ${t.fnName}\n${out}`);
}

const outPath = path.join(__dirname, 'cdk-proc-restore-after-miris-deploy-out.txt');
fs.writeFileSync(
  outPath,
  [
    'Processor restore after cdk-alert-miris CFN rollback (code-only, no EventBridge)',
    new Date().toISOString(),
    ...report,
  ].join('\n\n') + '\n',
);
console.log(`Wrote ${path.basename(outPath)}`);
