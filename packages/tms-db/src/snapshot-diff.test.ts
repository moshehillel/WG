import { describe, expect, it } from 'vitest';
import {
  assembleSnapshot,
  diffSnapshots,
  entityId,
  snapshotToEntityPuts,
} from './snapshot-diff.js';
import { emptySnapshot, type TmsSnapshot } from './types.js';

function baseSnap(partial: Partial<TmsSnapshot> = {}): TmsSnapshot {
  return { ...emptySnapshot(), ...partial };
}

describe('snapshot-diff', () => {
  it('entityId uses schoolId for calendars', () => {
    expect(entityId('schoolCalendars', { schoolId: 'sch-1', yearStart: '', yearEnd: '', offDays: [] })).toBe(
      'sch-1',
    );
    expect(entityId('sessions', { id: 's1' })).toBe('s1');
  });

  it('diffSnapshots emits puts/deletes for changed entities only', () => {
    const before = baseSnap({
      sessions: [
        {
          id: 'a',
          weekId: 'w1',
          studentId: 'st1',
          dateOfService: '2026-01-01',
          beginTime: '09:00',
          endTime: '09:30',
          attendance: 'attended',
          cancelReason: '',
          makeupOfSessionId: '',
          serviceType: 'PT',
          location: '',
          notes: 'old',
          aiFlags: [],
        },
        {
          id: 'b',
          weekId: 'w1',
          studentId: 'st1',
          dateOfService: '2026-01-02',
          beginTime: '09:00',
          endTime: '09:30',
          attendance: 'attended',
          cancelReason: '',
          makeupOfSessionId: '',
          serviceType: 'PT',
          location: '',
          notes: 'keep',
          aiFlags: [],
        },
      ],
    });
    const after = baseSnap({
      sessions: [
        {
          ...before.sessions[0]!,
          notes: 'new',
        },
        {
          id: 'c',
          weekId: 'w1',
          studentId: 'st1',
          dateOfService: '2026-01-03',
          beginTime: '09:00',
          endTime: '09:30',
          attendance: 'attended',
          cancelReason: '',
          makeupOfSessionId: '',
          serviceType: 'PT',
          location: '',
          notes: 'added',
          aiFlags: [],
        },
      ],
    });
    const diff = diffSnapshots(before, after);
    expect(diff.deletes).toEqual([{ collection: 'sessions', id: 'b' }]);
    expect(diff.puts.map((p) => p.id).sort()).toEqual(['a', 'c']);
    expect(diff.puts.find((p) => p.id === 'a')?.row).toMatchObject({ notes: 'new' });
  });

  it('assembleSnapshot + snapshotToEntityPuts round-trip collections', () => {
    const snap = baseSnap({
      users: [
        {
          id: 'u1',
          cognitoSub: 'sub',
          email: 'a@b.c',
          role: 'admin',
          displayName: 'A',
          providerId: '',
          active: true,
          createdAt: 't',
        },
      ],
      weeks: [
        {
          id: 'w1',
          providerId: 'p1',
          weekStart: '2026-01-05',
          status: 'draft',
          signerName: '',
          signerEmail: '',
          timesheetKey: '',
          signedKey: '',
          envelopeId: '',
          hhaStatus: 'none',
        },
      ],
    });
    const puts = snapshotToEntityPuts(snap);
    // users + weeks + default settings row
    expect(puts.length).toBeGreaterThanOrEqual(2);
    expect(puts.some((p) => p.collection === 'users')).toBe(true);
    expect(puts.some((p) => p.collection === 'weeks')).toBe(true);
    const rebuilt = assembleSnapshot(puts.map((p) => ({ collection: p.collection, row: p.row })));
    expect(rebuilt.users).toEqual(snap.users);
    expect(rebuilt.weeks).toEqual(snap.weeks);
  });

  it('idempotent: identical snapshots yield empty diff', () => {
    const snap = baseSnap({
      providers: [
        {
          id: 'p1',
          userId: 'u1',
          firstName: 'F',
          lastName: 'L',
          discipline: 'PT',
          payRate30Min: null,
          payRate42Min: null,
          payRate45Min: null,
          payRatePerHour: 70,
          payRateGroup30Min: null,
          payRateGroup42Min: null,
          payRateGroup45Min: null,
          payRateEval: null,
          payRateAdditionalHourly: null,
          hhaCaregiverCode: '',
          active: true,
          createdAt: 't',
        },
      ],
    });
    expect(diffSnapshots(snap, structuredClone(snap))).toEqual({ puts: [], deletes: [] });
  });
});
