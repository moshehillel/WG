import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { getEnv } from '@white-glove/shared';

export interface ProviderSoftCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

const secrets = new SecretsManagerClient({});

export async function loadProviderSoftCredentials(
  secretArn?: string,
): Promise<ProviderSoftCredentials> {
  if (secretArn) {
    const res = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!res.SecretString) throw new Error(`Secret ${secretArn} has no string value`);
    const parsed = JSON.parse(res.SecretString) as Partial<ProviderSoftCredentials>;
    if (!parsed.baseUrl || !parsed.username || !parsed.password) {
      throw new Error('ProviderSoft secret must include baseUrl, username, password');
    }
    return {
      baseUrl: parsed.baseUrl,
      username: parsed.username,
      password: parsed.password,
    };
  }

  const env = getEnv();
  if (!env.PROVIDERSOFT_BASE_URL || !env.PROVIDERSOFT_USERNAME || !env.PROVIDERSOFT_PASSWORD) {
    throw new Error(
      'Set PROVIDERSOFT_* env vars or pass PROVIDERSOFT_SECRET_ARN for credentials',
    );
  }
  return {
    baseUrl: env.PROVIDERSOFT_BASE_URL,
    username: env.PROVIDERSOFT_USERNAME,
    password: env.PROVIDERSOFT_PASSWORD,
  };
}
