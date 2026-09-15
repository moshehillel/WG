import * as zlib from 'node:zlib';

export interface SignEnvelope {
  envelopeId: string;
  /** Client e-sign vendor is SignNow; `docusign` kept only for any legacy envelopes. */
  vendor: 'signnow' | 'docusign' | 'adobe' | 'email';
  /** SignNow invite id (field or freeform; needed to cancel); omit for email stubs. */
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

/** SignNow MM/DD/YYYY validator (docs.signnow.com fields → Data validators). */
const DATE_VALIDATOR_MM_DD_YYYY = '13435fa6c2a17f83177fcbb5c4a9376ce85befeb';
const PRINCIPAL_ROLE = 'Principal';

/** Letter-landscape principal card tabs (top-left origin). */
const PRINCIPAL_SIGN_FIELD = { x: 418, y: 448, width: 220, height: 40 } as const;
const PRINCIPAL_DATE_FIELD = { x: 668, y: 496, width: 90, height: 18 } as const;
/** Left card Date line — therapist dates at TMS submit; backfilled via SignNow text when missing. */
const PROVIDER_DATE_FIELD = { x: 296, y: 496, width: 90, height: 18 } as const;
/** Split left (provider) vs right (principal) date regions on landscape page. */
const DATE_X_MID = 500;

async function getDocumentJson(
  creds: SignNowCreds,
  bearer: string,
  documentId: string,
): Promise<Record<string, unknown>> {
  const res = await signNowFetch(creds, `/document/${encodeURIComponent(documentId)}`, {
    method: 'GET',
    bearer,
  });
  if (!res.ok) {
    throw new SignNowApiError(
      `SignNow get document failed (${res.status}).`,
      res.status,
      await readErrorBody(res),
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Place required signature + date fields on the last page principal card,
 * then send a role-based (field) invite so freeform cannot skip the date.
 */
async function addPrincipalSignAndDateFields(
  creds: SignNowCreds,
  bearer: string,
  documentId: string,
  pageNumber: number,
): Promise<void> {
  const res = await signNowFetch(creds, `/document/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    bearer,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: [
        {
          type: 'signature',
          name: 'principal_signature',
          role: PRINCIPAL_ROLE,
          required: true,
          page_number: pageNumber,
          x: PRINCIPAL_SIGN_FIELD.x,
          y: PRINCIPAL_SIGN_FIELD.y,
          width: PRINCIPAL_SIGN_FIELD.width,
          height: PRINCIPAL_SIGN_FIELD.height,
          allowed_types: ['draw', 'type'],
        },
        {
          type: 'text',
          name: 'principal_date',
          label: 'Date',
          role: PRINCIPAL_ROLE,
          required: true,
          page_number: pageNumber,
          x: PRINCIPAL_DATE_FIELD.x,
          y: PRINCIPAL_DATE_FIELD.y,
          width: PRINCIPAL_DATE_FIELD.width,
          height: PRINCIPAL_DATE_FIELD.height,
          validator_id: DATE_VALIDATOR_MM_DD_YYYY,
          font_size: 10,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new SignNowApiError(
      `SignNow add fields failed (${res.status}).`,
      res.status,
      await readErrorBody(res),
    );
  }
}

function principalRoleId(doc: Record<string, unknown>): string {
  const roles = Array.isArray(doc.roles) ? doc.roles : [];
  for (const raw of roles) {
    const r = raw as Record<string, unknown>;
    const name = String(r.name || r.role || '').trim();
    if (name.toLowerCase() === PRINCIPAL_ROLE.toLowerCase()) {
      return String(r.unique_id || r.id || '').trim();
    }
  }
  // SignNow often accepts empty role_id when role name matches the field role.
  return '';
}

async function sendFieldInvite(
  creds: SignNowCreds,
  bearer: string,
  input: {
    documentId: string;
    to: string;
    from: string;
    subject: string;
    message: string;
    roleId: string;
    callbackUrl?: string;
  },
): Promise<string> {
  const payload: Record<string, unknown> = {
    from: input.from,
    to: [
      {
        email: input.to,
        role: PRINCIPAL_ROLE,
        role_id: input.roleId,
        order: 1,
        subject: input.subject,
        message: input.message,
      },
    ],
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
      `SignNow field invite failed (${res.status}). Ensure from_email matches the SignNow account login.`,
      res.status,
      await readErrorBody(res),
    );
  }
  const json = (await res.json()) as {
    id?: string;
    result?: string;
    data?: Array<{ id?: string }>;
  };
  const fromData = Array.isArray(json.data) ? String(json.data[0]?.id || '').trim() : '';
  return String(json.id || fromData || '').trim();
}

function formatMmDdYyyy(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function unixToDate(raw: unknown): Date | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // SignNow uses seconds; tolerate ms.
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_TEXT_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}/;

/** True when a SignNow text/field date already sits in [xMin, xMax]. */
function documentHasDateTextInXRange(
  doc: Record<string, unknown>,
  xMin: number,
  xMax: number,
): boolean {
  const texts = Array.isArray(doc.texts) ? doc.texts : [];
  for (const raw of texts) {
    const t = raw as Record<string, unknown>;
    const data = String(t.data || t.text || t.content || '').trim();
    const x = Number(t.x || 0);
    if (DATE_TEXT_RE.test(data) && x >= xMin && x <= xMax) return true;
  }
  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  for (const raw of fields) {
    const f = raw as Record<string, unknown>;
    const name = String(f.name || f.json_attributes || '').toLowerCase();
    const val = String(f.prefilled_text || f.value || f.data || '').trim();
    const x = Number(f.x || (f.json_attributes as Record<string, unknown> | undefined)?.x || 0);
    if (
      (name.includes('date') || String(f.type) === 'text') &&
      DATE_TEXT_RE.test(val) &&
      x >= xMin &&
      x <= xMax
    ) {
      return true;
    }
  }
  return false;
}

function pickPrincipalSignature(doc: Record<string, unknown>): Record<string, unknown> | null {
  const sigs = Array.isArray(doc.signatures) ? doc.signatures : [];
  if (!sigs.length) return null;
  // Principal card is the rightmost signature on the page.
  let best: Record<string, unknown> | null = null;
  let bestX = -1;
  for (const raw of sigs) {
    const s = raw as Record<string, unknown>;
    const x = Number(s.x || 0);
    if (x >= bestX) {
      bestX = x;
      best = s;
    }
  }
  return best;
}

/**
 * Freeform invites never collected a date — stamp MM/DD/YYYY onto the principal Date line
 * using the signature timestamp (or now) so archived PDFs show a date next to the scribble.
 */
async function stampPrincipalDateIfMissing(
  creds: SignNowCreds,
  bearer: string,
  documentId: string,
): Promise<boolean> {
  const doc = await getDocumentJson(creds, bearer, documentId);
  if (documentHasDateTextInXRange(doc, DATE_X_MID, 10_000)) return false;
  const sig = pickPrincipalSignature(doc);
  if (!sig) return false;

  const signedAt =
    unixToDate(sig.created) ||
    unixToDate(doc.updated) ||
    unixToDate(doc.created) ||
    new Date();
  const dateStr = formatMmDdYyyy(signedAt);
  const pageNumber = Number(sig.page_number ?? 0) || 0;
  const sigX = Number(sig.x || PRINCIPAL_SIGN_FIELD.x);
  const sigY = Number(sig.y || PRINCIPAL_SIGN_FIELD.y);
  const sigW = Number(sig.width || PRINCIPAL_SIGN_FIELD.width);
  // Prefer the printed Date line to the right of the signature; fall back to layout constants.
  const x = Math.max(sigX + sigW + 40, PRINCIPAL_DATE_FIELD.x);
  const y = Math.max(sigY + 22, PRINCIPAL_DATE_FIELD.y);

  const res = await signNowFetch(creds, `/document/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    bearer,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      texts: [
        {
          size: 10,
          x,
          y,
          width: PRINCIPAL_DATE_FIELD.width,
          height: PRINCIPAL_DATE_FIELD.height,
          page_number: pageNumber,
          font: 'Arial',
          data: dateStr,
          line_height: 12,
        },
      ],
    }),
  });
  if (!res.ok) {
    console.warn('[tms-esign] stamp principal date failed', {
      documentId,
      status: res.status,
      body: (await readErrorBody(res)).slice(0, 300),
    });
    return false;
  }
  console.info('[tms-esign] stamped principal date on completed SignNow doc', {
    documentId,
    dateStr,
    x,
    y,
    pageNumber,
  });
  return true;
}

/**
 * Therapist Date under the left signature card is normally baked into the PDF at submit.
 * Older freeform/field docs left it blank — stamp from document create time (submit) or now.
 */
async function stampProviderDateIfMissing(
  creds: SignNowCreds,
  bearer: string,
  documentId: string,
): Promise<boolean> {
  const doc = await getDocumentJson(creds, bearer, documentId);
  if (documentHasDateTextInXRange(doc, 0, DATE_X_MID - 1)) return false;

  const signedAt = unixToDate(doc.created) || unixToDate(doc.updated) || new Date();
  const dateStr = formatMmDdYyyy(signedAt);
  const pageNumber = 0;
  const x = PROVIDER_DATE_FIELD.x;
  const y = PROVIDER_DATE_FIELD.y;

  const res = await signNowFetch(creds, `/document/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    bearer,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      texts: [
        {
          size: 10,
          x,
          y,
          width: PROVIDER_DATE_FIELD.width,
          height: PROVIDER_DATE_FIELD.height,
          page_number: pageNumber,
          font: 'Arial',
          data: dateStr,
          line_height: 12,
        },
      ],
    }),
  });
  if (!res.ok) {
    console.warn('[tms-esign] stamp provider date failed', {
      documentId,
      status: res.status,
      body: (await readErrorBody(res)).slice(0, 300),
    });
    return false;
  }
  console.info('[tms-esign] stamped provider date on completed SignNow doc', {
    documentId,
    dateStr,
    x,
    y,
    pageNumber,
  });
  return true;
}

async function downloadPdfBytes(
  creds: SignNowCreds,
  bearer: string,
  documentId: string,
): Promise<Uint8Array | null> {
  const id = encodeURIComponent(documentId);
  const attempts: Array<{ path: string; kind: 'pdf' | 'zip' }> = [
    // Prefer flattened/collapsed when the account supports it.
    { path: `/document/${id}/download?type=collapsed`, kind: 'pdf' },
    { path: `/document/${id}/download?type=zip`, kind: 'zip' },
    { path: `/document/${id}/download`, kind: 'pdf' },
  ];

  for (const attempt of attempts) {
    try {
      const res = await signNowFetch(creds, attempt.path, {
        method: 'GET',
        bearer,
        headers: { Accept: attempt.kind === 'zip' ? 'application/zip,application/pdf,*/*' : 'application/pdf,*/*' },
      });
      if (!res.ok) {
        console.warn('[tms-esign] download attempt failed', {
          documentId,
          path: attempt.path,
          status: res.status,
        });
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) continue;
      if (attempt.kind === 'pdf' && bytes[0] === 0x25 && bytes[1] === 0x50) {
        // %PDF
        return bytes;
      }
      if (attempt.kind === 'zip') {
        const extracted = extractFirstPdfFromZip(bytes);
        if (extracted?.length) return extracted;
      }
      // Some accounts return PDF even when type=zip was requested.
      if (bytes[0] === 0x25 && bytes[1] === 0x50) return bytes;
    } catch (err) {
      console.warn(
        '[tms-esign] download attempt error',
        err instanceof Error ? err.message : err,
        { documentId, path: attempt.path },
      );
    }
  }
  return null;
}

/** Minimal ZIP local-file extractor (stored / deflate) for SignNow type=zip downloads. */
function extractFirstPdfFromZip(zipBytes: Uint8Array): Uint8Array | null {
  const buf = Buffer.from(zipBytes);
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.slice(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) break;
    const raw = buf.slice(dataStart, dataEnd);
    let file: Buffer;
    if (method === 0) {
      file = raw;
    } else if (method === 8) {
      try {
        file = zlib.inflateRawSync(raw);
      } catch {
        offset = dataEnd;
        continue;
      }
    } else {
      offset = dataEnd;
      continue;
    }
    if (/\.pdf$/i.test(name) && file.length >= 4 && file.slice(0, 4).toString() === '%PDF') {
      return new Uint8Array(file);
    }
    offset = dataEnd;
  }
  return null;
}

/** Best-effort Webhooks 2.0 subscription for document.complete → TMS /webhooks/esign. */
async function subscribeDocumentComplete(
  creds: SignNowCreds,
  bearer: string,
  documentId: string,
  callbackUrl: string,
): Promise<void> {
  try {
    const res = await signNowFetch(creds, '/v2/event-subscriptions', {
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
    if (!res.ok) {
      console.warn('[tms-esign] event-subscription failed', {
        documentId,
        status: res.status,
        body: (await readErrorBody(res)).slice(0, 400),
      });
    } else {
      console.info('[tms-esign] event-subscription ok', { documentId, callbackUrl });
    }
  } catch (err) {
    console.warn(
      '[tms-esign] event-subscription error',
      err instanceof Error ? err.message : err,
      { documentId },
    );
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
 * Flow: OAuth/API-key → upload PDF → add signature+date fields → role-based field invite.
 * (Freeform invites only capture a scribble and leave the Date line empty.)
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
  const message = `Please review and sign the timesheet for ${input.signerName || 'the school'}. Complete the signature and Date fields.\n\nPowered by advancedautomations.net`;
  const to = input.signerEmail.trim();

  let inviteId = '';
  let inviteMode: 'field' | 'freeform' = 'field';
  try {
    const uploaded = await getDocumentJson(creds, bearer, documentId);
    const pageCount = Math.max(1, Number(uploaded.page_count || 1) || 1);
    const lastPage = pageCount - 1;
    await addPrincipalSignAndDateFields(creds, bearer, documentId, lastPage);
    const withFields = await getDocumentJson(creds, bearer, documentId);
    const roleId = principalRoleId(withFields);
    inviteId = await sendFieldInvite(creds, bearer, {
      documentId,
      to,
      from,
      subject,
      message,
      roleId,
      callbackUrl: creds.webhookUrl || undefined,
    });
  } catch (err) {
    // Last-resort: freeform still gets a signature on the page (date may be empty).
    console.warn(
      '[tms-esign] field invite failed; falling back to freeform',
      err instanceof Error ? err.message : err,
      { weekId: input.weekId, documentId },
    );
    inviteMode = 'freeform';
    inviteId = await sendFreeformInvite(creds, bearer, {
      documentId,
      to,
      from,
      subject,
      message,
      callbackUrl: creds.webhookUrl || undefined,
    });
  }

  console.info('[tms-esign] SignNow invite ok', {
    weekId: input.weekId,
    documentId,
    inviteId: inviteId || null,
    inviteMode,
    to,
    from,
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

/**
 * Download signed PDF bytes after completion (for archive / View timesheet).
 * Stamps principal + provider Date lines when freeform / older PDFs left them empty.
 */
export async function downloadSignedDocument(
  documentId: string,
): Promise<Uint8Array | null> {
  const id = String(documentId || '').trim();
  if (!id || id.startsWith('email:')) return null;
  const creds = await resolveCreds();
  if (!(await isSignNowConfigured())) return null;
  try {
    const bearer = await getAccessToken(creds);
    try {
      await stampPrincipalDateIfMissing(creds, bearer, id);
      await stampProviderDateIfMissing(creds, bearer, id);
    } catch (err) {
      console.warn(
        '[tms-esign] date stamp skipped',
        err instanceof Error ? err.message : err,
        { documentId: id },
      );
    }
    const bytes = await downloadPdfBytes(creds, bearer, id);
    if (!bytes?.length) {
      console.warn('[tms-esign] download signed PDF empty', { documentId: id });
      return null;
    }
    return bytes;
  } catch (err) {
    console.warn(
      '[tms-esign] download signed PDF error',
      err instanceof Error ? err.message : err,
      { documentId: id },
    );
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
