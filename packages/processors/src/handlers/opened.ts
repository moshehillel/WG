import type { Handler } from 'aws-lambda';
import { applyHhaSecretFromArn, createHhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow, ParseResult, ProcessorResult } from '@white-glove/shared';
import { getEnv } from '@white-glove/shared';
import { createIdempotencyStore } from '../idempotency.js';
import { processOpenedCases } from '../process-opened.js';
import { getObjectText } from '../s3.js';

export interface OpenedEvent {
  parse: ParseResult;
  bucket?: string;
  dryRun?: boolean;
}

export const handler: Handler<OpenedEvent, ProcessorResult> = async (event) => {
  const env = await applyHhaSecretFromArn(getEnv());
  const bucket = event.bucket || env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET required');

  const text = await getObjectText(bucket, event.parse.artifactKeys.opened_cases);
  const rows = JSON.parse(text) as OpenedCaseRow[];

  return processOpenedCases({
    runId: event.parse.runId,
    rows,
    hha: createHhaClient(env),
    store: createIdempotencyStore(env.IDEMPOTENCY_TABLE),
    dryRun: event.dryRun ?? env.DRY_RUN,
  });
};

