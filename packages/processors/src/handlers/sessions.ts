import type { Handler } from 'aws-lambda';
import {
  applyHhaSecretFromArn,
  createHhaClient,
  type SoapHhaClientAdapter,
} from '@white-glove/hha-client';
import type { ParseResult, ProcessorResult, VerifiedSessionRow } from '@white-glove/shared';
import {
  buildCaregiverCodeMap,
  getEnv,
  processorBranchResultKey,
  unscheduledServicesKey,
} from '@white-glove/shared';
import { compactProcessorResultForSfn } from '../compact-processor-result.js';
import { createIdempotencyStore } from '../idempotency.js';
import { fetchUnscheduledForSessions } from '../fetch-unscheduled-for-sessions.js';
import { createReferenceMappingStore } from '../reference-mapping.js';
import { processVerifiedSessions } from '../process-sessions.js';
import { runProcessorBranchSafely } from '../safe-handler.js';
import { getObjectText, putJson } from '../s3.js';

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

  return runProcessorBranchSafely('sessions', event.parse.runId, async () => {
    // Case-only nightly runs omit verified_sessions from reportKinds; Parse leaves
    // artifactKeys.verified_sessions undefined. SFN still invokes this branch in
    // parallel — return empty success instead of S3 GetObject with Key=undefined
    // ("No value provided for input HTTP label: Key").
    const sessionsKey = event.parse.artifactKeys.verified_sessions;
    if (!sessionsKey) {
      return {
        runId: event.parse.runId,
        reportKind: 'verified_sessions' as const,
        processed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        exceptions: [],
      };
    }

    const text = await getObjectText(bucket, sessionsKey);
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

    const hha = createHhaClient(env, {
      referenceCache: createReferenceMappingStore(env.IDEMPOTENCY_TABLE),
    });
    const unscheduled = await fetchUnscheduledForSessions(rows);
    console.log(
      `[sessions] getUnscheduledServices run=${event.parse.runId} rows=${unscheduled.rows.length} from=${unscheduled.fromDate} to=${unscheduled.toDate} skipped=${unscheduled.skipped}`,
    );
    await putJson(bucket, unscheduledServicesKey(event.parse.runId), {
      total: unscheduled.rows.length,
      rows: unscheduled.rows,
      fromDate: unscheduled.fromDate,
      toDate: unscheduled.toDate,
      skipped: unscheduled.skipped,
      skipReason: unscheduled.skipReason,
    });
    const soap = hha as SoapHhaClientAdapter;
    const entUnscheduled =
      unscheduled.spaToken && typeof soap.getSoap === 'function'
        ? { spaToken: unscheduled.spaToken, soap }
        : undefined;

    const result = await processVerifiedSessions({
      runId: event.parse.runId,
      rows,
      hha,
      store: createIdempotencyStore(env.IDEMPOTENCY_TABLE),
      dryRun: event.dryRun ?? env.DRY_RUN,
      caregiverMap,
      unscheduledRows: unscheduled.rows,
      unscheduledFetchActive: !unscheduled.skipped,
      entUnscheduled,
    });
    await putJson(bucket, processorBranchResultKey(event.parse.runId, 'sessions'), result);
    return compactProcessorResultForSfn(result, 0);
  });
};
