import type { Handler } from 'aws-lambda';
import type { ProcessorResult, ValidateResult } from '@white-glove/shared';
import { getEnv } from '@white-glove/shared';
import { validateAndNotify } from '../validate.js';

export interface ValidateEvent {
  runId: string;
  bucket?: string;
  opened?: ProcessorResult;
  closed?: ProcessorResult;
  sessions?: ProcessorResult;
}

export const handler: Handler<ValidateEvent, ValidateResult> = async (event) => {
  const env = getEnv();
  const bucket = event.bucket || env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET required');

  return validateAndNotify({
    runId: event.runId,
    bucket,
    opened: event.opened,
    closed: event.closed,
    sessions: event.sessions,
    topicArn: env.EXCEPTION_TOPIC_ARN,
  });
};
