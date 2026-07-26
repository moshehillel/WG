import type {
  OpenedCaseRow,
  SessionDecision,
  SessionTriage,
  VerifiedSessionRow,
} from '@white-glove/shared';
import { programSessionMode } from '@white-glove/shared';

/**
 * Locked business rule: Early Intervention program types are never sent to HHA.
 * Detected via program type text ("Early Intervention" / "EI") or an explicit EI flag.
 */
export function isEarlyInterventionProgram(
  programType?: string,
  explicitFlag?: boolean,
): boolean {
  if (explicitFlag === true) return true;
  const program = programType?.trim().toLowerCase() ?? '';
  if (!program) return false;
  return (
    program.includes('early intervention') ||
    program === 'ei' ||
    program.startsWith('ei ') ||
    program.endsWith(' ei') ||
    program.includes('(ei)')
  );
}

export function isEarlyInterventionCase(row: {
  programType?: string;
  isEarlyIntervention?: boolean;
}): boolean {
  return isEarlyInterventionProgram(row.programType, row.isEarlyIntervention);
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
  if (isEarlyInterventionCase(row)) {
    return {
      sessionId: row.sessionId,
      triage: 'skip',
      reason: 'early_intervention',
    };
  }

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

  const program = row.programType?.trim();
  if (!program) {
    return {
      sessionId: row.sessionId,
      triage: 'skip',
      reason: 'missing_program_type',
    };
  }

  const programMode = programSessionMode(program);
  if (programMode === 'evv') {
    return {
      sessionId: row.sessionId,
      triage: 'verify_clocking',
      reason: `program_evv:${program}`,
    };
  }
  if (programMode === 'no_evv') {
    return {
      sessionId: row.sessionId,
      triage: 'auto_approve',
      reason: `program_no_evv:${program}`,
    };
  }
  return {
    sessionId: row.sessionId,
    triage: 'skip',
    reason: 'unknown_program_type',
  };
}
