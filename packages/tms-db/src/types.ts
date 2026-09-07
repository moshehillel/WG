export type Role = 'therapist' | 'admin';
export type Discipline = 'OT' | 'PT' | 'SLP';
export type WeekStatus = 'draft' | 'submitted' | 'signed' | 'locked' | 'reopened';
export type Attendance = 'attended' | 'missed' | 'makeup';
export type HhaTransferStatus = 'none' | 'pending' | 'sent' | 'confirmed' | 'failed';
export type DueKind = 'progress' | 'annual' | 'reeval';
/** Weekly = Freq per calendar week. school_day_cycle = Freq per N school days (e.g. 6). */
export type FrequencyKind = 'weekly' | 'school_day_cycle';

export interface AppUser {
  id: string;
  cognitoSub: string;
  email: string;
  role: Role;
  displayName: string;
  providerId: string;
  active: boolean;
  createdAt: string;
}

export interface School {
  id: string;
  name: string;
  district: string;
  signerName: string;
  signerEmail: string;
  createdAt: string;
}

/** Per-school academic calendar: year bounds + closed days (holidays/breaks). */
export interface SchoolCalendar {
  schoolId: string;
  /** First day of school (YYYY-MM-DD). */
  yearStart: string;
  /** Last day of school (YYYY-MM-DD). */
  yearEnd: string;
  /** ISO dates when school is closed. */
  offDays: string[];
}

export interface Provider {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  discipline: Discipline;
  payRate30Min: number | null;
  payRate42Min: number | null;
  payRate45Min: number | null;
  /** $/hour session (also legacy per-hour). */
  payRatePerHour: number | null;
  payRateGroup30Min: number | null;
  payRateGroup42Min: number | null;
  payRateGroup45Min: number | null;
  /** Flat rate per evaluation (HHA pay code uses this as OT $rate). */
  payRateEval: number | null;
  /** Flat hourly for additional services, billed to the minute. */
  payRateAdditionalHourly: number | null;
  hhaCaregiverCode: string;
  active: boolean;
  createdAt: string;
}

export const DEFAULT_ADMIN_NOTE_TAGS = ['Session note follow up', 'Gap in service'] as const;

export interface AdminNote {
  id: string;
  providerId: string;
  authorId: string;
  body: string;
  /** Predefined or custom tags. */
  tags: string[];
  createdAt: string;
}

export interface Student {
  id: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  dob: string;
  programId: string;
  programType: string;
  hhaPatientId: string;
  /** Optional grade from caseload CSV (e.g. KU Related Service Details). */
  grade?: string;
  createdAt: string;
}

export type MandateKind = 'regular' | 'makeup_auth';

export interface Mandate {
  id: string;
  studentId: string;
  providerId: string;
  serviceType: string;
  discipline: Discipline | '';
  /** makeup_auth = leftover makeup pool (does not consume weekly mandate). */
  mandateKind?: MandateKind;
  /**
   * Sessions allowed per calendar week when frequencyKind is weekly (or omitted).
   * For school_day_cycle rows this stays 0 — do not coerce cycle Freq into weekly.
   */
  frequencyPerWeek: number;
  /**
   * weekly (default) | school_day_cycle (e.g. Freq per 6 school days).
   * Omitted on legacy rows → treated as weekly.
   */
  frequencyKind?: FrequencyKind;
  /** Sessions allowed per period (Freq column). Same as frequencyPerWeek when weekly. */
  sessionsPerPeriod?: number;
  /** School-day cycle length when frequencyKind is school_day_cycle (typically 6). */
  periodSchoolDays?: number;
  ratioGroup: boolean;
  /** Session length in minutes from caseload RS Duration (e.g. 30, 42, 45). */
  durationMinutes?: number | null;
  /**
   * HHA school billing ServiceCodeName set at caseload import
   * (e.g. `PT school 30`). Related Service (`serviceType`) stays for therapists.
   * Eval / additional are not caseload mandates — leave unset.
   */
  billingServiceName?: string;
  /** Group mandate size; Individual imports as 1, Small Group may be null (overlap treats null Small Group as cap 2 = fewer than 3). */
  groupSize?: number | null;
  /** Session location from caseload (e.g. Push-In / Pull-Out). */
  location?: string;
  sourcePdfKey: string;
  parsedAt: string;
  startOn: string;
  endOn: string;
  createdAt: string;
}

export interface WeeklyPeriod {
  id: string;
  providerId: string;
  weekStart: string;
  status: WeekStatus;
  signerName: string;
  signerEmail: string;
  timesheetKey: string;
  signedKey: string;
  envelopeId: string;
  hhaStatus: HhaTransferStatus;
  /** Joined transfer error text when hhaStatus is failed (for admin Triage UI). */
  hhaError?: string;
}

/** Manual additional-service kinds (not regular caseload PT/OT visits from PDF). */
export const ADDITIONAL_SERVICE_TYPES = [
  'eval',
  'progress_report',
  'consultation',
  'meetings',
  'paid_absence',
] as const;

export type AdditionalServiceType = (typeof ADDITIONAL_SERVICE_TYPES)[number];

export const ADDITIONAL_SERVICE_LABELS: Record<AdditionalServiceType, string> = {
  eval: 'Eval',
  progress_report: 'Progress report',
  consultation: 'Consultation',
  meetings: 'Meetings',
  paid_absence: 'Paid absence',
};

export function isAdditionalServiceType(value: unknown): value is AdditionalServiceType {
  return ADDITIONAL_SERVICE_TYPES.includes(value as AdditionalServiceType);
}

export function additionalServiceLabel(value: string | undefined | null): string {
  if (!value) return '';
  if (isAdditionalServiceType(value)) return ADDITIONAL_SERVICE_LABELS[value];
  return String(value);
}

export interface SessionRow {
  id: string;
  weekId: string;
  studentId: string;
  dateOfService: string;
  beginTime: string;
  endTime: string;
  attendance: Attendance;
  cancelReason: string;
  makeupOfSessionId: string;
  serviceType: string;
  /** Eval / progress report / consultation / meetings — empty for PDF caseload visits. */
  additionalServiceType?: AdditionalServiceType | '';
  location: string;
  notes: string;
  /** CPT procedure codes from Frontline (e.g. 97110). */
  cptCodes?: string[];
  /** Sum of CPT units (1 unit ≈ 15 min). */
  cptUnits?: number;
  /** Display label like 97110x2. */
  cptLabel?: string;
  aiFlags: string[];
  /** True when AI/heuristic screening found hard blocks (blocks submit). */
  aiBlock?: boolean;
}

/** Global TMS app settings (single row id = "global"). */
export interface AppSettings {
  id: 'global';
  /** When true, providers cannot import/add sessions older than sessionImportMaxAgeDays. */
  sessionImportAgeLockEnabled: boolean;
  /** Max age in days for provider session import (default 14). */
  sessionImportMaxAgeDays: number;
  /** Week ids exempt from the age lock. */
  unlockedWeekIds: string[];
  /** Provider ids exempt from the age lock. */
  unlockedProviderIds: string[];
}

export function defaultAppSettings(): AppSettings {
  return {
    id: 'global',
    sessionImportAgeLockEnabled: true,
    sessionImportMaxAgeDays: 14,
    unlockedWeekIds: [],
    unlockedProviderIds: [],
  };
}

export interface StoredFile {
  id: string;
  studentId: string;
  providerId: string;
  weekId: string;
  kind: string;
  s3Key: string;
  label: string;
  createdAt: string;
}

export interface DueDate {
  id: string;
  /** Progress / annual / reeval deadlines apply to the whole school caseload. */
  schoolId: string;
  kind: DueKind;
  dueOn: string;
  completedAt: string;
  lastNagOn: string;
}

export interface AlertRow {
  id: string;
  userId: string;
  kind: string;
  severity: 'info' | 'warning' | 'error';
  body: string;
  entityRef: string;
  resolved: boolean;
  createdAt: string;
}

export interface HhaTransfer {
  id: string;
  sessionId: string;
  weekId: string;
  status: HhaTransferStatus;
  hhaVisitId: string;
  lastError: string;
  payloadHash: string;
  /** ISO timestamp of last upsert (used by end-of-day HHA error digest). */
  updatedAt?: string;
}

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  entity: string;
  beforeJson: string;
  afterJson: string;
  at: string;
}

export interface TmsSnapshot {
  users: AppUser[];
  schools: School[];
  schoolCalendars: SchoolCalendar[];
  providers: Provider[];
  adminNotes: AdminNote[];
  students: Student[];
  mandates: Mandate[];
  weeks: WeeklyPeriod[];
  sessions: SessionRow[];
  files: StoredFile[];
  dueDates: DueDate[];
  alerts: AlertRow[];
  hhaTransfers: HhaTransfer[];
  audit: AuditEvent[];
  settings: AppSettings[];
}

export function emptySnapshot(): TmsSnapshot {
  return {
    users: [],
    schools: [],
    schoolCalendars: [],
    providers: [],
    adminNotes: [],
    students: [],
    mandates: [],
    weeks: [],
    sessions: [],
    files: [],
    dueDates: [],
    alerts: [],
    hhaTransfers: [],
    audit: [],
    settings: [defaultAppSettings()],
  };
}
