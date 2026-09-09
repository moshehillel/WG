export interface SignEnvelope {
  envelopeId: string;
  /** Client e-sign vendor is SignNow; `docusign` kept only for any legacy envelopes. */
  vendor: 'signnow' | 'docusign' | 'adobe' | 'email';
  /** SignNow freeform invite id (needed to cancel); omit for email stubs. */
  inviteId?: string;
}

export class SignNowNotConfiguredError extends Error {
  constructor(message = 'SignNow is not configured. Add API credentials in AWS Secrets Manager (TmsDocuSignSecret / SignNow fields) or TMS_SIGNNOW_* env vars.') {
    super(message);
    this.name = 'SignNowNotConfiguredError';
  }
}

export class SignNowApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'SignNowApiError';
  }
}

type SignNowCreds = {
  apiKey: string;
  basicToken: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  fromEmail: string;
  baseUrl: string;
  webhookUrl: string;
};

const DEFAULT_BASE = 'https://api.signnow.com';
const PLACEHOLDER_NOTES = /unused|replace_me|placeholder|ses email fallback/i;

let cachedSecretJson: Record<string, unknown> | undefined;
let cachedBearer: { token: string; expiresAt: number } | undefined;

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

function allowEmailFallback(): boolean {
  return (
    env('TMS_SIGNNOW_ALLOW_EMAIL_FALLBACK') === '1' ||
    env('VITEST') === 'true' ||
    env('NODE_ENV') === 'test'
  );
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

async function loadSecretJson(): Promise<Record<string, unknown>> {
  if (cachedSecretJson) return cachedSecretJson;
  const arn = env('TMS_SIGNNOW_SECRET_ARN') || env('TMS_DOCUSIGN_SECRET_ARN');
  if (!arn) {
    cachedSecretJson = {};
    return cachedSecretJson;
  }
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );
    const client = new SecretsManagerClient({});
    const out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    const raw = (out.SecretString || '').trim();
    if (!raw || !raw.startsWith('{')) {
      cachedSecretJson = {};
      return cachedSecretJson;
    }
    cachedSecretJson = JSON.parse(raw) as Record<string, unknown>;
    return cachedSecretJson;
  } catch {
    cachedSecretJson = {};
    return cachedSecretJson;
  }
}

function resolveBasicToken(secret: Record<string, unknown>): string {
  const direct =
    env('TMS_SIGNNOW_BASIC_TOKEN') ||
    pickStr(secret, 'basic_token', 'basicToken', 'basic_auth', 'basicAuth');
  if (direct) {
    // Accept raw base64 or "Basic xxx"
    return direct.replace(/^Basic\s+/i, '').trim();
  }
  const clientId =
    env('TMS_SIGNNOW_CLIENT_ID') || pickStr(secret, 'client_id', 'clientId');
  const clientSecret =
    env('TMS_SIGNNOW_CLIENT_SECRET') || pickStr(secret, 'client_secret', 'clientSecret');
  if (clientId && clientSecret) {
    return Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  }
  // Some dashboards paste "client_id:client_secret" into api_key / basic fields
  const apiKeyLike =
    env('TMS_SIGNNOW_API_KEY') || pickStr(secret, 'api_key', 'apiKey', 'apikey');
  if (apiKeyLike.includes(':') && !apiKeyLike.includes(' ')) {
    return Buffer.from(apiKeyLike, 'utf8').toString('base64');
  }
  return '';
}

async function resolveCreds(): Promise<SignNowCreds> {
  const secret = await loadSecretJson();
  const note = pickStr(secret, 'note');
  const apiKeyRaw =
    env('TMS_SIGNNOW_API_KEY') || pickStr(secret, 'api_key', 'apiKey', 'apikey');
  // Treat client_id:client_secret style as basic, not bearer API key
  const apiKey =
    apiKeyRaw.includes(':') && !apiKeyRaw.includes(' ') ? '' : apiKeyRaw;

  const creds: SignNowCreds = {
    apiKey,
    basicToken: resolveBasicToken(secret),
    clientId: env('TMS_SIGNNOW_CLIENT_ID') || pickStr(secret, 'client_id', 'clientId'),
    clientSecret:
      env('TMS_SIGNNOW_CLIENT_SECRET') || pickStr(secret, 'client_secret', 'clientSecret'),
    username: env('TMS_SIGNNOW_USERNAME') || pickStr(secret, 'username', 'user', 'email'),
    password: env('TMS_SIGNNOW_PASSWORD') || pickStr(secret, 'password'),
    fromEmail:
      env('TMS_SIGNNOW_FROM_EMAIL') ||
      pickStr(secret, 'from_email', 'fromEmail', 'sender_email', 'senderEmail') ||
      env('TMS_SIGNNOW_USERNAME') ||
      pickStr(secret, 'username', 'email'),
    baseUrl: (
      env('TMS_SIGNNOW_BASE_URL') ||
      pickStr(secret, 'base_url', 'baseUrl', 'api_host', 'apiHost') ||
      DEFAULT_BASE
    ).replace(/\/+$/, ''),
    webhookUrl:
      env('TMS_SIGNNOW_WEBHOOK_URL') ||
      env('TMS_ESIGN_WEBHOOK_URL') ||
      pickStr(secret, 'webhook_url', 'webhookUrl'),
  };

  // Ignore legacy placeholder secret left by CDK
  if (note && PLACEHOLDER_NOTES.test(note) && !creds.apiKey && !creds.basicToken) {
    return {
      ...creds,
      apiKey: '',
      basicToken: '',
      username: '',
      password: '',
    };
  }
  return creds;
}

export async function isSignNowConfigured(): Promise<boolean> {
  const c = await resolveCreds();
  if (c.apiKey) return true;
  if (c.basicToken && c.username && c.password) return true;
  return false;
}

async function signNowFetch(
  creds: SignNowCreds,
  path: string,
  init: RequestInit & { bearer?: string } = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${creds.baseUrl}${path}`;
  const headers = new Headers(init.headers || {});
  if (init.bearer) headers.set('Authorization', `Bearer ${init.bearer}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return fetch(url, { ...init, headers });
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 800);
  } catch {
    return '';
  }
}

async function getAccessToken(creds: SignNowCreds): Promise<string> {
  if (creds.apiKey) return creds.apiKey;

  if (cachedBearer && cachedBearer.expiresAt > Date.now() + 60_000) {
    return cachedBearer.token;
  }

  if (!creds.basicToken || !creds.username || !creds.password) {
    throw new SignNowNotConfiguredError();
  }

  const body = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    grant_type: 'password',
    scope: '*',
  });
  const res = await signNowFetch(creds, '/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds.basicToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new SignNowApiError(
      `SignNow OAuth failed (${res.status}). Check basic_token / username / password.`,
      res.status,
      await readErrorBody(res),
    );
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  const token = String(json.access_token || '').trim();
  if (!token) throw new SignNowApiError('SignNow OAuth returned no access_token.');
  const expiresIn = Number(json.expires_in || 3600);
  cachedBearer = { token, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
  return token;
}

async function uploadDocument(
  creds: SignNowCreds,
  bearer: string,
  pdf: Uint8Array,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);
  const res = await signNowFetch(creds, '/document', {
    method: 'POST',
    bearer,
    body: form,
  });
  if (!res.ok) {
    throw new SignNowApiError(
      `SignNow upload failed (${res.status}).`,
      res.status,
      await readErrorBody(res),
    );
  }
  const json = (await res.json()) as { id?: string };
  const id = String(json.id || '').trim();
  if (!id) throw new SignNowApiError('SignNow upload returned no document id.');
  return id;
}

async function sendFreeformInvite(
  creds: SignNowCreds,
  bearer: string,
  input: {
    documentId: string;
    to: string;
    from: string;
    subject: string;
    message: string;
    callbackUrl?: string;
  },
): Promise<string> {
  const payload: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
    message: input.message,
  };
  if (input.callbackUrl) payload.callback_url = input.callbackUrl;

  const res = await signNowFetch(creds, `/document/${encodeURIComponent(input.documentId)}/invite`, {
    method: 'POST',
    bearer,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new SignNowApiError(
      `SignNow invite failed (${res.status}). Ensure from_email matches the SignNow account login.`,
      res.status,
      await readErrorBody(res),
    );
  }
  const json = (await res.json()) as { id?: string; result?: string };
  return String(json.id || '').trim();
}

/** Best-effort Webhooks 2.0 subscription for document.complete → TMS /webhooks/esign. */
async function subscribeDocumentComplete(
  creds: SignNowCreds,
  bearer: string,
  documentId: string,
  callbackUrl: string,
): Promise<void> {
  try {
    await signNowFetch(creds, '/v2/event-subscriptions', {
      method: 'POST',
      bearer,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'document.complete',
        entity_id: documentId,
        attributes: {
          callback: callbackUrl,
          docid_queryparam: true,
          use_tls_12: true,
          retry_count: 3,
          delete_access_token: true,
        },
      }),
    });
  } catch {
    /* optional */
  }
}

async function cancelFreeformInvite(
  creds: SignNowCreds,
  bearer: string,
  inviteId: string,
  reason: string,
): Promise<boolean> {
  const res = await signNowFetch(creds, `/invite/${encodeURIComponent(inviteId)}/cancel`, {
    method: 'PUT',
    bearer,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return res.ok;
}

async function listFreeformInviteIds(
  creds: SignNowCreds,
  bearer: string,
  documentId: string,
): Promise<string[]> {
  const res = await signNowFetch(
    creds,
    `/v2/documents/${encodeURIComponent(documentId)}/free-form-invites`,
    { method: 'GET', bearer },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as {
    data?: Array<{ id?: string; invite_id?: string }>;
  };
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .map((r) => String(r.id || r.invite_id || '').trim())
    .filter(Boolean);
}

/**
 * Create a principal signing request for the timesheet PDF via SignNow REST.
 *
 * Flow: OAuth/API-key → upload PDF → freeform invite (signer places signature anywhere).
 * Falls back to SES email stub only in tests or when TMS_SIGNNOW_ALLOW_EMAIL_FALLBACK=1.
 */
export async function createSignEnvelope(input: {
  signerEmail: string;
  signerName: string;
  weekId: string;
  pdf: Uint8Array;
}): Promise<SignEnvelope> {
  const creds = await resolveCreds();
  const configured = Boolean(
    creds.apiKey || (creds.basicToken && creds.username && creds.password),
  );

  if (!configured) {
    if (allowEmailFallback()) {
      return { envelopeId: `email:${input.weekId}`, vendor: 'email' };
    }
    throw new SignNowNotConfiguredError();
  }

  const from = creds.fromEmail || creds.username;
  if (!from) {
    throw new SignNowNotConfiguredError(
      'SignNow from_email is required (must match the SignNow account login email).',
    );
  }
  if (!String(input.signerEmail || '').trim()) {
    throw new SignNowApiError('Signer email is required for SignNow invite.');
  }

  const bearer = await getAccessToken(creds);
  const documentId = await uploadDocument(
    creds,
    bearer,
    input.pdf,
    `timesheet-${input.weekId}.pdf`,
  );

  const subject = `Please sign related-service timesheet (week ${input.weekId})`;
  const message = `Please review and sign the timesheet for ${input.signerName || 'the school'}.\n\nPowered by advancedautomations.net`;
  const inviteId = await sendFreeformInvite(creds, bearer, {
    documentId,
    to: input.signerEmail.trim(),
    from,
    subject,
    message,
    callbackUrl: creds.webhookUrl || undefined,
  });

  if (creds.webhookUrl) {
    await subscribeDocumentComplete(creds, bearer, documentId, creds.webhookUrl);
  }

  return {
    envelopeId: documentId,
    vendor: 'signnow',
    inviteId: inviteId || undefined,
  };
}

/** Void a pending e-sign envelope (SignNow freeform cancel, or no-op for email stubs). */
export async function voidSignEnvelope(
  envelopeId: string,
  reason = 'Therapist cancelled timesheet approval request',
): Promise<{ ok: boolean; skipped?: boolean }> {
  const id = String(envelopeId || '').trim();
  if (!id || id.startsWith('email:')) return { ok: true, skipped: true };

  const creds = await resolveCreds();
  const configured = Boolean(
    creds.apiKey || (creds.basicToken && creds.username && creds.password),
  );
  if (!configured) return { ok: true, skipped: true };

  try {
    const bearer = await getAccessToken(creds);
    // Prefer cancel by invite ids listed on the document
    const inviteIds = await listFreeformInviteIds(creds, bearer, id);
    let cancelled = false;
    for (const inviteId of inviteIds) {
      if (await cancelFreeformInvite(creds, bearer, inviteId, reason)) cancelled = true;
    }
    // Legacy / alternate: some accounts treat envelopeId as invite id
    if (!cancelled && inviteIds.length === 0) {
      cancelled = await cancelFreeformInvite(creds, bearer, id, reason);
    }
    // Field-invite cancel path (harmless if no field invites)
    await signNowFetch(creds, `/document/${encodeURIComponent(id)}/fieldinvitecancel`, {
      method: 'PUT',
      bearer,
    });
    return { ok: true, skipped: !cancelled && inviteIds.length === 0 };
  } catch {
    return { ok: true, skipped: true };
  }
}

/** Optional: download signed PDF bytes after completion (for archive). */
export async function downloadSignedDocument(
  documentId: string,
): Promise<Uint8Array | null> {
  const id = String(documentId || '').trim();
  if (!id || id.startsWith('email:')) return null;
  const creds = await resolveCreds();
  if (!(await isSignNowConfigured())) return null;
  try {
    const bearer = await getAccessToken(creds);
    const res = await signNowFetch(
      creds,
      `/document/${encodeURIComponent(id)}/download?type=collapsed`,
      { method: 'GET', bearer, headers: { Accept: 'application/pdf' } },
    );
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export function envelopeCompleted(payload: Record<string, unknown>): {
  envelopeId: string;
  completed: boolean;
} {
  const data = (payload.data as Record<string, unknown> | undefined) || undefined;
  const content = (payload.content as Record<string, unknown> | undefined) || undefined;
  const meta = (payload.meta as Record<string, unknown> | undefined) || undefined;
  const envelopeSummary =
    (data?.envelopeSummary as Record<string, unknown> | undefined) ||
    (payload.envelopeSummary as Record<string, unknown> | undefined);

  const envelopeId = String(
    payload.envelopeId ||
      payload.envelopeID ||
      payload.document_id ||
      payload.documentId ||
      content?.document_id ||
      content?.documentId ||
      data?.envelopeId ||
      data?.document_id ||
      envelopeSummary?.envelopeId ||
      payload.id ||
      '',
  );

  const event = String(
    payload.event ||
      payload.status ||
      payload.eventName ||
      meta?.event ||
      data?.envelopeEvent ||
      content?.status ||
      '',
  ).toLowerCase();
  const status = String(
    payload.status ||
      envelopeSummary?.status ||
      data?.envelopeStatus ||
      content?.status ||
      '',
  ).toLowerCase();

  const completed =
    event.includes('complet') ||
    event === 'document.complete' ||
    event === 'signed' ||
    event.includes('recipient-completed') ||
    status === 'completed' ||
    status === 'fulfilled' ||
    status === 'signed';

  return { envelopeId, completed };
}
