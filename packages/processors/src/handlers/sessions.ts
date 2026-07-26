import type { Handler } from 'aws-lambda';
import { applyHhaSecretFromArn, createHhaClient } from '@white-glove/hha-client';
import type { ParseResult, ProcessorResult, VerifiedSessionRow } from '@white-glove/shared';
import { buildCaregiverCodeMap, getEnv } from '@white-glove/shared';
import { createIdempotencyStore } from '../idempotency.js';
import { processVerifiedSessions } from '../process-sessions.js';
import { getObjectText } from '../s3.js';

export interface SessionsEvent {
  parse: ParseResult;
  bucket?: string;
  dryRun?: boolean;
}

interface CaregiverArtifact {
  entries?: Array<{ providerName: string; caregiverCode: string }>;
  map?: Record<string, string>;
}

export const handler: Handler<SessionsEvent, ProcessorResult> = async (event) => {
  const env = await applyHhaSecretFromArn(getEnv());
  const bucket = event.bucket || env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET required');

  const text = await getObjectText(bucket, event.parse.artifactKeys.verified_sessions);
  const rows = JSON.parse(text) as VerifiedSessionRow[];

  let caregiverMap = new Map<string, string>();
  if (event.parse.artifactKeys.caregiver_codes) {
    const caregiverText = await getObjectText(bucket, event.parse.artifactKeys.caregiver_codes);
    const artifact = JSON.parse(caregiverText) as CaregiverArtifact;
    if (artifact.map) {
      caregiverMap = new Map(Object.entries(artifact.map));
    } else if (artifact.entries?.length) {
      caregiverMap = buildCaregiverCodeMap(artifact.entries);
    }
  }

  return processVerifiedSessions({
    runId: event.parse.runId,
    rows,
    hha: createHhaClient(env),
    store: createIdempotencyStore(env.IDEMPOTENCY_TABLE),
    dryRun: event.dryRun ?? env.DRY_RUN,
    caregiverMap,
  });
};
