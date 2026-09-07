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
  isOrphanProvider,
  purgeOrphanProviders,
  lastServiceByStudent,
  mappingName,
  missingNotes,
  weekProgressReport,
  newId,
  nowIso,
  parseCaseloadUpload,
  parseDos,
  parseMandatePdfText,
  parseWeeklySessionText,
  isGenericSettingLabel,
  schoolNamesConflict,
  screenServiceNote,
  sessionSlotLabel,
  cptDurationError,
  notesLookCopyPasted,
  noteCopyPasteError,
  sessionSignatureError,
  sessionOverlapError,
  providerDaySessions,
  presentGroupPeerCount,
  mandateDurationMinutesForSession,
  soloGroupMandateNoteError,
  splitPersonName,
  therapistCanEdit,
  therapistCanImportOrAddServices,
  therapistCanMutateExistingSession,
  weekIsProcessed,
  resolveMakeupOfSessionId,
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
  appSettingsFromStore,
  sessionImportAgeError,
  defaultAppSettings,
  schoolBillingServiceNameForMandate,
  type AppSettings,
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
import { createSignEnvelope, envelopeCompleted, voidSignEnvelope } from './esign.js';
import { deactivateCognitoLogin, deleteCognitoLogin, inviteTherapist } from './invite.js';
import { PDF_NO_TEXT_ERROR, bodyHasPdfBytes, pdfTextFromBody } from './pdf-text.js';
import { runDueNags } from './due-nags.js';
import { runHhaErrorDigest } from './hha-error-digest.js';
import { putLockerPdf } from './s3-state.js';
import type { Mailer } from './mail.js';
import type { HhaClient } from '@white-glove/hha-client';
import { runLunaChat, sendLunaHandoff } from './luna.js';

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

/** Child id → "First Last" for mandate over/under messages. */
function studentNameById(store: MemoryStore): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of store.data.students) {
    const name = `${s.firstName} ${s.lastName}`.trim();
    map.set(s.id, name || s.id);
  }
  return map;
}

/** Child id → school calendar for school-day / cycle mandate windows. */
function calendarByStudentId(store: MemoryStore): Map<string, SchoolCalendar | null> {
  const map = new Map<string, SchoolCalendar | null>();
  for (const s of store.data.students) {
    const schoolId = String(s.schoolId || '').trim();
    map.set(s.id, schoolId ? store.schoolCalendarForSchool(schoolId) ?? null : null);
  }
  return map;
}

/** Child id → school display name for calendar fallback warnings. */
function schoolNameByStudentId(store: MemoryStore): Map<string, string> {
  const schoolName = new Map(store.data.schools.map((s) => [s.id, String(s.name || '').trim()]));
  const map = new Map<string, string>();
  for (const s of store.data.students) {
    const schoolId = String(s.schoolId || '').trim();
    map.set(s.id, schoolId ? schoolName.get(schoolId) || schoolId : '');
  }
  return map;
}

function mandateWeekOpts(store: MemoryStore): {
  calendarByStudentId: Map<string, SchoolCalendar | null>;
  schoolNameByStudentId: Map<string, string>;
} {
  return {
    calendarByStudentId: calendarByStudentId(store),
    schoolNameByStudentId: schoolNameByStudentId(store),
  };
}

function overMandateSummary(errors: string[]): string {
  if (!errors.length) return 'This upload exceeds the mandate.';
  if (errors.length === 1) return errors[0]!;
  return `Upload blocked — ${errors.length} sessions exceed the mandate. See details for each child and date/time.`;
}

/** Identity for upload dedupe / skip-already-saved (child + DOS + times). */
function uploadSessionKey(s: {
  studentId: string;
  dateOfService: string;
  beginTime: string;
  endTime: string;
}): string {
  return [
    String(s.studentId || '').trim().toLowerCase(),
    String(s.dateOfService || '').trim().toLowerCase(),
    String(s.beginTime || '').trim().toLowerCase().replace(/\./g, ''),
    String(s.endTime || '').trim().toLowerCase().replace(/\./g, ''),
  ].join('|');
}

function formatUploadRowLabel(row: {
  studentName?: string;
  dateOfService?: string;
  beginTime?: string;
  endTime?: string;
}): string {
  const who = String(row.studentName || '').trim() || 'Unknown child';
  const slot = sessionSlotLabel({
    dateOfService: String(row.dateOfService || ''),
    beginTime: String(row.beginTime || ''),
    endTime: String(row.endTime || ''),
  } as SessionRow);
  return `${who} — ${slot}`;
}

function providerFor(store: MemoryStore, user: AppUser) {
  if (user.providerId) {
    return store.data.providers.find((p) => p.id === user.providerId);
  }
  return store.data.providers.find((p) => p.userId === user.id);
}

function getAppSettings(store: MemoryStore): AppSettings {
  return appSettingsFromStore(store.data.settings);
}

function upsertAppSettings(store: MemoryStore, next: AppSettings): AppSettings {
  const row: AppSettings = { ...defaultAppSettings(), ...next, id: 'global' };
  store.data.settings = [row];
  return row;
}

/** Schools on this provider's caseload (via mandates). */
function schoolsForProvider(store: MemoryStore, providerId: string) {
  const studentIds = new Set(
    store.data.mandates.filter((m) => m.providerId === providerId || !m.providerId).map((m) => m.studentId),
  );
  const schoolIds = new Set(
    store.data.students.filter((s) => studentIds.has(s.id)).map((s) => s.schoolId).filter(Boolean),
  );
  return store.data.schools.filter((s) => schoolIds.has(s.id));
}

function schoolDistrictForWeek(
  store: MemoryStore,
  weekId: string,
  preferredSchoolId?: string,
): string {
  if (preferredSchoolId) {
    const preferred = store.data.schools.find((s) => s.id === preferredSchoolId);
    const label = String(preferred?.district || preferred?.name || '').trim();
    if (label) return label;
  }
  const sessions = store.sessionsForWeek(weekId);
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const student = store.data.students.find((st) => st.id === s.studentId);
    const school = student
      ? store.data.schools.find((sc) => sc.id === student.schoolId)
      : undefined;
    const label = String(school?.district || school?.name || '').trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [label, n] of counts) {
    if (n > bestN) {
      best = label;
      bestN = n;
    }
  }
  return best;
}

function cptLabelFromParts(codes: string[], procedures: string[], units: number): string {
  if (procedures.length) return procedures.join(', ');
  if (codes.length) return codes.map((c) => (units > 0 && codes.length === 1 ? `${c}x${units}` : c)).join(', ');
  return '';
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
    // Prefer adopting a same-name orphan instead of creating a linked twin.
    const byName = findProviderByName(
      store.data.providers,
      `${firstName} ${lastName}`.trim() || displayName,
    );
    if (byName && isOrphanProvider(store, byName)) {
      provider = store.upsertProvider({
        ...byName,
        userId: user.id,
        firstName: firstName || byName.firstName,
        lastName: lastName || byName.lastName,
        discipline: b.discipline != null && String(b.discipline) ? discipline : byName.discipline,
        ...providerPayFields(b, byName),
        hhaCaregiverCode:
          b.hhaCaregiverCode === undefined ? byName.hhaCaregiverCode : hhaCaregiverCode,
        active: true,
      });
    } else {
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
    }
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
  // Drop empty / merged orphan duplicates left after linking.
  purgeOrphanProviders(store);
  return {
    user: store.userById(user.id)!,
    provider: store.data.providers.find((p) => p.id === provider!.id)!,
    createdUser,
  };
}

function visibleStudents(
  store: MemoryStore,
  user: AppUser,
  weekStart: string,
  schoolId?: string,
): Student[] {
  if (user.role === 'admin') {
    const all = store.data.students;
    return schoolId ? all.filter((s) => s.schoolId === schoolId) : all;
  }
  const provider = providerFor(store, user);
  const providerId = provider?.id || '';
  const mandated = new Set(
    store.data.mandates
      .filter((m) => m.providerId === providerId || !m.providerId)
      .map((m) => m.studentId),
  );
  const week = weekStart ? store.weekByProviderStart(providerId, weekStart) : undefined;
  const fromWeek = new Set((week ? store.sessionsForWeek(week.id) : []).map((s) => s.studentId));
  const students = store.data.students.filter((s) => mandated.has(s.id) || fromWeek.has(s.id));
  if (!schoolId) return students;
  return students.filter((s) => s.schoolId === schoolId);
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
    'payRateEval',
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
      ],
      rows.map((r) => [
        r.childName,
        r.mandateLabel,
        r.weekLabel,
        r.sessionsProvided,
        r.notesPosted,
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

  if (req.method === 'POST' && path === '/internal/hha-error-digest') {
    const key = process.env.TMS_INTERNAL_KEY || '';
    const provided = req.headers['x-tms-internal'] || obj(req).key;
    if (!key || provided !== key) return json(401, { error: 'Unauthorized HHA digest job.' });
    if (!deps.mail) return json(503, { error: 'Mailer missing.' });
    const out = await runHhaErrorDigest(store, deps.mail);
    return json(200, out);
  }

  const auth = await authenticate(store, req.headers);
  if ('error' in auth) return json(auth.status, { error: auth.error });
  const ctx = auth;

  if (req.method === 'GET' && path === '/me') {
    const provider = providerFor(store, ctx.user);
    const schools = provider ? schoolsForProvider(store, provider.id) : [];
    return json(200, {
      user: ctx.user,
      provider,
      schools,
      settings: {
        sessionImportAgeLockEnabled: getAppSettings(store).sessionImportAgeLockEnabled,
        sessionImportMaxAgeDays: getAppSettings(store).sessionImportMaxAgeDays,
      },
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

  if (req.method === 'GET' && path === '/admin/settings') {
    return adminUser(() => json(200, { settings: getAppSettings(store) }));
  }

  if (req.method === 'POST' && path === '/admin/settings') {
    return adminUser(() => {
      const b = obj(req);
      const prev = getAppSettings(store);
      const next = upsertAppSettings(store, {
        ...prev,
        sessionImportAgeLockEnabled:
          typeof b.sessionImportAgeLockEnabled === 'boolean'
            ? b.sessionImportAgeLockEnabled
            : prev.sessionImportAgeLockEnabled,
        sessionImportMaxAgeDays:
          Number(b.sessionImportMaxAgeDays) > 0
            ? Math.floor(Number(b.sessionImportMaxAgeDays))
            : prev.sessionImportMaxAgeDays,
        unlockedWeekIds: Array.isArray(b.unlockedWeekIds)
          ? b.unlockedWeekIds.map(String)
          : prev.unlockedWeekIds,
        unlockedProviderIds: Array.isArray(b.unlockedProviderIds)
          ? b.unlockedProviderIds.map(String)
          : prev.unlockedProviderIds,
      });
      store.audit(ctx.user.id, 'update_settings', 'settings:global', prev, next);
      return json(200, { settings: next });
    });
  }

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
        address1: String(b.address1 ?? existing?.address1 ?? '').trim() || undefined,
        city: String(b.city ?? existing?.city ?? '').trim() || undefined,
        state: String(b.state ?? existing?.state ?? '').trim() || undefined,
        zipCode: String(b.zipCode ?? existing?.zipCode ?? '').trim() || undefined,
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

  if (req.method === 'POST' && path === '/admin/providers/purge-orphans') {
    return adminUser(() => {
      const result = purgeOrphanProviders(store);
      store.audit(ctx.user.id, 'purge_orphan_providers', 'providers', null, result);
      return json(200, {
        ...result,
        message:
          result.retained.length > 0
            ? `Deleted ${result.deleted.length} orphan(s); ${result.retained.length} kept (caseload with no linked match).`
            : `Deleted ${result.deleted.length} orphan provider(s).`,
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
      const firstName = String(b.firstName || '');
      const lastName = String(b.lastName || '');
      const userId = String(b.userId || '');
      // Avoid creating a new orphan twin when a linked profile already matches the name.
      if (!userId) {
        const existing = findProviderByName(store.data.providers, `${firstName} ${lastName}`.trim());
        if (existing && !isOrphanProvider(store, existing)) {
          return json(400, {
            error:
              'A linked provider with this name already exists. Open that profile instead of creating a duplicate without a login.',
            existingProviderId: existing.id,
          });
        }
      }
      const discipline = parseDiscipline(b.discipline);
      const provider = store.upsertProvider({
        id: String(b.id || newId()),
        userId,
        firstName,
        lastName,
        discipline,
        ...providerPayFields(b),
        hhaCaregiverCode: String(b.hhaCaregiverCode || ''),
        active: b.active === false ? false : true,
        createdAt: nowIso(),
      });
      if (provider.userId) linkUserToProvider(store, provider.userId, provider.id);
      purgeOrphanProviders(store);
      return json(201, {
        provider: store.data.providers.find((p) => p.id === provider.id),
        user: provider.userId ? store.userById(provider.userId) : undefined,
      });
    });
  }

  if (req.method === 'GET' && path === '/admin/providers') {
    return adminUser(() => {
      // Durable heal: merge alias caseloads and drop empty orphan twins on list.
      const orphanPurge = purgeOrphanProviders(store);
      return json(200, { providers: store.data.providers, orphanPurge });
    });
  }

  if (req.method === 'GET' && /^\/admin\/providers\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      // Heal on list; detail stays read-only. Import / purge-orphans also write.
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
        : String(b.frequencyKind || '') === 'monthly'
          ? 'monthly'
          : 'weekly') as FrequencyKind;
      const mandateKind = parseMandateKind(b.mandateKind);
      const freq = Number(b.frequencyPerWeek ?? b.sessionsPerPeriod ?? 0);
      const sessionsPerPeriod = Number(b.sessionsPerPeriod ?? b.frequencyPerWeek ?? freq);
      const disciplineRaw = String(b.discipline || '');
      const discipline = (['OT', 'PT', 'SLP'].includes(disciplineRaw) ? disciplineRaw : '') as Discipline | '';
      const durationMinutes = parseNullableNumber(b.durationMinutes);
      const groupSize = parseNullableNumber(b.groupSize);
      const billingServiceName = schoolBillingServiceNameForMandate({
        discipline,
        durationMinutes,
        mandateKind,
      });
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
        durationMinutes,
        billingServiceName,
        groupSize: groupSize ?? (Boolean(b.ratioGroup) ? null : 1),
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

  if ((req.method === 'POST' || req.method === 'PATCH') && /^\/admin\/mandates\/[^/]+$/.test(path)) {
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
      const frequencyKind = (kindRaw === 'school_day_cycle'
        ? 'school_day_cycle'
        : kindRaw === 'monthly'
          ? 'monthly'
          : 'weekly') as FrequencyKind;
      const sessionsPerPeriod =
        b.sessionsPerPeriod == null || b.sessionsPerPeriod === ''
          ? existing.sessionsPerPeriod ?? (frequencyKind === 'weekly' || frequencyKind === 'monthly' ? (Number.isFinite(freq) ? freq : existing.frequencyPerWeek) : existing.sessionsPerPeriod)
          : Number(b.sessionsPerPeriod);
      const periodSchoolDays =
        b.periodSchoolDays == null || b.periodSchoolDays === ''
          ? existing.periodSchoolDays
          : Number(b.periodSchoolDays);
      const mandateKind = parseMandateKind(b.mandateKind, existing.mandateKind || 'regular');
      const ratioGroup = b.ratioGroup == null ? existing.ratioGroup : Boolean(b.ratioGroup);
      const durationMinutes =
        b.durationMinutes === undefined ? existing.durationMinutes ?? null : parseNullableNumber(b.durationMinutes);
      const groupSize =
        b.groupSize === undefined ? existing.groupSize ?? null : parseNullableNumber(b.groupSize);
      const billingServiceName = schoolBillingServiceNameForMandate({
        discipline,
        durationMinutes,
        mandateKind,
      });
      const mandate = store.upsertMandate({
        ...existing,
        mandateKind,
        studentId: pickStr(b.studentId, existing.studentId),
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
        ratioGroup,
        durationMinutes,
        billingServiceName,
        groupSize,
      });
      store.audit(ctx.user.id, 'update_mandate', `mandate:${id}`, existing, mandate);
      return json(200, { mandate, message: 'Mandate updated.' });
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
    const schoolId = String(req.query.schoolId || '').trim();
    const students = visibleStudents(store, ctx.user, weekStart, schoolId || undefined);
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

  if (req.method === 'GET' && path === '/weeks') {
    const provider = providerFor(store, ctx.user);
    if (!provider && ctx.user.role !== 'admin') {
      return json(400, { error: 'No provider profile on this login.' });
    }
    const providerId = String(req.query.providerId || provider?.id || '');
    if (!providerId) return json(400, { error: 'providerId is required.' });
    if (ctx.user.role !== 'admin' && provider?.id !== providerId) {
      return json(403, { error: 'You can only list your own weeks.' });
    }
    const currentStart = weekStartFromDos(nowIso().slice(0, 10));
    const weeks = store.data.weeks
      .filter((w) => w.providerId === providerId)
      .map((w) => ({
        id: w.id,
        weekStart: w.weekStart,
        status: w.status,
        sessionCount: store.sessionsForWeek(w.id).length,
        isCurrent: w.weekStart === currentStart,
        processed: w.status === 'signed' || w.status === 'locked',
      }))
      .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
    return json(200, { weeks, currentWeekStart: currentStart });
  }

  if (req.method === 'GET' && path === '/week') {
    const provider = providerFor(store, ctx.user);
    if (!provider && ctx.user.role !== 'admin') return json(400, { error: 'No provider profile on this login.' });
    const weekStart = String(req.query.weekStart || obj(req).weekStart || '');
    const providerId = String(req.query.providerId || provider?.id || '');
    const schoolId = String(req.query.schoolId || '').trim();
    const week = store.weekByProviderStart(providerId, weekStart) || (weekStart ? undefined : store.data.weeks.find((w) => w.providerId === providerId));
    let sessions = week ? store.sessionsForWeek(week.id) : [];
    if (schoolId) {
      const schoolStudentIds = new Set(
        store.data.students.filter((s) => s.schoolId === schoolId).map((s) => s.id),
      );
      sessions = sessions.filter((s) => schoolStudentIds.has(s.studentId));
    }
    const check = week
      ? checkMandatesForWeek(
          store.data.mandates,
          sessions,
          store.data.sessions,
          studentNameById(store),
          mandateWeekOpts(store),
        )
      : { errors: [] as string[], warnings: [] as string[] };
    const ai = week ? collectHeuristicAiIssues(sessions) : { errors: [] as string[], warnings: [] as string[] };
    const students = visibleStudents(store, ctx.user, weekStart || week?.weekStart || '', schoolId || undefined);
    const payProvider =
      store.data.providers.find((p) => p.id === (week?.providerId || providerId)) || provider;
    const payProviderId = week?.providerId || providerId;
    const soloNoteErrors: string[] = [];
    const sessionsOut = sessions.map((s) => {
      const local = screenServiceNote(s);
      const flags = [...new Set([...(s.aiFlags || []), ...local.flags])];
      const dayPeers = payProviderId
        ? providerDaySessions(store.data.sessions, store.data.weeks, payProviderId, s.dateOfService, s.id)
        : [];
      const payOpts = {
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: s,
          peers: dayPeers,
          mandates: store.data.mandates,
        }),
        mandateDurationMinutes: mandateDurationMinutesForSession(s, store.data.mandates),
      };
      const soloNote = soloGroupMandateNoteError({
        notes: s.notes,
        serviceType: s.serviceType,
        studentId: s.studentId,
        attendance: s.attendance,
        mandates: store.data.mandates,
        presentGroupPeerCount: payOpts.presentGroupPeerCount,
      });
      if (soloNote) {
        const who = studentNameById(store).get(s.studentId) || s.studentId;
        soloNoteErrors.push(`${s.dateOfService} ${who}: ${soloNote}`);
      }
      return {
        ...s,
        aiFlags: flags,
        aiBlock: Boolean(s.aiBlock) || local.block,
        payAmount: payProvider ? sessionPayAmount(payProvider, s, payOpts) : null,
      };
    });
    const schoolDistrict = week
      ? schoolDistrictForWeek(store, week.id, schoolId || undefined)
      : '';
    return json(200, {
      week,
      sessions: sessionsOut,
      students,
      schoolDistrict,
      mandates: store.data.mandates.filter((m) => students.some((s) => s.id === m.studentId) || ctx.user.role === 'admin'),
      warnings: [...new Set([...check.warnings, ...ai.warnings])],
      errors: [...new Set([...check.errors, ...ai.errors, ...soloNoteErrors])],
    });
  }

  if (req.method === 'POST' && path === '/week/ensure') {
    const provider = providerFor(store, ctx.user);
    const b = obj(req);
    const providerId = String(b.providerId || provider?.id || '');
    const weekStart = String(b.weekStart || '');
    const schoolId = String(b.schoolId || '').trim();
    if (!providerId || !weekStart) return json(400, { error: 'providerId and weekStart are required.' });
    let week = store.weekByProviderStart(providerId, weekStart);
    const preferredSchool =
      (schoolId ? store.data.schools.find((s) => s.id === schoolId) : undefined) ||
      schoolsForProvider(store, providerId)[0] ||
      store.data.schools[0];
    if (!week) {
      week = store.upsertWeek({
        id: newId(),
        providerId,
        weekStart,
        status: 'draft',
        signerName: preferredSchool?.signerName || '',
        signerEmail: preferredSchool?.signerEmail || '',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
        hhaError: '',
      });
    } else if (
      preferredSchool &&
      therapistCanEdit(week.status) &&
      (!week.signerEmail || schoolId)
    ) {
      week = store.upsertWeek({
        ...week,
        signerName: preferredSchool.signerName || week.signerName,
        signerEmail: preferredSchool.signerEmail || week.signerEmail,
      });
    }
    return json(200, { week, school: preferredSchool || null });
  }

  if (req.method === 'POST' && path === '/week/upload-sessions') {
    const provider = providerFor(store, ctx.user);
    const b = obj(req);
    const providerId = String(b.providerId || provider?.id || '');
    if (!providerId) {
      const error =
        ctx.user.role === 'admin'
          ? 'providerId is required to import sessions for a provider.'
          : 'Your provider profile is not linked yet. Ask the office for help.';
      return json(400, { error, errors: [error] });
    }
    if (ctx.user.role !== 'admin' && provider?.id !== providerId) {
      return json(403, { error: 'You can only import sessions for your own provider profile.' });
    }
    const accountProvider =
      (providerId ? store.data.providers.find((p) => p.id === providerId) : undefined) || provider;
    if (!accountProvider) {
      return json(404, { error: 'Provider not found.' });
    }
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
        'Could not find any sessions in this PDF. Use a Frontline Related Service Session Notes or Therapist Activity Output report with a text layer (not a scan).';
      console.warn('upload-sessions 400', error, { textLen: String(text).length });
      return json(400, { error, errors: [error] });
    }

    // Provider mismatch is whole-file — cannot attribute rows to this account safely.
    const pdfProviderName = parsed.map((r) => r.providerName).find((n) => String(n || '').trim()) || '';
    if (pdfProviderName) {
      if (!findProviderByName([accountProvider], pdfProviderName)) {
        const error =
          ctx.user.role === 'admin'
            ? `Provider in PDF does not match this provider profile (PDF: "${pdfProviderName}").`
            : `Provider in PDF does not match your account (PDF: "${pdfProviderName}").`;
        return json(400, { error, errors: [error], saved: [], failed: [], skipped: [] });
      }
    }

    // Attach each session to the Monday week of its date of service (no calendar picker required).
    const weekCache = new Map<string, (typeof store.data.weeks)[number]>();
    const ensureWeek = (weekStart: string) => {
      let w = weekCache.get(weekStart) || store.weekByProviderStart(providerId, weekStart);
      if (!w) {
        const school = store.data.schools[0];
        w = store.upsertWeek({
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
          hhaError: '',
        });
      }
      weekCache.set(weekStart, w);
      return w;
    };
    const fallbackWeekStart = String(
      b.weekStart || (parsed[0] ? weekStartFromDos(parsed[0].dateOfService) : ''),
    );
    let week = fallbackWeekStart ? ensureWeek(fallbackWeekStart) : undefined;
    if (!week) {
      return json(400, {
        error: 'Could not determine a week for this upload (missing dates of service).',
        errors: ['Could not determine a week for this upload (missing dates of service).'],
      });
    }

    type UploadFail = {
      studentName: string;
      dateOfService: string;
      beginTime: string;
      endTime: string;
      error: string;
    };
    type UploadSaved = {
      id: string;
      studentId: string;
      studentName: string;
      dateOfService: string;
      beginTime: string;
      endTime: string;
      notes: string;
    };
    const failed: UploadFail[] = [];
    const pending: Array<{ session: SessionRow; studentName: string }> = [];
    const skipped: UploadSaved[] = [];
    const names = studentNameById(store);
    const settings = getAppSettings(store);
    const existingKeys = new Map<string, SessionRow>();
    for (const s of store.data.sessions) {
      const sw = store.data.weeks.find((w) => w.id === s.weekId);
      if (sw && sw.providerId === providerId) {
        existingKeys.set(uploadSessionKey(s), s);
      }
    }

    const resolveStudent = (studentName: string) => {
      const person = splitPersonName(studentName);
      const mapped = mappingName(studentName);
      return (
        store.findStudentByName(person.first, person.last) ||
        store.findStudentByName(mapped.first, mapped.last) ||
        (person.last && person.first
          ? store.findStudentByName(person.last, person.first)
          : undefined)
      );
    };

    // Sort so earlier sessions claim mandate slots first when some exceed.
    const ordered = [...parsed].sort((a, b) => {
      const da = parseDos(a.dateOfService)?.getTime() ?? 0;
      const db = parseDos(b.dateOfService)?.getTime() ?? 0;
      if (da !== db) return da - db;
      return String(a.beginTime || '').localeCompare(String(b.beginTime || ''));
    });

    // Validate all rows in memory first — all-or-nothing (no partial save).
    for (const row of ordered) {
      const label = formatUploadRowLabel(row);
      const display = String(row.studentName || '').trim() || 'Unknown';
      const student = resolveStudent(row.studentName);
      if (!student) {
        failed.push({
          studentName: display,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: Not found. Please reach out to your administrator to import the caseload first.`,
        });
        continue;
      }
      const studentName =
        `${student.firstName} ${student.lastName}`.trim() || display;

      const rowWeekStart = weekStartFromDos(row.dateOfService) || fallbackWeekStart;
      const targetWeek = ensureWeek(rowWeekStart);
      week = targetWeek;
      if (!therapistCanImportOrAddServices(targetWeek.status) && ctx.user.role !== 'admin') {
        const lockMsg =
          targetWeek.status === 'submitted'
            ? 'Week is awaiting signature — cancel approval before importing.'
            : weekIsProcessed(targetWeek.status)
              ? 'Week is signed/locked — ask an admin to reopen before importing.'
              : 'This week cannot accept imports.';
        failed.push({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${lockMsg}`,
        });
        continue;
      }

      const ageErr = sessionImportAgeError(row.dateOfService, {
        settings,
        providerId,
        weekId: targetWeek.id,
        isAdmin: ctx.user.role === 'admin',
      });
      if (ageErr) {
        failed.push({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${ageErr}`,
        });
        continue;
      }

      const rawSchool = String(row.schoolName || row.location || '').trim();
      const pdfSchool = rawSchool && !isGenericSettingLabel(rawSchool) ? rawSchool : '';
      if (pdfSchool) {
        const knownSchool = store.data.schools.find((s) => s.id === student.schoolId);
        if (knownSchool && schoolNamesConflict(pdfSchool, knownSchool.name)) {
          failed.push({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: School '${pdfSchool}' does not match child's school '${knownSchool.name}'.`,
          });
          continue;
        }
        if (!knownSchool) {
          const exists = store.data.schools.some(
            (s) => !schoolNamesConflict(pdfSchool, s.name) && Boolean(String(s.name || '').trim()),
          );
          if (!exists) {
            failed.push({
              studentName,
              dateOfService: row.dateOfService,
              beginTime: row.beginTime,
              endTime: row.endTime,
              error: `${label}: School '${pdfSchool}' not found`,
            });
            continue;
          }
        }
      }

      const key = uploadSessionKey({
        studentId: student.id,
        dateOfService: row.dateOfService,
        beginTime: row.beginTime,
        endTime: row.endTime,
      });
      const already = existingKeys.get(key);
      if (already) {
        // Exact duplicate of an already-saved (including processed) session → skip, never overwrite.
        skipped.push({
          id: already.id,
          studentId: already.studentId,
          studentName,
          dateOfService: already.dateOfService,
          beginTime: already.beginTime,
          endTime: already.endTime,
          notes: already.notes,
        });
        continue;
      }

      const cptCodes = row.cptCodes || [];
      const cptUnits = row.cptUnits || 0;
      const cptProcedures = row.cptProcedures || [];
      let session: SessionRow = {
        id: newId(),
        weekId: targetWeek.id,
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
        cptCodes,
        cptUnits,
        cptLabel: cptLabelFromParts(cptCodes, cptProcedures, cptUnits),
        aiFlags: [],
        aiBlock: false,
      };

      const projectedSessions = [
        ...store.sessionsForWeek(targetWeek.id),
        ...pending.filter((p) => p.session.weekId === targetWeek.id).map((p) => p.session),
        session,
      ];
      const allSessionsProjected = [
        ...store.data.sessions.filter((s) => s.weekId !== targetWeek.id),
        ...projectedSessions,
        ...pending.filter((p) => p.session.weekId !== targetWeek.id).map((p) => p.session),
      ];

      if (session.attendance === 'makeup') {
        const resolved = resolveMakeupOfSessionId(session, allSessionsProjected, store.data.mandates);
        if ('error' in resolved) {
          failed.push({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: ${resolved.error}`,
          });
          continue;
        }
        session = { ...session, makeupOfSessionId: resolved.makeupOfSessionId };
        const makeupErr = validateMakeup(session, allSessionsProjected, store.data.mandates);
        if (makeupErr) {
          failed.push({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: ${makeupErr}`,
          });
          continue;
        }
      }

      const cptErr = cptDurationError(
        session.beginTime,
        session.endTime,
        { codes: cptCodes, totalUnits: cptUnits, procedures: cptProcedures },
        session.attendance,
      );
      if (cptErr) {
        failed.push({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${cptErr}`,
        });
        continue;
      }

      const sigErr = sessionSignatureError(row.sourceSlice || row.notes || '', session.attendance);
      if (sigErr) {
        failed.push({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${sigErr}`,
        });
        continue;
      }

      const dayPeers = [
        ...providerDaySessions(
          store.data.sessions,
          store.data.weeks,
          providerId,
          session.dateOfService,
          session.id,
        ),
        ...pending
          .map((p) => p.session)
          .filter((s) => s.dateOfService === session.dateOfService),
      ];
      const overlapErr = sessionOverlapError({
        candidate: session,
        peers: dayPeers,
        studentNameById: names,
        mandates: store.data.mandates,
      });
      if (overlapErr) {
        failed.push({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${overlapErr}`,
        });
        continue;
      }

      const notePeers: Array<{ studentId: string; studentName: string; notes: string; dateOfService: string }> =
        [
          ...pending.map((p) => ({
            studentId: p.session.studentId,
            studentName: p.studentName,
            notes: p.session.notes,
            dateOfService: p.session.dateOfService,
          })),
          ...store
            .sessionsForWeek(targetWeek.id)
            .filter((s) => s.studentId !== student.id)
            .map((s) => ({
              studentId: s.studentId,
              studentName: names.get(s.studentId) || s.studentId,
              notes: s.notes,
              dateOfService: s.dateOfService,
            })),
        ];
      const peer = notePeers.find(
        (p) => p.studentId !== student.id && notesLookCopyPasted(session.notes, p.notes),
      );
      if (peer) {
        failed.push({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${noteCopyPasteError(studentName, peer.studentName, peer.dateOfService)}`,
        });
        continue;
      }

      const screened = screenServiceNote(session);
      session = {
        ...session,
        aiFlags: screened.flags,
        aiBlock: screened.block,
      };
      // Red (block) or yellow (warn) both reject the whole import.
      if (screened.block || screened.warnFlags.length) {
        failed.push({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${(screened.blockFlags.length ? screened.blockFlags : screened.warnFlags).join('; ') || 'Note screening failed'}`,
        });
        continue;
      }

      const check = checkMandatesForWeek(
        store.data.mandates,
        projectedSessions,
        allSessionsProjected,
        names,
        mandateWeekOpts(store),
      );
      if (check.errors.length) {
        const detail =
          check.errors.find((e) => e.includes(studentName) || e.includes(session.dateOfService)) ||
          check.errors[0] ||
          'This exceeds the mandate.';
        failed.push({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${detail}`,
        });
        continue;
      }

      existingKeys.set(key, session);
      pending.push({ session, studentName });
    }

    // Solo-group note locker after the full batch is known so same-slot peers count.
    if (!failed.length) {
      for (const item of pending) {
        const dayPeers = [
          ...providerDaySessions(
            store.data.sessions,
            store.data.weeks,
            providerId,
            item.session.dateOfService,
            item.session.id,
          ),
          ...pending
            .map((p) => p.session)
            .filter((s) => s.id !== item.session.id && s.dateOfService === item.session.dateOfService),
        ];
        const soloNoteErr = soloGroupMandateNoteError({
          notes: item.session.notes,
          serviceType: item.session.serviceType,
          studentId: item.session.studentId,
          attendance: item.session.attendance,
          mandates: store.data.mandates,
          presentGroupPeerCount: presentGroupPeerCount({
            candidate: item.session,
            peers: dayPeers,
            mandates: store.data.mandates,
          }),
        });
        if (soloNoteErr) {
          failed.push({
            studentName: item.studentName,
            dateOfService: item.session.dateOfService,
            beginTime: item.session.beginTime,
            endTime: item.session.endTime,
            error: `${formatUploadRowLabel({
              studentName: item.studentName,
              dateOfService: item.session.dateOfService,
              beginTime: item.session.beginTime,
              endTime: item.session.endTime,
            })}: ${soloNoteErr}`,
          });
        }
      }
    }

    // Any issue → save nothing.
    if (failed.length) {
      const errors = failed.map((f) => f.error);
      return json(200, {
        ok: false,
        partial: false,
        week,
        sessions: store.sessionsForWeek(week.id),
        saved: [],
        failed,
        skipped,
        warnings: [],
        errors,
        error:
          errors[0] ||
          `Import blocked — ${failed.length} issue(s). Nothing was saved. Fix all errors and import again.`,
        parsed: parsed.length,
        imported: 0,
        skippedCount: skipped.length,
      });
    }

    const saved: UploadSaved[] = [];
    for (const item of pending) {
      store.upsertSession(item.session);
      saved.push({
        id: item.session.id,
        studentId: item.session.studentId,
        studentName: item.studentName,
        dateOfService: item.session.dateOfService,
        beginTime: item.session.beginTime,
        endTime: item.session.endTime,
        notes: item.session.notes,
      });
    }

    const weekCheck = checkMandatesForWeek(
      store.data.mandates,
      store.sessionsForWeek(week.id),
      store.data.sessions,
      names,
      mandateWeekOpts(store),
    );

    return json(200, {
      ok: true,
      partial: false,
      week,
      sessions: store.sessionsForWeek(week.id),
      saved,
      failed: [],
      skipped,
      warnings: weekCheck.warnings,
      errors: [],
      parsed: parsed.length,
      imported: saved.length,
      skippedCount: skipped.length,
    });
  }

  if (req.method === 'POST' && path === '/week/sessions') {
    const b = obj(req);
    const week = store.data.weeks.find((w) => w.id === String(b.weekId || ''));
    if (!week) return json(404, { error: 'Week not found.' });
    const existing = store.data.sessions.find((s) => s.id === String(b.id || ''));
    if (existing) {
      if (!therapistCanMutateExistingSession(week.status, { isAdmin: ctx.user.role === 'admin' })) {
        return json(409, {
          error:
            week.status === 'submitted'
              ? 'Approval is pending. Cancel the signature request before editing sessions.'
              : 'This session was already processed and cannot be edited. Ask an admin if a change is required.',
        });
      }
    } else if (!therapistCanImportOrAddServices(week.status) && ctx.user.role !== 'admin') {
      return json(409, {
        error:
          week.status === 'submitted'
            ? 'This week is awaiting signature. Cancel the approval request before adding or editing sessions.'
            : weekIsProcessed(week.status)
              ? 'This week is signed/locked. Ask an admin to reopen it before adding sessions.'
              : 'This week cannot accept new sessions. Ask an admin to reopen it.',
      });
    }
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
    const cptRaw = String(b.cptLabel || b.cptCode || '').trim();
    const cptCodes = Array.isArray(b.cptCodes)
      ? (b.cptCodes as unknown[]).map(String).filter(Boolean)
      : cptRaw
        ? cptRaw.split(/[,;\s]+/).map((c) => c.replace(/x\d+$/i, '')).filter(Boolean)
        : existing?.cptCodes || [];
    const cptLabel = cptRaw || existing?.cptLabel || cptCodes.join(', ');
    const cptUnits =
      typeof b.cptUnits === 'number' && Number.isFinite(b.cptUnits)
        ? Number(b.cptUnits)
        : existing?.cptUnits || 0;
    const dateOfService = pickStr(b.dateOfService, existing?.dateOfService || '');
    const ageErr = sessionImportAgeError(dateOfService, {
      settings: getAppSettings(store),
      providerId: week.providerId,
      weekId: week.id,
      isAdmin: ctx.user.role === 'admin',
    });
    if (ageErr) return json(400, { error: ageErr, errors: [ageErr] });
    const session: SessionRow = {
      id: String(b.id || existing?.id || newId()),
      weekId: week.id,
      studentId: pickStr(b.studentId, existing?.studentId || ''),
      dateOfService,
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
      cptCodes,
      cptUnits,
      cptLabel,
      aiFlags: Array.isArray(b.aiFlags) ? (b.aiFlags as string[]) : existing?.aiFlags || [],
      aiBlock: typeof b.aiBlock === 'boolean' ? b.aiBlock : existing?.aiBlock || false,
    };
    if (additionalServiceType && !b.serviceType) {
      session.serviceType = serviceTypeFromAdditional;
    }
    if (session.attendance === 'makeup') {
      const resolved = resolveMakeupOfSessionId(
        session,
        store.data.sessions.filter((s) => s.id !== session.id).concat(session),
        store.data.mandates,
      );
      if ('error' in resolved) return json(400, { error: resolved.error });
      session.makeupOfSessionId = resolved.makeupOfSessionId;
    }
    const makeupErr = validateMakeup(
      session,
      store.data.sessions.filter((s) => s.id !== session.id).concat(session),
      store.data.mandates,
    );
    if (makeupErr) return json(400, { error: makeupErr });
    if (!isAdditionalServiceType(session.additionalServiceType || '')) {
      const dayPeers = providerDaySessions(
        store.data.sessions.filter((s) => s.id !== session.id),
        store.data.weeks,
        week.providerId,
        session.dateOfService,
        session.id,
      );
      const overlapErr = sessionOverlapError({
        candidate: session,
        peers: dayPeers,
        studentNameById: studentNameById(store),
        mandates: store.data.mandates,
      });
      if (overlapErr) return json(400, { error: overlapErr, errors: [overlapErr] });
      const soloNoteErr = soloGroupMandateNoteError({
        notes: session.notes,
        serviceType: session.serviceType,
        studentId: session.studentId,
        attendance: session.attendance,
        mandates: store.data.mandates,
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: session,
          peers: dayPeers,
          mandates: store.data.mandates,
        }),
      });
      if (soloNoteErr) return json(400, { error: soloNoteErr, errors: [soloNoteErr] });
    }
    const screenedLocal = screenServiceNote(session);
    session.aiFlags = screenedLocal.flags;
    session.aiBlock = screenedLocal.block;
    store.upsertSession(session);
    const check = checkMandatesForWeek(
      store.data.mandates,
      store.sessionsForWeek(week.id),
      store.data.sessions,
      studentNameById(store),
      mandateWeekOpts(store),
    );
    if (check.errors.length) {
      store.removeSession(session.id);
      return json(400, {
        error: overMandateSummary(check.errors),
        errors: check.errors,
      });
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
    const check = checkMandatesForWeek(
      store.data.mandates,
      sessions,
      store.data.sessions,
      studentNameById(store),
      mandateWeekOpts(store),
    );
    if (check.errors.length) {
      return json(400, {
        error: overMandateSummary(check.errors),
        errors: check.errors,
      });
    }
    const soloNoteErrors: string[] = [];
    for (const s of sessions) {
      if (isAdditionalServiceType(s.additionalServiceType || '')) continue;
      const dayPeers = providerDaySessions(
        store.data.sessions,
        store.data.weeks,
        week.providerId,
        s.dateOfService,
        s.id,
      );
      const soloNoteErr = soloGroupMandateNoteError({
        notes: s.notes,
        serviceType: s.serviceType,
        studentId: s.studentId,
        attendance: s.attendance,
        mandates: store.data.mandates,
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: s,
          peers: dayPeers,
          mandates: store.data.mandates,
        }),
      });
      if (soloNoteErr) {
        const who = studentNameById(store).get(s.studentId) || s.studentId;
        soloNoteErrors.push(`${s.dateOfService} ${who}: ${soloNoteErr}`);
      }
    }
    if (soloNoteErrors.length) {
      return json(400, {
        error: soloNoteErrors[0],
        errors: soloNoteErrors,
      });
    }
    const aiErrors: string[] = [];
    for (const s of sessions) {
      const makeupErr = validateMakeup(s, store.data.sessions, store.data.mandates);
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
    const schoolDistrict = schoolDistrictForWeek(
      store,
      next.id,
      String(b.schoolId || '').trim() || undefined,
    );
    const pdf = buildTimesheetPdf({
      week: next,
      providerLabel: provider ? `${provider.firstName} ${provider.lastName}` : next.providerId,
      signerName: next.signerName,
      signerEmail: next.signerEmail,
      schoolDistrict,
      rows: sessions.map((session) => {
        const dayPeers = providerDaySessions(
          store.data.sessions,
          store.data.weeks,
          next.providerId,
          session.dateOfService,
          session.id,
        );
        const payOpts = {
          presentGroupPeerCount: presentGroupPeerCount({
            candidate: session,
            peers: dayPeers,
            mandates: store.data.mandates,
          }),
          mandateDurationMinutes: mandateDurationMinutesForSession(session, store.data.mandates),
        };
        return {
          session,
          student: store.data.students.find((s) => s.id === session.studentId) as Student | undefined,
          payAmount: provider ? sessionPayAmount(provider, session, payOpts) : null,
        };
      }),
    });
    const envelope = await createSignEnvelope({
      signerEmail: next.signerEmail,
      signerName: next.signerName,
      weekId: next.id,
      pdf,
    });
    store.upsertWeek({ ...next, envelopeId: envelope.envelopeId, timesheetKey: `tms/timesheets/${next.id}.pdf` });
    // DocuSign emails the principal; only SES-attach the PDF on email fallback.
    if (deps.mail && next.signerEmail && envelope.vendor === 'email') {
      try {
        await deps.mail.send({
          to: [next.signerEmail],
          subject: `Please sign related-service timesheet (week of ${next.weekStart})`,
          text: `Please review and sign the attached timesheet for ${provider ? `${provider.firstName} ${provider.lastName}` : 'the therapist'}. Reply with the signed copy or complete the e-sign link when DocuSign is configured.\n\nPowered by advancedautomations.net`,
          attachmentName: `timesheet-${next.weekStart}.pdf`,
          attachment: pdf,
        });
      } catch (err) {
        // Roll back so a SES sandbox / identity failure does not leave the week stuck submitted.
        store.upsertWeek({ ...week });
        return json(503, {
          error: err instanceof Error ? err.message : 'Could not email the timesheet to the signer.',
        });
      }
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
    const schoolId = String(req.query.schoolId || '').trim();
    const schoolDistrict = schoolDistrictForWeek(store, week.id, schoolId || undefined);
    const pdf = buildTimesheetPdf({
      week,
      providerLabel: provider ? `${provider.firstName} ${provider.lastName}` : week.providerId,
      signerName: week.signerName,
      signerEmail: week.signerEmail,
      schoolDistrict,
      rows: store.sessionsForWeek(week.id).map((session) => {
        const dayPeers = providerDaySessions(
          store.data.sessions,
          store.data.weeks,
          week.providerId,
          session.dateOfService,
          session.id,
        );
        const payOpts = {
          presentGroupPeerCount: presentGroupPeerCount({
            candidate: session,
            peers: dayPeers,
            mandates: store.data.mandates,
          }),
          mandateDurationMinutes: mandateDurationMinutesForSession(session, store.data.mandates),
        };
        return {
          session,
          student: store.data.students.find((s) => s.id === session.studentId) as Student | undefined,
          payAmount: provider ? sessionPayAmount(provider, session, payOpts) : null,
        };
      }),
    });
    store.upsertWeek({ ...week, timesheetKey: `tms/timesheets/${week.id}.pdf` });
    return {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="timesheet-${week.weekStart}.pdf"`,
      },
      body: Buffer.from(pdf),
    };
  }

  if (req.method === 'POST' && /^\/weeks\/[^/]+\/cancel-approval$/.test(path)) {
    const week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });
    if (week.status !== 'submitted') {
      return json(409, { error: 'Only a pending (submitted) timesheet can cancel approval.' });
    }
    if (ctx.user.role !== 'admin') {
      const provider = providerFor(store, ctx.user);
      if (!provider || week.providerId !== provider.id) {
        return json(403, { error: 'You can only cancel your own pending timesheet.' });
      }
    }
    if (week.envelopeId) {
      await voidSignEnvelope(week.envelopeId, 'Timesheet approval cancelled in TMS');
    }
    const next = store.upsertWeek({
      ...week,
      status: 'draft',
      envelopeId: '',
      timesheetKey: '',
      signedKey: '',
    });
    store.audit(ctx.user.id, 'cancel_approval', `week:${week.id}`, week, next);
    return json(200, {
      week: next,
      message: 'Approval request cancelled. Week is back to draft.',
    });
  }

  if (req.method === 'DELETE' && /^\/sessions\/[^/]+$/.test(path)) {
    const id = path.split('/')[2];
    const session = store.data.sessions.find((s) => s.id === id);
    if (!session) return json(404, { error: 'Session not found.' });
    const week = store.data.weeks.find((w) => w.id === session.weekId);
    if (!week) return json(404, { error: 'Week not found.' });
    if (
      !therapistCanMutateExistingSession(week.status, { isAdmin: ctx.user.role === 'admin' })
    ) {
      return json(409, {
        error:
          week.status === 'submitted'
            ? 'Approval is pending. Cancel the signature request before removing sessions.'
            : weekIsProcessed(week.status)
              ? 'This session was already processed and cannot be removed.'
              : 'This week is locked. Ask an admin to reopen it.',
      });
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
    return adminUser(() =>
      json(410, {
        error:
          'Manual Sign is disabled. After the therapist sends the timesheet, the school principal signs via DocuSign; completion auto-locks and sends to HHA. Use Send to HHA to retry a failed transfer.',
      }),
    );
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

  if (req.method === 'POST' && path === '/support/luna/chat') {
    const b = obj(req);
    try {
      const out = await runLunaChat({
        messages: b.messages,
        pageUrl: String(b.pageUrl || '').trim(),
        user: ctx.user,
      });
      return json(200, out);
    } catch (err) {
      const status = Number((err as { status?: number })?.status) || 502;
      return json(status, {
        error: err instanceof Error ? err.message : 'Luna is unavailable.',
      });
    }
  }

  if (req.method === 'POST' && path === '/support/luna/handoff') {
    if (!deps.mail) return json(503, { error: 'Mailer is not configured.' });
    const b = obj(req);
    try {
      const out = await sendLunaHandoff({
        mail: deps.mail,
        user: ctx.user,
        messages: b.messages,
        summary: String(b.summary || '').trim(),
        pageUrl: String(b.pageUrl || '').trim(),
        contactName: b.contactName,
        contactEmail: b.contactEmail,
      });
      store.audit(ctx.user.id, 'luna_handoff', `user:${ctx.user.id}`, null, {
        to: out.to,
        mailId: out.id,
        contactName: out.contactName,
        contactEmail: out.contactEmail,
      });
      return json(200, {
        ok: true,
        to: out.to,
        id: out.id,
        reply: `Thanks — I sent this to ${out.to}. Moshe will follow up at ${out.contactEmail}.`,
      });
    } catch (err) {
      const status = Number((err as { status?: number })?.status) || 502;
      return json(status, {
        error: err instanceof Error ? err.message : 'Unable to send the support handoff.',
      });
    }
  }

  return json(404, { error: `No route ${req.method} ${path}` });
}
