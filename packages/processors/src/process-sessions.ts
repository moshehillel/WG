import type { HhaClient } from '@white-glove/hha-client';
import type {
  PipelineException,
  ProcessorResult,
  VerifiedSessionRow,
} from '@white-glove/shared';
import { buildHhaRowException, buildRowException, lookupCaregiverCode } from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { previewVerifiedSession } from './preview-scan.js';
import { triageVerifiedSession, type SessionRulesConfig } from './rules.js';
import { resolveSessionVisit } from './session-resolve.js';

function sessionSkipMessage(sessionId: string, reason: string | undefined): string {
  switch (reason) {
    case 'early_intervention':
      return `[verified_sessions] session=${sessionId} skipped: Early Intervention session not sent to HHA`;
    case 'missing_service_code':
      return `[verified_sessions] session=${sessionId} error: no service type on API report row`;
    case 'unknown_service_code':
      return `[verified_sessions] session=${sessionId} error: service type not in HHA mapping table`;
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
  caregiverMap?: Map<string, string>;
}): Promise<ProcessorResult> {
  const { runId, hha, store, dryRun, rules, caregiverMap } = options;
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
    if (!dryRun && (await store.alreadyProcessed(pk, `${runId}#${sk}`))) {
      skipped += 1;
      continue;
    }

    const decision = triageVerifiedSession(row, rules);
    if (decision.triage === 'skip') {
      const isServiceCodeError =
        decision.reason === 'missing_service_code' || decision.reason === 'unknown_service_code';
      if (isServiceCodeError) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code: decision.reason === 'missing_service_code' ? 'missing_service_code' : 'unknown_service_code',
            message: sessionSkipMessage(row.sessionId, decision.reason),
            reportKind: 'verified_sessions',
            rowId: row.sessionId,
            details: { triageReason: decision.reason, serviceCode: row.serviceCode },
          }),
        );
        continue;
      }

      skipped += 1;
      exceptions.push(
        buildRowException({
          code: 'skipped_by_rule',
          message: sessionSkipMessage(row.sessionId, decision.reason),
          reportKind: 'verified_sessions',
          rowId: row.sessionId,
          details: { triageReason: decision.reason },
        }),
      );
      if (!dryRun) {
        await store.markProcessed(pk, `${runId}#${sk}`, { triage: 'skip' });
      }
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

    if (dryRun) {
      const previewIssues = [
        ...previewVerifiedSession(row),
        ...(caregiverMap && row.providerName && !lookupCaregiverCode(caregiverMap, row.providerName)
          ? [
              buildRowException({
                code: 'other',
                message: `[preview/verified_sessions] session=${row.sessionId} provider "${row.providerName}" not in caregiver codes report`,
                reportKind: 'verified_sessions',
                rowId: row.sessionId,
                details: { providerName: row.providerName, preview: true },
              }),
            ]
          : []),
      ];
      if (previewIssues.length) {
        failed += 1;
        exceptions.push(...previewIssues);
      } else {
        succeeded += 1;
      }
      continue;
    }

    const needsEvv = decision.triage === 'verify_clocking';
    const resolved = await resolveSessionVisit({
      row,
      caregiverMap: caregiverMap ?? new Map(),
      hha,
      needsEvv,
    });
    if (!resolved.ok) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: resolved.error.code,
          message: resolved.error.message,
          reportKind: 'verified_sessions',
          rowId: row.sessionId,
          details: resolved.error.details,
        }),
      );
      continue;
    }

    let step = 'findPatient';
    try {
      const patientId = await hha.findPatient({
        externalId: row.patientExternalId,
        caseId: row.caseId,
      });
      if (!patientId) {
        throw new Error(
          `HHA patient not found for case ${row.caseId ?? row.patientExternalId} — sync opened_cases first`,
        );
      }

      const visitInput = { ...resolved.resolved.visit, patientId };

      step = 'findPendingCall';
      const pendingCall = needsEvv
        ? await hha.findPendingCall({
            patientId,
            caregiverId: visitInput.caregiverId,
            visitDate: visitInput.visitDate!,
          })
        : undefined;

      step = 'locateOrScheduleVisit';
      const visit = await hha.locateOrScheduleVisit({
        ...visitInput,
        callDashboardId: pendingCall?.callDashboardId,
      });

      if (needsEvv && pendingCall?.callDashboardId) {
        step = 'linkClockToVisit';
        await hha.linkClockToVisit(visit.id, {
          callerId: pendingCall.callDashboardId,
          startTime: row.startTime,
          endTime: row.endTime,
        });
      }

      if (needsEvv) {
        step = 'getClockingDetails';
        const clocking = await hha.getClockingDetails(visit.id, {
          patientId,
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
