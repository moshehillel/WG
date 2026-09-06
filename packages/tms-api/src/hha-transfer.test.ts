import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import { resolveHhaPatientId, transferLockedWeek } from './hha-transfer.js';

describe('resolveHhaPatientId', () => {
  it('uses trusted hhaPatientId without calling find', async () => {
    const hha = new MockHhaClient();
    const id = await resolveHhaPatientId({
      hha,
      student: {
        firstName: 'Ana',
        lastName: 'Binaj',
        programId: '49247',
        hhaPatientId: '999001',
      },
    });
    expect(id).toBe('999001');
    expect(hha.calls).not.toContain('findPatient');
  });

  it('rejects Program Id copied into hhaPatientId and finds by caseId', async () => {
    const hha = new MockHhaClient();
    const existing = await hha.upsertPatient({
      firstName: 'Ana',
      lastName: 'Binaj',
      caseId: '49247',
      externalId: '49247',
    });
    hha.calls.length = 0;
    const id = await resolveHhaPatientId({
      hha,
      student: {
        firstName: 'Ana',
        lastName: 'Binaj',
        programId: '49247',
        // Footgun: Program Id mistakenly stored as PatientID
        hhaPatientId: '49247',
      },
    });
    expect(id).toBe(existing.id);
    expect(hha.calls).toContain('findPatient');
    expect(hha.calls).not.toContain('upsertPatient');
  });

  it('finds by Program Id before create when name would miss', async () => {
    const hha = new MockHhaClient();
    const existing = await hha.upsertPatient({
      firstName: 'Different',
      lastName: 'Name',
      caseId: '922522794',
      externalId: '922522794',
    });
    hha.calls.length = 0;
    const id = await resolveHhaPatientId({
      hha,
      student: {
        firstName: 'Omar',
        lastName: 'Abedin',
        programId: '922522794',
        hhaPatientId: '',
      },
    });
    expect(id).toBe(existing.id);
    expect(hha.calls.filter((c) => c === 'upsertPatient')).toHaveLength(0);
  });
});

describe('transferLockedWeek Program Id', () => {
  it('links student via programId and confirms transfer with school billing + pay codes', async () => {
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
    const existing = await hha.upsertPatient({
      firstName: 'X',
      lastName: 'Y',
      caseId: '1012074',
      externalId: '1012074',
    });

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    expect(result.errors).toEqual([]);
    expect(store.data.students.find((s) => s.id === student.id)?.hhaPatientId).toBe(existing.id);
    expect(hha.calls).toContain('resolvePayCodeId');
    expect(hha.calls).toContain('resolveServiceCodeId');
  });

  it('hard-fails session when pay code missing in HHA', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'OT',
      payRatePerHour: null,
      payRate30Min: 62.5,
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
      firstName: 'Kid',
      lastName: 'One',
      dob: '',
      programId: '1',
      programType: 'Baldwin UFSD',
      hhaPatientId: '999',
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
      serviceType: 'OT School',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('OT SCHOOL 30', 'sc-ot-30');
    // OT $62.5 not in mock payCodes map â†’ fail

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(result.errors[0]).toMatch(/Pay code "OT \$62\.5" not found/);
  });

  it('hard-fails session when billing service code missing in HHA', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'OT',
      payRatePerHour: null,
      payRate30Min: 62.5,
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
      firstName: 'Kid',
      lastName: 'One',
      dob: '',
      programId: '1',
      programType: 'Baldwin UFSD',
      hhaPatientId: '999',
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
      serviceType: 'OT School',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });

    const hha = new MockHhaClient();
    hha.payCodes.set('OT $62.5', 'pay-ot-625');
    // no serviceCodesByName â†’ fail

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/Service code "OT school 30" not found/);
  });

  it('uses payRateEval for eval session pay code (OT $rate)', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'OT',
      payRatePerHour: null,
      payRate30Min: 62.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: 95,
      payRateAdditionalHourly: 55,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Kid',
      lastName: 'One',
      dob: '',
      programId: '1',
      programType: 'Baldwin UFSD',
      hhaPatientId: '999',
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
      endTime: '10:00',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'Eval',
      additionalServiceType: 'eval',
      location: 'School',
      notes: 'Initial evaluation completed with caregiver present.',
      aiFlags: [],
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('OT SCHOOL EVAL', 'sc-ot-eval');
    hha.payCodes.set('OT $95', 'pay-ot-95');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    expect(hha.calls).toContain('resolvePayCodeId');
  });
});

