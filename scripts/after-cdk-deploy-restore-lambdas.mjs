/**
 * After any `cdk deploy` of WhiteGloveStack, re-apply out-of-band Lambda code from git.
 *
 * Why: even with Code locked out of CFN templates, a failed deploy / rollback / unlocked
 * synth can still leave processors or TmsApiFn on a stale asset. This is the safety net
 * used after the Sep 14 cdk-alert-miris incident.
 *
 * Does NOT flip HHA_USE_PRODUCTION (restore-current may set it true to match live).
 * Prefer for alerts: node infra/deploy-alert-emails.mjs (no CDK).
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGitSha, stampBuiltAt, stampLambdaGitEnv } from '../infra/deploy-stamp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const infraDir = path.join(repoRoot, 'infra');

const skipTms = process.argv.includes('--skip-tms');
const skipProc = process.argv.includes('--skip-proc');
const stampOnly = process.argv.includes('--stamp-only');

const TMS_FN = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const PROC_FNS = [
  'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
  'WhiteGloveStack-ClosedFn618EFC8C-A4srMirJOT3k',
  'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD',
  'WhiteGloveStack-ValidateFn1051E81A-l77AgX8N75Jb',
  'WhiteGloveStack-NotifyFailureFn6B706429-vJFpbEMjz1g4',
];

const sha = readGitSha();
const builtAt = stampBuiltAt();
console.log(`after-cdk-deploy-restore-lambdas git=${sha} at=${builtAt}`);

if (!stampOnly) {
  if (!skipTms) {
    console.log('\n=== restore TmsApiFn (deploy-tms-restore-current.mjs) ===');
    execSync('node deploy-tms-restore-current.mjs', { cwd: infraDir, stdio: 'inherit' });
  }
  if (!skipProc) {
    console.log('\n=== restore processors (deploy-proc-restore-after-miris.mjs) ===');
    execSync('node deploy-proc-restore-after-miris.mjs', { cwd: infraDir, stdio: 'inherit' });
  }
}

console.log('\n=== stamp TMS_GIT_SHA / TMS_BUILT_AT ===');
const stamped = [];
for (const fnName of [TMS_FN, ...PROC_FNS]) {
  if (skipTms && fnName === TMS_FN) continue;
  if (skipProc && PROC_FNS.includes(fnName)) continue;
  try {
    const r = stampLambdaGitEnv(fnName, { sha, builtAt });
    stamped.push(`${fnName} sha=${r.sha}`);
    console.log('stamped', fnName);
  } catch (err) {
    console.warn(`stamp failed for ${fnName}:`, err?.message || err);
  }
}

const outPath = path.join(infraDir, 'cdk-after-deploy-restore-out.txt');
fs.writeFileSync(
  outPath,
  [
    'after-cdk-deploy-restore-lambdas',
    new Date().toISOString(),
    `git=${sha}`,
    `builtAt=${builtAt}`,
    `skipTms=${skipTms} skipProc=${skipProc} stampOnly=${stampOnly}`,
    ...stamped,
    '',
  ].join('\n'),
);
console.log(`\nWrote ${path.basename(outPath)}`);
