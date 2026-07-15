import type { HhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow, PipelineException, ProcessorResult } from '@white-glove/shared';
import { lookupServiceCode } from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { filterOpenedCases } from './rules.js';

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
    message: 'Early Intervention case ignored',
    reportKind: 'opened_cases',
    rowId: row.caseId,
  }));

  let succeeded = 0;
  let skipped = skippedEi.length;
  let failed = 0;

  for (const row of kept) {
    if (!row.caseId || !row.firstName || !row.lastName) {
      failed += 1;
      exceptions.push({
        code: 'parse_error',
        message: 'Opened case missing required identity fields',
        reportKind: 'opened_cases',
        rowId: row.caseId || undefined,
        details: { firstName: row.firstName, lastName: row.lastName },
      });
      continue;
    }

    const { pk, sk } = rowKey('opened_cases', row.caseId);
    if (await store.alreadyProcessed(pk, `${runId}#${sk}`)) {
      skipped += 1;
      continue;
    }

    if (row.serviceCode && !lookupServiceCode(row.serviceCode)) {
      exceptions.push({
        code: 'unknown_service_code',
        message: `Unknown service code ${row.serviceCode}`,
        reportKind: 'opened_cases',
        rowId: row.caseId,
      });
    }

    if (!row.serviceCode) {
      exceptions.push({
        code: 'missing_service_code',
        message: 'Opened case has no service code',
        reportKind: 'opened_cases',
        rowId: row.caseId,
      });
    }

    try {
      if (!dryRun) {
        const patient = await hha.upsertPatient({
          externalId: row.patientExternalId,
          caseId: row.caseId,
          firstName: row.firstName,
          lastName: row.lastName,
          dateOfBirth: row.dateOfBirth,
        });
        await hha.upsertContract({
          patientId: patient.id,
          contractExternalId: row.contractId,
          serviceCode: row.serviceCode,
          startDate: row.startDate,
          endDate: row.endDate,
        });
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
      exceptions.push({
        code: 'hha_api_error',
        message: err instanceof Error ? err.message : String(err),
        reportKind: 'opened_cases',
        rowId: row.caseId,
      });
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
