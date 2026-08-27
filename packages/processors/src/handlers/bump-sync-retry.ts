import type { Handler } from 'aws-lambda';

/**
 * After a timed-out HHA sync pass, bump the retry counter and drop prior branch
 * results so SyncToHha can re-run. Idempotency skips rows already written.
 */
export const handler: Handler<Record<string, unknown>, Record<string, unknown>> = async (event) => {
  const { results: _results, validation: _validation, error: _error, ...rest } = event;
  return {
    ...rest,
    syncRetryCount: Number(event.syncRetryCount ?? 0) + 1,
  };
};
