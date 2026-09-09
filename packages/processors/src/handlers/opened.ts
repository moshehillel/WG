import type { Handler } from 'aws-lambda';
import { applyHhaSecretFromArn, applySandboxHhaReads, applySandboxHhaWrites, createHhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow, ParseResult, ProcessorResult } from '@white-glove/shared';
import { getEnv, processorBranchResultKey } from '@white-glove/shared';
import { createIdempotencyStore } from '../idempotency.js';
import { createReferenceMappingStore } from '../reference-mapping.js';
import { createServiceMappingStore } from '../service-mapping.js';
import { processOpenedCases } from '../process-opened.js';
import { runProcessorBranchSafely } from '../safe-handler.js';
import { getObjectText, putJson } from '../s3.js';
import { resultStoppedForTimeBudget, shouldYieldFromLambdaContext, withTimedOutFlag } from '../time-budget.js';

export interface OpenedEvent {
  parse: ParseResult;
  bucket?: string;
  dryRun?: boolean;
  sandboxLiveFixtures?: boolean;
}

export const handler: Handler<OpenedEvent, ProcessorResult> = async (event, context) => {
  const env = await applyHhaSecretFromArn(getEnv());
  if (event.sandboxLiveFixtures && !event.dryRun) applySandboxHhaWrites();
  else if (event.dryRun) applySandboxHhaReads();
  const bucket = event.bucket || env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET required');
  const shouldYield = shouldYieldFromLambdaContext(context);

  return runProcessorBranchSafely('opened', event.parse.runId, async () => {
    // Gluck open MUST complete before new_services in this same Lambda.
    // New intakes create the HHA patient first; same-run new_services rows then
    // findPatient by caseId/MR. Step Functions Parallel only splits opened vs
    // closed vs sessions — not Gluck vs new_services.
    const text = await getObjectText(bucket, event.parse.artifactKeys.opened_cases);
    const gluckRows = (JSON.parse(text) as OpenedCaseRow[]).map((r) => ({
      ...r,
      sourceReport: 'opened_cases' as const,
    }));

    const hha = createHhaClient(env, {
      referenceCache: createReferenceMappingStore(env.IDEMPOTENCY_TABLE),
    });
    const store = createIdempotencyStore(env.IDEMPOTENCY_TABLE);
    const mappingStore = createServiceMappingStore(env.IDEMPOTENCY_TABLE);
    const dryRun = event.dryRun ?? env.DRY_RUN;

    const gluckResult = await processOpenedCases({
      runId: event.parse.runId,
      rows: gluckRows,
      hha,
      store,
      mappingStore,
      dryRun,
      reportKind: 'opened_cases',
      shouldYield,
    });
    await putJson(bucket, processorBranchResultKey(event.parse.runId, 'opened'), gluckResult);

    if (!event.parse.artifactKeys.new_services || resultStoppedForTimeBudget(gluckResult)) {
      return withTimedOutFlag(gluckResult);
    }

    const newServicesText = await getObjectText(bucket, event.parse.artifactKeys.new_services);
    const newServicesRows = (JSON.parse(newServicesText) as OpenedCaseRow[]).map((r) => ({
      ...r,
      sourceReport: 'new_services' as const,
    }));
    const newServicesResult = await processOpenedCases({
      runId: event.parse.runId,
      rows: newServicesRows,
      hha,
      store,
      mappingStore,
      dryRun,
      reportKind: 'new_services',
      shouldYield,
    });
    await putJson(
      bucket,
      processorBranchResultKey(event.parse.runId, 'new_services'),
      newServicesResult,
    );

    return withTimedOutFlag({
      runId: event.parse.runId,
      reportKind: 'opened_cases',
      processed: gluckResult.processed + newServicesResult.processed,
      succeeded: gluckResult.succeeded + newServicesResult.succeeded,
      skipped: gluckResult.skipped + newServicesResult.skipped,
      failed: gluckResult.failed + newServicesResult.failed,
      exceptions: [...gluckResult.exceptions, ...newServicesResult.exceptions],
      successes:
        gluckResult.successes?.length || newServicesResult.successes?.length
          ? [...(gluckResult.successes ?? []), ...(newServicesResult.successes ?? [])]
          : undefined,
    });
  });
};
