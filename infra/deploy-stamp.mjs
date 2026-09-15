/**
 * Stamp TMS_GIT_SHA + TMS_BUILT_AT on a Lambda after UpdateFunctionCode.
 * Makes accidental CDK/old-asset rollbacks easy to spot in get-function-configuration.
 *
 * Does NOT change HHA_USE_PRODUCTION or other business flags — only adds/overwrites
 * the two stamp keys onto the existing environment.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

export function readGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      cwd: repoRoot,
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function stampBuiltAt() {
  return new Date().toISOString();
}

/**
 * Merge TMS_GIT_SHA / TMS_BUILT_AT into Lambda environment Variables.
 * @param {string} fnName
 * @param {{ region?: string, sha?: string, builtAt?: string }} [opts]
 */
export function stampLambdaGitEnv(fnName, opts = {}) {
  const region = opts.region || process.env.AWS_REGION || 'us-east-1';
  const sha = opts.sha || readGitSha();
  const builtAt = opts.builtAt || stampBuiltAt();

  execSync(`aws lambda wait function-updated --region ${region} --function-name ${fnName}`, {
    stdio: 'inherit',
  });

  const prevRaw = execSync(
    `aws lambda get-function-configuration --region ${region} --function-name ${fnName} --query Environment.Variables --output json`,
    { encoding: 'utf8' },
  );
  const prev = JSON.parse(prevRaw);

  const nextVars = {
    ...(prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}),
    TMS_GIT_SHA: sha,
    TMS_BUILT_AT: builtAt,
  };

  // file:// JSON avoids PowerShell Variables={a=b,c=d} quoting pitfalls
  const tmp = path.join(
    __dirname,
    `.stamp-env-${fnName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-48)}.json`,
  );
  fs.writeFileSync(tmp, JSON.stringify({ Variables: nextVars }));

  try {
    execSync(
      `aws lambda update-function-configuration --region ${region} --function-name ${fnName} --environment file://${tmp} --query "{TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,LastModified:LastModified}" --output json`,
      { stdio: 'inherit' },
    );
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }

  return { sha, builtAt };
}
