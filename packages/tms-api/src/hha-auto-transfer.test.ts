import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import { runHhaAutoTransfer, weeksNeedingHhaTransfer } from './hha-auto-transfer.js';

function seedProvider(store: MemoryStore) {
  return store.upsertProvider({
    id: newId(),
    userId: '',
    firstName: 'Pat',
    lastName: 'Lee',
    discipline: 'OT',
    payRatePerHour: 72,
    payRate30Min: 36,
    payRate42Min: null,
    payRate45Min: null,
    payRateGroup30Min: null,
    payRateGroup42Min: null,
    payRateGroup45Min: null,
    payRateEval: null,
    payRateAdditionalHourly: null,
    hhaCaregiverCode: '1001',
    active: true,
    createdAt: nowIso(),
  });
}

function seedStudent(store: MemoryStore) {
  return store.upsertStudent({
    id: newId(),
    schoolId: '',
    firstName: 'Sam',
    lastName: 'Kid',
    dob: '2015-01-01',
    programId: '99',
    programType: 'CPSE',
    hhaPatientId: '555001',
    createdAt: nowIso(),
  });
}

function seedWeek(
  store: MemoryStore,
  providerId: string,
  opts: { status: 'locked' | 'signed' | 'draft' | 'submitted'; hhaStatus: 'none' | 'pending' | 'confirmed' | 'failed' },
) {
  return store.upsertWeek({
    id: newId(),
    providerId,
    weekStart: '2026-08-31',
    status: opts.status,
    signerName: 'P',
    signerEmail: 'p@s.test',
    timesheetKey: '',
    signedKey: '',
    envelopeId: '',
    hhaStatus: opts.hhaStatus,
  });
}

function seedAttendedSession(store: MemoryStore, weekId: string, studentId: string) {
  return store.upsertSession({
    id: newId(),
    weekId,
    studentId,
    dateOfService: '2026-09-01',
    beginTime: '09:00',
    endTime: '09:30',
    attendance: 'attended',
    cancelReason: '',
    makeupOfSessionId: '',
    serviceType: 'OT School',
    location: 'School',
    notes: 'note',
    aiFlags: [],
  });
}

describe('weeksNeedingHhaTransfer', () => {
  it('selects locked weeks with eligible sessions that are not fully confirmed', () => {
    const store = new MemoryStore();
    const provider = seedProvider(store);
    const student = seedStudent(store);
    const need = seedWeek(store, provider.id, { status: 'locked', hhaStatus: 'none' });
    seedAttendedSession(store, need.id, student.id);

    const confirmed = seedWeek(store, provider.id, { status: 'locked', hhaStatus: 'confirmed' });
    const confSession = seedAttendedSession(store, confirmed.id, student.id);
    store.upsertTransfer({
      id: newId(),
      sessionId: confSession.id,
      weekId: confirmed.id,
      status: 'confirmed',
      hhaVisitId: '123456',
      lastError: '',
      payloadHash: 'x',
      updatedAt: nowIso(),
    });

    const draft = seedWeek(store, provider.id, { status: 'draft', hhaStatus: 'none' });
    seedAttendedSession(store, draft.id, student.id);

    const ids = weeksNeedingHhaTransfer(store).map((w) => w.id);
    expect(ids).toContain(need.id);
    expect(ids).not.toContain(confirmed.id);
    expect(ids).not.toContain(draft.id);
  });

  it('selects failed / partial weeks for retry', () => {
    const store = new MemoryStore();
    const provider = seedProvider(store);
    const student = seedStudent(store);
    const failed = seedWeek(store, provider.id, { status: 'signed', hhaStatus: 'failed' });
    const session = seedAttendedSession(store, failed.id, student.id);
    store.upsertTransfer({
      id: newId(),
      sessionId: session.id,
      weekId: failed.id,
      status: 'failed',
      hhaVisitId: '',
      lastError: 'boom',
      payloadHash: 'x',
      updatedAt: nowIso(),
    });
    expect(weeksNeedingHhaTransfer(store).map((w) => w.id)).toEqual([failed.id]);
  });
});

describe('runHhaAutoTransfer', () => {
  it('respects TMS_HHA_AUTO_TRANSFER=false', async () => {
    const prev = process.env.TMS_HHA_AUTO_TRANSFER;
    process.env.TMS_HHA_AUTO_TRANSFER = 'false';
    try {
      const out = await runHhaAutoTransfer(new MemoryStore(), new MockHhaClient());
      expect(out.skipped).toBe(true);
      expect(out.skippedReason).toBe('disabled');
    } finally {
      if (prev === undefined) delete process.env.TMS_HHA_AUTO_TRANSFER;
      else process.env.TMS_HHA_AUTO_TRANSFER = prev;
    }
  });

  it('transfers selected locked weeks via transferLockedWeek', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: 70,
      payRate30Min: 70,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Ana',
      lastName: 'Binaj',
      dob: '',
      programId: '1012074',
      programType: 'Baldwin UFSD',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'PT School',
      discipline: 'PT',
      frequencyPerWeek: 1,
      ratioGroup: false,
      durationMinutes: 30,
      sourcePdfKey: '',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-08-31',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-09-01',
      beginTime: '09:00',
      endTime: '09:30',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    await hha.upsertPatient({
      firstName: 'X',
      lastName: 'Y',
      caseId: '1012074',
      externalId: '1012074',
    });
    let persisted = 0;
    const out = await runHhaAutoTransfer(store, hha, {
      afterWeek: async () => {
        persisted += 1;
      },
    });

    expect(out.skipped).toBe(false);
    expect(out.selected).toBe(1);
    expect(out.attempted).toBe(1);
    expect(out.weeks[0]?.errors || []).toEqual([]);
    expect(out.okWeeks).toBe(1);
    expect(out.transferredSessions).toBeGreaterThanOrEqual(1);
    expect(persisted).toBe(1);
    expect(store.data.weeks.find((w) => w.id === week.id)?.hhaStatus).toBe('confirmed');
  });
});
