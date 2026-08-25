import type { HhaClient, SoapHhaClientAdapter } from '@white-glove/hha-client';
import { resolveVisitForUnscheduledClock } from '@white-glove/hha-client';
import type {
  PipelineException,
  ProcessorResult,
  ProcessorSuccessRow,
  UnscheduledServiceRow,
  VerifiedSessionRow,
} from '@white-glove/shared';
import {
  buildHhaRowException,
  buildRowException,
  matchUnscheduledToSession,
  missingUnscheduledClockMessage,
  partyDetailsFromRow,
} from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { previewVerifiedSessionWithHha } from './preview-scan.js';
import { triageVerifiedSession, type SessionRulesConfig } from './rules.js';
import { resolveSessionVisit, resolveUnscheduledMatchKeys } from './session-resolve.js';
import { validateSessionAgainstUnscheduled } from './unscheduled-validate.js';
import { consumeTimeBudgetStop } from './time-budget.js';
import { resolveHhaPatientId } from './resolve-hha-patient.js';

function sessionSkipMessage(sessionId: string, reason: string | undefined): string {
  switch (reason) {
    case 'early_intervention':
      return `[verified_sessions] session=${sessionId} skipped: Early Intervention session not sent to HHA`;
    case 'missed_session':
      return `[verified_sessions] session=${sessionId} skipped: missed session (Pay Rate 0 / Missed status) — not sent to HHA`;
    case 'missing_service_code':
      return `[verified_sessions] session=${sessionId} error: no service type on API report row`;
    case 'unknown_service_code':
      return `[verified_sessions] session=${sessionId} error: service type not in HHA mapping table`;
    case 'missing_program_type':
      return `[verified_sessions] session=${sessionId} error: Program Type required on API report row — no billable approve without it`;
    case 'unknown_program_type':
      return `[verified_sessions] session=${sessionId} error: Program Type not in approved billing list — fix in ProviderSoft or add mapping before any HHA approve`;
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
  /** HHA getUnscheduledServices rows for EVV clock completeness checks. */
  unscheduledRows?: UnscheduledServiceRow[];
  /** ENT GraphQL create-from-unscheduled (SOAP existing visit → CreateVisitFromUnscheduledServices). */
  entUnscheduled?: {
    spaToken: string;
    soap: SoapHhaClientAdapter;
  };
  /** When true (production), EVV sessions require a matching unscheduled HHA clock. */
  unscheduledFetchActive?: boolean;
  shouldYield?: () => boolean;
}): Promise<ProcessorResult> {
  const {
    runId,
    hha,
    store,
    dryRun,
    rules,
    caregiverMap,
    unscheduledRows = [],
    entUnscheduled,
    unscheduledFetchActive = true,
    shouldYield,
  } = options;
  const exceptions: PipelineException[] = [];
  const successes: ProcessorSuccessRow[] = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  const unscheduledMatchCache = {
    patients: new Map<string, string | undefined>(),
    caregivers: new Map<string, string | undefined>(),
  };

  for (let i = 0; i < options.rows.length; i++) {
    const budget = consumeTimeBudgetStop(
      shouldYield,
      options.rows.length - i,
      i,
      'verified_sessions',
      exceptions,
    );
    if (budget.stop) {
      failed += budget.extraFailed;
      break;
    }
    const row = options.rows[i]!;
    const party = partyDetailsFromRow(row);
    if (!row.sessionId) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'missing_field',
          message:
            '[verified_sessions] row missing sessionId — cannot match API report row to HHA visit',
          reportKind: 'verified_sessions',
          details: party,
        }),
      );
      continue;
    }

    const { pk, sk } = rowKey('verified_sessions', row.sessionId);
    if (!dryRun && (await store.alreadyProcessed(pk, sk))) {
      skipped += 1;
      continue;
    }

    const decision = triageVerifiedSession(row, rules);
    if (decision.triage === 'skip') {
      const isBillingBlock =
        decision.reason === 'missing_service_code' ||
        decision.reason === 'unknown_service_code' ||
        decision.reason === 'missing_program_type' ||
        decision.reason === 'unknown_program_type';
      if (isBillingBlock) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code:
              decision.reason === 'missing_service_code'
                ? 'missing_service_code'
                : decision.reason === 'unknown_service_code'
                  ? 'unknown_service_code'
                  : 'missing_field',
            message: sessionSkipMessage(row.sessionId, decision.reason),
            reportKind: 'verified_sessions',
            rowId: row.sessionId,
            details: { triageReason: decision.reason, serviceCode: row.serviceCode, ...party },
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
          details: { triageReason: decision.reason, ...party },
        }),
      );
      if (!dryRun) {
        await store.markProcessed(pk, sk, { triage: 'skip', runId });
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
          details: { visitDate: row.visitDate, serviceCode: row.serviceCode, ...party },
        }),
      );
      continue;
    }

    if (dryRun) {
      const previewIssues = [
        ...(await previewVerifiedSessionWithHha(row, hha, caregiverMap)),
      ];
      if (decision.triage === 'verify_clocking') {
        const matchKeys = await resolveUnscheduledMatchKeys({
          row,
          caregiverMap: caregiverMap ?? new Map(),
          hha,
          cache: unscheduledMatchCache,
        });
        const clockIssue = validateSessionAgainstUnscheduled(row, unscheduledRows, {
          requireMatch: unscheduledFetchActive,
          matchKeys,
        });
        if (clockIssue) previewIssues.push(clockIssue);
      }
      if (previewIssues.length) {
        failed += 1;
        exceptions.push(...previewIssues);
      } else {
        succeeded += 1;
        successes.push({ rowId: row.sessionId, ...party });
      }
      continue;
    }

    const needsEvv = decision.triage === 'verify_clocking';
    let matchKeys;
    if (needsEvv) {
      matchKeys = await resolveUnscheduledMatchKeys({
        row,
        caregiverMap: caregiverMap ?? new Map(),
        hha,
        cache: unscheduledMatchCache,
      });
    }
    if (needsEvv) {
      const clockIssue = validateSessionAgainstUnscheduled(row, unscheduledRows, {
        requireMatch: unscheduledFetchActive,
        matchKeys,
      });
      if (clockIssue) {
        failed += 1;
        exceptions.push(clockIssue);
        continue;
      }
    }

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
      const patientId = await resolveHhaPatientId(hha, row);
      if (!patientId) {
        throw new Error(
          `HHA patient not found for case ${row.caseId ?? row.patientExternalId} — sync opened_cases first`,
        );
      }

      const visitInput = { ...resolved.resolved.visit, patientId };
      const unscheduledMatch = needsEvv
        ? matchUnscheduledToSession(row, unscheduledRows, matchKeys)
        : undefined;

      let visit: { id: string; created: boolean };

      if (needsEvv && unscheduledFetchActive) {
        if (!unscheduledMatch) {
          throw new Error(missingUnscheduledClockMessage(row.sessionId, row));
        }
        if (!entUnscheduled) {
          throw new Error(
            `[verified_sessions] session=${row.sessionId} ENT GraphQL client unavailable — cannot create visit from unscheduled clock`,
          );
        }
        step = 'resolveVisitForUnscheduledClock';
        const entResult = await resolveVisitForUnscheduledClock({
          soap: entUnscheduled.soap,
          entToken: entUnscheduled.spaToken,
          visit: visitInput,
          unscheduledRow: unscheduledMatch,
        });
        if (entResult.displayMessage && Number(entResult.visitId) <= 0) {
          throw new Error(entResult.displayMessage);
        }
        visit = { id: entResult.visitId, created: entResult.created };
      } else {
        step = 'findPendingCall';
        const pendingCall = needsEvv
          ? await hha.findPendingCall({
              patientId,
              caregiverId: visitInput.caregiverId,
              visitDate: visitInput.visitDate!,
            })
          : undefined;

        if (needsEvv && !pendingCall?.callDashboardId) {
          failed += 1;
          exceptions.push(
            buildRowException({
              code: 'other',
              message: `[verified_sessions] session=${row.sessionId} EVV program requires a pending mobile clock in HHA — no billable approve without linked clock`,
              reportKind: 'verified_sessions',
              rowId: row.sessionId,
              details: {
                patientId,
                visitDate: visitInput.visitDate,
                caregiverId: visitInput.caregiverId,
                legacySoapFallback: true,
                ...party,
              },
            }),
          );
          continue;
        }

        step = 'locateOrScheduleVisit';
        visit = await hha.locateOrScheduleVisit({
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
              message: `[verified_sessions] session=${row.sessionId} visit=${visit.id} time off: API Report ${row.startTime ?? '?'}–${row.endTime ?? '?'} vs HHA clock ${clocking.clockIn ?? '?'}–${clocking.clockOut ?? '?'}`,
              reportKind: 'verified_sessions',
              rowId: row.sessionId,
              details: {
                visitId: visit.id,
                expectedStart: row.startTime,
                expectedEnd: row.endTime,
                clockIn: clocking.clockIn,
                clockOut: clocking.clockOut,
                notes: clocking.notes,
                ...party,
              },
            }),
          );
          continue;
        }
      }

      step = 'approveVisit';
      await hha.approveVisit(visit.id);

      await store.markProcessed(pk, sk, { triage: decision.triage, runId });
      succeeded += 1;
      successes.push({ rowId: row.sessionId, ...party });
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
            ...party,
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
    successes: successes.length ? successes : undefined,
    ...(exceptions.some((ex) => ex.details?.timedOut === true) ? { timedOut: true as const } : {}),
  };
}
