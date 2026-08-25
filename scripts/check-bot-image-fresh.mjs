/**
 * Fail if the local ProviderSoft bot/shared sources do not match the ECR
 * image currently attached to the download Lambda (or :latest).
 *
 * Usage (repo root):
 *   npm run bot:check-fresh
 *   node scripts/check-bot-image-fresh.mjs --allow-missing-tag
 */
import { execSync } from 'node:child_process';
import { botSourceFingerprint, botSourceTag } from './bot-source-fingerprint.mjs';

const stackName = process.env.STACK_NAME ?? 'WhiteGloveStack';
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const allowMissingTag = process.argv.includes('--allow-missing-tag');

function awsJson(cmd) {
  return JSON.parse(
    execSync(`aws ${cmd} --region ${region} --output json`, { encoding: 'utf8' }),
  );
}

function getOutput(key) {
  const stacks = awsJson(`cloudformation describe-stacks --stack-name ${stackName}`);
  const out = stacks.Stacks[0].Outputs.find((o) => o.OutputKey === key);
  if (!out?.OutputValue) throw new Error(`Stack output ${key} not found`);
  return out.OutputValue;
}

function main() {
  const expected = botSourceFingerprint();
  const expectedTag = botSourceTag(expected);
  const ecrUri = getOutput('BotEcrRepositoryUri');
  const repoName = ecrUri.replace(/^[^/]+\//, '');

  const fnResource = awsJson(
    `cloudformation describe-stack-resources --stack-name ${stackName} --query "StackResources[?LogicalResourceId=='ProviderSoftDownloadFn4EFDACE3'].PhysicalResourceId | [0]"`,
  );
  if (!fnResource) throw new Error('ProviderSoftDownloadFn not found');

  const fn = awsJson(`lambda get-function --function-name ${fnResource}`);
  const imageUri = fn.Code?.ImageUri ?? '';
  const resolved = fn.Code?.ResolvedImageUri ?? '';

  const images = awsJson(
    `ecr describe-images --repository-name ${repoName} --image-ids imageTag=latest`,
  );
  const detail = images.imageDetails?.[0];
  const tags = detail?.imageTags ?? [];
  const digest = detail?.imageDigest ?? '';

  console.log(`Local bot source fingerprint: ${expected} (tag ${expectedTag})`);
  console.log(`Lambda ImageUri: ${imageUri}`);
  console.log(`Lambda ResolvedImageUri: ${resolved}`);
  console.log(`ECR :latest digest: ${digest}`);
  console.log(`ECR :latest tags: ${tags.join(', ') || '(none)'}`);

  if (tags.includes(expectedTag)) {
    console.log('OK — ECR :latest includes the local bot source tag. Schedules can use this image.');
    return;
  }

  const anySrcTag = tags.find((t) => t.startsWith('src-'));
  if (!anySrcTag && allowMissingTag) {
    console.warn(
      'WARN — ECR image has no src-* tag yet. Re-run: npm run deploy:aws:live',
    );
    process.exit(0);
  }

  console.error(`
STALE BOT IMAGE
  Local sources hash to ${expectedTag}, but ECR :latest is tagged: ${tags.join(', ') || '(none)'}.

  Plain "cdk deploy" / re-enabling EventBridge schedules does NOT rebuild the bot.
  Rebuild + retarget Lambda:

    npm run deploy:aws:live

  Then re-check:

    npm run bot:check-fresh
`);
  process.exit(1);
}

main();