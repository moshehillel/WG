import type {
  OpenedCaseRow,
  SessionDecision,
  SessionTriage,
  VerifiedSessionRow,
} from '@white-glove/shared';
import { lookupServiceCode } from '@white-glove/shared';

export function isEarlyInterventionCase(row: OpenedCaseRow): boolean {
  if (row.isEarlyIntervention === true) return true;
  const program = row.programType?.toLowerCase() ?? '';
  return program.includes('early intervention') || program === 'ei';
}

export function filterOpenedCases(rows: OpenedCaseRow[]): {
  kept: OpenedCaseRow[];
  skippedEi: OpenedCaseRow[];
} {
  const kept: OpenedCaseRow[] = [];
  const skippedEi: OpenedCaseRow[] = [];
  for (const row of rows) {
    if (isEarlyInterventionCase(row)) skippedEi.push(row);
    else kept.push(row);
  }
  return { kept, skippedEi };
}

export interface SessionRulesConfig {
  /** Force triage by session status string (lowercased). */
  statusOverrides?: Record<string, SessionTriage>;
  /** Codes that must never be sent to HHA. */
  skipServiceCodes?: string[];
  /** Codes that always require clocking verification. */
  verifyClockingCodes?: string[];
  /** Codes that always auto-approve. */
  autoApproveCodes?: string[];
}

const DEFAULT_STATUS_OVERRIDES: Record<string, SessionTriage> = {
  do_not_bill: 'skip',
  cancelled: 'skip',
  rejected: 'skip',
};

export function triageVerifiedSession(
  row: VerifiedSessionRow,
  config: SessionRulesConfig = {},
): SessionDecision {
  const status = row.status?.trim().toLowerCase() ?? '';
  const statusMap = { ...DEFAULT_STATUS_OVERRIDES, ...config.statusOverrides };
  if (status && statusMap[status]) {
    return { sessionId: row.sessionId, triage: statusMap[status], reason: `status:${status}` };
  }

  const code = row.serviceCode?.trim().toUpperCase() ?? '';
  if (!code) {
    return {
      sessionId: row.sessionId,
      triage: 'skip',
      reason: 'missing_service_code',
    };
  }

  const skipSet = new Set((config.skipServiceCodes ?? []).map((c) => c.toUpperCase()));
  if (skipSet.has(code)) {
    return { sessionId: row.sessionId, triage: 'skip', reason: 'skip_service_code' };
  }

  const verifySet = new Set((config.verifyClockingCodes ?? []).map((c) => c.toUpperCase()));
  if (verifySet.has(code)) {
    return { sessionId: row.sessionId, triage: 'verify_clocking', reason: 'verify_list' };
  }

  const autoSet = new Set((config.autoApproveCodes ?? []).map((c) => c.toUpperCase()));
  if (autoSet.has(code)) {
    return { sessionId: row.sessionId, triage: 'auto_approve', reason: 'auto_list' };
  }

  const mapping = lookupServiceCode(code);
  if (!mapping) {
    return {
      sessionId: row.sessionId,
      triage: 'skip',
      reason: 'unknown_service_code',
    };
  }

  return {
    sessionId: row.sessionId,
    triage: mapping.defaultSessionTriage,
    reason: `service_map:${mapping.hhaCode}`,
  };
}
