import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createHhaClient, MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore, purgeOrphanProviders } from '@white-glove/tms-db';
import { handleTmsRequest, type HttpRequest } from './router.js';
import { createMailer, type Mailer } from './mail.js';
import { runDueNags } from './due-nags.js';
import { deleteCognitoLogin } from './invite.js';
import { loadSnapshotFromS3, saveSnapshotToS3 } from './s3-state.js';

const store = new MemoryStore();
let mailer: Mailer | undefined;

async function mail(): Promise<Mailer> {
  if (!mailer) mailer = await createMailer();
  return mailer;
}

function cors(): Record<string, string> {
  return {
    'access-control-allow-origin': process.env.TMS_CORS_ORIGIN || '*',
    'access-control-allow-headers': 'content-type,authorization,x-tms-role,x-tms-email',
    'access-control-allow-methods': 'GET,POST,OPTIONS,PUT,PATCH,DELETE',
  };
}

function hhaClient() {
  if (process.env.HHA_USE_MOCK === 'false' && process.env.TMS_HHA_MOCK !== '1') {
    return createHhaClient();
  }
  return new MockHhaClient();
}

/** One-shot / ops: remove smoke test AppUsers (+ linked Provider) and Cognito login. */
async function purgeSmokeUsers(
  emails: string[],
): Promise<{ deleted: Array<Record<string, unknown>> }> {
  await loadSnapshotFromS3(store);
  const deleted: Array<Record<string, unknown>> = [];
  for (const raw of emails) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email.endsWith('@whiteglove.local')) {
      deleted.push({ email, status: 'skipped', reason: 'only @whiteglove.local allowed' });
      continue;
    }
    const user = store.userByEmail(email);
    if (!user) {
      deleted.push({ email, status: 'not_in_store' });
      try {
        await deleteCognitoLogin('', email);
        deleted[deleted.length - 1] = { email, status: 'cognito_only_cleared' };
      } catch {
        /* none in Cognito either */
      }
      continue;
    }
    if (user.role === 'admin') {
      deleted.push({ email, userId: user.id, status: 'skipped', reason: 'admin protected' });
      continue;
    }
    const provider =
      (user.providerId
        ? store.data.providers.find((p) => p.id === user.providerId)
        : undefined) || store.data.providers.find((p) => p.userId === user.id);
    const before = { user: { ...user }, provider: provider ? { ...provider } : null };
    if (provider) store.removeProvider(provider.id);
    let cognito = 'skipped';
    try {
      await deleteCognitoLogin(user.cognitoSub, user.email);
      cognito = 'deleted_or_absent';
    } catch (err) {
      cognito = err instanceof Error ? err.message : 'cognito_error';
    }
    store.deleteUser(user.id);
    store.audit('ops-purge', 'purge_smoke_user', `user:${user.id}`, before, null);
    deleted.push({
      email,
      userId: user.id,
      displayName: user.displayName,
      providerId: provider?.id || null,
      cognito,
      status: 'deleted',
    });
  }
  await saveSnapshotToS3(store);
  return { deleted };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const rec = event as { source?: string; tmsJob?: string; emails?: string[] };
  if (rec.source === 'aws.events' || rec.tmsJob === 'due-nags') {
    await loadSnapshotFromS3(store);
    const out = await runDueNags(store, await mail());
    await saveSnapshotToS3(store);
    return { statusCode: 200, body: JSON.stringify(out) };
  }
  if (rec.tmsJob === 'purge-smoke-users') {
    const emails = Array.isArray(rec.emails) ? rec.emails : [];
    const out = await purgeSmokeUsers(emails);
    return { statusCode: 200, body: JSON.stringify(out) };
  }
  if (rec.tmsJob === 'purge-orphan-providers') {
    await loadSnapshotFromS3(store);
    const out = purgeOrphanProviders(store);
    store.audit('ops-purge', 'purge_orphan_providers', 'providers', null, out);
    await saveSnapshotToS3(store);
    return { statusCode: 200, body: JSON.stringify(out) };
  }
  if (rec.tmsJob === 'list-users') {
    await loadSnapshotFromS3(store);
    const users = store.data.users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      displayName: u.displayName,
      providerId: u.providerId || null,
      active: u.active !== false,
    }));
    const providers = store.data.providers.map((p) => ({
      id: p.id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      userId: p.userId || null,
      discipline: p.discipline,
    }));
    return { statusCode: 200, body: JSON.stringify({ users, providers }) };
  }
  const method = event.requestContext.http.method.toUpperCase();
  const rawPath = event.rawPath || event.requestContext.http.path || '/';
  // Collapse accidental //path from API base URLs that end with /
  const path = (rawPath.replace(/^\/tms/, '') || '/').replace(/\/{2,}/g, '/') || '/';
  let body: unknown = event.body;
  if (typeof event.body === 'string' && event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  const req: HttpRequest = {
    method,
    path,
    headers: event.headers || {},
    query: event.queryStringParameters || {},
    body,
  };
  await loadSnapshotFromS3(store);
  const mandateSig = () =>
    store.data.mandates.map((m) => `${m.id}:${m.providerId}`).join('|');
  const beforeMandates = mandateSig();
  const result = await handleTmsRequest(store, req, { hha: hhaClient(), mail: await mail() });
  // Skip S3 write on pure reads — but persist when a GET repairs provider caseload aliases.
  const mutatedOnRead = beforeMandates !== mandateSig();
  if ((method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') || mutatedOnRead) {
    await saveSnapshotToS3(store);
  }
  if (Buffer.isBuffer(result.body)) {
    const out: APIGatewayProxyStructuredResultV2 = {
      statusCode: result.status,
      headers: { ...cors(), ...(result.headers || {}) },
      body: result.body.toString('base64'),
      isBase64Encoded: true,
    };
    return out;
  }
  return {
    statusCode: result.status,
    headers: { ...cors(), 'content-type': 'application/json; charset=utf-8', ...(result.headers || {}) },
    body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
  };
};

export { store as tmsStore };
