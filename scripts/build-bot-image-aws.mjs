#!/usr/bin/env node
/**
 * Build ProviderSoft Playwright Lambda image in AWS (no local Docker).
 *
 * 1. Invoke Bootstrap Lambda → downloads GitHub repo → S3 → starts CodeBuild
 * 2. Wait for CodeBuild (~15–25 min)
 * 3. Deploy live bot Lambda (or update existing)
 *
 * Prerequisite: push latest code to GitHub (moshehillel/WG).
 *
 * Usage (repo root):
 *   npm run bot:deploy:aws
 *   npm run bot:deploy:aws -- --local --deploy-live
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployLive = process.argv.includes('--deploy-live') || process.argv[1]?.includes('bot:deploy');
const useLocal = process.argv.includes('--local');
const stackName = process.env.STACK_NAME ?? 'WhiteGloveStack';
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function aws(cmd) {
  return execSync(`aws ${cmd} --region ${region}`, { encoding: 'utf8' }).trim();
}

function awsJson(cmd) {
  return JSON.parse(aws(`${cmd} --output json`));
}

function getOutput(key) {
  const stacks = awsJson(`cloudformation describe-stacks --stack-name ${stackName}`);
  const out = stacks.Stacks[0].Outputs.find((o) => o.OutputKey === key);
  if (!out?.OutputValue) throw new Error(`Stack output ${key} not found — run cdk deploy first`);
  return out.OutputValue;
}

async function waitForBuild(buildId) {
  console.log(`Waiting for CodeBuild ${buildId} (typically 15–25 min)...`);
  for (let i = 0; i < 120; i++) {
    const res = awsJson(`codebuild batch-get-builds --ids ${buildId}`);
    const build = res.builds[0];
    const status = build.buildStatus;
    if (i % 4 === 0) console.log(`  ${new Date().toISOString().slice(11, 19)} status: ${status}`);
    if (status === 'SUCCEEDED') {
      console.log('CodeBuild succeeded.');
      return;
    }
    if (status === 'FAILED' || status === 'FAULT' || status === 'STOPPED') {
      console.error('CodeBuild failed:', status);
      for (const p of build.phases ?? []) {
        if (p.phaseStatus === 'FAILED') {
          console.error(`  ${p.phaseType}: ${p.contexts?.map((c) => c.message).join('; ')}`);
        }
      }
      throw new Error(`CodeBuild ${status}`);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error('CodeBuild timed out after 30 minutes');
}

/** Docker build only needs shared + providersoft-bot (+ lockfiles). Keep under Lambda 6MB. */
const LOCAL_ZIP_ALLOW_PREFIXES = [
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'packages/shared/',
  'packages/providersoft-bot/',
];

const LOCAL_ZIP_PART_EXCLUDES = new Set([
  'node_modules',
  'dist',
  'downloads',
  'tmp-column-probe',
  'tmp',
  'coverage',
  '.playwright',
]);

function shouldIncludeInLocalZip(rel) {
  if (!rel) return true;
  const norm = rel.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  if (parts.some((p) => LOCAL_ZIP_PART_EXCLUDES.has(p))) return false;
  if (parts.some((p) => p === '.git' || p === '.cursor')) return false;
  if (/\.(har|csv|map)$/i.test(norm)) return false;

  // Allow parent dirs so fs.cpSync can recurse into packages/shared, etc.
  if (norm === 'packages' || norm === 'packages/shared' || norm === 'packages/providersoft-bot') {
    return true;
  }
  return LOCAL_ZIP_ALLOW_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

function zipLocalRepo(outZip) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-ps-'));
  const dest = path.join(staging, 'white-glove');
  console.log('Copying repo to staging (excluding node_modules, cdk.out, dist)...');
  fs.cpSync(repoRoot, dest, {
    recursive: true,
    filter: (src) => shouldIncludeInLocalZip(path.relative(repoRoot, src)),
  });
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);
  console.log('Creating zip via tar...');
  execSync(`tar -acf "${outZip}" -C "${staging}" white-glove`, { stdio: 'inherit' });
  fs.rmSync(staging, { recursive: true, force: true });
  return fs.statSync(outZip).size;
}

async function uploadLocalAndBuild(bootstrapFn) {
  const zipPath = path.join(os.tmpdir(), `providersoft-source-${Date.now()}.zip`);
  const bytes = zipLocalRepo(zipPath);
  const mb = (bytes / 1024 / 1024).toFixed(1);
  const zipBase64 = fs.readFileSync(zipPath).toString('base64');

  // Lambda invoke payload limit (~6MB). Larger local zips go straight to the CodeBuild source bucket.
  if (zipBase64.length > 5_500_000) {
    const bucket = getOutput('BotSourceBucketName');
    const project = getOutput('BotCodeBuildProjectName');
    console.log(`Local zip ${mb} MB exceeds Lambda payload — uploading to s3://${bucket}/source.zip …`);
    aws(`s3 cp "${zipPath.replace(/\\/g, '/')}" "s3://${bucket}/source.zip"`);
    fs.unlinkSync(zipPath);
    const started = awsJson(`codebuild start-build --project-name ${project}`);
    const buildId = started.build?.id;
    if (!buildId) throw new Error(`CodeBuild start failed: ${JSON.stringify(started)}`);
    console.log(`Started CodeBuild from S3 source: ${buildId}`);
    return buildId;
  }

  console.log(`Uploading ${mb} MB via bootstrap Lambda…`);
  fs.unlinkSync(zipPath);
  const payloadPath = path.join(os.tmpdir(), `ps-bootstrap-payload-${Date.now()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify({ zipBase64 }));
  const outFile = path.join(os.tmpdir(), `ps-bootstrap-out-${Date.now()}.json`);
  aws(
    `lambda invoke --function-name ${bootstrapFn} --cli-binary-format raw-in-base64-out --payload fileb://${payloadPath.replace(/\\/g, '/')} ${outFile.replace(/\\/g, '/')}`,
  );
  fs.unlinkSync(payloadPath);
  const result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  fs.unlinkSync(outFile);
  if (!result.ok || !result.buildId) throw new Error(`Bootstrap failed: ${JSON.stringify(result)}`);
  return result.buildId;
}

function forceUpdateDownloadFn(ecrUri) {
  const fn = awsJson(
    `cloudformation describe-stack-resources --stack-name ${stackName} --query "StackResources[?LogicalResourceId=='ProviderSoftDownloadFn4EFDACE3'].PhysicalResourceId | [0]"`,
  );
  if (!fn) throw new Error('ProviderSoftDownloadFn not found in stack');
  aws(`lambda update-function-code --function-name ${fn} --image-uri ${ecrUri}:latest`);
  console.log(`Forced Lambda ${fn} to pull ${ecrUri}:latest`);
}

async function main() {
  console.log('=== Build ProviderSoft bot in AWS (CodeBuild — no local Docker) ===\n');
  if (!useLocal) console.log('Note: Bootstrap Lambda downloads from GitHub. Push latest code first.\n');

  const bootstrapFn = getOutput('BotBootstrapFunctionName');
  const ecrUri = getOutput('BotEcrRepositoryUri');

  let buildId;
  if (useLocal) {
    buildId = await uploadLocalAndBuild(bootstrapFn);
    console.log(`Started CodeBuild: ${buildId}`);
  } else {
    console.log(`Invoking ${bootstrapFn} ...`);
    const outFile = path.join(os.tmpdir(), `bot-bootstrap-${Date.now()}.json`);
    const invokeMeta = awsJson(
      `lambda invoke --function-name ${bootstrapFn} --cli-binary-format raw-in-base64-out --payload "{}" ${outFile.replace(/\\/g, '/')}`,
    );
    if (invokeMeta.FunctionError) {
      const errBody = fs.readFileSync(outFile, 'utf8');
      throw new Error(`Bootstrap Lambda failed: ${invokeMeta.FunctionError}\n${errBody}`);
    }
    const result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    fs.unlinkSync(outFile);
    if (!result.ok || !result.buildId) throw new Error(`Bootstrap failed: ${JSON.stringify(result)}`);
    buildId = result.buildId;
    console.log(`GitHub → S3 (${((result.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB), CodeBuild: ${buildId}`);
  }

  await waitForBuild(buildId);

  console.log(`\nImage ready: ${ecrUri}:latest`);
  forceUpdateDownloadFn(ecrUri);

  if (deployLive) {
    console.log('\nDeploying live bot Lambda (CDK)...');
    const infraDir = path.join(repoRoot, 'infra');
    const code = spawnSync(
      'npx',
      [
        'cdk',
        'deploy',
        '--all',
        '--require-approval',
        'never',
        '-c',
        'providerSoftLiveBot=true',
        '-c',
        'providerSoftUseStubs=false',
        '-c',
        'enableNightSchedule=false',
        '-c',
        'enableSessionsSchedule=false',
        '-c',
        'hhaUseMock=false',
        '-c',
        `alertEmails=${process.env.ALERT_EMAILS ?? 'elefkowitz@whiteglovecare.net,moshe@advancedautomations.net'}`,
      ],
      { cwd: infraDir, stdio: 'inherit', shell: true },
    );
    if (code.status !== 0) throw new Error('CDK deploy failed');
  }

  console.log('\nDone. Live bot deployed. Nightly schedules stay off unless you pass enableNightSchedule / enableSessionsSchedule.');
  console.log('Verify stack outputs: ProviderSoftLiveBot=true, ProviderSoftUseStubs=false');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
