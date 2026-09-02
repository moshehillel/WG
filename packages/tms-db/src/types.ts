export type Role = 'therapist' | 'admin';
export type Discipline = 'OT' | 'PT' | 'SLP';
export type WeekStatus = 'draft' | 'submitted' | 'signed' | 'locked' | 'reopened';
export type Attendance = 'attended' | 'missed' | 'makeup';
export type HhaTransferStatus = 'none' | 'pending' | 'sent' | 'confirmed' | 'failed';
export type DueKind = 'progress' | 'annual' | 'reeval';

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

export interface Provider {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  discipline: Discipline;
  payRate: number | null;
  hhaCaregiverCode: string;
  active: boolean;
  createdAt: string;
}

export interface AdminNote {
  id: string;
  providerId: string;
  authorId: string;
  body: string;
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
  createdAt: string;
}

export interface Mandate {
  id: string;
  studentId: string;
  providerId: string;
  serviceType: string;
  discipline: Discipline | '';
  frequencyPerWeek: number;
  ratioGroup: boolean;
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
  location: string;
  notes: string;
  aiFlags: string[];
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
  studentId: string;
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
}

export function emptySnapshot(): TmsSnapshot {
  return {
    users: [],
    schools: [],
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
  };
}
