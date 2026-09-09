import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminSetUserMFAPreferenceCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-mfa-disable-everyone-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-mfa-disable-everyone.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const poolId = 'us-east-1_nDJo2pcjL';
const table = 'WhiteGloveStack-TmsStateTable10F38FC9-1OCJ1211NQLHU';

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
const codeSha = JSON.parse(out).CodeSha256;

// Force Dynamo requireMfa=false (idempotent).
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const existing = await doc.send(
  new GetCommand({ TableName: table, Key: { pk: 'ENTITY#settings', sk: 'ID#global' } }),
);
const entity = {
  ...(existing.Item?.entity && typeof existing.Item.entity === 'object' ? existing.Item.entity : {}),
  id: 'global',
  requireMfa: false,
  allowSmsMfa: false,
};
await doc.send(
  new PutCommand({
    TableName: table,
    Item: {
      pk: 'ENTITY#settings',
      sk: 'ID#global',
      collection: 'settings',
      entityId: 'global',
      entity,
    },
  }),
);
console.log('Dynamo requireMfa forced false', entity.requireMfa);

// Clear Cognito MFA for all users.
const cognito = new CognitoIdentityProviderClient({});
const disabledMfa = {
  SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
  SMSMfaSettings: { Enabled: false, PreferredMfa: false },
  EmailMfaSettings: { Enabled: false, PreferredMfa: false },
};
let token;
let cleared = 0;
let errors = 0;
const usernames = [];
do {
  const page = await cognito.send(
    new ListUsersCommand({ UserPoolId: poolId, Limit: 60, PaginationToken: token }),
  );
  for (const u of page.Users || []) {
    if (u.Username) usernames.push(u.Username);
  }
  token = page.PaginationToken;
} while (token);

for (const username of usernames) {
  try {
    await cognito.send(
      new AdminSetUserMFAPreferenceCommand({
        UserPoolId: poolId,
        Username: username,
        ...disabledMfa,
      }),
    );
    cleared += 1;
  } catch (err) {
    errors += 1;
    console.warn('clear failed', username, err?.name || err);
  }
}

let stillMfa = 0;
for (const username of usernames) {
  const u = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
  if ((u.UserMFASettingList && u.UserMFASettingList.length) || u.PreferredMfaSetting) stillMfa += 1;
}

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,CodeSha256:CodeSha256,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);
console.log('Cognito clear', { cleared, errors, stillMfa, total: usernames.length });

// Simulate login path: requireMfa from Dynamo must be false → FE will not force enroll.
const verify = await doc.send(
  new GetCommand({ TableName: table, Key: { pk: 'ENTITY#settings', sk: 'ID#global' } }),
);
const requireMfa = verify.Item?.entity?.requireMfa;
const meField = requireMfa !== false; // mirrors /me: requireMfa !== false
console.log('VERIFY', { dynamoRequireMfa: requireMfa, meWouldReturn: meField, stillMfaUsers: stillMfa });
if (requireMfa !== false || meField !== false || stillMfa !== 0) {
  throw new Error('MFA-off verification failed');
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-mfa-disable-everyone-deploy-out.txt'),
  [
    'TMS MFA: Disable-everyone + FE fail-closed enroll; age-lock no longer flips MFA ON',
    `Function: ${fnName}`,
    `API CodeSha256: ${codeSha}`,
    env.trim(),
    `Dynamo requireMfa=${requireMfa}`,
    `One-shot clear: cleared=${cleared} errors=${errors} stillMfa=${stillMfa}`,
    'Root cause: (1) FE fail-open defaulted missing/failed /me to requireMfa=true → forced enroll even when Dynamo OFF;',
    '  (2) Admin age-lock/yellow saves re-sent stale cached requireMfa:true and could flip Dynamo back ON;',
    '  (3) Advanced OFF save awaited Cognito clear → Netlify proxy timeout made OFF look broken.',
    'Fix: enforce enroll only when fromServer && requireMfa===true; omit requireMfa from locker saves;',
    '  settings OFF persists then races clear @6s; POST /admin/mfa/disable-all + Disable MFA for everyone button.',
    'HHA: sandbox preserved',
    'FE: white-glove-tms-web ?v=73',
    'Test: Security → Advanced (open) → Disable MFA for everyone → status shows OFF',
    'Test: hard-refresh → sign out → password login → app (no enroll / no email OTP)',
    '',
  ].join('\n'),
);
console.log('wrote cdk-tms-mfa-disable-everyone-deploy-out.txt');
