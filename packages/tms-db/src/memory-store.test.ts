import { describe, expect, it } from 'vitest';
import { emptySnapshot } from './types.js';
import {
  MemoryStore,
  migrateMandateBillingServiceNames,
  migrateMandateGroupSizes,
} from './memory-store.js';

describe('MemoryStore.load', () => {
  it('fills missing arrays so admin notes can be saved', () => {
    const store = new MemoryStore();
    const partial = emptySnapshot() as unknown as Record<string, unknown>;
    delete partial.adminNotes;
    store.load(partial as never);
    expect(Array.isArray(store.data.adminNotes)).toBe(true);
    const note = store.addAdminNote({
      id: 'n1',
      providerId: 'p1',
      authorId: 'a1',
      body: 'office only',
      tags: [],
      createdAt: '2026-09-02T00:00:00.000Z',
    });
    expect(note.body).toBe('office only');
    expect(store.notesForProvider('p1')).toHaveLength(1);
  });

  it('backfills null groupSize for Small Group / ratioGroup mandates to 2', () => {
    const store = new MemoryStore();
    const snap = emptySnapshot();
    snap.mandates = [
      {
        id: 'm-sg',
        studentId: 'st1',
        providerId: 'p1',
        serviceType: 'Physical Therapy',
        discipline: 'PT',
        frequencyPerWeek: 1,
        frequencyKind: 'weekly',
        sessionsPerPeriod: 1,
        ratioGroup: true,
        groupSize: null,
        sourcePdfKey: 'caseload-csv',
        parsedAt: '2026-09-01T00:00:00.000Z',
        startOn: '2026-09-01',
        endOn: '2027-06-30',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'm-svc',
        studentId: 'st2',
        providerId: 'p1',
        serviceType: 'OT Small Group',
        discipline: 'OT',
        frequencyPerWeek: 1,
        frequencyKind: 'weekly',
        sessionsPerPeriod: 1,
        ratioGroup: false,
        groupSize: null,
        sourcePdfKey: 'caseload-csv',
        parsedAt: '2026-09-01T00:00:00.000Z',
        startOn: '2026-09-01',
        endOn: '2027-06-30',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ];
    store.load(snap);
    expect(store.data.mandates.find((m) => m.id === 'm-sg')).toMatchObject({
      ratioGroup: true,
      groupSize: 2,
    });
    expect(store.data.mandates.find((m) => m.id === 'm-svc')).toMatchObject({
      ratioGroup: true,
      groupSize: 2,
    });
    expect(
      migrateMandateGroupSizes([
        {
          id: 'm-ind',
          studentId: 'st3',
          providerId: 'p1',
          serviceType: 'PT',
          frequencyPerWeek: 1,
          ratioGroup: false,
          groupSize: null,
          sourcePdfKey: 'x',
          parsedAt: 'x',
          createdAt: 'x',
        } as never,
      ])[0].groupSize,
    ).toBe(1);
  });

  it('backfills group mandate billingServiceName from PT school 30 → PT school group 30', () => {
    const store = new MemoryStore();
    const snap = emptySnapshot();
    snap.mandates = [
      {
        id: 'm-grp-wrong',
        studentId: 'st1',
        providerId: 'p1',
        serviceType: 'Physical Therapy',
        discipline: 'PT',
        frequencyPerWeek: 1,
        frequencyKind: 'weekly',
        sessionsPerPeriod: 1,
        ratioGroup: true,
        groupSize: 2,
        durationMinutes: 30,
        billingServiceName: 'PT school 30',
        sourcePdfKey: 'caseload-csv',
        parsedAt: '2026-09-01T00:00:00.000Z',
        startOn: '2026-09-01',
        endOn: '2027-06-30',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'm-ind-ok',
        studentId: 'st2',
        providerId: 'p1',
        serviceType: 'OT',
        discipline: 'OT',
        frequencyPerWeek: 1,
        frequencyKind: 'weekly',
        sessionsPerPeriod: 1,
        ratioGroup: false,
        groupSize: 1,
        durationMinutes: 30,
        billingServiceName: 'OT school 30',
        sourcePdfKey: 'caseload-csv',
        parsedAt: '2026-09-01T00:00:00.000Z',
        startOn: '2026-09-01',
        endOn: '2027-06-30',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ];
    store.load(snap);
    expect(store.data.mandates.find((m) => m.id === 'm-grp-wrong')?.billingServiceName).toBe(
      'PT school group 30',
    );
    expect(store.data.mandates.find((m) => m.id === 'm-ind-ok')?.billingServiceName).toBe(
      'OT school 30',
    );
    expect(
      migrateMandateBillingServiceNames([
        {
          id: 'm',
          studentId: 'st',
          providerId: 'p',
          serviceType: 'OT Small Group',
          discipline: 'OT',
          frequencyPerWeek: 1,
          ratioGroup: true,
          groupSize: 2,
          durationMinutes: 42,
          billingServiceName: 'OT school 42',
          sourcePdfKey: 'x',
          parsedAt: 'x',
          startOn: 'x',
          endOn: 'x',
          createdAt: 'x',
        },
      ])[0].billingServiceName,
    ).toBe('OT school group 42');
  });
});
