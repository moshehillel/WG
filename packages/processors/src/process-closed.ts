import type { HhaClient } from '@white-glove/hha-client';
import { isAlreadyDischargedError, isTrustedHhaPatientId } from '@white-glove/hha-client';
import type { ClosedCaseRow, PipelineException, ProcessorResult, ProcessorSuccessRow } from '@white-glove/shared';
import { buildHhaRowException, buildRowException, partyDetailsFromRow } from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { billingGuardMessage, validateClosedCaseBilling } from './billing-guards.js';
import { isEarlyInterventionCase } from './rules.js';
import { consumeTimeBudgetStop } from './time-budget.js';

export async function processClosedCases(options: {
  runId: string;
  rows: ClosedCaseRow[];
  hha: HhaClient;
  store: IdempotencyStore;
  dryRun?: boolean;
  shouldYield?: () => boolean;
}): Promise<ProcessorResult> {
  const { runId, hha, store, dryRun, shouldYield } = options;
  const exceptions: PipelineException[] = [];
  const successes: ProcessorSuccessRow[] = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < options.rows.length; i++) {
    const budget = consumeTimeBudgetStop(
      shouldYield,
      options.rows.length - i,
      i,
      'closed_cases',
      exceptions,
    );
    if (budget.stop) {
      failed += budget.extraFailed;
      break;
    }
    const row = options.rows[i]!;
    const party = partyDetailsFromRow(row);
    if (!row.caseId) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'missing_field',
          message:
            '[closed_cases] row=(unknown) missing caseId — cannot match ProviderSoft case to HHA patient',
          reportKind: 'closed_cases',
          details: party,
        }),
      );
      continue;
    }

    if (isEarlyInterventionCase(row)) {
      skipped += 1;
      exceptions.push(
        buildRowException({
          code: 'skipped_by_rule',
          message: `[closed_cases] row=${row.caseId} skipped: Early Intervention case not sent to HHA`,
          reportKind: 'closed_cases',
          rowId: row.caseId,
          details: { triageReason: 'early_intervention', ...party },
        }),
      );
      continue;
    }

    const billingMissing = validateClosedCaseBilling(row);
    if (billingMissing.length) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'missing_field',
          message: billingGuardMessage('closed_cases', row.caseId, billingMissing),
          reportKind: 'closed_cases',
          rowId: row.caseId,
          details: { missing: billingMissing, ...party, ...(dryRun ? { preview: true } : {}) },
        }),
      );
      continue;
    }

    const { pk, sk } = rowKey('closed_cases', row.caseId);
    if (!dryRun && (await store.alreadyProcessed(pk, sk))) {
      skipped += 1;
      continue;
    }

    const step = 'updateClosedCase';
    try {
      if (!dryRun) {
        await hha.updateClosedCase({
          caseId: row.caseId,
          patientId: isTrustedHhaPatientId(row.patientExternalId, row.caseId)
            ? row.patientExternalId
            : undefined,
          firstName: row.firstName,
          lastName: row.lastName,
          dateOfBirth: row.dateOfBirth,
          status: row.status ?? 'Closed',
          closedDate: row.closedDate,
          closedReason: row.closedReason,
        });
      }
      if (!dryRun) {
        await store.markProcessed(pk, sk, { caseId: row.caseId, runId });
      }
      succeeded += 1;
      successes.push({ rowId: row.caseId, ...party });
    } catch (err) {
      if (isAlreadyDischargedError(err)) {
        skipped += 1;
        if (!dryRun) {
          await store.markProcessed(pk, sk, { caseId: row.caseId, runId, alreadyDischarged: true });
        }
        exceptions.push(
          buildRowException({
            code: 'skipped_by_rule',
            message: `[closed_cases] row=${row.caseId} skipped: already discharged / no active HHA placements`,
            reportKind: 'closed_cases',
            rowId: row.caseId,
            details: {
              triageReason: 'already_discharged',
              closedDate: row.closedDate,
              ...party,
            },
          }),
        );
        continue;
      }
      failed += 1;
      exceptions.push(
        buildHhaRowException({
          reportKind: 'closed_cases',
          rowId: row.caseId,
          step,
          err,
          extraDetails: {
            patientExternalId: row.patientExternalId,
            closedDate: row.closedDate,
            closedReason: row.closedReason,
            ...party,
          },
        }),
      );
    }
  }

  return {
    runId,
    reportKind: 'closed_cases',
    processed: options.rows.length,
    succeeded,
    skipped,
    failed,
    exceptions,
    successes: successes.length ? successes : undefined,
    ...(exceptions.some((ex) => ex.details?.timedOut === true) ? { timedOut: true as const } : {}),
  };
}
