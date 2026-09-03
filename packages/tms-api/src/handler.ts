import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createHhaClient, MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore } from '@white-glove/tms-db';
import { handleTmsRequest, type HttpRequest } from './router.js';
import { createMailer, type Mailer } from './mail.js';
import { runDueNags } from './due-nags.js';
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

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const rec = event as { source?: string; tmsJob?: string };
  if (rec.source === 'aws.events' || rec.tmsJob === 'due-nags') {
    await loadSnapshotFromS3(store);
    const out = await runDueNags(store, await mail());
    await saveSnapshotToS3(store);
    return { statusCode: 200, body: JSON.stringify(out) };
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
  const result = await handleTmsRequest(store, req, { hha: hhaClient(), mail: await mail() });
  await saveSnapshotToS3(store);
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
