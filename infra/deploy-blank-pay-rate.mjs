/**
 * Deploy blank-pay-rate stop to OpenedFn and SessionsFn.
 * update-function-code only. Does not change EventBridge schedules or start Step Functions.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const allTargets = [
  {
    id: 'opened',
    fnName: 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
    entry: 'packages/processors/src/handlers/opened.ts',
  },
  {
    id: 'sessions',
    fnName: 'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD',
    entry: 'packages/processors/src/handlers/sessions.ts',
  },
];
/** Set DEPLOY_TARGETS=opened to skip SessionsFn when only new_services changed. */
const only = (process.env.DEPLOY_TARGETS || 'opened,sessions')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const targets = allTargets.filter((t) => only.includes(t.id));
if (!targets.length) throw new Error(`No deploy targets matched DEPLOY_TARGETS=${process.env.DEPLOY_TARGETS}`);

function assertBundle(id, bundled) {
  if (id === 'sessions' && !bundled.includes('Pay rate is blank')) {
    throw new Error(`${id} bundle missing blank pay rate hard-stop message`);
  }
  if (id === 'opened') {
    // Minify may escape the em-dash as \u2014 — check the readable pieces.
    if (!bundled.includes('Pay rate is blank') || !bundled.includes('EVV visit not created')) {
      throw new Error(`${id} bundle missing EVV blank-rate visible failure message`);
    }
    if (!bundled.includes('"approved"') && !bundled.includes('approved')) {
      throw new Error(`${id} bundle missing auth status-token guard`);
    }
    if (
      !bundled.includes('caregiver-assigned') &&
      !bundled.includes('recent caregiver visit pay code')
    ) {
      throw new Error(`${id} bundle missing caregiver pay-code path`);
    }
  }
  const banned = [
    'pickFirstPayCodeForDiscipline',
    'fallback pay rate',
    'any catalog rate',
    'using fallback',
    'catalog first-match',
    'skipped-blank-pay-rate',
  ];
  for (const text of banned) {
    if (bundled.includes(text)) {
      throw new Error(`${id} bundle still contains banned text: ${text}`);
    }
  }
}

execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });

const built = [];
for (const target of targets) {
  const outDir = path.join(__dirname, `proc-${target.id}-blank-pay-rate-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-${target.id}-blank-pay-rate.zip`);
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
  assertBundle(target.id, bundled);
  const note =
    target.id === 'opened'
      ? 'new_services blank rate fails visit visibly; caregiver pay code; auth status-token guard'
      : 'sessions hard-stops blank rate; no catalog fallback';
  console.log(target.id, 'bundle', fs.statSync(outfile).size, note);
  built.push({ ...target, outfile, zipPath });
}

for (const target of built) {
  if (fs.existsSync(target.zipPath)) fs.unlinkSync(target.zipPath);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${target.outfile.replace(/'/g, "''")}','${(target.outfile + '.map').replace(/'/g, "''")}' -DestinationPath '${target.zipPath.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );

  const out = execSync(
    `aws lambda update-function-code --function-name ${target.fnName} --zip-file fileb://${target.zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  );
  console.log(target.id, out.trim());
  execSync(`aws lambda wait function-updated --function-name ${target.fnName} --region us-east-1`, {
    stdio: 'inherit',
  });
  const confirmed = execSync(
    `aws lambda get-function-configuration --function-name ${target.fnName} --region us-east-1 --query "{FunctionName:FunctionName,CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize,State:State,LastUpdateStatus:LastUpdateStatus}" --output json`,
    { encoding: 'utf8' },
  );
  console.log(target.id, 'confirmed', confirmed.trim());
}

const rules = [
  'WhiteGlove-MondayApiPreview',
  'WhiteGloveStack-TuesdaySessionsScheduleC5134705-0uEUJoPO4wcQ',
  'WhiteGloveStack-NightlyCaseReportsSchedule20498DCD-BuDJo8jy9dRx',
];
for (const name of rules) {
  const rule = execSync(
    `aws events describe-rule --name ${name} --region us-east-1 --query "{Name:Name,State:State,ScheduleExpression:ScheduleExpression}" --output json`,
    { encoding: 'utf8' },
  );
  console.log('rule', rule.trim());
}

console.log('blank pay rate deployed. schedules not changed. no step functions execution.');
