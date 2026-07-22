import type { HhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow, PipelineException, ProcessorResult } from '@white-glove/shared';
import { buildHhaRowException, buildRowException, lookupServiceCode } from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { filterOpenedCases } from './rules.js';

function missingFieldMessage(reportKind: string, rowId: string | undefined, fields: string[]): string {
  const id = rowId ? `row=${rowId}` : 'row=(unknown)';
  return `[${reportKind}] ${id} missing required field(s): ${fields.join(', ')}`;
}

export async function processOpenedCases(options: {
  runId: string;
  rows: OpenedCaseRow[];
  hha: HhaClient;
  store: IdempotencyStore;
  dryRun?: boolean;
}): Promise<ProcessorResult> {
  const { runId, hha, store, dryRun } = options;
  const { kept, skippedEi } = filterOpenedCases(options.rows);
  const exceptions: PipelineException[] = skippedEi.map((row) => ({
    code: 'skipped_by_rule',
    message: `[opened_cases] row=${row.caseId ?? '(unknown)'} skipped: Early Intervention case not sent to HHA`,
    reportKind: 'opened_cases',
    rowId: row.caseId,
  }));

  let succeeded = 0;
  let skipped = skippedEi.length;
  let failed = 0;

  for (const row of kept) {
    const missing: string[] = [];
    if (!row.caseId) missing.push('caseId');
    if (!row.firstName) missing.push('firstName');
    if (!row.lastName) missing.push('lastName');
    if (missing.length) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'parse_error',
          message: missingFieldMessage('opened_cases', row.caseId, missing),
          reportKind: 'opened_cases',
          rowId: row.caseId || undefined,
          details: { missing, firstName: row.firstName, lastName: row.lastName },
        }),
      );
      continue;
    }

    const { pk, sk } = rowKey('opened_cases', row.caseId);
    if (await store.alreadyProcessed(pk, `${runId}#${sk}`)) {
      skipped += 1;
      continue;
    }

    if (row.serviceCode && !lookupServiceCode(row.serviceCode)) {
      exceptions.push(
        buildRowException({
          code: 'unknown_service_code',
          message: `[opened_cases] row=${row.caseId} unknown service code "${row.serviceCode}" — add mapping in service-codes config`,
          reportKind: 'opened_cases',
          rowId: row.caseId,
          details: { serviceCode: row.serviceCode },
        }),
      );
    }

    if (!row.serviceCode) {
      exceptions.push(
        buildRowException({
          code: 'missing_service_code',
          message: `[opened_cases] row=${row.caseId} has no service code in Gluck open report`,
          reportKind: 'opened_cases',
          rowId: row.caseId,
        }),
      );
    }

    let step = 'upsertPatient';
    try {
      if (!dryRun) {
        const patient = await hha.upsertPatient({
          externalId: row.patientExternalId,
          caseId: row.caseId,
          firstName: row.firstName,
          lastName: row.lastName,
          dateOfBirth: row.dateOfBirth,
        });
        step = 'upsertContract';
        await hha.upsertContract({
          patientId: patient.id,
          contractExternalId: row.contractId,
          serviceCode: row.serviceCode,
          startDate: row.startDate,
          endDate: row.endDate,
        });
        step = 'upsertAuthorization';
        await hha.upsertAuthorization({
          patientId: patient.id,
          authorizationNumber: row.authorizationNumber,
          serviceCode: row.serviceCode,
          startDate: row.startDate,
          endDate: row.endDate,
        });
      }
      await store.markProcessed(pk, `${runId}#${sk}`, { caseId: row.caseId });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      exceptions.push(
        buildHhaRowException({
          reportKind: 'opened_cases',
          rowId: row.caseId,
          step,
          err,
          extraDetails: {
            patientExternalId: row.patientExternalId,
            serviceCode: row.serviceCode,
          },
        }),
      );
    }
  }

  return {
    runId,
    reportKind: 'opened_cases',
    processed: options.rows.length,
    succeeded,
    skipped,
    failed,
    exceptions,
  };
}
