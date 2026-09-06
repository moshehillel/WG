import { migrateDueDatesToSchools } from './due-dates.js';
import { newId, nowIso } from './ids.js';
import { migrateProviders } from './provider-pay.js';
import type {
  AdminNote,
  AlertRow,
  AppUser,
  AuditEvent,
  DueDate,
  HhaTransfer,
  Mandate,
  Provider,
  School,
  SchoolCalendar,
  SessionRow,
  StoredFile,
  Student,
  TmsSnapshot,
  WeeklyPeriod,
} from './types.js';
import { defaultAppSettings, emptySnapshot } from './types.js';

function mergeSnapshot(snapshot: Partial<TmsSnapshot> | null | undefined): TmsSnapshot {
  const base = emptySnapshot();
  const src = snapshot && typeof snapshot === 'object' ? snapshot : {};
  for (const key of Object.keys(base) as (keyof TmsSnapshot)[]) {
    const value = src[key];
    if (Array.isArray(value)) (base as TmsSnapshot)[key] = structuredClone(value) as never;
  }
  base.dueDates = migrateDueDatesToSchools(base.dueDates as never, base.students);
  base.providers = migrateProviders(base.providers);
  base.adminNotes = (base.adminNotes || []).map((n) => ({
    ...n,
    tags: Array.isArray((n as { tags?: unknown }).tags)
      ? (n as { tags: string[] }).tags.map((t) => String(t)).filter(Boolean)
      : [],
  }));
  if (!base.settings?.length) {
    base.settings = [defaultAppSettings()];
  }
  return base;
}

export class MemoryStore {
  data: TmsSnapshot;

  constructor(snapshot?: TmsSnapshot) {
    this.data = snapshot ? mergeSnapshot(snapshot) : emptySnapshot();
  }

  snapshot(): TmsSnapshot {
    return structuredClone(this.data);
  }

  load(snapshot: TmsSnapshot): void {
    // Older S3 snapshots may omit newer arrays (e.g. adminNotes) — fill defaults
    // so push/filter never crash on undefined.
    this.data = mergeSnapshot(snapshot);
  }

  audit(actorId: string, action: string, entity: string, before: unknown, after: unknown): void {
    const row: AuditEvent = {
      id: newId(),
      actorId,
      action,
      entity,
      beforeJson: JSON.stringify(before ?? null),
      afterJson: JSON.stringify(after ?? null),
      at: nowIso(),
    };
    this.data.audit.push(row);
  }

  userById(id: string): AppUser | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  userByEmail(email: string): AppUser | undefined {
    return this.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  userBySub(sub: string): AppUser | undefined {
    return this.data.users.find((u) => u.cognitoSub === sub);
  }

  upsertUser(row: AppUser): AppUser {
    const i = this.data.users.findIndex((u) => u.id === row.id);
    if (i >= 0) this.data.users[i] = row;
    else this.data.users.push(row);
    return row;
  }

  deleteUser(id: string): AppUser | undefined {
    const i = this.data.users.findIndex((u) => u.id === id);
    if (i < 0) return undefined;
    const [removed] = this.data.users.splice(i, 1);
    return removed;
  }

  upsertSchool(row: School): School {
    const i = this.data.schools.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.schools[i] = row;
    else this.data.schools.push(row);
    return row;
  }

  /** Remove a school, its due dates, and clear schoolId on linked students. */
  removeSchool(id: string): School | undefined {
    const i = this.data.schools.findIndex((s) => s.id === id);
    if (i < 0) return undefined;
    const [removed] = this.data.schools.splice(i, 1);
    const dueIds = new Set(
      this.data.dueDates.filter((d) => d.schoolId === id).map((d) => d.id),
    );
    this.data.dueDates = this.data.dueDates.filter((d) => d.schoolId !== id);
    for (const s of this.data.students) {
      if (s.schoolId === id) s.schoolId = '';
    }
    for (const a of this.data.alerts) {
      if (dueIds.has(a.entityRef.replace(/^due:/, ''))) a.resolved = true;
    }
    this.data.schoolCalendars = this.data.schoolCalendars.filter((c) => c.schoolId !== id);
    return removed;
  }

  schoolCalendarForSchool(schoolId: string): SchoolCalendar | undefined {
    return this.data.schoolCalendars.find((c) => c.schoolId === schoolId);
  }

  upsertSchoolCalendar(row: SchoolCalendar): SchoolCalendar {
    const i = this.data.schoolCalendars.findIndex((c) => c.schoolId === row.schoolId);
    if (i >= 0) this.data.schoolCalendars[i] = row;
    else this.data.schoolCalendars.push(row);
    return row;
  }

  removeSchoolCalendar(schoolId: string): SchoolCalendar | undefined {
    const i = this.data.schoolCalendars.findIndex((c) => c.schoolId === schoolId);
    if (i < 0) return undefined;
    const [removed] = this.data.schoolCalendars.splice(i, 1);
    return removed;
  }

  upsertProvider(row: Provider): Provider {
    const i = this.data.providers.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.providers[i] = row;
    else this.data.providers.push(row);
    return row;
  }

  addAdminNote(row: AdminNote): AdminNote {
    this.data.adminNotes.push(row);
    return row;
  }

  notesForProvider(providerId: string): AdminNote[] {
    return this.data.adminNotes.filter((n) => n.providerId === providerId);
  }

  upsertAdminNote(row: AdminNote): AdminNote {
    const i = this.data.adminNotes.findIndex((n) => n.id === row.id);
    if (i >= 0) this.data.adminNotes[i] = row;
    else this.data.adminNotes.push(row);
    return row;
  }

  removeAdminNote(id: string): AdminNote | undefined {
    const i = this.data.adminNotes.findIndex((n) => n.id === id);
    if (i < 0) return undefined;
    const [removed] = this.data.adminNotes.splice(i, 1);
    return removed;
  }

  removeProvider(id: string): Provider | undefined {
    const i = this.data.providers.findIndex((p) => p.id === id);
    if (i < 0) return undefined;
    const [removed] = this.data.providers.splice(i, 1);
    this.data.adminNotes = this.data.adminNotes.filter((n) => n.providerId !== id);
    for (const m of this.data.mandates) {
      if (m.providerId === id) m.providerId = '';
    }
    for (const u of this.data.users) {
      if (u.providerId === id) u.providerId = '';
    }
    return removed;
  }

  upsertStudent(row: Student): Student {
    const i = this.data.students.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.students[i] = row;
    else this.data.students.push(row);
    return row;
  }

  removeStudent(id: string): Student | undefined {
    const i = this.data.students.findIndex((s) => s.id === id);
    if (i < 0) return undefined;
    const [removed] = this.data.students.splice(i, 1);
    this.data.mandates = this.data.mandates.filter((m) => m.studentId !== id);
    const sessionIds = new Set(
      this.data.sessions.filter((s) => s.studentId === id).map((s) => s.id),
    );
    this.data.sessions = this.data.sessions.filter((s) => s.studentId !== id);
    this.data.hhaTransfers = this.data.hhaTransfers.filter((t) => !sessionIds.has(t.sessionId));
    this.data.files = this.data.files.filter((f) => f.studentId !== id);
    return removed;
  }

  findStudentByName(first: string, last: string): Student | undefined {
    const f = first.trim().toLowerCase();
    const l = last.trim().toLowerCase();
    return this.data.students.find(
      (s) => s.firstName.toLowerCase() === f && s.lastName.toLowerCase() === l,
    );
  }

  upsertMandate(row: Mandate): Mandate {
    const i = this.data.mandates.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.mandates[i] = row;
    else this.data.mandates.push(row);
    return row;
  }

  /** First mandate for the student (legacy helpers / due-nags). Prefer mandatesForStudent. */
  mandateForStudent(studentId: string): Mandate | undefined {
    return this.data.mandates.find((m) => m.studentId === studentId);
  }

  /** All mandates for a student (individual + group, dual services, etc.). */
  mandatesForStudent(studentId: string): Mandate[] {
    return this.data.mandates.filter((m) => m.studentId === studentId);
  }

  removeMandate(id: string): Mandate | undefined {
    const i = this.data.mandates.findIndex((m) => m.id === id);
    if (i < 0) return undefined;
    const [removed] = this.data.mandates.splice(i, 1);
    return removed;
  }

  removeFile(id: string): StoredFile | undefined {
    const i = this.data.files.findIndex((f) => f.id === id);
    if (i < 0) return undefined;
    const [removed] = this.data.files.splice(i, 1);
    return removed;
  }

  weekByProviderStart(providerId: string, weekStart: string): WeeklyPeriod | undefined {
    return this.data.weeks.find((w) => w.providerId === providerId && w.weekStart === weekStart);
  }

  upsertWeek(row: WeeklyPeriod): WeeklyPeriod {
    const i = this.data.weeks.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.weeks[i] = row;
    else this.data.weeks.push(row);
    return row;
  }

  sessionsForWeek(weekId: string): SessionRow[] {
    return this.data.sessions.filter((s) => s.weekId === weekId);
  }

  upsertSession(row: SessionRow): SessionRow {
    const i = this.data.sessions.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.sessions[i] = row;
    else this.data.sessions.push(row);
    return row;
  }

  removeSession(id: string): void {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    this.data.hhaTransfers = this.data.hhaTransfers.filter((t) => t.sessionId !== id);
  }

  /** Remove a week and its sessions (and related HHA transfer rows). */
  removeWeek(id: string): boolean {
    const exists = this.data.weeks.some((w) => w.id === id);
    if (!exists) return false;
    const sessionIds = new Set(this.sessionsForWeek(id).map((s) => s.id));
    this.data.sessions = this.data.sessions.filter((s) => s.weekId !== id);
    this.data.hhaTransfers = this.data.hhaTransfers.filter((t) => !sessionIds.has(t.sessionId));
    this.data.weeks = this.data.weeks.filter((w) => w.id !== id);
    return true;
  }

  addFile(row: StoredFile): StoredFile {
    this.data.files.push(row);
    return row;
  }

  filesForStudent(studentId: string): StoredFile[] {
    return this.data.files.filter((f) => f.studentId === studentId);
  }

  filesForProvider(providerId: string): StoredFile[] {
    return this.data.files.filter((f) => f.providerId === providerId && !f.studentId);
  }

  upsertDueDate(row: DueDate): DueDate {
    const i = this.data.dueDates.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.dueDates[i] = row;
    else this.data.dueDates.push(row);
    return row;
  }

  removeDueDate(id: string): DueDate | undefined {
    const i = this.data.dueDates.findIndex((d) => d.id === id);
    if (i < 0) return undefined;
    const [removed] = this.data.dueDates.splice(i, 1);
    for (const a of this.data.alerts) {
      if (a.entityRef === `due:${id}`) a.resolved = true;
    }
    return removed;
  }

  /** Providers with at least one mandate for a student at this school. */
  providerIdsForSchool(schoolId: string): string[] {
    const studentIds = new Set(
      this.data.students.filter((s) => s.schoolId === schoolId).map((s) => s.id),
    );
    return [
      ...new Set(
        this.data.mandates
          .filter((m) => studentIds.has(m.studentId) && m.providerId)
          .map((m) => m.providerId),
      ),
    ];
  }

  addAlert(row: AlertRow): AlertRow {
    this.data.alerts.push(row);
    return row;
  }

  openAlerts(): AlertRow[] {
    return this.data.alerts.filter((a) => !a.resolved);
  }

  upsertTransfer(row: HhaTransfer): HhaTransfer {
    const i = this.data.hhaTransfers.findIndex((s) => s.sessionId === row.sessionId);
    if (i >= 0) this.data.hhaTransfers[i] = row;
    else this.data.hhaTransfers.push(row);
    return row;
  }

  transferForSession(sessionId: string): HhaTransfer | undefined {
    return this.data.hhaTransfers.find((t) => t.sessionId === sessionId);
  }
}
