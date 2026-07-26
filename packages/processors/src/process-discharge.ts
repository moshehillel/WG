import type { HhaClient } from '@white-glove/hha-client';
import type { PipelineException, ProcessorResult } from '@white-glove/shared';
import { buildHhaRowException, buildRowException } from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { billingGuardMessage, validateDischargeServiceBilling } from './billing-guards.js';
import { isEarlyInterventionCase } from './rules.js';

export interface DischargeServiceRow {
  caseId: string;
  patientExternalId?: string;
  firstName?: string;
  lastName?: string;
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
}): Promise<ProcessorResult> {
  const { runId, hha, store, dryRun } = options;
  const exceptions: PipelineException[] = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of options.rows) {
    if (!row.caseId) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'parse_error',
          message: '[discharge_service] row missing caseId',
          reportKind: 'closed_cases',
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
        }),
      );
      continue;
    }

    const { pk, sk } = rowKey('closed_cases', dischargeRowId(row));
    if (!dryRun && (await store.alreadyProcessed(pk, `${runId}#${sk}`))) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      const billingMissing = validateDischargeServiceBilling(row);
      if (billingMissing.length) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code: 'parse_error',
            message: billingGuardMessage('discharge_service', row.caseId, billingMissing),
            reportKind: 'closed_cases',
            rowId: row.caseId,
            details: { missing: billingMissing },
          }),
        );
        continue;
      }
      succeeded += 1;
      continue;
    }

    const billingMissing = validateDischargeServiceBilling(row);
    if (billingMissing.length) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'parse_error',
          message: billingGuardMessage('discharge_service', row.caseId, billingMissing),
          reportKind: 'closed_cases',
          rowId: row.caseId,
          details: { missing: billingMissing },
        }),
      );
      continue;
    }

    const step = 'dischargeService';
    try {
      await hha.dischargeService({
        caseId: row.caseId,
        patientId: row.patientExternalId,
        serviceCode: row.serviceCode,
        startDate: row.startDate,
        programType: row.programType,
        dischargeDate: row.dischargeDate ?? row.endDate,
        closedReason: `Service discharge: ${row.serviceCode ?? 'unknown'}`,
      });
      await store.markProcessed(pk, `${runId}#${sk}`, { caseId: row.caseId });
      succeeded += 1;
    } catch (err) {
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
  };
}
