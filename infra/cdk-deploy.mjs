/**
 * Safe CDK deploy wrapper for WhiteGloveStack.
 *
 * 1. Runs `cdk deploy` with all passed args
 * 2. Always re-applies out-of-band Lambda code from current git (TmsApiFn + procs)
 *
 * Prefer for alert-only changes:
 *   node infra/deploy-alert-emails.mjs --emails=a@x,b@y
 * That updates SNS + ALERT_EMAILS env without a stack deploy.
 *
 * Usage (from repo root):
 *   npm run cdk:deploy -- --all --require-approval never
 *   node infra/cdk-deploy.mjs -c alertEmails=...
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const infraDir = __dirname;

const cdkArgs = process.argv.slice(2);
const skipRestore = cdkArgs.includes('--skip-lambda-restore');
const forwarded = cdkArgs.filter((a) => a !== '--skip-lambda-restore');

console.log('cdk deploy', forwarded.join(' ') || '(default)');
execSync(`npx cdk deploy ${forwarded.map((a) => JSON.stringify(a)).join(' ')}`.trim(), {
  cwd: infraDir,
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

if (skipRestore) {
  console.log('Skipping after-cdk lambda restore (--skip-lambda-restore)');
  process.exit(0);
}

console.log('\n=== after-cdk-deploy-restore-lambdas ===');
execSync('node scripts/after-cdk-deploy-restore-lambdas.mjs', {
  cwd: repoRoot,
  stdio: 'inherit',
});
