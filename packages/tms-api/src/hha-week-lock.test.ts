import { describe, expect, it } from 'vitest';
import { InMemoryTmsDocStore } from './dynamo-state.js';
import { acquireHhaWeekLock } from './hha-week-lock.js';

describe('acquireHhaWeekLock', () => {
  it('lets the first caller through and blocks a second until release', async () => {
    const doc = new InMemoryTmsDocStore();
    const weekId = `week-lock-${Date.now()}`;
    const first = await acquireHhaWeekLock(weekId, doc);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await acquireHhaWeekLock(weekId, doc);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already running/i);
    await first.release();
    const third = await acquireHhaWeekLock(weekId, doc);
    expect(third.ok).toBe(true);
    if (third.ok) await third.release();
  });
});
