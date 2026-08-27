import type { PipelineException, UnscheduledMatchKeys, UnscheduledServiceRow, VerifiedSessionRow } from '@white-glove/shared';
import {
  buildRowException,
  incompleteUnscheduledClockMessage,
  isIncompleteUnscheduledClock,
  matchUnscheduledToSession,
  missingClockSide,
  missingUnscheduledClockMessage,
  partyDetailsFromRow,
  unscheduledCaregiverId,
  unscheduledPatientId,
  unscheduledRowVisitDate,
} from '@white-glove/shared';

/** PS API Report row missing Begin/End Time — cannot approve EVV session. */
export function validateVerifiedSessionTimes(row: VerifiedSessionRow): PipelineException | undefined {
  const hasStart = Boolean(row.startTime?.trim());
  const hasEnd = Boolean(row.endTime?.trim());
  if (hasStart === hasEnd) return undefined;

  const missing = !hasStart ? 'Begin Time (clock-in)' : 'End Time (clock-out)';
  return buildRowException({
    code: 'incomplete_unscheduled_clock',
    message: `[verified_sessions] session=${row.sessionId} API Report missing ${missing} — EVV session requires both Begin and End Time before HHA approve`,
    reportKind: 'verified_sessions',
    rowId: row.sessionId,
    details: {
      ...partyDetailsFromRow(row),
      startTime: row.startTime,
      endTime: row.endTime,
      missingSide: !hasStart ? 'in' : 'out',
      source: 'providersoft_report',
    },
  });
}

export function validateSessionAgainstUnscheduled(
  session: VerifiedSessionRow,
  unscheduled: UnscheduledServiceRow[],
  options?: { requireMatch?: boolean; matchKeys?: UnscheduledMatchKeys },
): PipelineException | undefined {
  const reportIssue = validateVerifiedSessionTimes(session);
  if (reportIssue) return reportIssue;

  const party = partyDetailsFromRow(session);
  const match = matchUnscheduledToSession(session, unscheduled, options?.matchKeys);
  if (!match) {
    if (!options?.requireMatch) return undefined;
    return buildRowException({
      code: 'incomplete_unscheduled_clock',
      message: missingUnscheduledClockMessage(session.sessionId ?? '?', session),
      reportKind: 'verified_sessions',
      rowId: session.sessionId,
      details: {
        ...party,
        source: 'hha_unscheduled_missing',
        missingSide: 'both',
        patientId: session.patientExternalId ?? session.caseId,
        caregiverId: session.caregiverId,
        visitDate: session.visitDate,
      },
    });
  }
  if (!isIncompleteUnscheduledClock(match)) return undefined;

  return buildRowException({
    code: 'incomplete_unscheduled_clock',
    message: incompleteUnscheduledClockMessage(session.sessionId, match),
    reportKind: 'verified_sessions',
    rowId: session.sessionId,
    details: {
      ...party,
      source: 'hha_unscheduled',
      missingSide: missingClockSide(match),
      evvInTime: match.EVVInTime,
      evvOutTime: match.EVVOutTime,
      multiInCallId: match.MultiInCallID,
      multiOutCallId: match.MultiOutCallID,
      maintenanceId: match.MaintenanceID,
      patientId: unscheduledPatientId(match),
      caregiverId: unscheduledCaregiverId(match),
      visitDate: unscheduledRowVisitDate(match),
    },
  });
}

export function findIncompleteUnscheduledRows(
  unscheduled: UnscheduledServiceRow[],
): UnscheduledServiceRow[] {
  return unscheduled.filter(isIncompleteUnscheduledClock);
}

/** Flag unscheduled rows with partial clocks not tied to a session id (fetch/audit). */
export function buildUnscheduledAuditExceptions(
  unscheduled: UnscheduledServiceRow[],
): PipelineException[] {
  return findIncompleteUnscheduledRows(unscheduled).map((row) => {
    const patientId = unscheduledPatientId(row) ?? 'unknown';
    const visitDate = unscheduledRowVisitDate(row) ?? '?';
    const rowId = `unscheduled:${patientId}:${visitDate}:${row.MaintenanceID ?? '?'}`;
    return buildRowException({
      code: 'incomplete_unscheduled_clock',
      message: `[verified_sessions] ${incompleteUnscheduledClockMessage(rowId, row)}`,
      reportKind: 'verified_sessions',
      rowId,
      details: {
        source: 'hha_unscheduled_audit',
        missingSide: missingClockSide(row),
        evvInTime: row.EVVInTime,
        evvOutTime: row.EVVOutTime,
        maintenanceId: row.MaintenanceID,
        patientId,
        visitDate,
      },
    });
  });
}
