import type { HhaClient } from '@white-glove/hha-client';
import { isAlreadyDischargedError, isTrustedHhaPatientId } from '@white-glove/hha-client';
import type { PipelineException, ProcessorResult, ProcessorSuccessRow } from '@white-glove/shared';
import { buildHhaRowException, buildRowException, partyDetailsFromRow } from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { billingGuardMessage, validateDischargeServiceBilling } from './billing-guards.js';
import { isEarlyInterventionCase } from './rules.js';
import { consumeTimeBudgetStop } from './time-budget.js';

export interface DischargeServiceRow {
  caseId: string;
  patientExternalId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  programType?: string;
  serviceCode?: string;
  startDate?: string;
  endDate?: string;
  dischargeDate?: string;
  isEarlyIntervention?: boolean;
}

function dischargeRowId(row: DischargeServiceRow): string {
  const service = row.serviceCode?.trim() || 'unknown-service';
  const start = row.startDate?.trim() || 'unknown-start';
  return `discharge:${row.caseId}#${service}#${start}`;
}

export async function processDischargeService(options: {
  runId: string;
  rows: DischargeServiceRow[];
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
          message: '[discharge_service] row missing caseId',
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
          message: `[discharge_service] row=${row.caseId} skipped: Early Intervention not sent to HHA`,
          reportKind: 'closed_cases',
          rowId: row.caseId,
          details: { triageReason: 'early_intervention', ...party },
        }),
      );
      continue;
    }

    const { pk, sk } = rowKey('closed_cases', dischargeRowId(row));
    if (!dryRun && (await store.alreadyProcessed(pk, sk))) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      const billingMissing = validateDischargeServiceBilling(row);
      if (billingMissing.length) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code: 'missing_field',
            message: billingGuardMessage('discharge_service', row.caseId, billingMissing),
            reportKind: 'closed_cases',
            rowId: row.caseId,
            details: { missing: billingMissing, preview: true, ...party },
          }),
        );
        continue;
      }
      succeeded += 1;
      successes.push({ rowId: row.caseId, ...party });
      continue;
    }

    const billingMissing = validateDischargeServiceBilling(row);
    if (billingMissing.length) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'missing_field',
          message: billingGuardMessage('discharge_service', row.caseId, billingMissing),
          reportKind: 'closed_cases',
          rowId: row.caseId,
          details: { missing: billingMissing, ...party },
        }),
      );
      continue;
    }

    const step = 'dischargeService';
    try {
      await hha.dischargeService({
        caseId: row.caseId,
        // Never pass Program Id as HHA PatientID (ErrorID=-56).
        patientId: isTrustedHhaPatientId(row.patientExternalId, row.caseId)
          ? row.patientExternalId
          : undefined,
        firstName: row.firstName,
        lastName: row.lastName,
        dateOfBirth: row.dateOfBirth,
        serviceCode: row.serviceCode,
        startDate: row.startDate,
        programType: row.programType,
        dischargeDate: row.dischargeDate ?? row.endDate,
        closedReason: `Service discharge: ${row.serviceCode ?? 'unknown'}`,
      });
      await store.markProcessed(pk, sk, { caseId: row.caseId, runId });
      succeeded += 1;
      successes.push({ rowId: row.caseId, ...party });
    } catch (err) {
      // Second service row after first success (e.g. Milez Hall duplicate SLP HC EVAL):
      // no active placements left — treat as already discharged, not a hard fail.
      if (isAlreadyDischargedError(err)) {
        skipped += 1;
        if (!dryRun) {
          await store.markProcessed(pk, sk, { caseId: row.caseId, runId, alreadyDischarged: true });
        }
        exceptions.push(
          buildRowException({
            code: 'skipped_by_rule',
            message: `[discharge_service] row=${row.caseId} skipped: already discharged / no active HHA placements`,
            reportKind: 'closed_cases',
            rowId: row.caseId,
            details: {
              triageReason: 'already_discharged',
              serviceCode: row.serviceCode,
              startDate: row.startDate,
              dischargeDate: row.dischargeDate,
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
            serviceCode: row.serviceCode,
            startDate: row.startDate,
            dischargeDate: row.dischargeDate,
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
