import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { AppUser, Role } from '@white-glove/tms-db';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';

export interface AuthContext {
  user: AppUser;
}

function createVerifier() {
  return CognitoJwtVerifier.create({
    userPoolId: process.env.TMS_USER_POOL_ID || '',
    tokenUse: 'id',
    clientId: process.env.TMS_CLIENT_ID || '',
  });
}

let verifier: ReturnType<typeof createVerifier> | null = null;

function getVerifier(): ReturnType<typeof createVerifier> | null {
  if (!process.env.TMS_USER_POOL_ID || !process.env.TMS_CLIENT_ID) return null;
  if (!verifier) verifier = createVerifier();
  return verifier;
}

function devHeadersAllowed(): boolean {
  return process.env.TMS_ALLOW_DEV_HEADERS === '1';
}

function ensureUser(
  store: MemoryStore,
  email: string,
  role: Role,
  sub: string,
  displayName: string,
): AppUser {
  const existing = store.userByEmail(email) || (sub ? store.userBySub(sub) : undefined);
  if (existing) {
    if (sub && existing.cognitoSub !== sub) {
      return store.upsertUser({
        ...existing,
        cognitoSub: sub,
        displayName: displayName || existing.displayName,
      });
    }
    return existing;
  }
  const user: AppUser = {
    id: newId(),
    cognitoSub: sub || newId(),
    email,
    role,
    displayName,
    providerId: '',
    active: true,
    createdAt: nowIso(),
  };
  store.upsertUser(user);
  return user;
}

export async function authenticate(
  store: MemoryStore,
  headers: Record<string, string | undefined>,
): Promise<AuthContext | { error: string; status: number }> {
  const h = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (devHeadersAllowed()) {
    const devRole = (h['x-tms-role'] || process.env.TMS_DEV_ROLE || '').toLowerCase();
    if (devRole === 'admin' || devRole === 'therapist') {
      const email = h['x-tms-email'] || process.env.TMS_DEV_EMAIL || `${devRole}@whiteglove.local`;
      const user = ensureUser(store, email, devRole, `dev-${email}`, devRole);
      return { user };
    }
  }
  const auth = h.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return { error: 'Sign in required.', status: 401 };
  }
  if (token === 'admin' || token === 'therapist') {
    if (!devHeadersAllowed()) return { error: 'Sign in required.', status: 401 };
    const user = ensureUser(store, `${token}@whiteglove.local`, token, `dev-${token}`, token);
    return { user };
  }
  const v = getVerifier();
  if (!v) return { error: 'Sign in is not set up on the server.', status: 401 };
  let payload: Record<string, unknown>;
  try {
    payload = (await v.verify(token)) as unknown as Record<string, unknown>;
  } catch {
    return { error: 'Your sign in expired or is not valid. Please sign in again.', status: 401 };
  }
  const email = String(payload.email || payload['cognito:username'] || '');
  const groups = payload['cognito:groups'];
  const groupList = Array.isArray(groups) ? groups.map(String) : [];
  const role: Role = groupList.includes('Admin') || groupList.includes('admin') ? 'admin' : 'therapist';
  const sub = String(payload.sub || '');
  if (!email) return { error: 'Token missing email.', status: 401 };
  const user = ensureUser(store, email, role, sub, email);
  if (user.role !== 'admin' && role === 'admin') {
    store.upsertUser({ ...user, role: 'admin' });
  }
  const resolved = store.userByEmail(email)!;
  if (resolved.active === false) {
    return { error: 'This account is deactivated. Ask another admin to restore access.', status: 403 };
  }
  return { user: resolved };
}

export function requireAdmin(ctx: AuthContext): string | null {
  if (ctx.user.role !== 'admin') return 'Admin only.';
  return null;
}
