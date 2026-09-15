/**
 * Prefer this over `cdk deploy -c alertEmails=...` for adding/changing alert recipients.
 *
 * Updates:
 * 1. SNS email subscriptions on ExceptionTopic (subscribe — user must Confirm)
 * 2. ALERT_EMAILS on ValidateFn + NotifyFailureFn (+ optional other procs)
 *
 * Does NOT touch Lambda Code, EventBridge rules, or HHA_USE_PRODUCTION.
 * Still update infra/cdk.json alertEmails so the next intentional CDK deploy matches.
 *
 * Usage:
 *   node infra/deploy-alert-emails.mjs
 *   node infra/deploy-alert-emails.mjs --emails=a@x.com,b@y.com
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const region = process.env.AWS_REGION || 'us-east-1';

const emailsArg = process.argv.find((a) => a.startsWith('--emails='));
let emails;
if (emailsArg) {
  emails = emailsArg
    .slice('--emails='.length)
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
} else {
  const cdkJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'cdk.json'), 'utf8'));
  emails = String(cdkJson.context?.alertEmails || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

if (!emails.length) {
  console.error('No alert emails — pass --emails=a@x,b@y or set cdk.json context.alertEmails');
  process.exit(1);
}

const joined = emails.join(',');
console.log('ALERT_EMAILS =', joined);

const topicArn = execSync(
  `aws cloudformation describe-stacks --region ${region} --stack-name WhiteGloveStack --query "Stacks[0].Outputs[?OutputKey=='ExceptionTopicArn'].OutputValue | [0]" --output text`,
  { encoding: 'utf8' },
).trim();

if (!topicArn || topicArn === 'None') {
  console.error('Could not resolve ExceptionTopicArn from WhiteGloveStack outputs');
  process.exit(1);
}
console.log('Topic', topicArn);

const existing = JSON.parse(
  execSync(
    `aws sns list-subscriptions-by-topic --region ${region} --topic-arn ${topicArn} --output json`,
    { encoding: 'utf8' },
  ),
);
const existingEmails = new Set(
  (existing.Subscriptions || [])
    .filter((s) => s.Protocol === 'email' || s.Protocol === 'email-json')
    .map((s) => String(s.Endpoint || '').toLowerCase()),
);

for (const email of emails) {
  if (existingEmails.has(email.toLowerCase())) {
    console.log(`SNS already subscribed (or pending): ${email}`);
    continue;
  }
  console.log(`SNS subscribe ${email}…`);
  execSync(
    `aws sns subscribe --region ${region} --topic-arn ${topicArn} --protocol email --notification-endpoint ${email} --output json`,
    { stdio: 'inherit' },
  );
  console.log(`  → Confirm the email AWS sends to ${email}`);
}

const fnNames = [
  'WhiteGloveStack-ValidateFn1051E81A-l77AgX8N75Jb',
  'WhiteGloveStack-NotifyFailureFn6B706429-vJFpbEMjz1g4',
  'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
  'WhiteGloveStack-ClosedFn618EFC8C-A4srMirJOT3k',
  'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD',
];

function resolveParseFn() {
  try {
    const name = execSync(
      `aws lambda list-functions --region ${region} --query "Functions[?starts_with(FunctionName, 'WhiteGloveStack-ParseFn')].FunctionName | [0]" --output text`,
      { encoding: 'utf8' },
    ).trim();
    return name && name !== 'None' ? name : null;
  } catch {
    return null;
  }
}

const parseFn = resolveParseFn();
const targets = [...fnNames];
if (parseFn) targets.push(parseFn);

for (const fnName of targets) {
  console.log(`\nUpdating ALERT_EMAILS on ${fnName}…`);
  const prev = JSON.parse(
    execSync(
      `aws lambda get-function-configuration --region ${region} --function-name ${fnName} --query Environment.Variables --output json`,
      { encoding: 'utf8' },
    ),
  );
  const nextVars = { ...prev, ALERT_EMAILS: joined };
  const tmp = path.join(__dirname, `.alert-env-${fnName.slice(-32)}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ Variables: nextVars }));
  try {
    execSync(
      `aws lambda update-function-configuration --region ${region} --function-name ${fnName} --environment file://${tmp} --query "Environment.Variables.ALERT_EMAILS" --output text`,
      { stdio: 'inherit' },
    );
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

const outPath = path.join(__dirname, 'cdk-alert-emails-cli-deploy-out.txt');
fs.writeFileSync(
  outPath,
  [
    'deploy-alert-emails (CLI — no CDK / no Lambda Code)',
    new Date().toISOString(),
    `emails=${joined}`,
    `topic=${topicArn}`,
    `functions=${targets.join(',')}`,
    'Confirm any new SNS subscription emails.',
    'Keep infra/cdk.json context.alertEmails in sync for the next CDK deploy.',
    '',
  ].join('\n'),
);
console.log(`\nWrote ${path.basename(outPath)}`);
console.log('Done. No Lambda code was changed.');
