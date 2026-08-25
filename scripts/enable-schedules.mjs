/**
 * Enable live EventBridge schedules (nightly cases + Tuesday sessions).
 * Rules are always provisioned by CDK (disabled by default); this flips State to ENABLED.
 *
 * Usage:
 *   npm run schedules:enable
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const check = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'scripts/check-bot-image-fresh.mjs')],
  { cwd: repoRoot, stdio: 'inherit' },
);
if (check.status !== 0) process.exit(check.status ?? 1);

function listLiveScheduleRules() {
  const listed = spawnSync(
    'aws',
    [
      'events',
      'list-rules',
      '--name-prefix',
      'WhiteGloveStack-',
      '--query',
      "Rules[?contains(Name, 'NightlyCaseReports') || contains(Name, 'TuesdaySessions')].Name",
      '--output',
      'text',
    ],
    { cwd: repoRoot, encoding: 'utf8', shell: true },
  );
  if (listed.status !== 0) {
    console.error(listed.stderr || listed.stdout || 'aws events list-rules failed');
    process.exit(listed.status ?? 1);
  }
  return (listed.stdout || '')
    .trim()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

let rules = listLiveScheduleRules();
if (!rules.length) {
  console.log(
    'Live schedule rules not found — deploying stack so Nightly/Tuesday rules exist (DISABLED)…',
  );
  const infraDir = path.join(repoRoot, 'infra');
  const deploy = spawnSync(
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
      'hhaUseMock=false',
      '-c',
      `alertEmails=${process.env.ALERT_EMAILS ?? 'elefkowitz@whiteglovecare.net,moshe@advancedautomations.net'}`,
    ],
    { cwd: infraDir, stdio: 'inherit', shell: true },
  );
  if (deploy.status !== 0) process.exit(deploy.status ?? 1);
  rules = listLiveScheduleRules();
}

if (!rules.length) {
  console.error('No NightlyCaseReports / TuesdaySessions EventBridge rules found after deploy.');
  process.exit(1);
}

for (const name of rules) {
  console.log(`Enabling ${name}…`);
  const en = spawnSync('aws', ['events', 'enable-rule', '--name', name], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
  if (en.status !== 0) process.exit(en.status ?? 1);
}

console.log('Live schedules ENABLED:', rules.join(', '));
console.log('Note: Monday dry-run preview is not toggled by this script.');
process.exit(0);
