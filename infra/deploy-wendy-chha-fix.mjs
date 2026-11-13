/**
 * LIVE: never write Manager Wendy (2036); write/verify Therapy Team 10022046 on
 * patient demographics updates; keep CHHA Case (10073742) for ProviderSoft only;
 * refuse TMS CreatePatient when branch is still CHHA Case / unset.
 * OpenedFn + SessionsFn + TmsApiFn code only. Sets HHA_CREATE_PATIENT_CHANNEL=tms
 * on TmsApiFn. Does not CDK-deploy, disable schedules, or start pipelines.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';

process.env.AWS_NO_VERIFY_SSL = '1';
const aws = 'aws --no-verify-ssl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const gitSha = `${readGitSha()}-wendy-chha-fix-2026-11-10`;

const processorTargets = [
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

const tmsFnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

function assertTherapyBundle(id, bundled) {
  const decl = bundled.match(
    /var ([A-Za-z0-9_$]+)=10022046,([A-Za-z0-9_$]+)=67321,([A-Za-z0-9_$]+)=84898(?:[;,]|$)/,
  );
  if (!decl) {
    throw new Error(`${id} bundle missing Therapy Team 10022046 with Grace 67321 and Billu 84898`);
  }
  if (!bundled.includes('Manager Wendy Ext. 3238')) {
    throw new Error(`${id} bundle missing Manager Wendy name label`);
  }
  if (!bundled.includes('CHHA Case')) {
    throw new Error(`${id} bundle missing CHHA Case refusal text`);
  }
  if (bundled.includes('existing chart keeps the team')) {
    throw new Error(`${id} bundle still keeps chart TeamID (Wendy echo path)`);
  }
}

const adapterSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/soap-adapter.ts'),
  'utf8',
);
if (!adapterSrc.includes('therapyTeamVerifyMismatchMessage')) {
  throw new Error('soap-adapter missing TeamID verify');
}
if (!adapterSrc.includes('MANAGER_WENDY_TEAM_ID')) {
  throw new Error('soap-adapter missing Wendy refuse');
}
if (adapterSrc.includes('existing chart keeps the team')) {
  throw new Error('soap-adapter still has keep-chart-team comment');
}

const builderSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/create-patient-builder.ts'),
  'utf8',
);
if (!builderSrc.includes('PROVIDERSOFT_CHHA_CASE_BRANCH_ID = 10073742')) {
  throw new Error('create-patient-builder missing CHHA Case branch constant');
}
if (!builderSrc.includes("raw === 'tms'")) {
  throw new Error('create-patient-builder missing TMS channel');
}

sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const results = [];

for (const target of processorTargets) {
  const outDir = path.join(__dirname, `proc-${target.id}-wendy-chha-fix-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-${target.id}-wendy-chha-fix.zip`);
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
  assertTherapyBundle(target.id, bundled);
  console.log(target.id, 'bundle', fs.statSync(outfile).size);

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  sh(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}','${(outfile + '.map').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { cwd: __dirname },
  );
  const out = execSync(
    `${aws} lambda update-function-code --function-name ${target.fnName} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  );
  console.log(target.id, out.trim());
  execSync(`${aws} lambda wait function-updated --function-name ${target.fnName} --region us-east-1`, {
    stdio: 'inherit',
  });
  results.push({ id: target.id, fnName: target.fnName, info: JSON.parse(out) });
}

{
  const outDir = path.join(__dirname, 'tms-api-wendy-chha-fix-asset');
  const stageDir = path.join(__dirname, '_zip_stage_wendy-chha-fix');
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, 'tms-api-wendy-chha-fix.zip');
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

  await esbuild.build({
    entryPoints: [path.join(repoRoot, 'packages/tms-api/src/handler.ts')],
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
    define: { 'process.env.TMS_GIT_SHA': JSON.stringify(gitSha) },
    mainFields: ['module', 'main'],
    external: ['playwright', 'playwright-core', '@playwright/test'],
  });

  const bundled = fs.readFileSync(outfile, 'utf8');
  if (!bundled.includes('CHHA Case')) {
    throw new Error('TmsApiFn bundle missing CHHA Case refusal text');
  }
  if (!bundled.includes('10022046')) {
    throw new Error('TmsApiFn bundle missing Therapy Team 10022046');
  }
  if (!bundled.includes('84898')) {
    throw new Error('TmsApiFn bundle missing Billu 84898');
  }
  console.log('tms', 'bundle', fs.statSync(outfile).size);

  fs.mkdirSync(stageDir, { recursive: true });
  for (const f of fs.readdirSync(stageDir)) fs.unlinkSync(path.join(stageDir, f));
  fs.copyFileSync(outfile, path.join(stageDir, 'index.mjs'));
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  sh(
    `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stageDir, 'index.mjs').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { cwd: __dirname },
  );

  const beforeProd = JSON.parse(
    execSync(
      `${aws} lambda get-function-configuration --function-name ${tmsFnName} --query "Environment.Variables.HHA_USE_PRODUCTION" --output json`,
      { encoding: 'utf8' },
    ),
  );
  if (String(beforeProd) !== 'true') {
    throw new Error(`Refusing TmsApiFn deploy: HHA_USE_PRODUCTION is ${beforeProd}`);
  }

  const out = execSync(
    `${aws} lambda update-function-code --function-name ${tmsFnName} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  );
  console.log('tms', out.trim());
  execSync(`${aws} lambda wait function-updated --function-name ${tmsFnName} --region us-east-1`, {
    stdio: 'inherit',
  });
  stampLambdaGitEnv(tmsFnName, { sha: gitSha });

  // Merge HHA_CREATE_PATIENT_CHANNEL=tms into existing env (no CDK).
  const cfg = JSON.parse(
    execSync(
      `${aws} lambda get-function-configuration --function-name ${tmsFnName} --query Environment.Variables --output json`,
      { encoding: 'utf8' },
    ),
  );
  cfg.HHA_CREATE_PATIENT_CHANNEL = 'tms';
  delete cfg.HHA_BRANCH_ID;
  // TMS therapy branch WGCC Therapy Services (Moshe directed 2026-11-11).
  cfg.HHA_TMS_BRANCH_ID = '10090277';
  const envPath = path.join(__dirname, '_tmp-tms-wendy-chha-env.json');
  fs.writeFileSync(envPath, JSON.stringify({ Variables: cfg }));
  execSync(
    `${aws} lambda update-function-configuration --function-name ${tmsFnName} --environment file://${envPath} --region us-east-1 --query "{HHA_CREATE_PATIENT_CHANNEL:Environment.Variables.HHA_CREATE_PATIENT_CHANNEL,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_TEAM_ID:Environment.Variables.HHA_TEAM_ID,HHA_COORDINATOR_ID:Environment.Variables.HHA_COORDINATOR_ID}" --output json`,
    { stdio: 'inherit' },
  );
  execSync(`${aws} lambda wait function-updated --function-name ${tmsFnName} --region us-east-1`, {
    stdio: 'inherit',
  });
  fs.unlinkSync(envPath);
  results.push({ id: 'tms', fnName: tmsFnName, info: JSON.parse(out), gitSha });
}

const schedule = execSync(
  `${aws} events list-rules --query "Rules[?contains(Name, 'WhiteGlove')].[Name,State]" --output json`,
  { encoding: 'utf8' },
);
console.log('schedules', schedule.trim());
console.log('deployed', JSON.stringify(results, null, 2));
console.log('wendy/CHHA fix deployed. schedules not disabled. no CDK.');
