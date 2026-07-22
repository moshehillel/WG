import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnv(filePath) {
  const env = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

const outputs = JSON.parse(
  execSync(
    'aws cloudformation describe-stacks --stack-name WhiteGloveStack --query Stacks[0].Outputs --output json',
    { encoding: 'utf8' },
  ),
);

function outputValue(key) {
  const row = outputs.find((o) => o.OutputKey === key);
  if (!row?.OutputValue) throw new Error(`Missing stack output ${key}`);
  return row.OutputValue;
}

const env = parseEnv(path.join(repoRoot, '.env'));
const psArn = outputValue('ProviderSoftSecretArn');
const hhaArn = outputValue('HhaSecretArn');

const psFile = path.join(repoRoot, '.secret-ps.json');
const hhaFile = path.join(repoRoot, '.secret-hha.json');

writeFileSync(
  psFile,
  JSON.stringify({
    baseUrl: env.PROVIDERSOFT_BASE_URL,
    username: env.PROVIDERSOFT_USERNAME,
    password: env.PROVIDERSOFT_PASSWORD,
  }),
);
writeFileSync(
  hhaFile,
  JSON.stringify({
    baseUrl: env.HHA_BASE_URL,
    apiKey: env.HHA_API_KEY || '',
    appName: env.HHA_APP_NAME,
    appSecret: env.HHA_APP_SECRET,
    appKey: env.HHA_APP_KEY,
  }),
);

try {
  execSync(
    `aws secretsmanager put-secret-value --secret-id ${psArn} --secret-string file://${psFile}`,
    { stdio: 'inherit' },
  );
  console.log('ProviderSoft secret updated');

  execSync(
    `aws secretsmanager put-secret-value --secret-id ${hhaArn} --secret-string file://${hhaFile}`,
    { stdio: 'inherit' },
  );
  console.log('HHA secret updated');
} finally {
  unlinkSync(psFile);
  unlinkSync(hhaFile);
}
