import type { Handler } from 'aws-lambda';
import { applyHhaSecretFromArn, createHhaClient } from '@white-glove/hha-client';
import type { ClosedCaseRow, ParseResult, ProcessorResult } from '@white-glove/shared';
import { getEnv } from '@white-glove/shared';
import { createIdempotencyStore } from '../idempotency.js';
import { processClosedCases } from '../process-closed.js';
import { processDischargeService, type DischargeServiceRow } from '../process-discharge.js';
import { getObjectText } from '../s3.js';

export interface ClosedEvent {
  parse: ParseResult;
  bucket?: string;
  dryRun?: boolean;
}

export const handler: Handler<ClosedEvent, ProcessorResult> = async (event) => {
  const env = await applyHhaSecretFromArn(getEnv());
  const bucket = event.bucket || env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET required');

  const text = await getObjectText(bucket, event.parse.artifactKeys.closed_cases);
  const rows = JSON.parse(text) as ClosedCaseRow[];

  const closedResult = await processClosedCases({
    runId: event.parse.runId,
    rows,
    hha: createHhaClient(env),
    store: createIdempotencyStore(env.IDEMPOTENCY_TABLE),
    dryRun: event.dryRun ?? env.DRY_RUN,
  });

  if (!event.parse.artifactKeys.discharge_service) {
    return closedResult;
  }

  const dischargeText = await getObjectText(bucket, event.parse.artifactKeys.discharge_service);
  const dischargeRows = JSON.parse(dischargeText) as DischargeServiceRow[];
  const dischargeResult = await processDischargeService({
    runId: event.parse.runId,
    rows: dischargeRows,
    hha: createHhaClient(env),
    store: createIdempotencyStore(env.IDEMPOTENCY_TABLE),
    dryRun: event.dryRun ?? env.DRY_RUN,
  });

  return {
    runId: event.parse.runId,
    reportKind: 'closed_cases',
    processed: closedResult.processed + dischargeResult.processed,
    succeeded: closedResult.succeeded + dischargeResult.succeeded,
    skipped: closedResult.skipped + dischargeResult.skipped,
    failed: closedResult.failed + dischargeResult.failed,
    exceptions: [...closedResult.exceptions, ...dischargeResult.exceptions],
  };
};
