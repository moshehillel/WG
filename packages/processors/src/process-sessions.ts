import type { HhaClient } from '@white-glove/hha-client';
import type {
  PipelineException,
  ProcessorResult,
  VerifiedSessionRow,
} from '@white-glove/shared';
import { buildHhaRowException, buildRowException } from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { triageVerifiedSession, type SessionRulesConfig } from './rules.js';

function sessionSkipMessage(sessionId: string, reason: string | undefined): string {
  switch (reason) {
    case 'early_intervention':
      return `[verified_sessions] session=${sessionId} skipped: Early Intervention session not sent to HHA`;
    case 'missing_service_code':
      return `[verified_sessions] session=${sessionId} skipped: no service code on API report row`;
    case 'unknown_service_code':
      return `[verified_sessions] session=${sessionId} skipped: service code not in mapping table`;
    default:
      return `[verified_sessions] session=${sessionId} skipped: ${reason ?? 'triage rule'}`;
  }
}

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
      exceptions.push(
        buildRowException({
          code: 'parse_error',
          message:
            '[verified_sessions] row missing sessionId — cannot match API report row to HHA visit',
          reportKind: 'verified_sessions',
        }),
      );
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
      exceptions.push(
        buildRowException({
          code,
          message: sessionSkipMessage(row.sessionId, decision.reason),
          reportKind: 'verified_sessions',
          rowId: row.sessionId,
          details: { triageReason: decision.reason },
        }),
      );
      await store.markProcessed(pk, `${runId}#${sk}`, { triage: 'skip' });
      continue;
    }

    const patientKey = row.patientExternalId ?? row.caseId;
    if (!patientKey) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'unmatched_patient',
          message: `[verified_sessions] session=${row.sessionId} has no patientExternalId or caseId — cannot locate HHA patient`,
          reportKind: 'verified_sessions',
          rowId: row.sessionId,
          details: { visitDate: row.visitDate, serviceCode: row.serviceCode },
        }),
      );
      continue;
    }

    let step = 'upsertPatient';
    try {
      if (!dryRun) {
        const patient = await hha.upsertPatient({
          externalId: row.patientExternalId,
          caseId: row.caseId,
          firstName: 'Unknown',
          lastName: patientKey,
        });
        step = 'locateOrScheduleVisit';
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
          step = 'getClockingDetails';
          const clocking = await hha.getClockingDetails(visit.id, {
            patientId: patient.id,
            visitDate: row.visitDate,
            startTime: row.startTime,
            endTime: row.endTime,
          });
          if (!clocking.matchesExpected) {
            failed += 1;
            exceptions.push(
              buildRowException({
                code: 'clocking_mismatch',
                message: `[verified_sessions] session=${row.sessionId} visit=${visit.id} EVV mismatch: expected ${row.startTime ?? '?'}–${row.endTime ?? '?'}, got ${clocking.clockIn ?? '?'}–${clocking.clockOut ?? '?'}`,
                reportKind: 'verified_sessions',
                rowId: row.sessionId,
                details: {
                  visitId: visit.id,
                  expectedStart: row.startTime,
                  expectedEnd: row.endTime,
                  clockIn: clocking.clockIn,
                  clockOut: clocking.clockOut,
                  notes: clocking.notes,
                },
              }),
            );
            continue;
          }
        }

        step = 'approveVisit';
        await hha.approveVisit(visit.id);
      }

      await store.markProcessed(pk, `${runId}#${sk}`, { triage: decision.triage });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      exceptions.push(
        buildHhaRowException({
          reportKind: 'verified_sessions',
          rowId: row.sessionId,
          step,
          err,
          extraDetails: {
            patientKey,
            visitDate: row.visitDate,
            serviceCode: row.serviceCode,
            triage: decision.triage,
          },
        }),
      );
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
