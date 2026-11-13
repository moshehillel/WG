import type { ProcessorResult } from '@white-glove/shared';

/** Monday preview is a sessions read. Case branches must not call HHA on a dry run. */
export function emptyCaseBranchResult(
  runId: string,
  reportKind: 'opened_cases' | 'closed_cases',
): ProcessorResult {
  return {
    runId,
    reportKind,
    processed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    exceptions: [],
  };
}
