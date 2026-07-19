import type { HhaClient } from '@white-glove/hha-client';
import type { ClosedCaseRow, PipelineException, ProcessorResult } from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { isEarlyInterventionCase } from './rules.js';

export async function processClosedCases(options: {
  runId: string;
  rows: ClosedCaseRow[];
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
      exceptions.push({
        code: 'parse_error',
        message: 'Closed case missing caseId',
        reportKind: 'closed_cases',
      });
      continue;
    }

    if (isEarlyInterventionCase(row)) {
      skipped += 1;
      exceptions.push({
        code: 'skipped_by_rule',
        message: 'Early Intervention case ignored — not sent to HHA',
        reportKind: 'closed_cases',
        rowId: row.caseId,
      });
      continue;
    }

    const { pk, sk } = rowKey('closed_cases', row.caseId);
    if (await store.alreadyProcessed(pk, `${runId}#${sk}`)) {
      skipped += 1;
      continue;
    }

    try {
      if (!dryRun) {
        await hha.updateClosedCase({
          caseId: row.caseId,
          patientId: row.patientExternalId,
          status: row.status ?? 'Closed',
          closedDate: row.closedDate,
          closedReason: row.closedReason,
        });
      }
      await store.markProcessed(pk, `${runId}#${sk}`, { caseId: row.caseId });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      exceptions.push({
        code: 'hha_api_error',
        message: err instanceof Error ? err.message : String(err),
        reportKind: 'closed_cases',
        rowId: row.caseId,
      });
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
