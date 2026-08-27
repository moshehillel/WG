import { buildRowException } from '@white-glove/shared';
import type { PipelineException, ProcessorResult } from '@white-glove/shared';

type ReportKind = ProcessorResult['reportKind'];

/** Leave enough time after the last row for S3 writes and Lambda freeze. */
export const LAMBDA_TIME_RESERVE_MS = 90_000;

/**
 * Step Functions `ContinueAfterTimeout` re-runs SyncToHha while `syncRetryCount` is less than this.
 * Total SyncToHha passes = 1 initial + MAX_SYNC_RETRY_COUNT continuations (3 when this is 2).
 */
export const MAX_SYNC_RETRY_COUNT = 2;

export function shouldYieldFromLambdaContext(
  context: { getRemainingTimeInMillis?: () => number } | undefined,
  reserveMs = LAMBDA_TIME_RESERVE_MS,
): (() => boolean) | undefined {
  const remaining = context?.getRemainingTimeInMillis;
  if (typeof remaining !== 'function') return undefined;
  return () => remaining() <= reserveMs;
}

export function timeBudgetException(options: {
  reportKind: ReportKind;
  remainingRows: number;
  completedRows: number;
}): PipelineException {
  const { reportKind, remainingRows, completedRows } = options;
  return buildRowException({
    code: 'pipeline_step_error',
    message: `[${reportKind}] stopped with ${remainingRows} row(s) left so Lambda would not hard-timeout (${completedRows} already handled). Rows already written to HHA were kept. Pipeline may auto-retry remaining rows (idempotent skip of already-synced rows).`,
    reportKind,
    details: { timedOut: true, remainingRows, completedRows },
  });
}

export function resultStoppedForTimeBudget(result: ProcessorResult): boolean {
  return result.timedOut === true || result.exceptions.some((ex) => ex.details?.timedOut === true);
}

/** Stamp top-level timedOut so Step Functions can Choice without scanning exceptions. */
export function withTimedOutFlag(result: ProcessorResult): ProcessorResult {
  if (resultStoppedForTimeBudget(result)) {
    return { ...result, timedOut: true };
  }
  return result;
}

/**
 * Validate runs only after SyncToHha retries are exhausted (or no timeout).
 * Rewrite soft/hard timeout exceptions so the alert clearly flags a terminal failure.
 */
export function flagExhaustedSyncTimeouts(result: ProcessorResult): ProcessorResult {
  if (!resultStoppedForTimeBudget(result)) return result;

  let sawTimeout = false;
  const exceptions = result.exceptions.map((ex) => {
    if (ex.details?.timedOut !== true) return ex;
    sawTimeout = true;
    const remaining =
      typeof ex.details.remainingRows === 'number' ? ex.details.remainingRows : undefined;
    const remainingText =
      remaining !== undefined ? `${remaining} row(s) still not entered` : 'some rows still not entered';
    return {
      ...ex,
      message: `[${result.reportKind}] HHA sync still incomplete after max auto-retries (${MAX_SYNC_RETRY_COUNT} continuations, ${remainingText}). Already-written rows were kept; remaining rows were not entered. Investigate Lambda duration / batch size, then start another run.`,
      details: {
        ...ex.details,
        timedOut: true,
        retriesExhausted: true,
        maxSyncRetryCount: MAX_SYNC_RETRY_COUNT,
      },
    };
  });

  if (!sawTimeout) {
    exceptions.push(
      buildRowException({
        code: 'pipeline_step_error',
        message: `[${result.reportKind}] HHA sync still incomplete after max auto-retries (${MAX_SYNC_RETRY_COUNT} continuations). Already-written rows were kept; remaining rows were not entered.`,
        reportKind: result.reportKind,
        details: {
          timedOut: true,
          retriesExhausted: true,
          maxSyncRetryCount: MAX_SYNC_RETRY_COUNT,
          branchCrashed: true,
        },
      }),
    );
  }

  return { ...result, timedOut: true, exceptions };
}

/** If the Lambda time reserve is gone, record one summary exception and stop the loop. */
export function consumeTimeBudgetStop(
  shouldYield: (() => boolean) | undefined,
  remainingRows: number,
  completedRows: number,
  reportKind: ReportKind,
  exceptions: PipelineException[],
): { stop: boolean; extraFailed: number } {
  if (!shouldYield?.() || remainingRows <= 0) return { stop: false, extraFailed: 0 };
  exceptions.push(timeBudgetException({ reportKind, remainingRows, completedRows }));
  return { stop: true, extraFailed: remainingRows };
}
