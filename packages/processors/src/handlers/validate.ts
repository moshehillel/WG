import type { Handler } from 'aws-lambda';
import type { ParseResult, ProcessorResult } from '@white-glove/shared';
import {
  exceptionsKey,
  getEnv,
  normalizedReferenceKey,
  parseResultKey,
  processorBranchResultKey,
  unscheduledServicesKey,
} from '@white-glove/shared';
import { compactValidateResultForSfn } from '../compact-processor-result.js';
import { getObjectText } from '../s3.js';
import { validateAndNotify } from '../validate.js';

export interface ValidateEvent {
  runId: string;
  bucket?: string;
  dryRun?: boolean;
  sandbox?: boolean;
  sandboxEmailFixtures?: boolean;
  skipAlertEmail?: boolean;
  forceAlertEmail?: boolean;
  /** Read-only: return S3 artifact instead of running validation (for ops scripts). */
  returnArtifact?:
    | 'exceptions'
    | 'sessions'
    | 'verified_sessions'
    | 'new_services'
    | 'unscheduled_services'
    | 'parse_result'
    | 'raw_closed_csv'
    | 'raw_discharge_csv';
  parse?: ParseResult;
  opened?: ProcessorResult;
  closed?: ProcessorResult;
  sessions?: ProcessorResult;
}

export const handler: Handler<ValidateEvent, unknown> = async (event) => {
  const env = getEnv();
  const bucket = event.bucket || env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET required');

  if (event.returnArtifact) {
    if (event.returnArtifact === 'exceptions') {
      return JSON.parse(await getObjectText(bucket, exceptionsKey(event.runId)));
    }
    if (event.returnArtifact === 'sessions') {
      return JSON.parse(
        await getObjectText(bucket, processorBranchResultKey(event.runId, 'sessions')),
      );
    }
    if (event.returnArtifact === 'new_services') {
      return JSON.parse(
        await getObjectText(bucket, normalizedReferenceKey(event.runId, 'new_services')),
      );
    }
    if (event.returnArtifact === 'unscheduled_services') {
      return JSON.parse(await getObjectText(bucket, unscheduledServicesKey(event.runId)));
    }
    if (event.returnArtifact === 'parse_result') {
      return JSON.parse(await getObjectText(bucket, parseResultKey(event.runId)));
    }
    if (
      event.returnArtifact === 'raw_closed_csv' ||
      event.returnArtifact === 'raw_discharge_csv'
    ) {
      const key =
        event.returnArtifact === 'raw_closed_csv'
          ? `runs/${event.runId}/raw/closed-cases.csv`
          : `runs/${event.runId}/raw/discharge-service.csv`;
      const text = await getObjectText(bucket, key);
      const lines = text.split(/\r?\n/);
      const nonEmpty = lines.filter((l) => l.trim().length > 0);
      return {
        key,
        bytes: Buffer.byteLength(text, 'utf8'),
        lineCount: lines.length,
        nonEmptyLineCount: nonEmpty.length,
        preview: text.slice(0, 4000),
        firstNonEmptyLines: nonEmpty.slice(0, 8),
      };
    }
    const parse = JSON.parse(await getObjectText(bucket, parseResultKey(event.runId))) as ParseResult;
    if (!parse.artifactKeys.verified_sessions) {
      throw new Error(
        `runId=${event.runId}: API Report (verified_sessions) was not downloaded — no normalized artifact`,
      );
    }
    return JSON.parse(await getObjectText(bucket, parse.artifactKeys.verified_sessions));
  }

  return compactValidateResultForSfn(
    await validateAndNotify({
      runId: event.runId,
      bucket,
      dryRun: event.dryRun,
      sandbox: event.sandbox,
      sandboxEmailFixtures: event.sandboxEmailFixtures,
      skipAlertEmail: event.skipAlertEmail,
      forceAlertEmail: event.forceAlertEmail,
      opened: event.opened,
      closed: event.closed,
      sessions: event.sessions,
      parse: event.parse,
      topicArn: env.EXCEPTION_TOPIC_ARN,
    }),
  );
};
