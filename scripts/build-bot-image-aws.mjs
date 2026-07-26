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
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployLive = process.argv.includes('--deploy-live') || process.argv[1]?.includes('bot:deploy');
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

async function main() {
  console.log('=== Build ProviderSoft bot in AWS (CodeBuild — no local Docker) ===\n');
  console.log('Note: Bootstrap Lambda downloads from GitHub. Push latest code first.\n');

  const bootstrapFn = getOutput('BotBootstrapFunctionName');
  const ecrUri = getOutput('BotEcrRepositoryUri');

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
  console.log(`GitHub → S3 (${((result.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB), CodeBuild: ${result.buildId}`);

  await waitForBuild(result.buildId);

  console.log(`\nImage ready: ${ecrUri}:latest`);

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
