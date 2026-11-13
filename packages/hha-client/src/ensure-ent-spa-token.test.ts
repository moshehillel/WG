import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const aws = vi.hoisted(() => ({
  secret: {} as Record<string, unknown>,
  puts: [] as string[],
  pending: '',
}));

vi.mock('@aws-sdk/client-secrets-manager', () => {
  class GetSecretValueCommand {
    constructor(public input: unknown) {}
  }
  class PutSecretValueCommand {
    constructor(public input: { SecretString?: string }) {}
  }
  class SecretsManagerClient {
    async send(cmd: { constructor: { name: string }; input?: { SecretString?: string } }) {
      if (cmd.constructor.name === 'PutSecretValueCommand') {
        const text = cmd.input?.SecretString ?? '{}';
        aws.puts.push(text);
        aws.secret = JSON.parse(text) as Record<string, unknown>;
        return {};
      }
      return { SecretString: JSON.stringify(aws.secret) };
    }
  }
  return { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand };
});

vi.mock('@aws-sdk/client-s3', () => {
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  class PutObjectCommand {
    constructor(public input: { Body?: string }) {}
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  class S3Client {
    async send(cmd: { constructor: { name: string }; input?: { Body?: string } }) {
      if (cmd.constructor.name === 'PutObjectCommand') {
        aws.pending = String(cmd.input?.Body ?? '');
        return {};
      }
      if (cmd.constructor.name === 'GetObjectCommand') {
        return { Body: { transformToString: async () => aws.pending } };
      }
      return {};
    }
  }
  return { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand };
});

import { ensureEntSpaToken } from '../dist/ensure-ent-spa-token.js';
import { loginEntJson } from '../dist/ent-http-login.js';
import { completeHhaMfaRenewal, startHhaMfaRenewal } from '../dist/mfa-renew.js';

const JSON_LOGIN = 'https://secure.hhaexchange.com/api/v2/account/login';
const RETURN_URL =
  '/connect/authorize/callback?client_id=HHAExchange.Login.orchestrator&redirect_uri=https%3A%2F%2Fauth.hhaexchange.com%2Fcallback';
const USER_ID = '217884';
const REMEMBER = `hhamfa.${createHash('sha1').update(USER_ID).digest('hex')}`;
const REMEMBER_VALUE = 'CfDJ8-remember';
const SESSION_COOKIE = 'idsrv.session';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';

function jwtWithExp(exp: number): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ exp, sub: '9' })}.x`;
}

function redirect(location: string, cookies: string[] = [], status = 302): Response {
  const headers = new Headers();
  for (const c of cookies) headers.append('set-cookie', c);
  headers.set('location', location);
  return new Response('', { status, headers });
}

function jsonResponse(body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

interface Call {
  url: string;
  method: string;
  body: string;
  cookie: string;
  accept: string;
  referer: string;
}

/**
 * HHAX as captured in the non-incognito and incognito HARs: identity login chain,
 * JSON login that skips MFA only when the remember cookie is sent, MFA endpoints
 * that set hhamfa.<sha1(userId)> on .hhaexchange.com, and the SPA authorize redirect
 * that issues a token when the secure.hhaexchange.com session cookie is present.
 */
function fakeHhax(opts: { spa: string; acceptRemember?: boolean; tokenStepFails?: boolean }) {
  const calls: Call[] = [];
  const acceptRemember = opts.acceptRemember ?? true;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
      cookie: headers.get('cookie') ?? '',
      accept: headers.get('accept') ?? '',
      referer: headers.get('referer') ?? '',
    };
    calls.push(call);
    const u = new URL(url);
    const hasSession = call.cookie.includes(`${SESSION_COOKIE}=`) && u.hostname === 'secure.hhaexchange.com';

    if (u.hostname === 'app.hhaexchange.com' && u.pathname === '/identity/account/login') {
      return redirect('https://auth.hhaexchange.com/login?origin=app');
    }
    if (u.hostname === 'auth.hhaexchange.com' && u.pathname === '/login') {
      return redirect(
        'https://secure.hhaexchange.com/connect/authorize?client_id=HHAExchange.Login.orchestrator&prompt=login',
      );
    }
    if (u.hostname === 'app.hhaexchange.com' && u.pathname === '/identity/connect/authorize') {
      return redirect(`https://secure.hhaexchange.com/connect/authorize${u.search}&origin=v4`);
    }
    if (u.hostname === 'secure.hhaexchange.com' && u.pathname === '/connect/authorize') {
      if (u.searchParams.get('client_id') === 'HHAExchange.visit.maintenance') {
        // Live HHAX: '+' in response_type reaches /ui/error (unsupported_response_type); the browser sends %20.
        if (!u.search.includes('response_type=id_token%20token') || opts.tokenStepFails) {
          return redirect('https://secure.hhaexchange.com/ui/error?errorId=e1');
        }
        if (hasSession) {
          return redirect(`https://ent.app.hhaexchange.com/#id_token=x&access_token=${opts.spa}&token_type=Bearer`);
        }
      }
      return redirect(`https://secure.hhaexchange.com/connect/login?ReturnUrl=${encodeURIComponent(RETURN_URL)}`);
    }
    if (u.pathname === '/connect/login') {
      return redirect(
        `https://secure.hhaexchange.com/ui/identity/auth/login?ReturnUrl=${encodeURIComponent(RETURN_URL)}`,
      );
    }
    if (u.pathname === '/ui/identity/auth/login') return new Response('<html></html>', { status: 200 });
    if (u.pathname === '/ui/error') return new Response('<html></html>', { status: 200 });
    if (u.pathname === '/api/v2/account/error') {
      return jsonResponse({ error: 'unsupported_response_type', errorDescription: 'Response type not supported' });
    }
    if (url === JSON_LOGIN) {
      if (acceptRemember && call.cookie.includes(`${REMEMBER}=${REMEMBER_VALUE}`)) {
        return jsonResponse({ isMFARequired: false, validReturnUrl: RETURN_URL }, [
          `${SESSION_COOKIE}=s-login; path=/; secure; httponly`,
        ]);
      }
      return jsonResponse(
        { isMFARequired: true, mfaUI: 'https://secure.hhaexchange.com/mfa/', validReturnUrl: 'https://secure.hhaexchange.com/mfa/' },
        ['hhamfa.temp=CfDJ8-temp; path=/; secure; httponly'],
      );
    }
    if (u.pathname === '/identity/api/mfa-methods-login/configuration-options') {
      return jsonResponse([{ id: 59754, mfaType: 1, isDefault: true }]);
    }
    if (u.pathname.endsWith('/send-otp')) return jsonResponse({});
    if (u.pathname === '/identity/api/mfa-methods-login/login') {
      return jsonResponse({}, [
        `${REMEMBER}=${REMEMBER_VALUE}; expires=Thu, 26 Nov 2026 13:22:27 GMT; domain=.hhaexchange.com; path=/; secure; samesite=lax`,
      ]);
    }
    if (u.pathname === '/api/v2/account/complete-mfa') {
      return redirect(`https://secure.hhaexchange.com${RETURN_URL}`, [`${SESSION_COOKIE}=s-mfa; path=/; secure; httponly`], 307);
    }
    if (u.pathname === '/connect/authorize/callback') {
      return redirect('https://auth.hhaexchange.com/callback?code=c&state=s');
    }
    if (u.hostname === 'auth.hhaexchange.com' && u.pathname === '/callback') {
      return redirect('https://app.hhaexchange.com/ENT2608010000/AutoLogin.aspx');
    }
    if (u.pathname.endsWith('/AutoLogin.aspx')) {
      return redirect('https://app.hhaexchange.com/ENT2608010000/Common/Notifications.aspx?s=1', [
        'HHAX_ENT_AccessToken=ent; path=/; domain=.hhaexchange.com',
        'HHAX_Session=guid; path=/; domain=.hhaexchange.com',
      ]);
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const ENV_KEYS = [
  'HHA_SECRET_ARN',
  'HHA_ENT_COOKIES_SECRET_ARN',
  'HHA_ENT_SPA_ACCESS_TOKEN',
  'HHA_ENT_BEARER',
  'HHA_ENT_HHAMFA_COOKIES',
  'HHA_ENT_HHAMFA_RENEWED_AT',
  'HHA_ENT_USER_ID',
  'HHA_ENT_USERNAME',
  'HHA_ENT_PASSWORD',
  'HHA_ENT_OTP',
  'REPORTS_BUCKET',
] as const;

function baseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HHA_ENT_USERNAME: 'user',
    HHA_ENT_PASSWORD: 'pass',
    HHA_ENT_AUTO_LOGIN: 'true',
    HHA_ENT_USER_ID: USER_ID,
    HHA_ENT_PROVIDER_ID: '613',
    HHA_ENT_OFFICE_IDS: '1',
    ...extra,
  };
}

describe('HHA ENT login with the saved 30-day MFA device cookie', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    aws.puts.length = 0;
    aws.pending = '';
    aws.secret = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('dashboard renewal follows the browser login, stores the remember cookie, and verifies MFA is skipped', async () => {
    const oldToken = jwtWithExp(1787859682);
    const spa = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    aws.secret = { entSpaAccessToken: oldToken, entHhamfaRenewedAt: '2026-08-01T00:00:00.000Z' };
    Object.assign(process.env, baseEnv({ HHA_SECRET_ARN: SECRET_ARN, REPORTS_BUCKET: 'reports-test' }));
    const { calls } = fakeHhax({ spa });

    const started = await startHhaMfaRenewal(process.env);
    const startLogin = calls.find((c) => c.url === JSON_LOGIN);
    const startBody = JSON.parse(startLogin?.body ?? '{}') as Record<string, unknown>;
    expect(startBody.returnUrl).toBe(RETURN_URL);
    expect(startBody.languageCode).toBe('en-US');
    expect(startLogin?.referer).toContain('/ui/identity/auth/login?ReturnUrl=');
    expect(calls.some((c) => c.url.endsWith('/send-otp'))).toBe(true);

    calls.length = 0;
    const status = await completeHhaMfaRenewal(started.sessionId, '123456', process.env);

    const completeMfa = calls.find((c) => c.url.endsWith('/api/v2/account/complete-mfa'));
    expect(completeMfa?.accept).toBe('application/octet-stream');
    expect(calls.some((c) => c.url.startsWith('https://auth.hhaexchange.com/callback'))).toBe(true);

    const written = JSON.parse(aws.puts[aws.puts.length - 1] ?? '{}') as Record<string, string>;
    expect(written.entSpaAccessToken).toBe(spa);
    expect(written.entSpaExpiresAt).toBe(String(JSON.parse(Buffer.from(spa.split('.')[1]!, 'base64url').toString()).exp));
    expect(written.entHhamfaRenewedAt).not.toBe('2026-08-01T00:00:00.000Z');
    const cookies = JSON.parse(written.entHhamfaCookies ?? '[]') as Array<{ name: string; value: string; domain: string }>;
    expect(cookies).toContainEqual(expect.objectContaining({ name: REMEMBER, value: REMEMBER_VALUE, domain: 'hhaexchange.com' }));
    expect(cookies).toContainEqual(expect.objectContaining({ name: SESSION_COOKIE, domain: 'secure.hhaexchange.com' }));
    expect(cookies.some((c) => c.name === 'hhamfa.temp')).toBe(false);

    expect(status.deviceRemembered).toBe(true);
    expect(status.cookieCount).toBe(1);
    const verifyLogin = calls.filter((c) => c.url === JSON_LOGIN).at(-1);
    expect(verifyLogin?.cookie).toContain(`${REMEMBER}=${REMEMBER_VALUE}`);
    expect(verifyLogin?.cookie).not.toContain(`${SESSION_COOKIE}=`);
  });

  it('reports deviceRemembered=false when HHAX still challenges right after renewal', async () => {
    Object.assign(process.env, baseEnv({ HHA_SECRET_ARN: SECRET_ARN, REPORTS_BUCKET: 'reports-test' }));
    fakeHhax({ spa: jwtWithExp(Math.floor(Date.now() / 1000) + 3600), acceptRemember: false });
    const started = await startHhaMfaRenewal(process.env);
    const status = await completeHhaMfaRenewal(started.sessionId, '123456', process.env);
    expect(status.deviceRemembered).toBe(false);
    expect(status.message).toMatch(/still asked/);
  });

  it('asks for the SPA token like the browser: implicit authorize with response_type id_token%20token, token from the fragment', async () => {
    Object.assign(process.env, baseEnv({ HHA_SECRET_ARN: SECRET_ARN, REPORTS_BUCKET: 'reports-test' }));
    const spa = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const { calls } = fakeHhax({ spa });
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const started = await startHhaMfaRenewal(process.env);
    await completeHhaMfaRenewal(started.sessionId, '123456', process.env);
    log.mockRestore();

    const authorize = calls.find((c) => c.url.startsWith('https://app.hhaexchange.com/identity/connect/authorize'));
    const raw = authorize?.url ?? '';
    expect(raw).toContain('client_id=HHAExchange.visit.maintenance');
    expect(raw).toContain('redirect_uri=https%3A%2F%2Fent.app.hhaexchange.com');
    expect(raw).toContain('response_type=id_token%20token');
    expect(raw).toContain('scope=openid%20profile');
    expect(raw).not.toContain('+');
    const hops = logs.filter((l) => l.includes('[hha-ent] authorize hop'));
    expect(hops.length).toBeGreaterThanOrEqual(2);
    expect(hops.join('\n')).not.toContain(spa);
    expect(hops.join('\n')).not.toContain('access_token=');
    expect(JSON.parse(aws.puts.at(-1) ?? '{}').entSpaAccessToken).toBe(spa);
  });

  it('code accepted but token step fails: saves the device + session cookies, keeps the renewal date, plain error', async () => {
    aws.secret = { entHhamfaRenewedAt: '2026-10-27T13:22:27.144Z', entSpaAccessToken: 'old', entPassword: 'pass' };
    Object.assign(process.env, baseEnv({ HHA_SECRET_ARN: SECRET_ARN, REPORTS_BUCKET: 'reports-test' }));
    fakeHhax({ spa: jwtWithExp(Math.floor(Date.now() / 1000) + 3600), tokenStepFails: true });
    const started = await startHhaMfaRenewal(process.env);

    const err = await completeHhaMfaRenewal(started.sessionId, '123456', process.env).catch((e: unknown) => e as Error);
    expect(err.message).toMatch(/accepted the code and the 30-day device cookie was saved/);
    expect(err.message).toContain('unsupported_response_type');
    expect(err.message).toMatch(/renewal date was not changed/);
    const written = JSON.parse(aws.puts.at(-1) ?? '{}') as Record<string, string>;
    expect(written.entHhamfaRenewedAt).toBe('2026-10-27T13:22:27.144Z');
    expect(written.entSpaAccessToken).toBe('old');
    expect(written.entPassword).toBe('pass');
    const cookies = JSON.parse(written.entHhamfaCookies ?? '[]') as Array<{ name: string; domain: string }>;
    expect(cookies).toContainEqual(expect.objectContaining({ name: REMEMBER, domain: 'hhaexchange.com' }));
    expect(cookies).toContainEqual(expect.objectContaining({ name: SESSION_COOKIE, domain: 'secure.hhaexchange.com' }));
  });

  it('expired access token + saved remember cookie -> new token without MFA, saved to the secret', async () => {
    const expired = jwtWithExp(Math.floor(Date.now() / 1000) - 60);
    const spa = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const storedCookies = JSON.stringify([
      { name: 'hhamfa.temp', value: 'old-temp', domain: 'secure.hhaexchange.com', path: '/' },
      { name: REMEMBER, value: REMEMBER_VALUE, domain: 'hhaexchange.com', path: '/' },
    ]);
    aws.secret = {
      entSpaAccessToken: expired,
      entHhamfaCookies: storedCookies,
      entHhamfaRenewedAt: new Date().toISOString(),
      entPassword: 'pass',
    };
    process.env.HHA_SECRET_ARN = SECRET_ARN;
    const env = baseEnv({
      HHA_ENT_SPA_ACCESS_TOKEN: expired,
      HHA_ENT_HHAMFA_COOKIES: storedCookies,
      HHA_ENT_HHAMFA_RENEWED_AT: new Date().toISOString(),
    });
    const { calls } = fakeHhax({ spa });

    const token = await ensureEntSpaToken(env);

    expect(token).toBe(spa);
    expect(calls.some((c) => /mfa-methods-login|send-otp|complete-mfa/.test(c.url))).toBe(false);
    const login = calls.find((c) => c.url === JSON_LOGIN);
    expect(login?.cookie).toContain(`${REMEMBER}=${REMEMBER_VALUE}`);
    expect(login?.cookie).not.toContain('hhamfa.temp=');
    const body = JSON.parse(login?.body ?? '{}') as Record<string, unknown>;
    expect(body.returnUrl).toBe(RETURN_URL);
    expect(body.languageCode).toBe('en-US');
    expect(body).not.toHaveProperty('__RequestVerificationToken');

    const written = JSON.parse(aws.puts.at(-1) ?? '{}') as Record<string, string>;
    expect(written.entSpaAccessToken).toBe(spa);
    expect(written.entPassword).toBe('pass');
    const cookies = JSON.parse(written.entHhamfaCookies ?? '[]') as Array<{ name: string; value: string }>;
    expect(cookies).toContainEqual(expect.objectContaining({ name: REMEMBER, value: REMEMBER_VALUE }));
    expect(cookies).toContainEqual(expect.objectContaining({ name: SESSION_COOKIE }));
  });

  it('expired access token + saved identity session -> token from the authorize redirect, no password login', async () => {
    const spa = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const env = baseEnv({
      HHA_ENT_SPA_ACCESS_TOKEN: jwtWithExp(Math.floor(Date.now() / 1000) + 100),
      HHA_ENT_HHAMFA_COOKIES: JSON.stringify([
        { name: REMEMBER, value: REMEMBER_VALUE, domain: 'hhaexchange.com', path: '/' },
        { name: SESSION_COOKIE, value: 's-old', domain: 'secure.hhaexchange.com', path: '/' },
      ]),
    });
    const { calls } = fakeHhax({ spa });

    expect(await ensureEntSpaToken(env)).toBe(spa);
    expect(calls.some((c) => c.url === JSON_LOGIN)).toBe(false);
    expect(JSON.parse(env.HHA_ENT_HHAMFA_COOKIES ?? '[]')).toContainEqual(
      expect.objectContaining({ name: REMEMBER, value: REMEMBER_VALUE }),
    );
  });

  it('uses a non-expired saved SPA token and makes no HTTP calls', async () => {
    const spa = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const fetchMock = vi.fn(async () => {
      throw new Error('login should not run');
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await ensureEntSpaToken({
      HHA_ENT_SPA_ACCESS_TOKEN: spa,
      HHA_ENT_BEARER: jwtWithExp(Math.floor(Date.now() / 1000) - 120),
    });

    expect(token).toBe(spa);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says plainly when HHAX challenges MFA despite the remember cookie, and does not send an OTP or write the secret', async () => {
    process.env.HHA_SECRET_ARN = SECRET_ARN;
    const env = baseEnv({
      HHA_ENT_HHAMFA_COOKIES: JSON.stringify([{ name: REMEMBER, value: 'rejected', domain: 'hhaexchange.com', path: '/' }]),
      HHA_ENT_HHAMFA_RENEWED_AT: new Date().toISOString(),
    });
    const { calls } = fakeHhax({ spa: jwtWithExp(Math.floor(Date.now() / 1000) + 3600) });

    const err = await ensureEntSpaToken(env).catch((e: unknown) => e as Error & { code?: string });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('HHA_MFA_REQUIRED');
    expect(err.message).toMatch(/even though the saved 30-day device cookie .* was sent/);
    expect(err.message).toMatch(/Renew MFA once on the White Glove dashboard/);
    expect(err.message).not.toMatch(/expired/);
    expect(calls.some((c) => c.url.endsWith('/send-otp'))).toBe(false);
    expect(aws.puts).toEqual([]);
  });

  it('says the device cookie is missing when none is stored', async () => {
    fakeHhax({ spa: jwtWithExp(Math.floor(Date.now() / 1000) + 3600) });
    const err = await loginEntJson(baseEnv({ HHA_ENT_HHAMFA_COOKIES: '[]' })).catch((e: unknown) => e as Error);
    expect(err.message).toContain(`no saved 30-day device cookie (${REMEMBER})`);
  });
});
