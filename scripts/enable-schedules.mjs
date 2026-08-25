/**
 * Enable nightly / sessions EventBridge schedules only if the bot image matches
 * local providersoft-bot + shared sources.
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
    'enableNightSchedule=true',
    '-c',
    'enableSessionsSchedule=true',
    '-c',
    'hhaUseMock=false',
    '-c',
    `alertEmails=${process.env.ALERT_EMAILS ?? 'elefkowitz@whiteglovecare.net,moshe@advancedautomations.net'}`,
  ],
  { cwd: infraDir, stdio: 'inherit', shell: true },
);
process.exit(code.status ?? 1);