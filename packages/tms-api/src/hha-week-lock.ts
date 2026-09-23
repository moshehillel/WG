import { getTmsDocStore, type TmsDocStore } from './dynamo-state.js';

/** Longer than TmsApiFn's 10-minute timeout so a live transfer is not treated as stale. */
const STALE_MS = 12 * 60 * 1000;
const LOCK_PK = 'HHA_WEEK_LOCK';

export const HHA_WEEK_LOCK_BUSY =
  'HHA transfer for this week is already running. Wait until it finishes.';

const localLocks = new Set<string>();

function lockSk(weekId: string): string {
  return `ID#${weekId}`;
}

/**
 * One transfer per week across overlapping requests (double-click, two tabs).
 * In-process set covers the same Lambda container. Dynamo conditional put covers
 * two containers that both loaded the snapshot before either row was confirmed.
 */
export async function acquireHhaWeekLock(
  weekId: string,
  docStore?: TmsDocStore,
): Promise<{ ok: true; release: () => Promise<void> } | { ok: false; error: string }> {
  if (localLocks.has(weekId)) {
    return { ok: false, error: HHA_WEEK_LOCK_BUSY };
  }
  localLocks.add(weekId);
  const doc = docStore ?? getTmsDocStore();

  const releaseLocal = () => {
    localLocks.delete(weekId);
  };

  try {
    if (doc) {
      const sk = lockSk(weekId);
      const existing = await doc.get(LOCK_PK, sk);
      const started = existing?.startedAt ? Date.parse(String(existing.startedAt)) : NaN;
      const fresh = Boolean(existing) && Number.isFinite(started) && Date.now() - started < STALE_MS;
      if (fresh) {
        releaseLocal();
        return { ok: false, error: HHA_WEEK_LOCK_BUSY };
      }
      if (existing) {
        await doc.batchWrite([], [{ pk: LOCK_PK, sk }]);
      }
      const claimed = await doc.put(
        {
          pk: LOCK_PK,
          sk,
          weekId,
          startedAt: new Date().toISOString(),
        },
        { condition: 'attribute_not_exists(pk)' },
      );
      if (claimed === 'condition_failed') {
        releaseLocal();
        return { ok: false, error: HHA_WEEK_LOCK_BUSY };
      }
    }
  } catch (err) {
    releaseLocal();
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Could not lock this week's HHA transfer (${message}). Try again.`,
    };
  }

  return {
    ok: true,
    release: async () => {
      releaseLocal();
      if (!doc) return;
      try {
        await doc.batchWrite([], [{ pk: LOCK_PK, sk: lockSk(weekId) }]);
      } catch (err) {
        console.error('[hha-week-lock] release failed', err);
      }
    },
  };
}
