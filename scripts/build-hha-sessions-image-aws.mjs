#!/usr/bin/env node
/**
 * Build HHA ENT Sessions Playwright Lambda image in AWS (no local Docker).
 *
 * Usage:
 *   npm run hha:sessions:deploy:aws              # GitHub source → CodeBuild
 *   npm run hha:sessions:deploy:aws -- --local   # zip local repo → CodeBuild
 *   npm run hha:sessions:deploy:aws -- --deploy-live
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployLive = process.argv.includes('--deploy-live');
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
  throw new Error('CodeBuild timed out');
}

const LOCAL_ZIP_EXCLUDES = new Set([
  '.git',
  'node_modules',
  '.playwright',
  'cdk.out',
  'dist',
  '.cursor',
  'coverage',
  'agent-transcripts',
  'terminals',
  'docs',
  'providersoft-bot',
  'recordings',
  'scripts',
]);

/** Only infra/dockerignore.hha-sessions is needed for CodeBuild; skip rest of infra/. */
const LOCAL_ZIP_INFRA_ALLOW = new Set(['dockerignore.hha-sessions']);

function shouldIncludeInLocalZip(rel) {
  if (!rel) return true;
  const norm = rel.replace(/\\/g, '/');
  const parts = norm.split('/');
  if (parts.some((p) => LOCAL_ZIP_EXCLUDES.has(p))) return false;
  if (norm.startsWith('infra/') && !LOCAL_ZIP_INFRA_ALLOW.has(parts[1] ?? '')) return false;
  if (norm.endsWith('.har') || norm.endsWith('.pdf')) return false;
  if (/^_(dry-run|exec|lambda|paycode|sfn|unscheduled|tmp|har|ent|probe|validate|run2|get-|opened|ns-|cg-|ex-|sessions|verified|exceptions)/.test(parts[0] ?? '')) return false;
  if (parts[0]?.startsWith('_') && (parts[0].endsWith('.json') || parts[0].endsWith('.mjs') || parts[0].endsWith('.cjs') || parts[0].endsWith('.html') || parts[0].endsWith('.txt'))) {
    return false;
  }
  if (parts[0]?.startsWith('deploy') && parts[0]?.endsWith('.txt')) return false;
  return true;
}

function zipLocalRepo(outZip) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-hha-'));
  const dest = path.join(staging, 'white-glove');
  console.log('Copying repo to staging (minimal HHA sessions build context)...');
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
  const zipPath = path.join(os.tmpdir(), `hha-sessions-source-${Date.now()}.zip`);
  console.log('Zipping local repo (excludes node_modules, .git)...');
  const bytes = zipLocalRepo(zipPath);
  const mb = (bytes / 1024 / 1024).toFixed(1);
  const zipBase64 = fs.readFileSync(zipPath).toString('base64');

  // Lambda invoke payload limit (~6MB). Larger local zips go straight to the CodeBuild source bucket.
  if (zipBase64.length > 5_500_000) {
    const project = getOutput('HhaSessionsBotCodeBuildProjectName');
    const bucket = awsJson(
      `cloudformation describe-stack-resources --stack-name ${stackName} --query "StackResources[?LogicalResourceId=='HhaSessionsBotImageSourceBucket31A03D35'].PhysicalResourceId | [0]"`,
    );
    if (!bucket || typeof bucket !== 'string') {
      throw new Error(
        'HHA sessions source bucket not found — cannot upload oversized local zip',
      );
    }
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
  const payloadPath = path.join(os.tmpdir(), `hha-bootstrap-payload-${Date.now()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify({ zipBase64 }));
  const outFile = path.join(os.tmpdir(), `hha-bootstrap-out-${Date.now()}.json`);
  aws(
    `lambda invoke --function-name ${bootstrapFn} --cli-binary-format raw-in-base64-out --payload fileb://${payloadPath.replace(/\\/g, '/')} ${outFile.replace(/\\/g, '/')}`,
  );
  fs.unlinkSync(payloadPath);
  const result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  fs.unlinkSync(outFile);
  if (!result.ok || !result.buildId) throw new Error(`Bootstrap failed: ${JSON.stringify(result)}`);
  return result.buildId;
}

async function main() {
  console.log('=== Build HHA Sessions bot in AWS ===\n');

  const bootstrapFn = getOutput('HhaSessionsBotBootstrapFunctionName');
  const ecrUri = getOutput('HhaSessionsBotEcrRepositoryUri');
  const project = getOutput('HhaSessionsBotCodeBuildProjectName');

  let buildId;
  if (useLocal) {
    buildId = await uploadLocalAndBuild(bootstrapFn);
    console.log(`Started CodeBuild: ${buildId}`);
  } else {
    console.log(`Invoking ${bootstrapFn} (GitHub source)...`);
    const outFile = path.join(os.tmpdir(), `hha-bootstrap-${Date.now()}.json`);
    aws(
      `lambda invoke --function-name ${bootstrapFn} --cli-binary-format raw-in-base64-out --payload "{}" "${outFile.replace(/\\/g, '/')}"`,
    );
    const result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    fs.unlinkSync(outFile);
    if (!result.ok || !result.buildId) throw new Error(`Bootstrap failed: ${JSON.stringify(result)}`);
    buildId = result.buildId;
  }

  await waitForBuild(buildId);
  console.log(`\nImage ready: ${ecrUri}:latest`);

  const fn = awsJson(
    `cloudformation describe-stack-resources --stack-name ${stackName} --query "StackResources[?LogicalResourceId=='SessionsFn37158A11'].PhysicalResourceId | [0]"`,
  );
  if (fn) {
    aws(`lambda update-function-code --function-name ${fn} --image-uri ${ecrUri}:latest`);
    console.log(`Forced Lambda ${fn} to pull ${ecrUri}:latest`);
  }

  if (deployLive) {
    console.log('\nDeploying SessionsFn Docker Lambda (CDK)...');
    const infraDir = path.join(repoRoot, 'infra');
    const code = spawnSync(
      'npx',
      [
        'cdk',
        'deploy',
        'WhiteGloveStack',
        '--require-approval',
        'never',
        '-c',
        'providerSoftLiveBot=true',
        '-c',
        'providerSoftUseStubs=false',
        '-c',
        'hhaEntLiveBot=true',
        // Keep production EventBridge schedules (do not force them off).
        '-c',
        'enableNightSchedule=true',
        '-c',
        'enableSessionsSchedule=true',
      ],
      { cwd: infraDir, stdio: 'inherit', shell: true },
    );
    if (code.status !== 0) throw new Error('CDK deploy failed');
  }

  console.log('\nDone. Set HhaSecret entUsername/entPassword (and entHhamfaCookies after local login).');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
