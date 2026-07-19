import type { HhaClient } from '@white-glove/hha-client';
import type {
  PipelineException,
  ProcessorResult,
  VerifiedSessionRow,
} from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { triageVerifiedSession, type SessionRulesConfig } from './rules.js';

export async function processVerifiedSessions(options: {
  runId: string;
  rows: VerifiedSessionRow[];
  hha: HhaClient;
  store: IdempotencyStore;
  dryRun?: boolean;
  rules?: SessionRulesConfig;
}): Promise<ProcessorResult> {
  const { runId, hha, store, dryRun, rules } = options;
  const exceptions: PipelineException[] = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of options.rows) {
    if (!row.sessionId) {
      failed += 1;
      exceptions.push({
        code: 'parse_error',
        message: 'Session missing sessionId',
        reportKind: 'verified_sessions',
      });
      continue;
    }

    const { pk, sk } = rowKey('verified_sessions', row.sessionId);
    if (await store.alreadyProcessed(pk, `${runId}#${sk}`)) {
      skipped += 1;
      continue;
    }

    const decision = triageVerifiedSession(row, rules);
    if (decision.triage === 'skip') {
      skipped += 1;
      const code =
        decision.reason === 'missing_service_code'
          ? 'missing_service_code'
          : decision.reason === 'unknown_service_code'
            ? 'unknown_service_code'
            : 'skipped_by_rule';
      exceptions.push({
        code,
        message:
          decision.reason === 'early_intervention'
            ? 'Early Intervention session ignored — not sent to HHA'
            : `Session not sent to HHA (${decision.reason ?? 'skip'})`,
        reportKind: 'verified_sessions',
        rowId: row.sessionId,
      });
      await store.markProcessed(pk, `${runId}#${sk}`, { triage: 'skip' });
      continue;
    }

    const patientKey = row.patientExternalId ?? row.caseId;
    if (!patientKey) {
      failed += 1;
      exceptions.push({
        code: 'unmatched_patient',
        message: 'Session has no patient or case reference',
        reportKind: 'verified_sessions',
        rowId: row.sessionId,
      });
      continue;
    }

    try {
      if (!dryRun) {
        const patient = await hha.upsertPatient({
          externalId: row.patientExternalId,
          caseId: row.caseId,
          firstName: 'Unknown',
          lastName: patientKey,
        });
        const visit = await hha.locateOrScheduleVisit({
          patientId: patient.id,
          visitExternalId: row.sessionId,
          serviceCode: row.serviceCode,
          visitDate: row.visitDate,
          startTime: row.startTime,
          endTime: row.endTime,
          caregiverId: row.caregiverId,
        });

        if (decision.triage === 'verify_clocking') {
          const clocking = await hha.getClockingDetails(visit.id, {
            patientId: patient.id,
            visitDate: row.visitDate,
            startTime: row.startTime,
            endTime: row.endTime,
          });
          if (!clocking.matchesExpected) {
            failed += 1;
            exceptions.push({
              code: 'clocking_mismatch',
              message: clocking.notes ?? 'Clocking details did not match',
              reportKind: 'verified_sessions',
              rowId: row.sessionId,
              details: { visitId: visit.id },
            });
            continue;
          }
        }

        await hha.approveVisit(visit.id);
      }

      await store.markProcessed(pk, `${runId}#${sk}`, { triage: decision.triage });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      exceptions.push({
        code: 'hha_api_error',
        message: err instanceof Error ? err.message : String(err),
        reportKind: 'verified_sessions',
        rowId: row.sessionId,
      });
    }
  }

  return {
    runId,
    reportKind: 'verified_sessions',
    processed: options.rows.length,
    succeeded,
    skipped,
    failed,
    exceptions,
  };
}
