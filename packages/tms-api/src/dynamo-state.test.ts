import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, emptySnapshot, type TmsSnapshot } from '@white-glove/tms-db';
import {
  InMemoryTmsDocStore,
  ensureMigratedFromS3,
  getMigrationMeta,
  loadSnapshotFromDynamo,
  resetTmsDocStoreCache,
  saveSnapshotDiffToDynamo,
} from './dynamo-state.js';

function sampleSnapshot(): TmsSnapshot {
  return {
    ...emptySnapshot(),
    users: [
      {
        id: 'u1',
        cognitoSub: 'sub-1',
        email: 'fatimah@example.com',
        role: 'therapist',
        displayName: 'Fatimah',
        providerId: 'p1',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    providers: [
      {
        id: 'p1',
        userId: 'u1',
        firstName: 'Fatimah',
        lastName: 'Test',
        discipline: 'OT',
        payRate30Min: null,
        payRate42Min: null,
        payRate45Min: null,
        payRatePerHour: 80,
        payRateGroup30Min: null,
        payRateGroup42Min: null,
        payRateGroup45Min: null,
        payRateEval: null,
        payRateAdditionalHourly: null,
        hhaCaregiverCode: 'WG-1',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    weeks: [
      {
        id: 'w1',
        providerId: 'p1',
        weekStart: '2026-03-02',
        status: 'draft',
        signerName: '',
        signerEmail: '',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      },
    ],
    sessions: [
      {
        id: 's1',
        weekId: 'w1',
        studentId: 'st1',
        dateOfService: '2026-03-03',
        beginTime: '10:00',
        endTime: '10:30',
        attendance: 'attended',
        cancelReason: '',
        makeupOfSessionId: '',
        serviceType: 'OT',
        location: '',
        notes: 'note',
        aiFlags: [],
      },
    ],
  };
}

describe('dynamo-state', () => {
  beforeEach(() => {
    resetTmsDocStoreCache();
  });

  it('persists entity diffs and reloads sessions/weeks without clobbering siblings', async () => {
    const doc = new InMemoryTmsDocStore();
    // Seed full snapshot (same as post-migration state).
    await saveSnapshotDiffToDynamo(emptySnapshot(), sampleSnapshot(), doc);

    const storeA = new MemoryStore(sampleSnapshot());
    const beforeA = storeA.snapshot();
    storeA.upsertSession({ ...storeA.data.sessions[0]!, notes: 'from-A' });
    await saveSnapshotDiffToDynamo(beforeA, storeA.snapshot(), doc);

    const storeB = new MemoryStore(sampleSnapshot());
    const beforeB = storeB.snapshot();
    storeB.upsertSession({
      id: 's2',
      weekId: 'w1',
      studentId: 'st1',
      dateOfService: '2026-03-04',
      beginTime: '11:00',
      endTime: '11:30',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'OT',
      location: '',
      notes: 'from-B',
      aiFlags: [],
    });
    await saveSnapshotDiffToDynamo(beforeB, storeB.snapshot(), doc);

    const loaded = new MemoryStore();
    await loadSnapshotFromDynamo(loaded, doc);
    expect(loaded.data.sessions).toHaveLength(2);
    expect(loaded.data.sessions.find((s) => s.id === 's1')?.notes).toBe('from-A');
    expect(loaded.data.sessions.find((s) => s.id === 's2')?.notes).toBe('from-B');
    expect(loaded.data.weeks).toHaveLength(1);
    expect(loaded.data.users[0]?.displayName).toBe('Fatimah');
  });

  it('migrates from source snapshot and is idempotent on re-run', async () => {
    const doc = new InMemoryTmsDocStore();
    const snap = sampleSnapshot();
    let sourceReads = 0;
    const backups: TmsSnapshot[] = [];

    const first = await ensureMigratedFromS3({
      docStore: doc,
      loadSource: async () => {
        sourceReads += 1;
        return snap;
      },
      writeBackup: async (s) => {
        backups.push(s);
      },
    });
    expect(first?.status).toBe('complete');
    expect(first?.entityCount).toBeGreaterThan(0);
    expect(sourceReads).toBe(1);
    expect(backups).toHaveLength(1);

    const second = await ensureMigratedFromS3({
      docStore: doc,
      loadSource: async () => {
        sourceReads += 1;
        return snap;
      },
    });
    expect(second?.status).toBe('complete');
    expect(second?.entityCount).toBe(first?.entityCount);
    expect(sourceReads).toBe(1); // did not re-read source

    const meta = await getMigrationMeta(doc);
    expect(meta?.status).toBe('complete');

    const loaded = new MemoryStore();
    await loadSnapshotFromDynamo(loaded, doc);
    expect(loaded.data.sessions).toHaveLength(1);
    expect(loaded.data.weeks[0]?.id).toBe('w1');
    expect(loaded.data.users[0]?.email).toBe('fatimah@example.com');
  });

  it('deletes removed entities on diff save', async () => {
    const doc = new InMemoryTmsDocStore();
    const store = new MemoryStore(sampleSnapshot());
    await saveSnapshotDiffToDynamo(emptySnapshot(), store.snapshot(), doc);
    const before = store.snapshot();
    store.removeSession('s1');
    await saveSnapshotDiffToDynamo(before, store.snapshot(), doc);
    const loaded = new MemoryStore();
    await loadSnapshotFromDynamo(loaded, doc);
    expect(loaded.data.sessions).toHaveLength(0);
    expect(loaded.data.weeks).toHaveLength(1);
  });
});
