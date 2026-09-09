import type { Handler } from 'aws-lambda';
import { applyHhaSecretFromArn, createHhaClient } from '@white-glove/hha-client';
import type { ClosedCaseRow, ParseResult, ProcessorResult } from '@white-glove/shared';
import { getEnv, processorBranchResultKey } from '@white-glove/shared';
import { createIdempotencyStore } from '../idempotency.js';
import { createReferenceMappingStore } from '../reference-mapping.js';
import { processClosedCases } from '../process-closed.js';
import { processDischargeService, type DischargeServiceRow } from '../process-discharge.js';
import { runProcessorBranchSafely } from '../safe-handler.js';
import { getObjectText, putJson } from '../s3.js';

export interface ClosedEvent {
  parse: ParseResult;
  bucket?: string;
  dryRun?: boolean;
}

/**
 * Gluck closure + discharge service run in one Lambda (same Pattern as OpenedFn
 * for Gluck open + new_services). Results are written to separate S3 branch keys
 * so Validate/email/CSV label them independently — SFN return is closed-only.
 */
export const handler: Handler<ClosedEvent, ProcessorResult> = async (event) => {
  const env = await applyHhaSecretFromArn(getEnv());
  const bucket = event.bucket || env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET required');

  return runProcessorBranchSafely('closed', event.parse.runId, async () => {
    const text = await getObjectText(bucket, event.parse.artifactKeys.closed_cases);
    const rows = JSON.parse(text) as ClosedCaseRow[];

    const hha = createHhaClient(env, {
      referenceCache: createReferenceMappingStore(env.IDEMPOTENCY_TABLE),
    });
    const store = createIdempotencyStore(env.IDEMPOTENCY_TABLE);
    const dryRun = event.dryRun ?? env.DRY_RUN;

    const closedResult = await processClosedCases({
      runId: event.parse.runId,
      rows,
      hha,
      store,
      dryRun,
    });
    await putJson(bucket, processorBranchResultKey(event.parse.runId, 'closed'), closedResult);

    if (!event.parse.artifactKeys.discharge_service) {
      return closedResult;
    }

    const dischargeText = await getObjectText(bucket, event.parse.artifactKeys.discharge_service);
    const dischargeRows = JSON.parse(dischargeText) as DischargeServiceRow[];
    const dischargeResult = await processDischargeService({
      runId: event.parse.runId,
      rows: dischargeRows,
      hha,
      store,
      dryRun,
    });
    await putJson(
      bucket,
      processorBranchResultKey(event.parse.runId, 'discharge'),
      dischargeResult,
    );

    // Do not merge into closed_cases — Validate loads discharge from S3 separately.
    return closedResult;
  });
};
