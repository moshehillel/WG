import type { UnscheduledServiceRow } from './types/unscheduled.js';
import type { VerifiedSessionRow } from './types/reports.js';

export function hasClockTime(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

/** True when exactly one of EVV in/out is present (partial mobile clock). */
export function isIncompleteUnscheduledClock(row: UnscheduledServiceRow): boolean {
  const hasIn = hasClockTime(row.EVVInTime);
  const hasOut = hasClockTime(row.EVVOutTime);
  return hasIn !== hasOut;
}

export function missingClockSide(row: UnscheduledServiceRow): 'in' | 'out' | 'both' | null {
  const hasIn = hasClockTime(row.EVVInTime);
  const hasOut = hasClockTime(row.EVVOutTime);
  if (hasIn && hasOut) return null;
  if (hasIn && !hasOut) return 'out';
  if (!hasIn && hasOut) return 'in';
  return 'both';
}

export function unscheduledRowLabel(row: UnscheduledServiceRow): string {
  const p = row.Patient;
  const patient =
    [p?.PatientFirstName, p?.PatientLastName].filter(Boolean).join(' ') ||
    String(row.PatientId ?? p?.PatientID ?? '?');
  const c = row.Caregiver;
  const caregiver =
    [c?.CaregiverFirstName, c?.CaregiverLastName].filter(Boolean).join(' ') ||
    String(row.AideID ?? c?.AideID ?? '?');
  return `${patient} / ${caregiver}`;
}

/** ISO or PS date → YYYY-MM-DD for matching. */
export function normalizeVisitDate(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
  }
  return undefined;
}

export function unscheduledRowVisitDate(row: UnscheduledServiceRow): string | undefined {
  for (const t of [row.EVVInTime, row.EVVOutTime, row.CallDateTime]) {
    const d = normalizeVisitDate(t);
    if (d) return d;
  }
  return undefined;
}

export function unscheduledPatientId(row: UnscheduledServiceRow): string | undefined {
  const id = row.Patient?.PatientID ?? row.PatientId;
  return id != null ? String(id) : undefined;
}

export function unscheduledCaregiverId(row: UnscheduledServiceRow): string | undefined {
  const id = row.Caregiver?.AideID ?? row.AideID;
  return id != null ? String(id) : undefined;
}

export function unscheduledCaregiverCode(row: UnscheduledServiceRow): string | undefined {
  return row.Caregiver?.CaregiverCode?.trim() || undefined;
}

/** HHA-resolved ids for matching ProviderSoft sessions to getUnscheduledServices rows. */
export interface UnscheduledMatchKeys {
  /** HHA internal PatientID (from findPatient). */
  hhaPatientId?: string;
  /** HHA internal AideID (from resolveCaregiverId). */
  hhaCaregiverId?: string;
  /** WGC/WGJ caregiver code from ProviderSoft caregiver_codes report. */
  caregiverCode?: string;
}

function idsMatch(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return true;
  return left === right;
}

function caregiverMatches(
  sessionCaregiverId: string | undefined,
  sessionCaregiverCode: string | undefined,
  rowCaregiverId: string | undefined,
  rowCaregiverCode: string | undefined,
): boolean {
  if (sessionCaregiverId && rowCaregiverId && sessionCaregiverId === rowCaregiverId) return true;
  if (sessionCaregiverCode && rowCaregiverCode && sessionCaregiverCode === rowCaregiverCode) {
    return true;
  }
  if (!sessionCaregiverId && !sessionCaregiverCode) return true;
  if (!rowCaregiverId && !rowCaregiverCode) return true;
  return false;
}

/** Match API Report session row to an unscheduled HHA clock (PatientID + AideID/CaregiverCode + visit date). */
export function matchUnscheduledToSession(
  session: VerifiedSessionRow,
  unscheduled: UnscheduledServiceRow[],
  keys?: UnscheduledMatchKeys,
): UnscheduledServiceRow | undefined {
  const sessionDate = normalizeVisitDate(session.visitDate);
  const sessionPatient = keys?.hhaPatientId?.trim() ?? session.patientExternalId?.trim();
  const sessionCaregiver = keys?.hhaCaregiverId?.trim() ?? session.caregiverId?.trim();
  const sessionCaregiverCode = keys?.caregiverCode?.trim();

  return unscheduled.find((row) => {
    const rowDate = unscheduledRowVisitDate(row);
    const rowPatient = unscheduledPatientId(row);
    const rowCaregiver = unscheduledCaregiverId(row);
    const rowCaregiverCode = unscheduledCaregiverCode(row);

    if (sessionDate && rowDate && sessionDate !== rowDate) return false;
    if (!idsMatch(sessionPatient, rowPatient)) return false;
    if (
      !caregiverMatches(sessionCaregiver, sessionCaregiverCode, rowCaregiver, rowCaregiverCode)
    ) {
      return false;
    }

    const patientOk = idsMatch(sessionPatient, rowPatient);
    const caregiverOk = caregiverMatches(
      sessionCaregiver,
      sessionCaregiverCode,
      rowCaregiver,
      rowCaregiverCode,
    );
    const dateOk = !sessionDate || !rowDate || sessionDate === rowDate;

    return patientOk && caregiverOk && dateOk && Boolean(rowPatient || rowDate);
  });
}

/**
 * Partial HHA unscheduled clock (exactly one of in/out present).
 * Never use this for "no clock at all" — use missingUnscheduledClockMessage.
 */
export function incompleteUnscheduledClockMessage(
  sessionId: string,
  row: UnscheduledServiceRow,
): string {
  const side = missingClockSide(row);
  const label = unscheduledRowLabel(row);
  const inTime = row.EVVInTime?.trim() || '(missing)';
  const outTime = row.EVVOutTime?.trim() || '(missing)';
  if (side === 'in') {
    return `[verified_sessions] session=${sessionId} missing clock-in for ${label} (EVVInTime=(missing), EVVOutTime=${outTime}) — cannot approve until caregiver clocks in (or CallInMID is linked)`;
  }
  if (side === 'out') {
    return `[verified_sessions] session=${sessionId} missing clock-out for ${label} (EVVInTime=${inTime}, EVVOutTime=(missing)) — cannot approve until caregiver clocks out (or CallOutMID is linked)`;
  }
  // Defensive: both missing on a matched row should be rare; still say "missing clock".
  return `[verified_sessions] session=${sessionId} missing clock for ${label} (EVVInTime=${inTime}, EVVOutTime=${outTime}) — no clock-in or clock-out on the HHA unscheduled row; cannot approve`;
}

/** No matching HHA unscheduled row at all (not a partial in/out). */
export function missingUnscheduledClockMessage(sessionId: string, session: VerifiedSessionRow): string {
  const patient = session.patientExternalId ?? session.caseId ?? '?';
  const caregiver = session.caregiverId ?? session.providerName ?? '?';
  const date = session.visitDate ?? '?';
  return `[verified_sessions] session=${sessionId} missing clock — no matching HHA unscheduled mobile clock for patient=${patient} caregiver=${caregiver} date=${date} (getUnscheduledServices); cannot enter visit in HHA`;
}
