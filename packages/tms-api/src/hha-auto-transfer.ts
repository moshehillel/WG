import type { HhaClient } from '@white-glove/hha-client';
import { weekHhaRollup, type MemoryStore, type WeeklyPeriod } from '@white-glove/tms-db';
import { transferLockedWeek } from './hha-transfer.js';

export type HhaAutoTransferWeekResult = {
  weekId: string;
  weekStart: string;
  providerId: string;
  ok: boolean;
  transferred: number;
  errors: string[];
  skippedReason?: string;
};

export type HhaAutoTransferResult = {
  selected: number;
  attempted: number;
  okWeeks: number;
  failedWeeks: number;
  transferredSessions: number;
  skipped: boolean;
  skippedReason?: string;
  weeks: HhaAutoTransferWeekResult[];
};

/**
 * Locked/signed weeks that still need HHA: eligible attended/makeup sessions exist
 * and not every eligible session is confirmed yet (covers none / pending / failed / partial).
 * Fully confirmed weeks are skipped (transferLockedWeek would no-op them anyway).
 */
export function weeksNeedingHhaTransfer(store: MemoryStore): WeeklyPeriod[] {
  return store.data.weeks
    .filter((w) => w.status === 'locked' || w.status === 'signed')
    .filter((w) => {
      const rollup = weekHhaRollup(store, w.id);
      if (rollup.eligible <= 0) return false;
      return rollup.status !== 'confirmed';
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.id.localeCompare(b.id));
}

/**
 * Wednesday-morning payroll job: same path as admin POST /weeks/:id/hha.
 * Idempotent — re-send re-asserts Auth + ConfirmVisits (TimesheetApproved=Yes) on existing visits.
 */
export async function runHhaAutoTransfer(
  store: MemoryStore,
  hha: HhaClient,
  options?: {
    actorId?: string;
    /** Persist after each week so a timeout mid-batch does not lose progress. */
    afterWeek?: () => Promise<void>;
  },
): Promise<HhaAutoTransferResult> {
  const disabled =
    process.env.TMS_HHA_AUTO_TRANSFER === '0' ||
    process.env.TMS_HHA_AUTO_TRANSFER === 'false';
  if (disabled) {
    return {
      selected: 0,
      attempted: 0,
      okWeeks: 0,
      failedWeeks: 0,
      transferredSessions: 0,
      skipped: true,
      skippedReason: 'disabled',
      weeks: [],
    };
  }

  const actorId = options?.actorId || 'hha-auto-transfer';
  const selected = weeksNeedingHhaTransfer(store);
  const weeks: HhaAutoTransferWeekResult[] = [];
  let okWeeks = 0;
  let failedWeeks = 0;
  let transferredSessions = 0;

  for (const week of selected) {
    // Re-read — prior iterations may have updated the in-memory week row.
    const live = store.data.weeks.find((w) => w.id === week.id) || week;
    const result = await transferLockedWeek({
      store,
      week: live,
      hha,
      actorId,
    });
    weeks.push({
      weekId: week.id,
      weekStart: week.weekStart,
      providerId: week.providerId,
      ok: result.ok,
      transferred: result.transferred,
      errors: result.errors,
    });
    if (result.ok) okWeeks += 1;
    else failedWeeks += 1;
    transferredSessions += result.transferred;
    if (options?.afterWeek) await options.afterWeek();
  }

  console.info('[tms-hha] auto-transfer done', {
    selected: selected.length,
    okWeeks,
    failedWeeks,
    transferredSessions,
  });

  return {
    selected: selected.length,
    attempted: weeks.length,
    okWeeks,
    failedWeeks,
    transferredSessions,
    skipped: false,
    weeks,
  };
}
