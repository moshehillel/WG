import {
  adminProviderDetail,
  adminSchoolDetail,
  adminStudentDetail,
  adminStudentsList,
  adminWeeksList,
  applyCaseloadImport,
  checkMandatesForWeek,
  collectHeuristicAiIssues,
  dashboard,
  dueDateReport,
  findProviderByName,
  lastServiceByStudent,
  mappingName,
  missingNotes,
  weekProgressReport,
  newId,
  nowIso,
  parseCaseloadUpload,
  parseMandatePdfText,
  parseWeeklySessionText,
  schoolNamesConflict,
  screenServiceNote,
  splitPersonName,
  therapistCanEdit,
  unusedMissedForStudent,
  validateMakeup,
  weekStartFromDos,
  additionalServiceLabel,
  isAdditionalServiceType,
  emptySchoolCalendar,
  isIsoDate,
  normalizeOffDays,
  parseOffDaysCsv,
  blankProviderPay,
  sessionPayAmount,
  DEFAULT_ADMIN_NOTE_TAGS,
  rowsToXlsxBuffer,
  type AppUser,
  type Discipline,
  type FrequencyKind,
  type MandateKind,
  type MemoryStore,
  type SchoolCalendar,
  type SessionRow,
  type Student,
} from '@white-glove/tms-db';
import { authenticate, requireAdmin, type AuthContext } from './auth.js';
import { screenNoteWithOptionalBedrock } from './bedrock.js';
import { transferLockedWeek } from './hha-transfer.js';
import { buildTimesheetPdf } from './timesheet.js';
import { createSignEnvelope, envelopeCompleted } from './esign.js';
import { deactivateCognitoLogin, deleteCognitoLogin, inviteTherapist } from './invite.js';
import { PDF_NO_TEXT_ERROR, bodyHasPdfBytes, pdfTextFromBody } from './pdf-text.js';
import { runDueNags } from './due-nags.js';
import { putLockerPdf } from './s3-state.js';
import type { Mailer } from './mail.js';
import type { HhaClient } from '@white-glove/hha-client';

export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

function json(status: number, body: unknown): HttpResponse {
  return { status, body, headers: { 'content-type': 'application/json' } };
}

function textBody(req: HttpRequest): string {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object' && 'pdfText' in req.body) {
    return String((req.body as { pdfText?: string }).pdfText || '');
  }
  if (req.body && typeof req.body === 'object' && 'text' in req.body) {
    return String((req.body as { text?: string }).text || '');
  }
  return '';
}

function obj(req: HttpRequest): Record<string, unknown> {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function providerFor(store: MemoryStore, user: AppUser) {
  if (user.providerId) {
    return store.data.providers.find((p) => p.id === user.providerId);
  }
  return store.data.providers.find((p) => p.userId === user.id);
}

/** School-scoped due dates visible to the signed-in user (admins see all). */
function dueDatesForUser(store: MemoryStore, user: AppUser) {
  const open = dueDateReport(store).filter((d) => d.status !== 'done');
  if (user.role === 'admin') return open;
  const provider = providerFor(store, user);
  if (!provider) return [];
  const myStudentIds = new Set(
    store.data.mandates.filter((m) => m.providerId === provider.id).map((m) => m.studentId),
  );
  const mySchoolIds = new Set(
    store.data.students.filter((s) => myStudentIds.has(s.id)).map((s) => s.schoolId),
  );
  return open.filter((d) => mySchoolIds.has(d.schoolId));
}

function linkUserToProvider(store: MemoryStore, userId: string, providerId: string): void {
  const user = store.userById(userId);
  if (user) store.upsertUser({ ...user, providerId });
  const provider = store.data.providers.find((p) => p.id === providerId);
  if (provider) store.upsertProvider({ ...provider, userId });
}

function parseDiscipline(raw: unknown, fallback: Discipline = 'PT'): Discipline {
  const d = String(raw || fallback);
  return ['OT', 'PT', 'SLP'].includes(d) ? (d as Discipline) : fallback;
}

function therapistDisplayName(b: Record<string, unknown>, email: string): string {
  const fromParts = `${String(b.firstName || '')} ${String(b.lastName || '')}`.trim();
  return String(b.displayName || fromParts || email).trim() || email;
}

function splitDisplayName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Create Cognito invite (best-effort) + AppUser + Provider and link both ways. Links existing login by email. */
async function upsertTherapistAsProvider(
  store: MemoryStore,
  b: Record<string, unknown>,
): Promise<{ user: AppUser; provider: ReturnType<MemoryStore['upsertProvider']>; createdUser: boolean }> {
  const email = String(b.email || '').trim().toLowerCase();
  if (!email) throw new Error('Email is required.');
  const displayName = therapistDisplayName(b, email);
  const fromDisplay = splitDisplayName(displayName);
  const firstName = String(b.firstName || fromDisplay.firstName || '').trim();
  const lastName = String(b.lastName || fromDisplay.lastName || '').trim();
  const discipline = parseDiscipline(b.discipline);
  const hhaCaregiverCode = String(b.hhaCaregiverCode || '');

  let user = store.userByEmail(email);
  let createdUser = false;
  if (!user) {
    let cognitoSub = `invite-${email}`;
    try {
      cognitoSub = await inviteTherapist(email, displayName, 'therapist');
    } catch {
      cognitoSub = `invite-${email}`;
    }
    user = store.upsertUser({
      id: newId(),
      cognitoSub,
      email,
      role: 'therapist',
      displayName,
      providerId: '',
      active: true,
      createdAt: nowIso(),
    });
    createdUser = true;
  } else {
    user = store.upsertUser({
      ...user,
      displayName: displayName || user.displayName,
      role: 'therapist',
      active: true,
    });
  }

  let provider = providerFor(store, user);
  if (!provider) {
    provider = store.upsertProvider({
      id: newId(),
      userId: user.id,
      firstName,
      lastName,
      discipline,
      ...providerPayFields(b),
      hhaCaregiverCode,
      active: true,
      createdAt: nowIso(),
    });
  } else {
    provider = store.upsertProvider({
      ...provider,
      firstName: firstName || provider.firstName,
      lastName: lastName || provider.lastName,
      discipline: b.discipline != null && String(b.discipline) ? discipline : provider.discipline,
      ...providerPayFields(b, provider),
      hhaCaregiverCode:
        b.hhaCaregiverCode === undefined ? provider.hhaCaregiverCode : hhaCaregiverCode,
      active: true,
      userId: user.id,
    });
  }
  linkUserToProvider(store, user.id, provider.id);
  return {
    user: store.userById(user.id)!,
    provider: store.data.providers.find((p) => p.id === provider!.id)!,
    createdUser,
  };
}

function visibleStudents(store: MemoryStore, user: AppUser, weekStart: string): Student[] {
  if (user.role === 'admin') return store.data.students;
  const provider = providerFor(store, user);
  const providerId = provider?.id || '';
  const mandated = new Set(
    store.data.mandates
      .filter((m) => m.providerId === providerId || !m.providerId)
      .map((m) => m.studentId),
  );
  const week = weekStart ? store.weekByProviderStart(providerId, weekStart) : undefined;
  const fromWeek = new Set((week ? store.sessionsForWeek(week.id) : []).map((s) => s.studentId));
  return store.data.students.filter((s) => mandated.has(s.id) || fromWeek.has(s.id));
}

function pickStr(v: unknown, fallback: string): string {
  return v != null ? String(v) : fallback;
}

function parseNoteTags(b: Record<string, unknown>, existing: string[] = []): string[] {
  if (b.tags === undefined) return existing;
  const raw = b.tags;
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(',')
        .map((t) => t.trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const s = String(t || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function parseMandateKind(raw: unknown, fallback: MandateKind = 'regular'): MandateKind {
  return String(raw || fallback) === 'makeup_auth' ? 'makeup_auth' : 'regular';
}

function parseNullableNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Prefer `payRatePerHour`; accept legacy `payRate` as alias for per-hour. */
function resolvePayRatePerHour(
  b: Record<string, unknown>,
  existing: number | null | undefined,
): number | null {
  if (b.payRatePerHour !== undefined) return parseNullableNumber(b.payRatePerHour);
  if (b.payRate !== undefined) return parseNullableNumber(b.payRate);
  return existing ?? null;
}

function resolveOptionalPayField(
  b: Record<string, unknown>,
  key: string,
  existing: number | null | undefined,
): number | null {
  if (b[key] !== undefined) return parseNullableNumber(b[key]);
  return existing ?? null;
}

function providerPayFields(
  b: Record<string, unknown>,
  existing?: Partial<ReturnType<typeof blankProviderPay>> & { payRatePerHour?: number | null },
) {
  const payKeys = [
    'payRate30Min',
    'payRate42Min',
    'payRate45Min',
    'payRateGroup30Min',
    'payRateGroup42Min',
    'payRateGroup45Min',
    'payRateAdditionalHourly',
  ] as const;
  const out = {
    ...blankProviderPay(),
    payRatePerHour: resolvePayRatePerHour(b, existing?.payRatePerHour),
  };
  for (const key of payKeys) {
    out[key] = resolveOptionalPayField(b, key, existing?.[key]);
  }
  if (b.payRateAdditionalServices !== undefined && b.payRateAdditionalHourly === undefined) {
    out.payRateAdditionalHourly = parseNullableNumber(b.payRateAdditionalServices);
  }
  return out;
}

function pdfBufferFromBody(b: Record<string, unknown>): Buffer | null {
  const raw = typeof b.pdfBase64 === 'string' ? b.pdfBase64.trim() : '';
  if (!raw) return null;
  return Buffer.from(raw.replace(/^data:application\/pdf;base64,/, ''), 'base64');
}

function anyFileBufferFromBody(b: Record<string, unknown>): Buffer | null {
  const pdf = pdfBufferFromBody(b);
  if (pdf) return pdf;
  const raw = typeof b.fileBase64 === 'string' ? b.fileBase64.trim() : '';
  if (!raw) return null;
  return Buffer.from(raw.replace(/^data:[^;]+;base64,/, ''), 'base64');
}

function xlsxResponse(filename: string, buf: Buffer): HttpResponse {
  return {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${filename}"`,
    },
    body: buf,
  };
}

function reportRange(query: Record<string, string | undefined>) {
  return { from: String(query.from || '').trim(), to: String(query.to || '').trim() };
}

function reportXlsxWeekProgress(
  store: MemoryStore,
  query: Record<string, string | undefined>,
): HttpResponse {
  const { from, to } = reportRange(query);
  const rows = weekProgressReport(store, { from, to });
  return xlsxResponse(
    'sessions-notes-progress.xlsx',
    rowsToXlsxBuffer(
      'Sessions & notes',
      [
        'Child',
        'Mandate',
        'Week',
        'Sessions provided',
        'Notes posted',
        'Missed',
        'Notes follow-up',
        'Progress %',
      ],
      rows.map((r) => [
        r.childName,
        r.mandateLabel,
        r.weekLabel,
        r.sessionsProvided,
        r.notesPosted,
        r.sessionsMissed,
        r.notesFollowUp,
        r.progressPct,
      ]),
    ),
  );
}

function reportXlsxMissing(store: MemoryStore, query: Record<string, string | undefined>): HttpResponse {
  const { from, to } = reportRange(query);
  const rows = missingNotes(store, undefined, { from, to, includeMissed: true });
  return xlsxResponse(
    'missing-notes.xlsx',
    rowsToXlsxBuffer(
      'Note follow-ups',
      ['Child', 'Date', 'Week', 'Attendance', 'Reason', 'Notes'],
      rows.map((r) => [r.studentName, r.date, r.weekStart || r.weekId, r.attendance, r.reason, r.notes]),
    ),
  );
}

function reportXlsxLastService(store: MemoryStore, query: Record<string, string | undefined>): HttpResponse {
  const providerId = String(query.providerId || '').trim();
  const rows = lastServiceByStudent(store, { providerId: providerId || undefined });
  return xlsxResponse(
    'last-service.xlsx',
    rowsToXlsxBuffer(
      'Last service',
      ['Child', 'Provider', 'School', 'Last DOS'],
      rows.map((r) => [r.name, r.providerName, r.schoolName, r.lastDos]),
    ),
  );
}

function reportXlsxDueDates(store: MemoryStore, query: Record<string, string | undefined>): HttpResponse {
  const { from, to } = reportRange(query);
  const rows = dueDateReport(store, new Date(), { from, to });
  return xlsxResponse(
    'due-dates.xlsx',
    rowsToXlsxBuffer(
      'Due dates',
      ['School', 'Kind', 'Due', 'Status'],
      rows.map((r) => [r.schoolName, r.kind, r.dueOn, r.status]),
    ),
  );
}

export async function handleTmsRequest(
  store: MemoryStore,
  req: HttpRequest,
  deps: { hha?: HhaClient; mail?: Mailer } = {},
): Promise<HttpResponse> {
  if (req.method === 'OPTIONS') return { status: 204, body: '' };
  const path = req.path.replace(/\/+$/, '') || '/';

  if (req.method === 'POST' && path === '/webhooks/esign') {
    const { envelopeId, completed } = envelopeCompleted(obj(req));
    if (!completed || !envelopeId) return json(202, { ok: true, ignored: true });
    const week = store.data.weeks.find((w) => w.envelopeId === envelopeId || w.id === envelopeId.replace(/^email:/, ''));
    if (!week) return json(404, { error: 'Envelope week not found.' });
    const locked = store.upsertWeek({ ...week, status: 'locked', signedKey: `tms/signed/${week.id}.pdf` });
    store.audit('esign', 'sign_and_lock', `week:${week.id}`, week, locked);
    const provider = store.data.providers.find((p) => p.id === week.providerId);
    const therapist = provider ? store.userById(provider.userId) : undefined;
    if (deps.mail && therapist?.email) {
      await deps.mail.send({
        to: [therapist.email],
        subject: 'Timesheet signed — you will be paid',
        text: 'Success. This week is signed and locked. You will be paid.',
      });
    }
    if (deps.hha && (locked.status === 'locked')) {
      await transferLockedWeek({ store, week: locked, hha: deps.hha, actorId: 'esign' });
    }
    return json(200, {
      week: store.data.weeks.find((w) => w.id === week.id),
      therapistMessage: 'Success. This week is signed and locked. You will be paid.',
    });
  }

  if (req.method === 'POST' && path === '/internal/due-nags') {
    // Requires a configured key — without TMS_INTERNAL_KEY this HTTP route stays off.
    // The daily EventBridge job invokes the Lambda directly and does not pass through here.
    const key = process.env.TMS_INTERNAL_KEY || '';
    const provided = req.headers['x-tms-internal'] || obj(req).key;
    if (!key || provided !== key) return json(401, { error: 'Unauthorized nag job.' });
    if (!deps.mail) return json(503, { error: 'Mailer missing.' });
    const out = await runDueNags(store, deps.mail);
    return json(200, out);
  }

  const auth = await authenticate(store, req.headers);
  if ('error' in auth) return json(auth.status, { error: auth.error });
  const ctx = auth;

  if (req.method === 'GET' && path === '/me') {
    return json(200, {
      user: ctx.user,
      provider: providerFor(store, ctx.user),
      alerts: store.openAlerts().slice(0, 20),
      dueDates: dueDatesForUser(store, ctx.user),
    });
  }

  if (req.method === 'GET' && path === '/dashboard') {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    return json(200, dashboard(store));
  }

  const adminUser = async (
    fn: (c: AuthContext) => Promise<HttpResponse> | HttpResponse,
  ): Promise<HttpResponse> => {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    return fn(ctx);
  };

  if (req.method === 'POST' && path === '/admin/therapists') {
    return adminUser(async () => {
      const b = obj(req);
      // Always therapist — ignore any role from the client body.
      try {
        const out = await upsertTherapistAsProvider(store, { ...b, role: 'therapist' });
        store.audit(ctx.user.id, 'upsert_therapist', `user:${out.user.id}`, null, {
          user: out.user,
          provider: out.provider,
        });
        return json(out.createdUser ? 201 : 200, {
          user: out.user,
          provider: out.provider,
          message: out.createdUser
            ? 'Therapist created and linked as provider. They will get a Cognito invite when the user pool is configured.'
            : 'Existing login linked to therapist (provider) profile.',
        });
      } catch (err) {
        return json(400, { error: err instanceof Error ? err.message : 'Could not create therapist.' });
      }
    });
  }

  if (req.method === 'POST' && path === '/admin/users') {
    return adminUser(async () => {
      const b = obj(req);
      const email = String(b.email || '').trim().toLowerCase();
      const role = b.role === 'admin' ? 'admin' : 'therapist';
      if (!email) return json(400, { error: 'Email is required.' });

      // Therapist with profile fields → one-shot user + provider + link (same as /admin/therapists).
      const wantsProvider =
        role === 'therapist' &&
        (b.discipline != null ||
          b.firstName != null ||
          b.lastName != null ||
          b.payRate != null ||
          b.payRatePerHour != null ||
          b.payRate30Min != null ||
          b.payRateAdditionalHourly != null ||
          b.hhaCaregiverCode != null ||
          b.createProvider === true);
      if (wantsProvider) {
        try {
          const out = await upsertTherapistAsProvider(store, { ...b, email });
          store.audit(ctx.user.id, 'invite_user', `user:${out.user.id}`, null, {
            user: out.user,
            provider: out.provider,
          });
          return json(out.createdUser ? 201 : 200, {
            user: out.user,
            provider: out.provider,
            message: out.createdUser
              ? 'Therapist login created and linked as provider.'
              : 'Existing login linked to therapist (provider) profile.',
          });
        } catch (err) {
          return json(400, { error: err instanceof Error ? err.message : 'Could not create therapist.' });
        }
      }

      if (store.userByEmail(email)) return json(400, { error: 'User already exists.' });
      let cognitoSub = String(b.cognitoSub || `invite-${email}`);
      try {
        cognitoSub = await inviteTherapist(email, String(b.displayName || email), role);
      } catch (err) {
        cognitoSub = `invite-${email}`;
        void err;
      }
      const user: AppUser = {
        id: newId(),
        cognitoSub,
        email,
        role,
        displayName: String(b.displayName || email),
        providerId: String(b.providerId || ''),
        active: true,
        createdAt: nowIso(),
      };
      store.upsertUser(user);
      if (user.providerId) linkUserToProvider(store, user.id, user.providerId);
      store.audit(ctx.user.id, 'invite_user', `user:${user.id}`, null, user);
      const who = role === 'admin' ? 'Admin' : 'Therapist';
      return json(201, {
        user: store.userById(user.id),
        message: `${who} invite created. They will get a Cognito email when the user pool is configured.`,
      });
    });
  }

  if (req.method === 'GET' && path === '/admin/users') {
    return adminUser(() => json(200, { users: store.data.users }));
  }

  if (req.method === 'DELETE' && /^\/admin\/users\/[^/]+$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const target = store.userById(id);
      if (!target) return json(404, { error: 'User not found.' });
      if (target.id === ctx.user.id) {
        return json(400, { error: 'You cannot delete your own admin account.' });
      }
      if (target.role === 'admin') {
        const otherActiveAdmins = store.data.users.filter(
          (u) => u.role === 'admin' && u.active !== false && u.id !== target.id,
        );
        if (otherActiveAdmins.length === 0) {
          return json(400, { error: 'Cannot delete the last active admin.' });
        }
      }
      const linkedProvider =
        (target.providerId
          ? store.data.providers.find((p) => p.id === target.providerId)
          : undefined) || store.data.providers.find((p) => p.userId === target.id);
      const before = { user: { ...target }, provider: linkedProvider ? { ...linkedProvider } : null };
      if (linkedProvider && target.role === 'therapist') {
        store.removeProvider(linkedProvider.id);
      }
      try {
        await deleteCognitoLogin(target.cognitoSub, target.email);
      } catch (err) {
        // App user is still removed so the admin list stays clean.
        void err;
      }
      store.deleteUser(target.id);
      store.audit(ctx.user.id, 'delete_user', `user:${target.id}`, before, null);
      return json(200, {
        deleted: true,
        id: target.id,
        message: target.role === 'admin' ? 'Admin removed.' : 'Therapist removed.',
      });
    });
  }

  if (req.method === 'POST' && /^\/admin\/users\/[^/]+\/deactivate$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const target = store.userById(id);
      if (!target) return json(404, { error: 'User not found.' });
      if (target.id === ctx.user.id) {
        return json(400, { error: 'You cannot deactivate your own admin account.' });
      }
      if (target.role === 'admin') {
        return json(400, { error: 'Admins must be deleted, not deactivated.' });
      }
      if (target.active === false) {
        return json(200, { user: target, message: 'Already deactivated.' });
      }
      const before = { ...target };
      const updated = store.upsertUser({ ...target, active: false });
      try {
        await deactivateCognitoLogin(target.email, target.role);
      } catch (err) {
        // App state still deactivates; Cognito may lag if username differs.
        void err;
      }
      store.audit(ctx.user.id, 'deactivate_user', `user:${updated.id}`, before, updated);
      return json(200, {
        user: updated,
        message: 'User deactivated.',
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/schools') {
    return adminUser(() => {
      const b = obj(req);
      const id = String(b.id || newId());
      const existing = store.data.schools.find((s) => s.id === id);
      const school = store.upsertSchool({
        id,
        name: String(b.name || existing?.name || '').trim(),
        district: String(b.district ?? existing?.district ?? ''),
        signerName: String(b.signerName ?? existing?.signerName ?? ''),
        signerEmail: String(b.signerEmail ?? existing?.signerEmail ?? ''),
        createdAt: existing?.createdAt || nowIso(),
      });
      return json(existing ? 200 : 201, { school });
    });
  }

  if (req.method === 'GET' && path === '/admin/schools') {
    return adminUser(() => {
      const calendarsBySchoolId: Record<string, SchoolCalendar> = {};
      for (const s of store.data.schools) {
        calendarsBySchoolId[s.id] =
          store.schoolCalendarForSchool(s.id) ?? emptySchoolCalendar(s.id);
      }
      return json(200, { schools: store.data.schools, calendarsBySchoolId });
    });
  }

  if (req.method === 'GET' && /^\/admin\/schools\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      if (id === 'calendar') return json(404, { error: 'Not found.' });
      const detail = adminSchoolDetail(store, id);
      if (!detail) return json(404, { error: 'School not found.' });
      return json(200, detail);
    });
  }

  if (req.method === 'GET' && /^\/admin\/schools\/[^/]+\/calendar$/.test(path)) {
    return adminUser(() => {
      const schoolId = path.split('/')[3];
      const school = store.data.schools.find((s) => s.id === schoolId);
      if (!school) return json(404, { error: 'School not found.' });
      const calendar =
        store.schoolCalendarForSchool(schoolId) ?? emptySchoolCalendar(schoolId);
      return json(200, { calendar });
    });
  }

  if (req.method === 'POST' && /^\/admin\/schools\/[^/]+\/calendar$/.test(path)) {
    return adminUser(() => {
      const schoolId = path.split('/')[3];
      const school = store.data.schools.find((s) => s.id === schoolId);
      if (!school) return json(404, { error: 'School not found.' });
      const b = obj(req);
      const yearStart = String(b.yearStart ?? '').trim();
      const yearEnd = String(b.yearEnd ?? '').trim();
      if (yearStart && !isIsoDate(yearStart)) {
        return json(400, { error: 'yearStart must be YYYY-MM-DD.' });
      }
      if (yearEnd && !isIsoDate(yearEnd)) {
        return json(400, { error: 'yearEnd must be YYYY-MM-DD.' });
      }
      if (yearStart && yearEnd && yearStart > yearEnd) {
        return json(400, { error: 'yearStart must be on or before yearEnd.' });
      }
      let offDays: string[] = [];
      if (Array.isArray(b.offDays)) {
        offDays = normalizeOffDays(b.offDays.map(String));
      }
      const csv = String(b.offDaysCsv ?? b.offDaysText ?? '').trim();
      if (csv) offDays = normalizeOffDays([...offDays, ...parseOffDaysCsv(csv)]);
      const before = store.schoolCalendarForSchool(schoolId) ?? null;
      const calendar = store.upsertSchoolCalendar({
        schoolId,
        yearStart,
        yearEnd,
        offDays,
      });
      store.audit(ctx.user.id, 'upsert_school_calendar', `school:${schoolId}`, before, calendar);
      return json(200, { calendar, message: 'School calendar saved.' });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/schools\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.schools.find((s) => s.id === id);
      if (!existing) return json(404, { error: 'School not found.' });
      const childCount = store.data.students.filter((s) => s.schoolId === id).length;
      store.removeSchool(id);
      store.audit(ctx.user.id, 'delete_school', `school:${id}`, { ...existing, childCount }, null);
      return json(200, {
        deleted: true,
        id,
        message:
          childCount > 0
            ? `School removed. ${childCount} child(ren) no longer linked to a school.`
            : 'School removed.',
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/providers') {
    return adminUser(async () => {
      const b = obj(req);
      const email = String(b.email || '').trim().toLowerCase();
      // Email means therapist-as-provider: create/link login + provider in one step.
      if (email) {
        try {
          const out = await upsertTherapistAsProvider(store, b);
          store.audit(ctx.user.id, 'upsert_provider', `provider:${out.provider.id}`, null, out);
          return json(out.createdUser ? 201 : 200, {
            provider: out.provider,
            user: out.user,
          });
        } catch (err) {
          return json(400, { error: err instanceof Error ? err.message : 'Could not save provider.' });
        }
      }
      const discipline = parseDiscipline(b.discipline);
      const userId = String(b.userId || '');
      const provider = store.upsertProvider({
        id: String(b.id || newId()),
        userId,
        firstName: String(b.firstName || ''),
        lastName: String(b.lastName || ''),
        discipline,
        ...providerPayFields(b),
        hhaCaregiverCode: String(b.hhaCaregiverCode || ''),
        active: b.active === false ? false : true,
        createdAt: nowIso(),
      });
      if (provider.userId) linkUserToProvider(store, provider.userId, provider.id);
      return json(201, {
        provider: store.data.providers.find((p) => p.id === provider.id),
        user: provider.userId ? store.userById(provider.userId) : undefined,
      });
    });
  }

  if (req.method === 'GET' && path === '/admin/providers') {
    return adminUser(() => json(200, { providers: store.data.providers }));
  }

  if (req.method === 'GET' && /^\/admin\/providers\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const detail = adminProviderDetail(store, id);
      if (!detail) return json(404, { error: 'Provider not found.' });
      return json(200, detail);
    });
  }

  if ((req.method === 'POST' || req.method === 'PATCH') && /^\/admin\/providers\/[^/]+$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const existing = store.data.providers.find((p) => p.id === id);
      if (!existing) return json(404, { error: 'Provider not found.' });
      const b = obj(req);
      const provider = store.upsertProvider({
        ...existing,
        firstName: pickStr(b.firstName, existing.firstName),
        lastName: pickStr(b.lastName, existing.lastName),
        discipline: parseDiscipline(b.discipline, existing.discipline),
        ...providerPayFields(b, existing),
        hhaCaregiverCode: pickStr(b.hhaCaregiverCode, existing.hhaCaregiverCode),
        active: b.active === false ? false : b.active === true ? true : existing.active,
      });
      let user = provider.userId ? store.userById(provider.userId) : store.data.users.find((u) => u.providerId === provider.id);
      if (user && (b.email != null || b.displayName != null)) {
        const email = b.email != null ? String(b.email).trim().toLowerCase() : user.email;
        const displayName =
          b.displayName != null
            ? String(b.displayName).trim()
            : `${provider.firstName} ${provider.lastName}`.trim() || user.displayName;
        user = store.upsertUser({ ...user, email: email || user.email, displayName: displayName || user.displayName });
      }
      store.audit(ctx.user.id, 'update_provider', `provider:${id}`, existing, provider);
      return json(200, { provider, user: user || null });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/providers\/[^/]+$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const existing = store.data.providers.find((p) => p.id === id);
      if (!existing) return json(404, { error: 'Provider not found.' });
      const linked =
        (existing.userId ? store.userById(existing.userId) : undefined) ||
        store.data.users.find((u) => u.providerId === existing.id);
      const before = { provider: existing, user: linked || null };
      store.removeProvider(id);
      if (linked && linked.role === 'therapist') {
        store.upsertUser({ ...linked, providerId: '', active: false });
        try {
          await deactivateCognitoLogin(linked.email, linked.role);
        } catch {
          /* app unlink still wins */
        }
      }
      store.audit(ctx.user.id, 'delete_provider', `provider:${id}`, before, null);
      return json(200, { deleted: true, id, message: 'Provider removed.' });
    });
  }

  if ((req.method === 'POST' || req.method === 'PATCH') && /^\/admin\/providers\/[^/]+\/notes\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const providerId = path.split('/')[3];
      const noteId = path.split('/')[5];
      const existing = store.data.adminNotes.find((n) => n.id === noteId && n.providerId === providerId);
      if (!existing) return json(404, { error: 'Note not found.' });
      const text = String(obj(req).body || obj(req).note || obj(req).text || '').trim();
      if (!text) return json(400, { error: 'Note text is required.' });
      const tags = parseNoteTags(obj(req), existing.tags);
      const note = store.upsertAdminNote({ ...existing, body: text, tags });
      store.audit(ctx.user.id, 'update_admin_note', `note:${noteId}`, existing, note);
      return json(200, { note, notes: store.notesForProvider(providerId) });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/providers\/[^/]+\/notes\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const providerId = path.split('/')[3];
      const noteId = path.split('/')[5];
      const existing = store.data.adminNotes.find((n) => n.id === noteId && n.providerId === providerId);
      if (!existing) return json(404, { error: 'Note not found.' });
      store.removeAdminNote(noteId);
      store.audit(ctx.user.id, 'delete_admin_note', `note:${noteId}`, existing, null);
      return json(200, { deleted: true, notes: store.notesForProvider(providerId) });
    });
  }

  if (req.method === 'GET' && path === '/admin/students') {
    return adminUser(() => json(200, { students: adminStudentsList(store) }));
  }

  if (req.method === 'GET' && /^\/admin\/students\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const detail = adminStudentDetail(store, id);
      if (!detail) return json(404, { error: 'Child not found.' });
      return json(200, detail);
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/students\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.students.find((s) => s.id === id);
      if (!existing) return json(404, { error: 'Child not found.' });
      store.removeStudent(id);
      store.audit(ctx.user.id, 'delete_student', `student:${id}`, existing, null);
      return json(200, { deleted: true, id, message: 'Child removed.' });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/mandates\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.mandates.find((m) => m.id === id);
      if (!existing) return json(404, { error: 'Mandate not found.' });
      store.removeMandate(id);
      store.audit(ctx.user.id, 'delete_mandate', `mandate:${id}`, existing, null);
      return json(200, { deleted: true, id, message: 'Mandate removed.' });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/files\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.files.find((f) => f.id === id);
      if (!existing) return json(404, { error: 'File not found.' });
      store.removeFile(id);
      store.audit(ctx.user.id, 'delete_file', `file:${id}`, existing, null);
      return json(200, { deleted: true, id, message: 'File removed.' });
    });
  }

  if (req.method === 'GET' && path === '/admin/weeks') {
    return adminUser(() => json(200, { weeks: adminWeeksList(store) }));
  }

  if (req.method === 'POST' && /^\/admin\/providers\/[^/]+\/notes$/.test(path)) {
    return adminUser(() => {
      const providerId = path.split('/')[3];
      const provider = store.data.providers.find((p) => p.id === providerId);
      if (!provider) return json(404, { error: 'Provider not found.' });
      const text = String(obj(req).body || obj(req).note || obj(req).text || '').trim();
      if (!text) return json(400, { error: 'Note text is required.' });
      const note = store.addAdminNote({
        id: newId(),
        providerId,
        authorId: ctx.user.id,
        body: text,
        tags: parseNoteTags(obj(req), []),
        createdAt: nowIso(),
      });
      return json(201, { note, notes: store.notesForProvider(providerId) });
    });
  }

  if (req.method === 'GET' && /^\/admin\/providers\/[^/]+\/notes$/.test(path)) {
    return adminUser(() => {
      const providerId = path.split('/')[3];
      return json(200, {
        notes: store.notesForProvider(providerId),
        tagOptions: [...DEFAULT_ADMIN_NOTE_TAGS],
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/mandates/parse') {
    return adminUser(() => {
      const b = obj(req);
      const text = pdfTextFromBody(b) || textBody(req);
      if (!text.trim()) {
        return json(400, {
          error: bodyHasPdfBytes(b)
            ? PDF_NO_TEXT_ERROR
            : 'Upload a mandate PDF or paste the mandate text.',
        });
      }
      const parsed = parseMandatePdfText(text);
      let student = store.findStudentByName(parsed.firstName, parsed.lastName);
      if (!student && parsed.firstName) {
        student = store.upsertStudent({
          id: newId(),
          schoolId: String(obj(req).schoolId || store.data.schools[0]?.id || ''),
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          dob: parsed.dob,
          programId: parsed.programId,
          programType: parsed.programType,
          hhaPatientId: '',
          createdAt: nowIso(),
        });
      }
      let mandate = student ? store.mandateForStudent(student.id) : undefined;
      if (student && parsed.frequencyPerWeek != null) {
        mandate = store.upsertMandate({
          id: mandate?.id || newId(),
          studentId: student.id,
          providerId: String(obj(req).providerId || ''),
          serviceType: parsed.serviceType,
          discipline: parsed.discipline,
          frequencyPerWeek: parsed.frequencyPerWeek,
          frequencyKind: 'weekly',
          sessionsPerPeriod: parsed.frequencyPerWeek,
          ratioGroup: parsed.ratioGroup,
          sourcePdfKey: String(b.sourcePdfKey || 'upload'),
          parsedAt: nowIso(),
          startOn: '',
          endOn: '',
          createdAt: mandate?.createdAt || nowIso(),
        });
      }
      store.audit(ctx.user.id, 'parse_mandate_pdf', student ? `student:${student.id}` : 'student:new', null, parsed);
      return json(200, { parsed, student, mandate });
    });
  }

  if (req.method === 'POST' && path === '/admin/caseloads/import') {
    return adminUser(() => {
      const b = obj(req);
      const csvText = String(b.csvText || b.csv || textBody(req) || '');
      const fileBase64 = String(b.fileBase64 || b.excelBase64 || b.contentBase64 || '');
      if (!csvText.trim() && !fileBase64.trim()) {
        return json(400, { error: 'csvText or fileBase64 is required.' });
      }
      const parsed = parseCaseloadUpload({
        fileName: String(b.fileName || ''),
        mime: String(b.mime || b.contentType || ''),
        csvText,
        fileBase64,
      });
      const dryRun = b.dryRun === true && b.confirm !== true;
      // Persist only when confirming. Valid rows still commit even if some rows had parse errors.
      // RS Provider must match an existing TMS therapist — no default-provider fallback.
      const result = applyCaseloadImport(store, parsed, { dryRun });
      if (!dryRun) {
        store.audit(
          ctx.user.id,
          'caseload_csv_import',
          'caseload',
          null,
          {
            createdStudents: result.createdStudents,
            createdMandates: result.createdMandates,
            updatedMandates: result.updatedMandates,
            createdSchools: result.createdSchools,
            rowCount: result.rows.length,
            errorCount: result.errors.length,
          },
        );
      }
      return json(200, {
        ...result,
        dryRun,
        parsedRowCount: parsed.rows.length,
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/mandates') {
    return adminUser(() => {
      const b = obj(req);
      const studentId = String(b.studentId || '').trim();
      if (!studentId) return json(400, { error: 'studentId is required.' });
      const student = store.data.students.find((s) => s.id === studentId);
      if (!student) return json(404, { error: 'Child not found.' });
      const frequencyKind = (String(b.frequencyKind || 'weekly') === 'school_day_cycle'
        ? 'school_day_cycle'
        : 'weekly') as FrequencyKind;
      const mandateKind = parseMandateKind(b.mandateKind);
      const freq = Number(b.frequencyPerWeek ?? b.sessionsPerPeriod ?? 0);
      const sessionsPerPeriod = Number(b.sessionsPerPeriod ?? b.frequencyPerWeek ?? freq);
      const disciplineRaw = String(b.discipline || '');
      const discipline = (['OT', 'PT', 'SLP'].includes(disciplineRaw) ? disciplineRaw : '') as Discipline | '';
      const mandate = store.upsertMandate({
        id: newId(),
        studentId,
        providerId: String(b.providerId || ''),
        serviceType: String(b.serviceType || (mandateKind === 'makeup_auth' ? 'Makeup authorization' : '')),
        discipline,
        mandateKind,
        frequencyPerWeek: frequencyKind === 'school_day_cycle' || mandateKind === 'makeup_auth' ? 0 : (Number.isFinite(freq) ? freq : 0),
        frequencyKind: mandateKind === 'makeup_auth' ? 'weekly' : frequencyKind,
        sessionsPerPeriod: Number.isFinite(sessionsPerPeriod) ? sessionsPerPeriod : 0,
        periodSchoolDays:
          frequencyKind === 'school_day_cycle' ? Number(b.periodSchoolDays || 6) : undefined,
        ratioGroup: Boolean(b.ratioGroup),
        location: String(b.location || ''),
        sourcePdfKey: 'manual',
        parsedAt: nowIso(),
        startOn: String(b.startOn || ''),
        endOn: String(b.endOn || ''),
        createdAt: nowIso(),
      });
      store.audit(ctx.user.id, 'create_mandate', `mandate:${mandate.id}`, null, mandate);
      return json(201, { mandate, message: 'Mandate saved.' });
    });
  }

  if (req.method === 'POST' && /^\/admin\/mandates\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.mandates.find((m) => m.id === id);
      if (!existing) return json(404, { error: 'Mandate not found.' });
      const b = obj(req);
      const disciplineRaw = b.discipline != null ? String(b.discipline) : existing.discipline;
      const discipline = (['OT', 'PT', 'SLP'].includes(disciplineRaw) ? disciplineRaw : existing.discipline) as Discipline | '';
      const freq = b.frequencyPerWeek == null || b.frequencyPerWeek === ''
        ? existing.frequencyPerWeek
        : Number(b.frequencyPerWeek);
      const kindRaw = b.frequencyKind != null ? String(b.frequencyKind) : existing.frequencyKind || 'weekly';
      const frequencyKind = (kindRaw === 'school_day_cycle' ? 'school_day_cycle' : 'weekly') as FrequencyKind;
      const sessionsPerPeriod =
        b.sessionsPerPeriod == null || b.sessionsPerPeriod === ''
          ? existing.sessionsPerPeriod ?? (frequencyKind === 'weekly' ? (Number.isFinite(freq) ? freq : existing.frequencyPerWeek) : existing.sessionsPerPeriod)
          : Number(b.sessionsPerPeriod);
      const periodSchoolDays =
        b.periodSchoolDays == null || b.periodSchoolDays === ''
          ? existing.periodSchoolDays
          : Number(b.periodSchoolDays);
      const mandateKind = parseMandateKind(b.mandateKind, existing.mandateKind || 'regular');
      const mandate = store.upsertMandate({
        ...existing,
        mandateKind,
        frequencyPerWeek: mandateKind === 'makeup_auth'
          ? 0
          : frequencyKind === 'school_day_cycle'
          ? 0
          : Number.isFinite(freq) ? freq : existing.frequencyPerWeek,
        frequencyKind: mandateKind === 'makeup_auth' ? 'weekly' : frequencyKind,
        sessionsPerPeriod: Number.isFinite(Number(sessionsPerPeriod)) ? Number(sessionsPerPeriod) : existing.sessionsPerPeriod,
        periodSchoolDays: frequencyKind === 'school_day_cycle'
          ? (Number.isFinite(Number(periodSchoolDays)) ? Number(periodSchoolDays) : existing.periodSchoolDays || 6)
          : undefined,
        serviceType: pickStr(b.serviceType, existing.serviceType),
        discipline,
        providerId: pickStr(b.providerId, existing.providerId),
        startOn: pickStr(b.startOn, existing.startOn),
        endOn: pickStr(b.endOn, existing.endOn),
        location: b.location != null ? String(b.location) : existing.location,
        ratioGroup: b.ratioGroup == null ? existing.ratioGroup : Boolean(b.ratioGroup),
      });
      store.audit(ctx.user.id, 'update_mandate', `mandate:${id}`, existing, mandate);
      return json(200, { mandate });
    });
  }

  if (req.method === 'POST' && /^\/admin\/students\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.students.find((s) => s.id === id);
      if (!existing) return json(404, { error: 'Student not found.' });
      const b = obj(req);
      const student = store.upsertStudent({
        ...existing,
        firstName: pickStr(b.firstName, existing.firstName),
        lastName: pickStr(b.lastName, existing.lastName),
        dob: pickStr(b.dob, existing.dob),
        schoolId: pickStr(b.schoolId, existing.schoolId),
        hhaPatientId: pickStr(b.hhaPatientId, existing.hhaPatientId),
        programId: pickStr(b.programId, existing.programId),
        programType: pickStr(b.programType, existing.programType),
        grade: b.grade != null ? String(b.grade) : existing.grade,
      });
      store.audit(ctx.user.id, 'update_student', `student:${id}`, existing, student);
      return json(200, { student });
    });
  }

  if (req.method === 'POST' && path === '/admin/due-dates') {
    return adminUser(() => {
      const b = obj(req);
      const schoolId = String(b.schoolId || '').trim();
      if (!schoolId) return json(400, { error: 'schoolId is required.' });
      const school = store.data.schools.find((s) => s.id === schoolId);
      if (!school) return json(404, { error: 'School not found.' });
      const kind = b.kind === 'annual' || b.kind === 'reeval' ? b.kind : 'progress';
      const dueOn = String(b.dueOn || '').trim();
      if (!dueOn) return json(400, { error: 'dueOn is required.' });
      const existing = store.data.dueDates.find(
        (d) => d.schoolId === schoolId && d.kind === kind && !d.completedAt,
      );
      const row = store.upsertDueDate({
        id: String(b.id || existing?.id || newId()),
        schoolId,
        kind,
        dueOn,
        completedAt: String(b.completedAt || ''),
        lastNagOn: existing && existing.dueOn === dueOn ? existing.lastNagOn : '',
      });
      const label = school.name || schoolId;
      store.addAlert({
        id: newId(),
        userId: '',
        kind: `due_${row.kind}`,
        severity: 'warning',
        body: `${label}: ${row.kind} due ${row.dueOn}`,
        entityRef: `due:${row.id}`,
        resolved: Boolean(row.completedAt),
        createdAt: nowIso(),
      });
      return json(201, { dueDate: row });
    });
  }

  if (req.method === 'POST' && /^\/admin\/due-dates\/[^/]+\/complete$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const row = store.data.dueDates.find((d) => d.id === id);
      if (!row) return json(404, { error: 'Due date not found.' });
      const updated = store.upsertDueDate({ ...row, completedAt: nowIso() });
      for (const a of store.data.alerts) {
        if (a.entityRef === `due:${id}`) a.resolved = true;
      }
      return json(200, { dueDate: updated });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/due-dates\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.dueDates.find((d) => d.id === id);
      if (!existing) return json(404, { error: 'Due date not found.' });
      store.removeDueDate(id);
      store.audit(ctx.user.id, 'delete_due_date', `due:${id}`, existing, null);
      return json(200, { deleted: true, id, message: 'Due date removed.' });
    });
  }

  if (req.method === 'GET' && path === '/admin/reports/missing-notes') {
    return adminUser(() => {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      return json(200, {
        rows: missingNotes(store, undefined, { from, to, includeMissed: true }),
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/last-service') {
    return adminUser(() => {
      const providerId = String(req.query.providerId || '').trim();
      return json(200, {
        rows: lastServiceByStudent(store, {
          providerId: providerId || undefined,
        }),
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/due-dates') {
    return adminUser(() => {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      return json(200, { rows: dueDateReport(store, new Date(), { from, to }) });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/week-progress') {
    return adminUser(() => {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      return json(200, {
        from: from || null,
        to: to || null,
        rows: weekProgressReport(store, { from, to }),
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/week-progress.xlsx') {
    return adminUser(() => reportXlsxWeekProgress(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/missing-notes.xlsx') {
    return adminUser(() => reportXlsxMissing(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/last-service.xlsx') {
    return adminUser(() => reportXlsxLastService(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/due-dates.xlsx') {
    return adminUser(() => reportXlsxDueDates(store, req.query));
  }

  if (req.method === 'GET' && path === '/students') {
    const weekStart = String(req.query.weekStart || weekStartFromDos(nowIso().slice(0, 10)));
    const students = visibleStudents(store, ctx.user, weekStart);
    const ids = new Set(students.map((s) => s.id));
    return json(200, {
      students,
      mandates: store.data.mandates.filter((m) => ctx.user.role === 'admin' || ids.has(m.studentId)),
      files: store.data.files.filter((f) => ctx.user.role === 'admin' || ids.has(f.studentId)),
    });
  }

  if (req.method === 'POST' && path === '/files') {
    const b = obj(req);
    const id = newId();
    const studentId = String(b.studentId || '');
    const buf = anyFileBufferFromBody(b);
    let s3Key = String(b.s3Key || '');
    if (buf) {
      const ext = String(b.fileName || b.label || 'upload').split('.').pop() || 'bin';
      s3Key = studentId
        ? `tms/locker/${studentId}/${id}.${ext}`
        : `tms/locker/providers/${String(b.providerId || 'p')}/${id}.${ext}`;
      await putLockerPdf(s3Key, buf);
    } else if (!s3Key) {
      s3Key = String(b.label || 'local');
    }
    const file = store.addFile({
      id,
      studentId,
      providerId: String(b.providerId || providerFor(store, ctx.user)?.id || ''),
      weekId: String(b.weekId || ''),
      kind: String(b.kind || (studentId ? 'locker' : 'provider_report')),
      s3Key,
      label: String(b.label || 'upload'),
      createdAt: nowIso(),
    });
    return json(201, { file });
  }

  if (req.method === 'GET' && path === '/week') {
    const provider = providerFor(store, ctx.user);
    if (!provider && ctx.user.role !== 'admin') return json(400, { error: 'No provider profile on this login.' });
    const weekStart = String(req.query.weekStart || obj(req).weekStart || '');
    const providerId = String(req.query.providerId || provider?.id || '');
    const week = store.weekByProviderStart(providerId, weekStart) || (weekStart ? undefined : store.data.weeks.find((w) => w.providerId === providerId));
    const sessions = week ? store.sessionsForWeek(week.id) : [];
    const check = week
      ? checkMandatesForWeek(store.data.mandates, sessions, store.data.sessions)
      : { errors: [] as string[], warnings: [] as string[] };
    const ai = week ? collectHeuristicAiIssues(sessions) : { errors: [] as string[], warnings: [] as string[] };
    const students = visibleStudents(store, ctx.user, weekStart || week?.weekStart || '');
    const payProvider =
      store.data.providers.find((p) => p.id === (week?.providerId || providerId)) || provider;
    const sessionsOut = sessions.map((s) => {
      const local = screenServiceNote(s);
      const flags = [...new Set([...(s.aiFlags || []), ...local.flags])];
      return {
        ...s,
        aiFlags: flags,
        aiBlock: Boolean(s.aiBlock) || local.block,
        payAmount: payProvider ? sessionPayAmount(payProvider, s) : null,
      };
    });
    return json(200, {
      week,
      sessions: sessionsOut,
      students,
      mandates: store.data.mandates.filter((m) => students.some((s) => s.id === m.studentId) || ctx.user.role === 'admin'),
      warnings: [...new Set([...check.warnings, ...ai.warnings])],
      errors: [...new Set([...check.errors, ...ai.errors])],
    });
  }

  if (req.method === 'POST' && path === '/week/ensure') {
    const provider = providerFor(store, ctx.user);
    const b = obj(req);
    const providerId = String(b.providerId || provider?.id || '');
    const weekStart = String(b.weekStart || '');
    if (!providerId || !weekStart) return json(400, { error: 'providerId and weekStart are required.' });
    let week = store.weekByProviderStart(providerId, weekStart);
    if (!week) {
      const school = store.data.schools[0];
      week = store.upsertWeek({
        id: newId(),
        providerId,
        weekStart,
        status: 'draft',
        signerName: school?.signerName || '',
        signerEmail: school?.signerEmail || '',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      });
    }
    return json(200, { week });
  }

  if (req.method === 'POST' && path === '/week/upload-sessions') {
    const provider = providerFor(store, ctx.user);
    const b = obj(req);
    const providerId = String(b.providerId || provider?.id || '');
    const accountProvider =
      (providerId ? store.data.providers.find((p) => p.id === providerId) : undefined) || provider;
    const text = pdfTextFromBody(b) || textBody(req) || String(b.pdfText || '');
    if (!String(text).trim()) {
      const error = bodyHasPdfBytes(b)
        ? PDF_NO_TEXT_ERROR
        : 'Choose a weekly notes PDF (or paste the report text).';
      console.warn('upload-sessions 400', error, {
        hasPdf: bodyHasPdfBytes(b),
        pdfBase64Len: typeof b.pdfBase64 === 'string' ? b.pdfBase64.length : 0,
      });
      return json(400, { error, errors: [error] });
    }
    const parsed = parseWeeklySessionText(text);
    if (!parsed.length) {
      const error =
        'Could not find any sessions in this PDF. Use a Frontline Related Service Session Notes report with a text layer (not a scan).';
      console.warn('upload-sessions 400', error, { textLen: String(text).length });
      return json(400, { error, errors: [error] });
    }

    const matchErrors: string[] = [];
    const pdfProviderName = parsed.map((r) => r.providerName).find((n) => String(n || '').trim()) || '';
    if (pdfProviderName) {
      if (!accountProvider) {
        matchErrors.push('Your provider profile is not linked yet. Ask the office for help.');
      } else if (!findProviderByName([accountProvider], pdfProviderName)) {
        matchErrors.push(
          `Provider in PDF does not match your account (PDF: "${pdfProviderName}").`,
        );
      }
    }

    const studentByKey = new Map<string, { id: string; display: string }>();
    for (const row of parsed) {
      const display = String(row.studentName || '').trim() || 'Unknown';
      const person = splitPersonName(row.studentName);
      const mapped = mappingName(row.studentName);
      const key = `${person.last}|${person.first}|${mapped.last}|${mapped.first}`.toLowerCase();
      if (studentByKey.has(key)) continue;
      const student =
        store.findStudentByName(person.first, person.last) ||
        store.findStudentByName(mapped.first, mapped.last) ||
        (person.last && person.first
          ? store.findStudentByName(person.last, person.first)
          : undefined);
      if (!student) {
        matchErrors.push(`Child '${display}' not found — import caseload first`);
        studentByKey.set(key, { id: '', display });
        continue;
      }
      studentByKey.set(key, {
        id: student.id,
        display: `${student.firstName} ${student.lastName}`.trim() || display,
      });

      const pdfSchool = String(row.schoolName || row.location || '').trim();
      if (pdfSchool) {
        const knownSchool = store.data.schools.find((s) => s.id === student.schoolId);
        if (knownSchool && schoolNamesConflict(pdfSchool, knownSchool.name)) {
          matchErrors.push(
            `School '${pdfSchool}' does not match child's school '${knownSchool.name}'.`,
          );
        } else if (!knownSchool) {
          const exists = store.data.schools.some(
            (s) => !schoolNamesConflict(pdfSchool, s.name) && Boolean(String(s.name || '').trim()),
          );
          if (!exists) {
            matchErrors.push(`School '${pdfSchool}' not found`);
          }
        }
      }
    }

    if (matchErrors.length) {
      const unique = [...new Set(matchErrors)];
      return json(400, {
        error:
          unique.length > 1
            ? `Upload blocked — ${unique.length} issues. Fix caseload / provider match first.`
            : unique[0],
        errors: unique,
        warnings: [],
      });
    }

    const weekStart = String(b.weekStart || (parsed[0] ? weekStartFromDos(parsed[0].dateOfService) : ''));
    let week = store.weekByProviderStart(providerId, weekStart);
    if (!week) {
      const school = store.data.schools[0];
      week = store.upsertWeek({
        id: newId(),
        providerId,
        weekStart,
        status: 'draft',
        signerName: String(b.signerName || school?.signerName || ''),
        signerEmail: String(b.signerEmail || school?.signerEmail || ''),
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      });
    }
    if (!therapistCanEdit(week.status) && ctx.user.role !== 'admin') {
      const error = 'This week is locked. Ask an admin to reopen it.';
      return json(409, { error, errors: [error] });
    }
    // Replace prior draft rows so retries do not stack duplicates and trip Over mandate.
    const prior = store.sessionsForWeek(week.id);
    for (const s of prior) store.removeSession(s.id);
    const created: SessionRow[] = [];
    for (const row of parsed) {
      const person = splitPersonName(row.studentName);
      const mapped = mappingName(row.studentName);
      const student =
        store.findStudentByName(person.first, person.last) ||
        store.findStudentByName(mapped.first, mapped.last) ||
        (person.last && person.first
          ? store.findStudentByName(person.last, person.first)
          : undefined);
      if (!student) {
        // Should not happen after pre-check; roll back if it does.
        for (const s of created) store.removeSession(s.id);
        for (const s of prior) store.upsertSession(s);
        const display = String(row.studentName || '').trim() || 'Unknown';
        const error = `Child '${display}' not found — import caseload first`;
        return json(400, { error, errors: [error] });
      }
      const session = store.upsertSession({
        id: newId(),
        weekId: week.id,
        studentId: student.id,
        dateOfService: row.dateOfService,
        beginTime: row.beginTime,
        endTime: row.endTime,
        attendance: row.attendance,
        cancelReason: row.cancelReason,
        makeupOfSessionId: '',
        serviceType: row.serviceType,
        additionalServiceType: '',
        location: row.location,
        notes: row.notes,
        aiFlags: [],
        aiBlock: false,
      });
      created.push(session);
    }
    const check = checkMandatesForWeek(
      store.data.mandates,
      store.sessionsForWeek(week.id),
      store.data.sessions,
    );
    if (check.errors.length) {
      for (const s of created) store.removeSession(s.id);
      for (const s of prior) store.upsertSession(s);
      const errors = check.errors.filter(Boolean);
      return json(400, {
        error:
          errors.length > 1
            ? `Over mandate — ${errors.length} issues. Upload is blocked.`
            : `Over mandate — ${errors[0] || 'this PDF has more sessions than allowed for the week.'}`,
        errors,
        warnings: check.warnings,
      });
    }
    return json(200, {
      week,
      sessions: store.sessionsForWeek(week.id),
      warnings: check.warnings,
      errors: [],
      parsed: parsed.length,
    });
  }

  if (req.method === 'POST' && path === '/week/sessions') {
    const b = obj(req);
    const week = store.data.weeks.find((w) => w.id === String(b.weekId || ''));
    if (!week) return json(404, { error: 'Week not found.' });
    if (!therapistCanEdit(week.status) && ctx.user.role !== 'admin') {
      return json(409, { error: 'This week is locked. Ask an admin to reopen it.' });
    }
    const existing = store.data.sessions.find((s) => s.id === String(b.id || ''));
    const attendance =
      b.attendance === 'missed' || b.attendance === 'makeup' || b.attendance === 'attended'
        ? b.attendance
        : existing?.attendance || 'attended';
    const rawAdditional = b.additionalServiceType;
    let additionalServiceType: SessionRow['additionalServiceType'] =
      existing?.additionalServiceType || '';
    if (rawAdditional === '' || rawAdditional == null) {
      if (Object.prototype.hasOwnProperty.call(b, 'additionalServiceType')) {
        additionalServiceType = '';
      }
    } else if (isAdditionalServiceType(rawAdditional)) {
      additionalServiceType = rawAdditional;
    } else {
      return json(400, {
        error: 'Pick a valid additional service: Eval, Progress report, Consultation, Meetings, or Paid absence.',
      });
    }
    const serviceTypeFromAdditional = additionalServiceType
      ? additionalServiceLabel(additionalServiceType)
      : '';
    const session: SessionRow = {
      id: String(b.id || existing?.id || newId()),
      weekId: week.id,
      studentId: pickStr(b.studentId, existing?.studentId || ''),
      dateOfService: pickStr(b.dateOfService, existing?.dateOfService || ''),
      beginTime: pickStr(b.beginTime, existing?.beginTime || ''),
      endTime: pickStr(b.endTime, existing?.endTime || ''),
      attendance,
      cancelReason: pickStr(b.cancelReason, existing?.cancelReason || ''),
      makeupOfSessionId: pickStr(b.makeupOfSessionId, existing?.makeupOfSessionId || ''),
      serviceType: pickStr(
        b.serviceType,
        serviceTypeFromAdditional || existing?.serviceType || '',
      ),
      additionalServiceType,
      location: pickStr(b.location, existing?.location || ''),
      notes: pickStr(b.notes, existing?.notes || ''),
      aiFlags: Array.isArray(b.aiFlags) ? (b.aiFlags as string[]) : existing?.aiFlags || [],
      aiBlock: typeof b.aiBlock === 'boolean' ? b.aiBlock : existing?.aiBlock || false,
    };
    if (additionalServiceType && !b.serviceType) {
      session.serviceType = serviceTypeFromAdditional;
    }
    const makeupErr = validateMakeup(
      session,
      store.data.sessions.filter((s) => s.id !== session.id).concat(session),
    );
    if (makeupErr) return json(400, { error: makeupErr });
    const screenedLocal = screenServiceNote(session);
    session.aiFlags = screenedLocal.flags;
    session.aiBlock = screenedLocal.block;
    store.upsertSession(session);
    const check = checkMandatesForWeek(
      store.data.mandates,
      store.sessionsForWeek(week.id),
      store.data.sessions,
    );
    if (check.errors.length) {
      store.removeSession(session.id);
      return json(400, { error: 'Over mandate', errors: check.errors });
    }
    return json(200, { session, warnings: [...check.warnings, ...screenedLocal.warnFlags] });
  }

  if (req.method === 'GET' && /^\/students\/[^/]+\/missed$/.test(path)) {
    const studentId = path.split('/')[2];
    return json(200, { missed: unusedMissedForStudent(store.data.sessions, studentId) });
  }

  if (req.method === 'POST' && /^\/sessions\/[^/]+\/ai-screen$/.test(path)) {
    const id = path.split('/')[2];
    const session = store.data.sessions.find((s) => s.id === id);
    if (!session) return json(404, { error: 'Session not found.' });
    const screened = await screenNoteWithOptionalBedrock(session);
    store.upsertSession({
      ...session,
      aiFlags: screened.flags,
      aiBlock: screened.block,
    });
    return json(200, screened);
  }

  if (req.method === 'POST' && /^\/weeks\/[^/]+\/submit$/.test(path)) {
    const week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });
    if (!therapistCanEdit(week.status) && ctx.user.role !== 'admin') {
      return json(409, { error: 'This week is locked.' });
    }
    const sessions = store.sessionsForWeek(week.id);
    const check = checkMandatesForWeek(store.data.mandates, sessions, store.data.sessions);
    if (check.errors.length) return json(400, { error: 'Over mandate', errors: check.errors });
    const aiErrors: string[] = [];
    for (const s of sessions) {
      const makeupErr = validateMakeup(s, store.data.sessions);
      if (makeupErr) return json(400, { error: makeupErr });
      if (s.attendance !== 'missed') {
        const screened = await screenNoteWithOptionalBedrock(s);
        store.upsertSession({
          ...s,
          aiFlags: screened.flags,
          aiBlock: screened.block,
        });
        if (screened.block) {
          for (const f of screened.blockFlags) {
            aiErrors.push(`${s.dateOfService}: ${f}`);
          }
        }
      }
    }
    if (aiErrors.length) {
      return json(400, {
        error: 'AI note screening blocked submit',
        errors: aiErrors,
        warnings: check.warnings,
      });
    }
    const b = obj(req);
    const next = store.upsertWeek({
      ...week,
      status: 'submitted',
      signerName: String(b.signerName || week.signerName),
      signerEmail: String(b.signerEmail || week.signerEmail),
    });
    const provider = store.data.providers.find((p) => p.id === next.providerId);
    const pdf = buildTimesheetPdf({
      week: next,
      providerLabel: provider ? `${provider.firstName} ${provider.lastName}` : next.providerId,
      signerName: next.signerName,
      signerEmail: next.signerEmail,
      rows: sessions.map((session) => ({
        session,
        student: store.data.students.find((s) => s.id === session.studentId) as Student | undefined,
        payAmount: provider ? sessionPayAmount(provider, session) : null,
      })),
    });
    const envelope = await createSignEnvelope({
      signerEmail: next.signerEmail,
      signerName: next.signerName,
      weekId: next.id,
      pdf,
    });
    store.upsertWeek({ ...next, envelopeId: envelope.envelopeId, timesheetKey: `tms/timesheets/${next.id}.pdf` });
    if (deps.mail && next.signerEmail) {
      await deps.mail.send({
        to: [next.signerEmail],
        subject: `Please sign related-service timesheet (week of ${next.weekStart})`,
        text: envelope.vendor === 'email'
          ? `Please review and sign the attached timesheet for ${provider ? `${provider.firstName} ${provider.lastName}` : 'the therapist'}. Reply with the signed copy or sign in the e-sign link when it is enabled.`
          : `A signing envelope was sent (${envelope.vendor}). Envelope ${envelope.envelopeId}.`,
        attachmentName: envelope.vendor === 'email' ? `timesheet-${next.weekStart}.pdf` : undefined,
        attachment: envelope.vendor === 'email' ? pdf : undefined,
      });
    }
    store.audit(ctx.user.id, 'submit_week', `week:${week.id}`, week, next);
    return json(200, {
      week: store.data.weeks.find((w) => w.id === next.id),
      warnings: check.warnings,
      envelope,
      message: `Timesheet sent to ${next.signerEmail || 'the entered signer'}${envelope.vendor === 'docusign' ? ' via DocuSign' : ' by email'}.`,
    });
  }

  if (req.method === 'GET' && /^\/weeks\/[^/]+\/timesheet$/.test(path)) {
    const week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });
    const provider = store.data.providers.find((p) => p.id === week.providerId);
    const pdf = buildTimesheetPdf({
      week,
      providerLabel: provider ? `${provider.firstName} ${provider.lastName}` : week.providerId,
      signerName: week.signerName,
      signerEmail: week.signerEmail,
      rows: store.sessionsForWeek(week.id).map((session) => ({
        session,
        student: store.data.students.find((s) => s.id === session.studentId) as Student | undefined,
        payAmount: provider ? sessionPayAmount(provider, session) : null,
      })),
    });
    store.upsertWeek({ ...week, timesheetKey: `tms/timesheets/${week.id}.pdf` });
    return {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="timesheet-${week.weekStart}.pdf"` },
      body: Buffer.from(pdf),
    };
  }

  if (req.method === 'DELETE' && /^\/sessions\/[^/]+$/.test(path)) {
    const id = path.split('/')[2];
    const session = store.data.sessions.find((s) => s.id === id);
    if (!session) return json(404, { error: 'Session not found.' });
    const week = store.data.weeks.find((w) => w.id === session.weekId);
    if (!week) return json(404, { error: 'Week not found.' });
    if (!therapistCanEdit(week.status) && ctx.user.role !== 'admin') {
      return json(409, { error: 'This week is locked. Ask an admin to reopen it.' });
    }
    if (ctx.user.role !== 'admin') {
      const provider = providerFor(store, ctx.user);
      if (!provider || week.providerId !== provider.id) {
        return json(403, { error: 'You can only remove sessions from your own week.' });
      }
    }
    store.removeSession(id);
    store.audit(ctx.user.id, 'remove_session', `session:${id}`, session, null);
    return json(200, { ok: true, sessions: store.sessionsForWeek(week.id) });
  }

  if (req.method === 'DELETE' && /^\/admin\/weeks\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const week = store.data.weeks.find((w) => w.id === path.split('/')[3]);
      if (!week) return json(404, { error: 'Week not found.' });
      store.removeWeek(week.id);
      store.audit(ctx.user.id, 'remove_week', `week:${week.id}`, week, null);
      return json(200, { ok: true });
    });
  }

  if (req.method === 'POST' && /^\/admin\/weeks\/[^/]+\/sign$/.test(path)) {
    return adminUser(async () => {
      const week = store.data.weeks.find((w) => w.id === path.split('/')[3]);
      if (!week) return json(404, { error: 'Week not found.' });
      if (week.status !== 'submitted') {
        return json(409, { error: 'Week must be submitted before it can be marked signed.' });
      }
      const signed = store.upsertWeek({
        ...week,
        status: 'signed',
        signedKey: String(obj(req).signedKey || `tms/signed/${week.id}.pdf`),
      });
      const locked = store.upsertWeek({ ...signed, status: 'locked' });
      store.audit(ctx.user.id, 'sign_and_lock', `week:${week.id}`, week, locked);
      const provider = store.data.providers.find((p) => p.id === locked.providerId);
      const therapist = provider ? store.userById(provider.userId) : undefined;
      if (deps.mail && therapist?.email) {
        await deps.mail.send({
          to: [therapist.email],
          subject: 'Timesheet signed — you will be paid',
          text: 'Success. This week is signed and locked. You will be paid.',
        });
      }
      if (deps.hha) {
        await transferLockedWeek({ store, week: locked, hha: deps.hha, actorId: ctx.user.id });
      }
      return json(200, {
        week: store.data.weeks.find((w) => w.id === locked.id),
        therapistMessage: 'Success. This week is signed and locked. You will be paid.',
      });
    });
  }

  if (req.method === 'POST' && /^\/admin\/weeks\/[^/]+\/reopen$/.test(path)) {
    return adminUser(() => {
      const week = store.data.weeks.find((w) => w.id === path.split('/')[3]);
      if (!week) return json(404, { error: 'Week not found.' });
      if (week.status !== 'locked' && week.status !== 'signed') {
        return json(409, { error: 'Only signed or locked weeks can be reopened.' });
      }
      const next = store.upsertWeek({ ...week, status: 'reopened', hhaStatus: week.hhaStatus });
      store.audit(ctx.user.id, 'reopen_week', `week:${week.id}`, week, next);
      return json(200, { week: next });
    });
  }

  if (req.method === 'POST' && /^\/weeks\/[^/]+\/hha$/.test(path)) {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    const week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });
    if (!deps.hha) return json(503, { error: 'HHA client is not configured.' });
    const result = await transferLockedWeek({
      store,
      week: store.data.weeks.find((w) => w.id === week.id)!,
      hha: deps.hha,
      actorId: ctx.user.id,
    });
    return json(result.ok ? 200 : 207, result);
  }

  if (req.method === 'GET' && path === '/alerts') {
    const rows = store.openAlerts();
    return json(200, { alerts: rows, dueDates: dueDatesForUser(store, ctx.user) });
  }

  return json(404, { error: `No route ${req.method} ${path}` });
}
