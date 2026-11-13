/**
 * Secret JSON keys and the env vars ensureEntSpaToken / spaTokenFromEnv read.
 * Renewal and secret load both use this map so the field names cannot drift.
 */
export const ENT_SPA_SECRET_KEY = 'entSpaAccessToken';
export const ENT_SPA_EXPIRES_SECRET_KEY = 'entSpaExpiresAt';
export const ENT_HHAMFA_RENEWED_SECRET_KEY = 'entHhamfaRenewedAt';
export const ENT_HHAMFA_COOKIES_SECRET_KEY = 'entHhamfaCookies';

export const ENT_SPA_ACCESS_TOKEN_ENV = 'HHA_ENT_SPA_ACCESS_TOKEN';
export const ENT_SPA_BEARER_ENV = 'HHA_ENT_BEARER';
export const ENT_HHAMFA_RENEWED_ENV = 'HHA_ENT_HHAMFA_RENEWED_AT';
export const ENT_HHAMFA_COOKIES_ENV = 'HHA_ENT_HHAMFA_COOKIES';

/** Saved secret token first. An expired bearer must not hide a replacement SPA token. */
export const ENT_SPA_TOKEN_ENV_KEYS = [ENT_SPA_ACCESS_TOKEN_ENV, ENT_SPA_BEARER_ENV] as const;
