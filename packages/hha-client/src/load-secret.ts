import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { getEnv, resetEnvCache, type Env } from '@white-glove/shared';

const secrets = new SecretsManagerClient({});

/**
 * If HHA_SECRET_ARN is set, merge baseUrl/apiKey into process.env and return refreshed env.
 */
export async function applyHhaSecretFromArn(env: Env = getEnv()): Promise<Env> {
  const arn = process.env.HHA_SECRET_ARN;
  if (!arn) return env;

  const res = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) return env;

  const parsed = JSON.parse(res.SecretString) as { baseUrl?: string; apiKey?: string };
  if (parsed.baseUrl) process.env.HHA_BASE_URL = parsed.baseUrl;
  if (parsed.apiKey) process.env.HHA_API_KEY = parsed.apiKey;
  resetEnvCache();
  return getEnv();
}
