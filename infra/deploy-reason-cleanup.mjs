/**
 * Deploy clear HHA ops Reason strings (-310, short -74, strip SOAP/ErrorID noise)
 * to OpenedFn / ValidateFn / NotifyFailureFn. Rebuilds @white-glove/shared first.
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
    id: 'validate',
    entry: 'packages/processors/src/handlers/validate.ts',
    fnName: 'WhiteGloveStack-ValidateFn1051E81A-l77AgX8N75Jb',
  },
  {
    id: 'notify',
    entry: 'packages/processors/src/handlers/notify-failure.ts',
    fnName: 'WhiteGloveStack-NotifyFailureFnA1B2C3D4', // replaced below if wrong
  },
];

const notifyName = execSync(
  `aws lambda list-functions --region us-east-1 --query "Functions[?contains(FunctionName, 'NotifyFailure')].FunctionName" --output text`,
  { encoding: 'utf8' },
)
  .trim()
  .split(/\s+/)
  .find((n) => n.includes('NotifyFailure'));
if (!notifyName) throw new Error('NotifyFailureFn not found');
targets[2].fnName = notifyName;

const lines = [
  'Clear HHA Reason: -310 provider not eligible; short invalid service code; strip ErrorID/SOAP/WGC dumps',
];

execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });

for (const t of targets) {
  const outDir = path.join(__dirname, `proc-${t.id}-reason-cleanup-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-${t.id}-reason-cleanup.zip`);

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

  const bundled = fs.readFileSync(outfile, 'utf8');
  // Validate formats ops Reasons. Notify may only import a subset — still deploy it.
  if (t.id === 'validate') {
    if (!bundled.includes('provider not eligible for that service')) {
      throw new Error(`${t.id} bundle missing -310 reason string`);
    }
    if (!bundled.includes('invalid service code')) {
      throw new Error(`${t.id} bundle missing invalid service code string`);
    }
    console.log(`${t.id}: bundle contains -310 + invalid service code strings OK`);
  } else {
    const has310 = bundled.includes('provider not eligible for that service');
    console.log(
      `${t.id}: bundled ${fs.statSync(outfile).size} bytes` +
        (has310 ? ' (has -310 string)' : ' (no -310 string in this entry — OK if tree-shaken)'),
    );
  }

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

fs.writeFileSync(path.join(__dirname, 'cdk-reason-cleanup-deploy-out.txt'), lines.join('\n'));
console.log('wrote cdk-reason-cleanup-deploy-out.txt');
