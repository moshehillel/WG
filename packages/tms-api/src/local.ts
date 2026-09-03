import { createServer } from 'node:http';
import { MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import { handleTmsRequest } from './router.js';
import { MemoryMailer } from './mail.js';

// Local dev server: allow the x-tms-role / x-tms-email dev headers by default.
process.env.TMS_ALLOW_DEV_HEADERS = process.env.TMS_ALLOW_DEV_HEADERS || '1';

const store = new MemoryStore();
if (!store.data.users.length) {
  const admin = store.upsertUser({
    id: newId(),
    cognitoSub: 'dev-admin',
    email: 'admin@whiteglove.local',
    role: 'admin',
    displayName: 'Admin',
    providerId: '',
    active: true,
    createdAt: nowIso(),
  });
  const therapistUser = store.upsertUser({
    id: newId(),
    cognitoSub: 'dev-therapist',
    email: 'therapist@whiteglove.local',
    role: 'therapist',
    displayName: 'Diana Kraupner',
    providerId: '',
    active: true,
    createdAt: nowIso(),
  });
  const school = store.upsertSchool({
    id: newId(),
    name: 'Carle Place',
    district: 'Carle Place UFSD',
    signerName: '',
    signerEmail: '',
    createdAt: nowIso(),
  });
  const provider = store.upsertProvider({
    id: newId(),
    userId: therapistUser.id,
    firstName: 'Diana',
    lastName: 'Kraupner',
    discipline: 'PT',
    payRate: 72,
    hhaCaregiverCode: 'WGC-35595',
    active: true,
    createdAt: nowIso(),
  });
  store.upsertUser({ ...therapistUser, providerId: provider.id });
  store.upsertUser(admin);
  const student = store.upsertStudent({
    id: newId(),
    schoolId: school.id,
    firstName: 'Aiden',
    lastName: 'Odne',
    dob: '07/12/2019',
    programId: '',
    programType: 'Carle Place',
    hhaPatientId: '',
    createdAt: nowIso(),
  });
  store.upsertMandate({
    id: newId(),
    studentId: student.id,
    providerId: provider.id,
    serviceType: 'PT School',
    discipline: 'PT',
    frequencyPerWeek: 2,
    frequencyKind: 'weekly',
    sessionsPerPeriod: 2,
    ratioGroup: false,
    sourcePdfKey: 'seed',
    parsedAt: nowIso(),
    startOn: '',
    endOn: '',
    createdAt: nowIso(),
  });
}

const hha = new MockHhaClient();
const mail = new MemoryMailer();
const port = Number(process.env.TMS_PORT || 8787);

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body: unknown = raw;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v[0] : v;
  }
  const result = await handleTmsRequest(
    store,
    {
      method: (req.method || 'GET').toUpperCase(),
      path: url.pathname,
      headers,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    },
    { hha, mail },
  );
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,authorization,x-tms-role,x-tms-email',
    'access-control-allow-methods': 'GET,POST,OPTIONS,PUT,PATCH,DELETE',
  };
  if (Buffer.isBuffer(result.body)) {
    res.writeHead(result.status, { ...cors, ...(result.headers || {}) });
    res.end(result.body);
    return;
  }
  res.writeHead(result.status, {
    ...cors,
    'content-type': 'application/json; charset=utf-8',
    ...(result.headers || {}),
  });
  res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
}).listen(port, () => {
  console.log(`TMS API http://127.0.0.1:${port}  (headers x-tms-role: admin|therapist)`);
});
