import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-mfa-require-off-clear-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-mfa-require-off-clear.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const roleName = 'WhiteGloveStack-TmsApiFnServiceRoleC1E5A0C5-1VQYQJXKJQYVQ'; // may differ — resolve below

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
console.log('role', resolvedRole || roleName);

const poolArn = execSync(
  `aws cognito-idp describe-user-pool --user-pool-id us-east-1_nDJo2pcjL --query UserPool.Arn --output text`,
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
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,Handler:Handler,Runtime:Runtime}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-mfa-require-off-clear-deploy-out.txt'),
  [
    'TMS MFA: requireMfa=false clears Cognito PreferredMFA so login is password-only',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    `IAM: ListUsers + AdminSetUserMFAPreference on ${poolArn}`,
    'Root cause: app requireMfa was already false in Dynamo, but Cognito EMAIL_OTP PreferredMfaSetting still forced EMAIL_OTP on USER_PASSWORD_AUTH',
    'One-shot clear applied to moshe@ / mgluck@ / bmarkowitz@ before deploy',
    'HHA: sandbox preserved (USE_MOCK=false, USE_PRODUCTION=false, ALLOW_PRODUCTION=false)',
    'Test: sign out → password login → no email OTP when requireMfa off and user MFA cleared',
    'Test: Advanced → Require MFA OFF → save → mfaClear.cleared > 0; next login password-only',
    'Test: user Security → Advanced → disable mine clears EMAIL_OTP without WebAuthnMfaSettings error',
    'From domain: advancedautomations.net (do not re-add whiteglovecare SES sending identities)',
    '',
  ].join('\n'),
);
