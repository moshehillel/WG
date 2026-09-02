import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
  getEnv,
  HHA_PRODUCTION_SOAP_URL,
  parseOfficeIds,
  resetEnvCache,
  type Env,
} from '@white-glove/shared';

const secrets = new SecretsManagerClient({});

async function readSecretString(arn: string): Promise<string | undefined> {
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  return res.SecretString ?? undefined;
}

function parseSecretJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * If HHA_SECRET_ARN is set, merge SOAP + ENT fields into process.env.
 */
export async function applyHhaSecretFromArn(env: Env = getEnv()): Promise<Env> {
  const arn = process.env.HHA_SECRET_ARN;
  if (!arn) return env;

  const res = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) return env;

  const parsed = parseSecretJson(res.SecretString) as {
    baseUrl?: string;
    apiKey?: string;
    appName?: string;
    appSecret?: string;
    appKey?: string;
    entSpaAccessToken?: string;
    entSpaExpiresAt?: number;
    entCoordinatorId?: string;
    entCoordinatorNames?: string;
    entUserId?: number | string;
    entProviderId?: number | string;
    entOfficeIds?: string;
    entUsername?: string;
    entPassword?: string;
    entOtp?: string;
    entHhamfaCookies?: string;
    entHhamfaRenewedAt?: string;
    productionBaseUrl?: string;
  } | null;

  if (!parsed) {
    console.warn('[hha-secret] SecretString is not a JSON object — skipping merge');
  } else {
    const prodUrl =
      parsed.productionBaseUrl?.trim() ||
      process.env.HHA_PRODUCTION_BASE_URL?.trim() ||
      HHA_PRODUCTION_SOAP_URL;
    const baseUrl = parsed.baseUrl?.trim() ?? '';
    const useProduction =
      process.env.HHA_USE_PRODUCTION === 'true' ||
      !baseUrl ||
      baseUrl.includes('CHANGE_ME') ||
      /sandbox1\.hhaexchange\.com/i.test(baseUrl);
    process.env.HHA_BASE_URL = useProduction ? prodUrl : baseUrl;
    if (useProduction) process.env.HHA_ALLOW_PRODUCTION = 'true';
    if (parsed.apiKey) process.env.HHA_API_KEY = parsed.apiKey;
    if (parsed.appName) process.env.HHA_APP_NAME = parsed.appName;
    if (parsed.appSecret) process.env.HHA_APP_SECRET = parsed.appSecret;
    if (parsed.appKey) process.env.HHA_APP_KEY = parsed.appKey;
    if (parsed.entSpaAccessToken) process.env.HHA_ENT_SPA_ACCESS_TOKEN = parsed.entSpaAccessToken;
    if (parsed.entCoordinatorId) process.env.HHA_ENT_COORDINATOR_ID = parsed.entCoordinatorId;
    if (parsed.entCoordinatorNames) process.env.HHA_ENT_COORDINATOR_NAMES = parsed.entCoordinatorNames;
    if (parsed.entUserId != null) process.env.HHA_ENT_USER_ID = String(parsed.entUserId);
    if (parsed.entProviderId != null) process.env.HHA_ENT_PROVIDER_ID = String(parsed.entProviderId);
    if (parsed.entOfficeIds) {
      process.env.HHA_ENT_OFFICE_IDS = parseOfficeIds(parsed.entOfficeIds);
    }
    if (parsed.entUsername) process.env.HHA_ENT_USERNAME = parsed.entUsername;
    if (parsed.entPassword) process.env.HHA_ENT_PASSWORD = parsed.entPassword;
    if (parsed.entOtp) process.env.HHA_ENT_OTP = parsed.entOtp;
    if (parsed.entHhamfaRenewedAt) process.env.HHA_ENT_HHAMFA_RENEWED_AT = parsed.entHhamfaRenewedAt;
    if (parsed.productionBaseUrl) process.env.HHA_PRODUCTION_BASE_URL = parsed.productionBaseUrl;

    const cookiesArn = process.env.HHA_ENT_COOKIES_SECRET_ARN?.trim();
    if (cookiesArn) {
      const cookieSecret = await readSecretString(cookiesArn);
      if (cookieSecret) process.env.HHA_ENT_HHAMFA_COOKIES = cookieSecret;
    } else if (parsed.entHhamfaCookies) {
      process.env.HHA_ENT_HHAMFA_COOKIES = parsed.entHhamfaCookies;
    }
  }

  resetEnvCache();
  return getEnv();
}
