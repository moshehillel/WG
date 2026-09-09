import type { AppUser } from '@white-glove/tms-db';
import type { Mailer } from './mail.js';

export type LunaChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type LunaChatResult = {
  reply: string;
  action: 'ask' | 'handoff';
  summary: string;
};

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_SUPPORT_EMAIL = 'moshe@advancedautomations.net';

const SYSTEM_PROMPT = `You are Luna, the White Glove Therapy TMS support assistant.
You help therapists and admins with the White Glove Therapy Management System (timesheets, mandates, caseloads, schools, reports, sign-in, PDF uploads).

Rules:
- Be concise, warm, and practical. Ask short clarifying questions before escalating.
- Typical clarifiers: which page/screen, role (admin vs therapist), exact error text, steps already tried, browser if relevant.
- Do not invent product secrets, API keys, internal credentials, or undocumented features.
- Do not claim you fixed backend/infrastructure issues yourself.
- When you have enough context to open a support ticket, set action to "handoff" and write a clear one-paragraph summary for the support engineer. Otherwise set action to "ask".
- Never discuss or assist with religion, Christianity, gossip, romance/love stories, reproduction, sex, adultery, or intimate topics. If asked, reply briefly that you can only help with TMS support.

Respond with JSON only (no markdown fences):
{"reply":"message shown to the user","action":"ask"|"handoff","summary":"blank unless handoff"}`;

export function lunaSupportEmail(): string {
  return (process.env.LUNA_SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim() || DEFAULT_SUPPORT_EMAIL;
}

export function lunaModel(): string {
  return (process.env.OPENAI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

let cachedSecretKey: string | undefined;

async function resolveOpenAiApiKey(): Promise<string> {
  const direct = (process.env.OPENAI_API_KEY || '').trim();
  if (direct) return direct;
  const arn = (process.env.OPENAI_SECRET_ARN || '').trim();
  if (!arn) return '';
  if (cachedSecretKey !== undefined) return cachedSecretKey;
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );
    const client = new SecretsManagerClient({});
    const out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    const raw = (out.SecretString || '').trim();
    // Plain string secret, or JSON {"OPENAI_API_KEY":"..."} / {"apiKey":"..."}
    let key = raw;
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        key = String(parsed.OPENAI_API_KEY || parsed.apiKey || parsed.key || '').trim();
      } catch {
        key = raw;
      }
    }
    if (!key || key === 'REPLACE_ME_IN_SECRETS_MANAGER') {
      cachedSecretKey = '';
      return '';
    }
    cachedSecretKey = key;
    return key;
  } catch {
    cachedSecretKey = '';
    return '';
  }
}

/** @deprecated prefer resolveOpenAiApiKey — sync helper for tests / local env only */
export function openaiApiKey(): string {
  return (process.env.OPENAI_API_KEY || '').trim();
}

export function parseLunaModelJson(raw: string): LunaChatResult {
  const text = String(raw || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match?.[0] || '{}') as {
    reply?: unknown;
    action?: unknown;
    summary?: unknown;
  };
  const reply = String(parsed.reply || '').trim();
  const action = String(parsed.action || '').toLowerCase() === 'handoff' ? 'handoff' : 'ask';
  const summary = String(parsed.summary || '').trim();
  if (!reply) {
    return {
      reply: 'Could you share a bit more detail about what went wrong?',
      action: 'ask',
      summary: '',
    };
  }
  return { reply, action, summary: action === 'handoff' ? summary || reply : '' };
}

const LIGHT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Require contact name + lightly-validated email before handoff email is sent. */
export function normalizeHandoffContact(input: {
  contactName?: unknown;
  contactEmail?: unknown;
}): { contactName: string; contactEmail: string } {
  const contactName = String(input.contactName || '').trim().slice(0, 200);
  const contactEmail = String(input.contactEmail || '').trim().toLowerCase().slice(0, 320);
  if (!contactName) {
    const err = new Error('Name is required before sending to support.');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  if (!contactEmail || !LIGHT_EMAIL_RE.test(contactEmail)) {
    const err = new Error('A valid email is required before sending to support.');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return { contactName, contactEmail };
}

/** User-facing handoff confirmation — never mention the internal support inbox. */
export function buildHandoffConfirmationReply(contactEmail: string): string {
  const email = String(contactEmail || '').trim();
  if (!email) {
    return 'Thanks — I’ve sent this to our team. We’ll follow up at the email you provided.';
  }
  return `Thanks — I’ve sent this to our team. We’ll follow up with you at ${email}.`;
}

function normalizeMessages(messages: unknown): LunaChatMessage[] {
  if (!Array.isArray(messages)) return [];
  const out: LunaChatMessage[] = [];
  for (const item of messages) {
    if (!item || typeof item !== 'object') continue;
    const role = String((item as { role?: unknown }).role || '');
    const content = String((item as { content?: unknown }).content || '').trim();
    if (!content) continue;
    if (role !== 'user' && role !== 'assistant') continue;
    out.push({ role, content: content.slice(0, 4000) });
  }
  return out.slice(-24);
}

/** Synthetic user for pre-login Luna chat (no Cognito). */
export const LUNA_GUEST_USER: AppUser = {
  id: 'guest',
  cognitoSub: 'guest',
  email: 'guest@unauthenticated.local',
  role: 'therapist',
  displayName: '(not signed in)',
  providerId: '',
  active: true,
  createdAt: '1970-01-01T00:00:00.000Z',
};

export function isLunaGuestUser(user: AppUser | undefined | null): boolean {
  return Boolean(user && user.id === LUNA_GUEST_USER.id);
}

type GuestRateBucket = { n: number; resetAt: number };
const guestRateBuckets = new Map<string, GuestRateBucket>();

/** In-memory per-key rate limit (Lambda instance). Returns error message when blocked. */
export function checkLunaGuestRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): string | null {
  const k = String(key || 'unknown').slice(0, 200);
  let row = guestRateBuckets.get(k);
  if (!row || now >= row.resetAt) {
    row = { n: 0, resetAt: now + windowMs };
    guestRateBuckets.set(k, row);
  }
  row.n += 1;
  if (row.n > limit) {
    return 'Too many Luna requests. Please wait a few minutes and try again.';
  }
  return null;
}

/** Test helper — clear guest rate buckets. */
export function resetLunaGuestRateLimits(): void {
  guestRateBuckets.clear();
}

export function lunaClientIp(headers: Record<string, string | undefined>): string {
  const h = Object.fromEntries(
    Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const xff = String(h['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return xff || String(h['x-real-ip'] || '').trim() || 'unknown';
}

export async function runLunaChat(input: {
  messages: unknown;
  pageUrl?: string;
  user: AppUser;
}): Promise<LunaChatResult> {
  const key = await resolveOpenAiApiKey();
  if (!key) {
    const err = new Error('Luna is unavailable (OpenAI is not configured).');
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
  const messages = normalizeMessages(input.messages);
  if (!messages.length) {
    return {
      reply: 'Hi, I’m Luna. What issue are you running into in White Glove TMS?',
      action: 'ask',
      summary: '',
    };
  }
  const guest = isLunaGuestUser(input.user);
  const contextNote = [
    guest
      ? 'Caller: guest (not signed in)'
      : `Signed-in user: ${input.user.displayName || input.user.email} <${input.user.email}>`,
    guest ? 'Role: (unknown — pre-login)' : `Role: ${input.user.role}`,
    input.pageUrl ? `Page URL: ${input.pageUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: lunaModel(),
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: contextNote },
        ...messages,
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(
      res.status === 401 || res.status === 403
        ? 'Luna is unavailable (OpenAI key rejected).'
        : 'Luna is unavailable right now. Please try again shortly.',
    );
    (err as Error & { status?: number; detail?: string }).status = 502;
    (err as Error & { detail?: string }).detail = detail.slice(0, 400);
    throw err;
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parseLunaModelJson(data.choices?.[0]?.message?.content || '');
}

export function buildHandoffEmail(input: {
  user: AppUser;
  messages: unknown;
  summary?: string;
  pageUrl?: string;
  timestamp?: string;
  contactName: string;
  contactEmail: string;
}): { subject: string; text: string } {
  const messages = normalizeMessages(input.messages);
  const when = input.timestamp || new Date().toISOString();
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Luna'}: ${m.content}`)
    .join('\n\n');
  const summary =
    String(input.summary || '').trim() ||
    'User requested support handoff from Luna (no model summary provided).';
  const contact = normalizeHandoffContact({
    contactName: input.contactName,
    contactEmail: input.contactEmail,
  });
  const guest = isLunaGuestUser(input.user);
  const text = [
    'Luna support handoff — White Glove TMS',
    '',
    '=== CONTACT (reply here) ===',
    `Name: ${contact.contactName}`,
    `Email: ${contact.contactEmail}`,
    '===========================',
    '',
    `Timestamp: ${when}`,
    guest ? 'Signed-in account: (not signed in — guest / login screen)' : null,
    guest ? null : `Signed-in account name: ${input.user.displayName || '(none)'}`,
    guest ? null : `Signed-in account email: ${input.user.email}`,
    guest ? 'User role: (unknown — pre-login)' : `User role: ${input.user.role}`,
    `Page URL: ${input.pageUrl || '(unknown)'}`,
    '',
    'Summary:',
    summary,
    '',
    'Transcript:',
    transcript || '(empty)',
  ]
    .filter((line) => line !== null)
    .join('\n');
  return {
    subject: `[Luna] TMS support — ${contact.contactName} <${contact.contactEmail}>`,
    text,
  };
}

export async function sendLunaHandoff(input: {
  mail: Mailer;
  user: AppUser;
  messages: unknown;
  summary?: string;
  pageUrl?: string;
  contactName?: unknown;
  contactEmail?: unknown;
}): Promise<{ ok: boolean; id: string; to: string; contactName: string; contactEmail: string }> {
  const contact = normalizeHandoffContact({
    contactName: input.contactName,
    contactEmail: input.contactEmail,
  });
  const to = lunaSupportEmail();
  const { subject, text } = buildHandoffEmail({ ...input, ...contact });
  const out = await input.mail.send({ to: [to], subject, text });
  return { ok: out.ok, id: out.id, to, ...contact };
}
