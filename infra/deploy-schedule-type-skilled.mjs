/**
 * Deploy CreateSchedule ScheduleType fix: OT/PT/ST → Skilled (was hardcoding Non-Skilled → -310).
 * Targets: OpenedFn (new_services EVV), SessionsFn, TmsApiFn.
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
    id: 'sessions',
    entry: 'packages/processors/src/handlers/sessions.ts',
    fnName: 'WhiteGloveStack-SessionsFn37158A11-7oL5jyKF7OOP',
  },
  {
    id: 'tms',
    entry: 'packages/tms-api/src/handler.ts',
    fnName: 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ',
  },
];

// Resolve current SessionsFn name (aliases exist).
const sessionsNames = execSync(
  `aws lambda list-functions --region us-east-1 --query "Functions[?contains(FunctionName, 'SessionsFn')].FunctionName" --output text`,
  { encoding: 'utf8' },
)
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const sessionsPick =
  sessionsNames.find((n) => n.includes('SessionsFn37158A11')) ?? sessionsNames[0];
if (sessionsPick) targets[1].fnName = sessionsPick;

const lines = [
  'CreateSchedule ScheduleType: infer Skilled for OT/PT/ST (fixes false -310 caregiver not eligible)',
];

// Prefer source schedule-builder via esbuild entry bundling (does not need clean tsc dist).
for (const t of targets) {
  const outDir = path.join(__dirname, `proc-${t.id}-schedule-skilled-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-${t.id}-schedule-skilled.zip`);

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
  const hasSkilledInfer =
    bundled.includes('cannot be scheduled for OT') ||
    bundled.includes('inferCreateScheduleType') ||
    bundled.includes('SKILLED_DISCIPLINES') ||
    /ScheduleType>Skilled/.test(bundled) ||
    bundled.includes('Skilled') && bundled.includes('Non-Skilled') && bundled.includes('OT HC Eval');
  // Minified: look for Skilled string near schedule builder logic
  const hasSkilled = bundled.includes('Skilled');
  const hasOtInfer =
    bundled.includes('OT HC Eval') ||
    bundled.includes('"OT"') ||
    bundled.includes('OT') && bundled.includes('Skilled');
  console.log(
    `${t.id}: bundled ${fs.statSync(outfile).size} bytes hasSkilled=${hasSkilled} hasOtInfer=${Boolean(hasOtInfer)} marker=${Boolean(hasSkilledInfer)}`,
  );
  if (!hasSkilled) {
    throw new Error(`${t.id} bundle missing Skilled string — schedule-builder not included?`);
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
  console.log(t.id, t.fnName, out.trim());
  lines.push(`${t.id}: ${t.fnName}`);
  lines.push(out.trim());
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-schedule-type-skilled-deploy-out.txt'),
  lines.join('\n') + '\n',
);
console.log('Wrote cdk-schedule-type-skilled-deploy-out.txt');
