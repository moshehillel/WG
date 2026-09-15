/**
 * Enable live EventBridge schedules.
 * Rules are always provisioned by CDK (disabled by default); this flips State to ENABLED.
 *
 * Usage:
 *   npm run schedules:enable              # both nightly cases + Tuesday sessions
 *   npm run schedules:enable -- --cases-only
 *   npm run schedules:enable -- --sessions-only
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const casesOnly = args.has('--cases-only');
const sessionsOnly = args.has('--sessions-only');
if (casesOnly && sessionsOnly) {
  console.error('Use only one of --cases-only or --sessions-only');
  process.exit(1);
}

const check = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'scripts/check-bot-image-fresh.mjs')],
  { cwd: repoRoot, stdio: 'inherit' },
);
if (check.status !== 0) process.exit(check.status ?? 1);

function listLiveScheduleRules() {
  const nameFilter = casesOnly
    ? "contains(Name, 'NightlyCaseReports')"
    : sessionsOnly
      ? "contains(Name, 'TuesdaySessions')"
      : "contains(Name, 'NightlyCaseReports') || contains(Name, 'TuesdaySessions')";
  const listed = spawnSync(
    'aws',
    [
      'events',
      'list-rules',
      '--name-prefix',
      'WhiteGloveStack-',
      '--query',
      `Rules[?${nameFilter}].Name`,
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
      `alertEmails=${process.env.ALERT_EMAILS ?? 'elefkowitz@whiteglovecare.net,moshe@advancedautomations.net,ggreenfeld@whiteglovecare.net,alowy@whiteglovecare.net,gfriedman@whiteglovecare.net,miris@whiteglovecare.net'}`,
    ],
    { cwd: infraDir, stdio: 'inherit', shell: true },
  );
  if (deploy.status !== 0) process.exit(deploy.status ?? 1);
  rules = listLiveScheduleRules();
}

if (!rules.length) {
  console.error(
    casesOnly
      ? 'No NightlyCaseReports EventBridge rule found after deploy.'
      : sessionsOnly
        ? 'No TuesdaySessions EventBridge rule found after deploy.'
        : 'No NightlyCaseReports / TuesdaySessions EventBridge rules found after deploy.',
  );
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
if (casesOnly) {
  console.log('Mode: cases only — Tuesday API/sessions schedule was not changed.');
} else if (sessionsOnly) {
  console.log('Mode: sessions only — Nightly case reports schedule was not changed.');
}
console.log('Note: Monday dry-run preview is not toggled by this script.');
process.exit(0);
