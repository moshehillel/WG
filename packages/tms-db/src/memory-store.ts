import { newId, nowIso } from './ids.js';
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
  SessionRow,
  StoredFile,
  Student,
  TmsSnapshot,
  WeeklyPeriod,
} from './types.js';
import { emptySnapshot } from './types.js';

function mergeSnapshot(snapshot: Partial<TmsSnapshot> | null | undefined): TmsSnapshot {
  const base = emptySnapshot();
  const src = snapshot && typeof snapshot === 'object' ? snapshot : {};
  for (const key of Object.keys(base) as (keyof TmsSnapshot)[]) {
    const value = src[key];
    if (Array.isArray(value)) (base as TmsSnapshot)[key] = structuredClone(value) as never;
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

  upsertStudent(row: Student): Student {
    const i = this.data.students.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.students[i] = row;
    else this.data.students.push(row);
    return row;
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
  }

  addFile(row: StoredFile): StoredFile {
    this.data.files.push(row);
    return row;
  }

  filesForStudent(studentId: string): StoredFile[] {
    return this.data.files.filter((f) => f.studentId === studentId);
  }

  upsertDueDate(row: DueDate): DueDate {
    const i = this.data.dueDates.findIndex((s) => s.id === row.id);
    if (i >= 0) this.data.dueDates[i] = row;
    else this.data.dueDates.push(row);
    return row;
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
