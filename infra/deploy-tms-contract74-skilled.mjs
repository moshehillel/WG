/**
 * Deploy TMS + processors with:
 * 1) AddPatientContract from student.programType before CreateSchedule (-74)
 * 2) CreateSchedule ScheduleType=Skilled for OT/PT/ST therapy (-310 from Non-Skilled)
 * Preserves HHA prod env flags on TMS.
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
  'Deploy: program-type ContractID attach (-74) + ScheduleType Skilled for therapy (-310)',
];

for (const t of targets) {
  const outDir = path.join(__dirname, `proc-${t.id}-contract74-skilled-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-${t.id}-contract74-skilled.zip`);

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
  const hasSkilled = bundled.includes('Skilled') && bundled.includes('Non-Skilled');
  const hasContractAttach =
    t.id !== 'tms' ||
    bundled.includes('needed for patient primary') ||
    bundled.includes('patient primary contract');
  console.log(
    `${t.id}: size=${fs.statSync(outfile).size} hasSkilled=${hasSkilled} hasContractAttach=${hasContractAttach}`,
  );
  if (!hasSkilled) throw new Error(`${t.id} missing Skilled/Non-Skilled schedule inference`);
  if (t.id === 'tms' && !hasContractAttach) {
    throw new Error('tms missing ensurePatientProgramContract marker');
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

const env = execSync(
  `aws lambda get-function-configuration --function-name ${targets[2].fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION}" --output json`,
  { encoding: 'utf8' },
);
lines.push('TMS HHA env:');
lines.push(env.trim());
lines.push(`GitSHA: ${execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: repoRoot }).trim()}`);

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-contract74-skilled-deploy-out.txt'),
  lines.join('\n') + '\n',
);
console.log('Wrote cdk-tms-contract74-skilled-deploy-out.txt');
