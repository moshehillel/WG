import type { Handler } from 'aws-lambda';
import { PipelineRunInputSchema, type PipelineRunInput } from '@white-glove/shared';

export type MergePipelineInput = PipelineRunInput & { syncRetryCount: number };

/** Supply safe defaults for optional pipeline flags before downstream Choice states run. */
export const handler: Handler<PipelineRunInput & { syncRetryCount?: number }, MergePipelineInput> = async (
  event,
) => {
  const parsed = PipelineRunInputSchema.parse({
    ...event,
    dryRun: event.dryRun ?? false,
    sandbox: event.sandbox ?? false,
    sandboxEmailFixtures: event.sandboxEmailFixtures ?? false,
    sandboxLiveFixtures: event.sandboxLiveFixtures ?? false,
  });
  return {
    ...parsed,
    // Always present so SFN downloadPayload `dateRanges.$` never fails on missing path.
    dateRanges: parsed.dateRanges ?? {},
    syncRetryCount: typeof event.syncRetryCount === 'number' ? event.syncRetryCount : 0,
  };
};
