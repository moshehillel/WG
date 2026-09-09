import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-mfa-off-persist-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-mfa-off-persist.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const poolId = 'us-east-1_nDJo2pcjL';

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/tms-api/src/handler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: true,
  outfile,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

const roleArn = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query Role --output text`,
  { encoding: 'utf8' },
).trim();
const resolvedRole = roleArn.split('/').pop();
console.log('role', resolvedRole);

const poolArn = execSync(
  `aws cognito-idp describe-user-pool --user-pool-id ${poolId} --query UserPool.Arn --output text`,
  { encoding: 'utf8' },
).trim();

const policy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['cognito-idp:ListUsers', 'cognito-idp:AdminSetUserMFAPreference'],
      Resource: poolArn,
    },
  ],
};
const policyPath = path.join(__dirname, 'tms-mfa-clear-inline-policy.json');
fs.writeFileSync(policyPath, JSON.stringify(policy));
execSync(
  `aws iam put-role-policy --role-name ${resolvedRole} --policy-name TmsClearCognitoMfa --policy-document file://${policyPath}`,
  { stdio: 'inherit' },
);
console.log('IAM TmsClearCognitoMfa attached');

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,Handler:Handler,Runtime:Runtime,CodeSha256:CodeSha256,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

// One-shot clear Preferred MFA so password login has no EMAIL_OTP/TOTP while requireMfa is off.
const usersJson = execSync(
  `aws cognito-idp list-users --user-pool-id ${poolId} --limit 60 --output json`,
  { encoding: 'utf8' },
);
const users = JSON.parse(usersJson).Users || [];
let cleared = 0;
let errors = 0;
for (const u of users) {
  const username = u.Username;
  if (!username) continue;
  try {
    execSync(
      `aws cognito-idp admin-set-user-mfa-preference --user-pool-id ${poolId} --username ${username} --software-token-mfa-settings Enabled=false,PreferredMfa=false --sms-mfa-settings Enabled=false,PreferredMfa=false --email-mfa-settings Enabled=false,PreferredMfa=false`,
      { stdio: 'pipe' },
    );
    cleared += 1;
  } catch {
    errors += 1;
  }
}
console.log('one-shot Cognito MFA clear', { cleared, errors, total: users.length });

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-mfa-off-persist-deploy-out.txt'),
  [
    'TMS MFA: requireMfa=false persists before Cognito clear; FE Advanced reads saved OFF',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    `IAM: ListUsers + AdminSetUserMFAPreference on ${poolArn}`,
    `One-shot clear: cleared=${cleared} errors=${errors}`,
    'Root cause: (1) Cognito clear ran before Dynamo flush — proxy timeout left requireMfa sticky ON in practice / FE defaulted missing reads to true; (2) FE fetchAppMfaSettings failed open to requireMfa=true on /me blips → forced enroll every login; (3) Advanced UI did not cache/admin-read saved false reliably',
    'Fix: persistNow before clear; FE cache + admin/settings read; enforce only when requireMfa===true',
    'HHA: sandbox preserved (USE_MOCK=false, USE_PRODUCTION=false, ALLOW_PRODUCTION=false)',
    'FE Netlify repo: white-glove-tms-web',
    'Cache bust: app.js?v=72 styles.css?v=72',
    'Test: Advanced → Require MFA OFF → save → reload Advanced still OFF',
    'Test: sign out → password login → land in app (no enroll / no email OTP)',
    'From domain: advancedautomations.net (do not re-add whiteglovecare SES sending identities)',
    '',
  ].join('\n'),
);
console.log('wrote cdk-tms-mfa-off-persist-deploy-out.txt');
