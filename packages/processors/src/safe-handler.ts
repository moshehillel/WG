import type { ProcessorResult, ReportKind } from '@white-glove/shared';
import { buildRowException } from '@white-glove/shared';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const BRANCH_REPORT: Record<'opened' | 'closed' | 'sessions', ReportKind> = {
  opened: 'opened_cases',
  closed: 'closed_cases',
  sessions: 'verified_sessions',
};

/**
 * Prevent one processor branch crash from failing the entire Step Functions parallel step.
 * Returns a structured ProcessorResult so Validate still runs and emails a branch crash alert.
 */
export async function runProcessorBranchSafely(
  branch: keyof typeof BRANCH_REPORT,
  runId: string,
  fn: () => Promise<ProcessorResult>,
): Promise<ProcessorResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      runId,
      reportKind: BRANCH_REPORT[branch],
      processed: 0,
      succeeded: 0,
      skipped: 0,
      failed: 1,
      exceptions: [
        buildRowException({
          code: 'pipeline_step_error',
          message: `[${branch}] processor branch crashed: ${errorMessage(err)}. Other HHA branches may still have completed — check validate summary for partial results.`,
          reportKind: BRANCH_REPORT[branch],
          details: { branch, crashed: true },
        }),
      ],
    };
  }
}
