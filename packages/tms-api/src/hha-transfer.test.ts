import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import {
  ensurePatientAuthorizationForVisit,
  mandateToAuthPeriodMaximum,
  resolveHhaPatientId,
  tmsAuthorizationNumber,
  transferLockedWeek,
} from './hha-transfer.js';

function seedSchoolMandate(
  store: MemoryStore,
  opts: { studentId: string; providerId: string; durationMinutes: number; serviceType?: string },
) {
  store.upsertMandate({
    id: newId(),
    studentId: opts.studentId,
    providerId: opts.providerId,
    serviceType: opts.serviceType || 'PT School',
    discipline: 'PT',
    frequencyPerWeek: 1,
    ratioGroup: false,
    durationMinutes: opts.durationMinutes,
    sourcePdfKey: '',
    parsedAt: nowIso(),
    startOn: '',
    endOn: '',
    createdAt: nowIso(),
  });
}

describe('mandateToAuthPeriodMaximum / tmsAuthorizationNumber', () => {
  it('maps weekly mandate to Weekly Period + Maximum from frequencyPerWeek', () => {
    expect(
      mandateToAuthPeriodMaximum({
        id: 'm1',
        studentId: 's1',
        providerId: 'p1',
        serviceType: 'PT School',
        discipline: 'PT',
        frequencyPerWeek: 2,
        frequencyKind: 'weekly',
        ratioGroup: false,
        sourcePdfKey: '',
        parsedAt: '',
        startOn: '2026-09-01',
        endOn: '2027-06-30',
        createdAt: '',
      }),
    ).toEqual({ period: 'Weekly', maximum: 2 });
  });

  it('maps monthly and school_day_cycle; falls back to Daily/1 without mandate', () => {
    expect(
      mandateToAuthPeriodMaximum({
        id: 'm2',
        studentId: 's1',
        providerId: 'p1',
        serviceType: 'PT School',
        discipline: 'PT',
        frequencyPerWeek: 0,
        frequencyKind: 'monthly',
        sessionsPerPeriod: 4,
        ratioGroup: false,
        sourcePdfKey: '',
        parsedAt: '',
        startOn: '',
        endOn: '',
        createdAt: '',
      }),
    ).toEqual({ period: 'Monthly', maximum: 4 });
    expect(
      mandateToAuthPeriodMaximum({
        id: 'm3',
        studentId: 's1',
        providerId: 'p1',
        serviceType: 'PT School',
        discipline: 'PT',
        frequencyPerWeek: 0,
        frequencyKind: 'school_day_cycle',
        sessionsPerPeriod: 2,
        periodSchoolDays: 6,
        ratioGroup: false,
        sourcePdfKey: '',
        parsedAt: '',
        startOn: '',
        endOn: '',
        createdAt: '',
      }),
    ).toEqual({ period: 'Weekly', maximum: 2 });
    expect(mandateToAuthPeriodMaximum(undefined)).toEqual({ period: 'Daily', maximum: 1 });
  });

  it('builds stable TMS AuthorizationNumber from programId + serviceCodeId', () => {
    expect(
      tmsAuthorizationNumber({ programId: '1012074', patientId: '999', serviceCodeId: 'sc-pt-30' }),
    ).toBe('TMS-1012074-sc-pt-30');
  });
});

describe('ensurePatientAuthorizationForVisit', () => {
  it('calls upsertAuthorization with Period/Maximum from mandate', async () => {
    const hha = new MockHhaClient();
    const result = await ensurePatientAuthorizationForVisit({
      hha,
      patientId: 'p-1',
      contractId: '74',
      serviceCodeId: 'sc-pt-school-30',
      serviceCode: 'PT school 30',
      programType: 'Baldwin UFSD',
      programId: '1012074',
      mandate: {
        id: 'm1',
        studentId: 's1',
        providerId: 'p1',
        serviceType: 'PT School',
        discipline: 'PT',
        frequencyPerWeek: 1,
        frequencyKind: 'weekly',
        ratioGroup: false,
        sourcePdfKey: '',
        parsedAt: '',
        startOn: '2026-09-01',
        endOn: '2027-06-30',
        createdAt: '',
      },
      visitDate: '2026-09-01',
    });
    expect(hha.calls).toContain('upsertAuthorization');
    expect(result.created).toBe(true);
    expect(result.authorizationNumber).toBe('TMS-1012074-sc-pt-school-30');
  });
});

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

  it('passes school address into CreatePatient when patient is new', async () => {
    const hha = new MockHhaClient();
    const id = await resolveHhaPatientId({
      hha,
      student: {
        firstName: 'Sam',
        lastName: 'Lee',
        programId: '55001',
        hhaPatientId: '',
        dob: '2018-03-15',
      },
      schoolAddress: {
        address1: '1 School Lane',
        city: 'Carle Place',
        state: 'NY',
        zipCode: '11514',
      },
    });
    expect(id).toBeTruthy();
    expect(hha.calls).toContain('upsertPatient');
    const created = [...hha.patients.values()].find((p) => p.id === id);
    expect(created?.address1).toBe('1 School Lane');
    expect(created?.city).toBe('Carle Place');
    expect(created?.state).toBe('NY');
    expect(created?.zipCode).toBe('11514');
    expect(created?.dateOfBirth).toBe('2018-03-15');
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
    seedSchoolMandate(store, {
      studentId: student.id,
      providerId: provider.id,
      durationMinutes: 30,
      serviceType: 'PT School',
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
    expect(hha.calls).toContain('upsertContract');
    expect(hha.calls).toContain('upsertAuthorization');
    const authIdx = hha.calls.indexOf('upsertAuthorization');
    const schedIdx = hha.calls.indexOf('locateOrScheduleVisit');
    expect(authIdx).toBeGreaterThan(-1);
    expect(schedIdx).toBeGreaterThan(authIdx);
  });

  it('attaches program-type contract before CreateSchedule (avoids -74)', async () => {
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
      programId: '49247',
      programType: 'Island Park UFSD',
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
    seedSchoolMandate(store, {
      studentId: student.id,
      providerId: provider.id,
      durationMinutes: 30,
      serviceType: 'PT School',
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    expect(hha.calls.indexOf('upsertContract')).toBeGreaterThanOrEqual(0);
    expect(hha.calls.indexOf('upsertContract')).toBeLessThan(
      hha.calls.indexOf('locateOrScheduleVisit'),
    );
    const patientId = store.data.students.find((s) => s.id === student.id)?.hhaPatientId;
    expect(patientId).toBeTruthy();
    const placements = hha.placementsByPatient.get(patientId!) ?? [];
    expect(placements.some((p) => p.contractId === '73268')).toBe(true);
  });

  it('uses mandate duration for pay/billing — not Frontline nearest (40 min clock + 30 mandate)', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'OT',
      payRatePerHour: 80,
      payRate30Min: 62.5,
      payRate42Min: 70,
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
    // 40-min Frontline clock is nearer to 42 — must still use 30-min mandate rate.
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-09-01',
      beginTime: '09:00',
      endTime: '09:40',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'OT School',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'OT School',
      discipline: 'OT',
      frequencyPerWeek: 1,
      ratioGroup: false,
      durationMinutes: 30,
      sourcePdfKey: '',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('OT SCHOOL 30', 'sc-ot-30');
    hha.payCodes.set('OT $62.5', 'pay-ot-625');
    // If nearest-clock wrongly picked 42, transfer would be OT $70 — ensure that is not used.
    hha.payCodes.set('OT $70', 'pay-ot-70');
    hha.serviceCodesByName.set('OT SCHOOL 42', 'sc-ot-42');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    const visit = [...hha.visits.values()][0];
    expect(visit?.payCodeId).toBe('pay-ot-625'); // OT $62.5 (30-min), not pay-ot-70 (42)
    expect(visit?.serviceCode).toBe('OT school 30');
    expect(visit?.payRate).toBe('62.5');
  });

  it('prefers mandate.billingServiceName stored at import over recompute', async () => {
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
      serviceType: 'PT School',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });
    // Duration alone would bucket to school 60; stored import name must win.
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'Physical Therapy',
      discipline: 'PT',
      frequencyPerWeek: 2,
      ratioGroup: false,
      durationMinutes: 58,
      billingServiceName: 'PT school 30',
      sourcePdfKey: 'caseload-csv',
      parsedAt: nowIso(),
      startOn: '2026-09-02',
      endOn: '2027-06-25',
      createdAt: nowIso(),
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-30');
    hha.serviceCodesByName.set('PT SCHOOL 60', 'sc-pt-60');
    hha.payCodes.set('PT $70', 'pay-pt-70');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    const visit = [...hha.visits.values()][0];
    expect(visit?.serviceCode).toBe('PT school 30');
  });

  it('group mandate billing uses school group; rewrites legacy individual stamp', async () => {
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
      payRateGroup30Min: 34,
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
      serviceType: 'PT School Group',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });
    // Legacy wrong stamp (individual); transfer must use school group for group mandate.
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'Physical Therapy',
      discipline: 'PT',
      frequencyPerWeek: 2,
      ratioGroup: true,
      groupSize: 2,
      durationMinutes: 30,
      billingServiceName: 'PT school 30',
      sourcePdfKey: 'caseload-csv',
      parsedAt: nowIso(),
      startOn: '2026-09-02',
      endOn: '2027-06-25',
      createdAt: nowIso(),
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-30');
    hha.serviceCodesByName.set('PT SCHOOL GROUP 30', 'sc-pt-grp-30');
    hha.payCodes.set('PT $70', 'pay-pt-70');
    hha.payCodes.set('PT Group $34', 'pay-pt-grp-34');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const visit = [...hha.visits.values()][0];
    expect(visit?.serviceCode).toBe('PT school group 30');
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
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'OT School',
      discipline: 'OT',
      frequencyPerWeek: 1,
      ratioGroup: false,
      durationMinutes: 30,
      sourcePdfKey: '',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
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
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'OT School',
      discipline: 'OT',
      frequencyPerWeek: 1,
      ratioGroup: false,
      durationMinutes: 30,
      sourcePdfKey: '',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
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

  it('saves resolved HHA caregiver id onto the provider for next transfer', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'James',
      lastName: 'Vasaturo',
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
      hhaCaregiverCode: '',
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
      serviceType: 'PT School',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });
    seedSchoolMandate(store, {
      studentId: student.id,
      providerId: provider.id,
      durationMinutes: 30,
      serviceType: 'PT School',
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    hha.payCodes.set('PT $70', 'pay-pt-70');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(true);
    expect(store.data.providers.find((p) => p.id === provider.id)?.hhaCaregiverCode).toBe(
      'mock-caregiver-1',
    );
  });
});

describe('transferLockedWeek ErrorID=-56 patient recovery', () => {
  function seedWeek(store: MemoryStore, opts: { badPatientId: string; programId: string }) {
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
      dob: '2021-02-22',
      programId: opts.programId,
      programType: 'Baldwin UFSD',
      hhaPatientId: opts.badPatientId,
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
    seedSchoolMandate(store, {
      studentId: student.id,
      providerId: provider.id,
      durationMinutes: 30,
      serviceType: 'PT School',
    });
    return { provider, student, week };
  }

  it('on -56: clears bad ID, searches, saves found PatientID, does not CreatePatient', async () => {
    const store = new MemoryStore();
    const { student, week } = seedWeek(store, {
      badPatientId: '26027958',
      programId: '21021322',
    });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    hha.invalidPatientIds.add('26027958');
    const existing = await hha.upsertPatient({
      firstName: 'Ana',
      lastName: 'Binaj',
      caseId: '21021322',
      externalId: '21021322',
      dateOfBirth: '2021-02-22',
    });
    hha.calls.length = 0;

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });

    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    expect(store.data.students.find((s) => s.id === student.id)?.hhaPatientId).toBe(existing.id);
    expect(hha.calls.filter((c) => c === 'findPatient').length).toBeGreaterThanOrEqual(1);
    // First resolve used trusted bad ID (no find); recovery find + upsertPatient may find again.
    // CreatePatient path is upsertPatient — must not create a second patient.
    expect([...hha.patients.values()].filter((p) => p.firstName === 'Ana').length).toBe(1);
    expect(hha.calls.filter((c) => c === 'locateOrScheduleVisit').length).toBe(2);
  });

  it('on -56: when search misses, CreatePatient then save new PatientID and retry', async () => {
    const store = new MemoryStore();
    const { student, week } = seedWeek(store, {
      badPatientId: '26027959',
      programId: '21042316',
    });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    hha.invalidPatientIds.add('26027959');
    // No existing patient in mock → find misses → upsert creates.

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });

    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    const saved = store.data.students.find((s) => s.id === student.id)?.hhaPatientId;
    expect(saved).toBeTruthy();
    expect(saved).not.toBe('26027959');
    expect(hha.calls).toContain('findPatient');
    expect(hha.calls).toContain('upsertPatient');
    expect(hha.calls.filter((c) => c === 'locateOrScheduleVisit').length).toBe(2);
  });

  it('normal CreatePatient success already persists hhaPatientId', async () => {
    const store = new MemoryStore();
    const { student, week } = seedWeek(store, { badPatientId: '', programId: '550099' });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });

    expect(result.ok).toBe(true);
    const saved = store.data.students.find((s) => s.id === student.id)?.hhaPatientId;
    expect(saved).toBeTruthy();
    expect(hha.calls).toContain('upsertPatient');
  });
});

describe('transferLockedWeek GetVisitInfoV2 -415 after schedule', () => {
  it('keeps VisitID but fails transfer when approveVisit returns -415 (pay needs confirm)', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Nee',
      lastName: 'Patel',
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
      firstName: 'Valerie',
      lastName: 'Eley',
      dob: '2018-01-01',
      programId: '909062926',
      programType: 'Baldwin UFSD',
      hhaPatientId: '24745304',
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
    const session = store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-09-04',
      beginTime: '10:05 am',
      endTime: '10:35 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });
    seedSchoolMandate(store, {
      studentId: student.id,
      providerId: provider.id,
      durationMinutes: 30,
      serviceType: 'PT School',
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    hha.payCodes.set('PT $70', 'pay-pt-70');
    hha.approveVisit = async () => {
      hha.calls.push('approveVisit');
      throw new Error(
        'HHA GetVisitInfoV2 failed: Invalid VisitID for current agency (ErrorID=-415)',
      );
    };

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(result.errors.some((e) => /ErrorID=-415|could not read the VisitID/i.test(e))).toBe(true);
    const tr = store.transferForSession(session.id);
    expect(tr?.status).toBe('failed');
    expect(tr?.hhaVisitId).toBeTruthy();
    expect(tr?.lastError).toMatch(/ConfirmVisits|VisitID|-415/i);
  });
});

