import type { ProcessorResult, ValidateResult } from '@white-glove/shared';

/** Step Functions caps task output at 256 KiB — trim exception payloads for SFN handoff. */
export function compactProcessorResultForSfn(
  result: ProcessorResult,
  maxExceptions = 0,
): ProcessorResult {
  if (maxExceptions <= 0) {
    return { ...result, exceptions: [], timedOut: result.timedOut };
  }
  if (result.exceptions.length <= maxExceptions) return result;
  return {
    ...result,
    exceptions: result.exceptions.slice(0, maxExceptions),
    timedOut: result.timedOut,
  };
}

/** Validate writes full artifacts to S3; SFN only needs counts and ok flag. */
export function compactValidateResultForSfn(result: ValidateResult): ValidateResult {
  const strip = (branch?: ProcessorResult): ProcessorResult | undefined =>
    branch ? compactProcessorResultForSfn(branch, 0) : undefined;
  return {
    runId: result.runId,
    ok: result.ok,
    exceptionCount: result.exceptionCount,
    exceptions: [],
    summary: {
      opened: strip(result.summary.opened),
      closed: strip(result.summary.closed),
      sessions: strip(result.summary.sessions),
    },
  };
}
