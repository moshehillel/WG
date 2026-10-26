import { describe, expect, it, vi } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore, adminStudentsList, newId, nowIso } from '@white-glove/tms-db';
import {
  ensurePatientAuthorizationForVisit,
  mandateToAuthPeriodMaximum,
  resolveHhaPatientId,
  sessionDiscipline,
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

describe('sessionDiscipline', () => {
  it('uses the session service type and does not invent PT from the provider when it is blank', () => {
    expect(sessionDiscipline({ serviceType: 'ST Individual' }, 'PT')).toBe('ST');
    expect(sessionDiscipline({ serviceType: '' }, 'PT')).toBeUndefined();
    expect(sessionDiscipline({ serviceType: '   ' }, 'PT')).toBeUndefined();
    expect(sessionDiscipline({ serviceType: 'Eval' }, 'OT')).toBe('OT');
  });
});

describe('mandateToAuthPeriodMaximum / tmsAuthorizationNumber', () => {
  it('uses same-day Entire Period with visit/mandate duration minutes (WG school pattern)', () => {
    expect(
      mandateToAuthPeriodMaximum(
        {
          id: 'm1',
          studentId: 's1',
          providerId: 'p1',
          serviceType: 'PT School',
          discipline: 'PT',
          frequencyPerWeek: 2,
          frequencyKind: 'weekly',
          durationMinutes: 30,
          ratioGroup: false,
          sourcePdfKey: '',
          parsedAt: '',
          startOn: '2026-09-01',
          endOn: '2027-06-30',
          createdAt: '',
        },
        { visitDurationMinutes: 30 },
      ),
    ).toEqual({ period: 'Entire Period', maximum: 15 });
  });

  it('falls back to Entire Period max 15 when duration missing', () => {
    expect(mandateToAuthPeriodMaximum(undefined)).toEqual({ period: 'Entire Period', maximum: 15 });
    expect(mandateToAuthPeriodMaximum(undefined, { visitDurationMinutes: 45 })).toEqual({
      period: 'Entire Period',
      maximum: 15,
    });
  });

  it('builds TMS AuthorizationNumber from programId + serviceCodeId + visit day', () => {
    expect(
      tmsAuthorizationNumber({ programId: '1012074', patientId: '999', serviceCodeId: 'sc-pt-30' }),
    ).toBe('TMS2-1012074-sc-pt-30');
    expect(
      tmsAuthorizationNumber({
        programId: '1012074',
        patientId: '999',
        serviceCodeId: 'sc-pt-30',
        visitDate: '2026-09-04',
      }),
    ).toBe('TMS2-1012074-sc-pt-30-2026-09-04');
  });
});

describe('ensurePatientAuthorizationForVisit', () => {
  it('calls upsertAuthorization with same-day Entire Period from visit duration', async () => {
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
        durationMinutes: 30,
        ratioGroup: false,
        sourcePdfKey: '',
        parsedAt: '',
        startOn: '2026-09-01',
        endOn: '2027-06-30',
        createdAt: '',
      },
      visitDate: '2026-09-04',
      visitDurationMinutes: 30,
    });
    expect(hha.calls).toContain('upsertAuthorization');
    expect(result.created).toBe(true);
    expect(result.authorizationNumber).toBe('TMS2-1012074-sc-pt-school-30-2026-09-04');
    expect(mandateToAuthPeriodMaximum(undefined, { visitDurationMinutes: 30 })).toEqual({
      period: 'Entire Period',
      maximum: 15,
    });
  });
});

describe('resolveHhaPatientId', () => {
  it('uses trusted hhaPatientId without calling find when the chart is the same child', async () => {
    const hha = new MockHhaClient();
    hha.patients.set('999001', {
      id: '999001',
      firstName: 'ANA',
      lastName: 'Binaj PT*',
      dateOfBirth: '03/15/2018',
    });
    const id = await resolveHhaPatientId({
      hha,
      student: {
        firstName: 'Ana',
        lastName: 'Binaj',
        dob: '2018-03-15',
        programId: '49247',
        hhaPatientId: '999001',
      },
    });
    expect(id).toBe('999001');
    expect(hha.calls).not.toContain('findPatient');
    expect(hha.calls).not.toContain('upsertPatient');
  });

  it('rejects Program Id copied into hhaPatientId and finds by caseId', async () => {
    const hha = new MockHhaClient();
    const existing = await hha.upsertPatient({
      firstName: 'Ana',
      lastName: 'Binaj',
      dateOfBirth: '2018-03-15',
      caseId: '49247',
      externalId: '49247',
    });
    hha.calls.length = 0;
    const id = await resolveHhaPatientId({
      hha,
      student: {
        firstName: 'Ana',
        lastName: 'Binaj',
        dob: '2018-03-15',
        programId: '49247',
        // Footgun: Program Id mistakenly stored as PatientID
        hhaPatientId: '49247',
      },
    });
    expect(id).toBe(existing.id);
    expect(hha.calls).toContain('findPatient');
    expect(hha.calls).not.toContain('upsertPatient');
  });

  it('creates the real child when the MR hit is a different child', async () => {
    const hha = new MockHhaClient();
    const elijah = await hha.upsertPatient({
      firstName: 'Elijah',
      lastName: 'George',
      dateOfBirth: '2018-10-03',
      caseId: '258268743',
      externalId: '258268743',
    });
    hha.calls.length = 0;
    const id = await resolveHhaPatientId({
      hha,
      student: {
        firstName: 'Max',
        lastName: 'Campbell',
        dob: '2018-03-12',
        programId: '258268743',
        hhaPatientId: '',
      },
      schoolAddress: {
        address1: '1 School Lane',
        city: 'Westbury',
        state: 'NY',
        zipCode: '11590',
      },
    });
    expect(id).toBeTruthy();
    expect(id).not.toBe(elijah.id);
    expect(hha.calls).toContain('createPatient');
    expect(hha.calls.filter((c) => c === 'upsertPatient')).toHaveLength(0);
    const created = [...hha.patients.values()].find((p) => p.id === id);
    expect(created?.firstName).toBe('Max');
    expect(created?.lastName).toBe('Campbell');
    expect(created?.dateOfBirth).toBe('2018-03-12');
    expect([...hha.patients.values()].find((p) => p.id === elijah.id)?.firstName).toBe('Elijah');
    expect([...hha.patients.values()].find((p) => p.id === elijah.id)?.dateOfBirth).toBe(
      '2018-10-03',
    );
  });

  it('names the missing field and does not create when CreatePatient would be rejected', async () => {
    const hha = new MockHhaClient();
    const elijah = await hha.upsertPatient({
      firstName: 'Elijah',
      lastName: 'George',
      dateOfBirth: '2018-10-03',
      caseId: '258268743',
      externalId: '258268743',
    });
    hha.calls.length = 0;
    await expect(
      resolveHhaPatientId({
        hha,
        student: {
          firstName: 'Max',
          lastName: 'Campbell',
          dob: '2018-03-12',
          programId: '258268743',
          hhaPatientId: '',
        },
      }),
    ).rejects.toThrow(
      'CreatePatient FAILED — missing required field(s): Address, City, State, Zip Code.',
    );
    expect(hha.calls).not.toContain('createPatient');
    expect(hha.calls).not.toContain('upsertPatient');
    expect([...hha.patients.values()].find((p) => p.id === elijah.id)?.firstName).toBe('Elijah');
  });

  it('does not save a created PatientID when the returned chart is a different child', async () => {
    const hha = new MockHhaClient();
    const elijah = await hha.upsertPatient({
      firstName: 'Elijah',
      lastName: 'George',
      dateOfBirth: '2018-10-03',
      caseId: '258268743',
      externalId: '258268743',
    });
    hha.createPatient = async () => {
      hha.calls.push('createPatient');
      return { id: elijah.id, created: false };
    };
    hha.calls.length = 0;
    await expect(
      resolveHhaPatientId({
        hha,
        student: {
          firstName: 'Max',
          lastName: 'Campbell',
          dob: '2018-03-12',
          programId: '258268743',
        },
        schoolAddress: {
          address1: '1 School Lane',
          city: 'Westbury',
          state: 'NY',
          zipCode: '11590',
        },
      }),
    ).rejects.toThrow(
      `HHA patient ${elijah.id} is Elijah George (dob 2018-10-03), not Max Campbell (dob 2018-03-12). Refusing to transfer.`,
    );
    expect(hha.calls).toContain('createPatient');
    expect([...hha.patients.values()].find((p) => p.id === elijah.id)?.firstName).toBe('Elijah');
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
    expect(hha.calls).toContain('createPatient');
    expect(hha.calls.filter((c) => c === 'createPatient')).toHaveLength(1);
    const created = [...hha.patients.values()].find((p) => p.id === id);
    expect(created?.address1).toBe('1 School Lane');
    expect(created?.city).toBe('Carle Place');
    expect(created?.state).toBe('NY');
    expect(created?.zipCode).toBe('11514');
    expect(created?.dateOfBirth).toBe('2018-03-15');
  });
});

describe('transfer refuses a different HHA child', () => {
  function seedMaxWeek(
    store: MemoryStore,
    hhaPatientId: string,
    opts?: { withAddress?: boolean },
  ) {
    const school = opts?.withAddress
      ? store.upsertSchool({
          id: newId(),
          name: 'Westbury UFSD',
          district: 'Westbury UFSD',
          signerName: 'S',
          signerEmail: 's@school.test',
          address1: '1 School Lane',
          city: 'Westbury',
          state: 'NY',
          zipCode: '11590',
          createdAt: nowIso(),
        })
      : undefined;
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Regine',
      lastName: 'Souverain',
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
      schoolId: school?.id || '',
      firstName: 'Max',
      lastName: 'Campbell',
      dob: '2018-03-12',
      programId: '258268743',
      programType: 'Westbury UFSD',
      hhaPatientId,
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-21',
      status: 'locked',
      signerName: 'R',
      signerEmail: 'r@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-09-24',
      beginTime: '09:00',
      endTime: '09:30',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: 'School',
      notes: 'eval',
      aiFlags: [],
    });
    seedSchoolMandate(store, {
      studentId: student.id,
      providerId: provider.id,
      durationMinutes: 30,
      serviceType: 'PT School',
    });
    return { student, week };
  }

  it('does not schedule a mismatched MR hit when the child cannot be created', async () => {
    const store = new MemoryStore();
    const { student, week } = seedMaxWeek(store, '');
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    const elijah = await hha.upsertPatient({
      firstName: 'Elijah',
      lastName: 'George',
      dateOfBirth: '2018-10-03',
      caseId: '258268743',
      externalId: '258268743',
    });
    hha.visits.set('1343715794', {
      id: '1343715794',
      patientId: elijah.id,
      visitDate: '2026-09-01',
      approved: true,
    });
    hha.calls.length = 0;

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });

    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(result.errors[0]).toContain(
      'CreatePatient FAILED — missing required field(s): Address, City, State, Zip Code.',
    );
    expect(store.data.students.find((s) => s.id === student.id)?.hhaPatientId).toBe('');
    expect(hha.calls).not.toContain('createPatient');
    expect(hha.calls).not.toContain('upsertPatient');
    expect(hha.calls).not.toContain('locateOrScheduleVisit');
    expect(hha.visits.get('1343715794')?.patientId).toBe(elijah.id);
    expect([...hha.visits.values()]).toHaveLength(1);
    expect([...hha.patients.values()].find((p) => p.id === elijah.id)?.firstName).toBe('Elijah');
  });

  it('creates the real child when the MR hit is someone else and does not give them the visit', async () => {
    const store = new MemoryStore();
    const { student, week } = seedMaxWeek(store, '', { withAddress: true });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    const elijah = await hha.upsertPatient({
      firstName: 'Elijah',
      lastName: 'George',
      dateOfBirth: '2018-10-03',
      caseId: '258268743',
      externalId: '258268743',
    });
    hha.visits.set('1343715794', {
      id: '1343715794',
      patientId: elijah.id,
      visitDate: '2026-09-01',
      approved: true,
    });
    hha.calls.length = 0;

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    const saved = store.data.students.find((s) => s.id === student.id)?.hhaPatientId;
    expect(saved).toBeTruthy();
    expect(saved).not.toBe(elijah.id);
    const created = [...hha.patients.values()].find((p) => p.id === saved);
    expect(created?.firstName).toBe('Max');
    expect(created?.dateOfBirth).toBe('2018-03-12');
    expect(hha.calls.filter((c) => c === 'createPatient')).toHaveLength(1);
    expect(hha.calls).not.toContain('upsertPatient');
    const scheduled = [...hha.visits.values()].filter((v) => v.id !== '1343715794');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.patientId).toBe(saved);
    expect(hha.visits.get('1343715794')?.patientId).toBe(elijah.id);
    expect([...hha.patients.values()].find((p) => p.id === elijah.id)?.firstName).toBe('Elijah');
    expect([...hha.patients.values()].find((p) => p.id === elijah.id)?.dateOfBirth).toBe(
      '2018-10-03',
    );
  });

  it('accepts an MR hit with the same name and date of birth', async () => {
    const store = new MemoryStore();
    const { student, week } = seedMaxWeek(store, '');
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    const max = await hha.upsertPatient({
      firstName: 'MAX',
      lastName: 'Campbell PT*',
      dateOfBirth: '03/12/2018',
      caseId: '258268743',
      externalId: '258268743',
    });
    hha.calls.length = 0;

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(store.data.students.find((s) => s.id === student.id)?.hhaPatientId).toBe(max.id);
    const visit = [...hha.visits.values()][0];
    expect(visit?.patientId).toBe(max.id);
    expect(hha.calls).not.toContain('createPatient');
    expect([...hha.patients.values()].filter((p) => /campbell/i.test(p.lastName || ''))).toHaveLength(1);
  });

  it('clears a stored id for a different child and creates the real child', async () => {
    const store = new MemoryStore();
    const { student, week } = seedMaxWeek(store, '23975457', { withAddress: true });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    hha.patients.set('23975457', {
      id: '23975457',
      firstName: 'Elijah',
      lastName: 'George',
      dateOfBirth: '2018-10-03',
      caseId: '258268743',
      externalId: '258268743',
    });
    hha.visits.set('1343715794', {
      id: '1343715794',
      patientId: '23975457',
      visitDate: '2026-09-01',
      approved: true,
    });
    hha.calls.length = 0;

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });

    expect(result.ok).toBe(true);
    const saved = store.data.students.find((s) => s.id === student.id)?.hhaPatientId;
    expect(saved).toBeTruthy();
    expect(saved).not.toBe('23975457');
    expect(hha.calls.filter((c) => c === 'createPatient')).toHaveLength(1);
    expect(hha.calls).not.toContain('upsertPatient');
    const scheduled = [...hha.visits.values()].filter((v) => v.id !== '1343715794');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.patientId).toBe(saved);
    expect(hha.visits.get('1343715794')?.patientId).toBe('23975457');
    expect(hha.patients.get('23975457')?.firstName).toBe('Elijah');
    expect(hha.patients.get('23975457')?.dateOfBirth).toBe('2018-10-03');
  });

  it('keeps a stored hhaPatientId when the chart is still this child', async () => {
    const store = new MemoryStore();
    const { student, week } = seedMaxWeek(store, '25149934');
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-school-30');
    hha.patients.set('25149934', {
      id: '25149934',
      firstName: 'Max',
      lastName: 'Campbell',
      dateOfBirth: '2018-03-12',
      caseId: '258268743',
      externalId: '258268743',
    });
    hha.calls.length = 0;

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });

    expect(result.ok).toBe(true);
    expect(store.data.students.find((s) => s.id === student.id)?.hhaPatientId).toBe('25149934');
    expect(hha.calls).not.toContain('findPatient');
    expect([...hha.visits.values()][0]?.patientId).toBe('25149934');
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
      dob: '2016-04-02',
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
      firstName: 'Ana',
      lastName: 'Binaj',
      dateOfBirth: '2016-04-02',
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
    const school = store.upsertSchool({
      id: newId(),
      name: 'Island Park',
      district: 'Island Park UFSD',
      signerName: 'S',
      signerEmail: 's@school.test',
      address1: '1 School Lane',
      city: 'Island Park',
      state: 'NY',
      zipCode: '11558',
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: school.id,
      firstName: 'Ana',
      lastName: 'Binaj',
      dob: '2016-04-02',
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
    // 40 is not a school billing bucket. Pay stays the 30-min mandate rate, and
    // CreateSchedule is refused because the clock (40) ≠ the 30-minute code.
    // Must not switch the code to the nearer 42-minute bucket.
    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(result.errors[0]).toMatch(/Session clock is 40 min but HHA billing "OT school 30" is 30 min/);
    expect(result.errors[0]).not.toMatch(/school 42/);
    expect([...hha.visits.values()]).toHaveLength(0);
  });

  it('blocks a 30-minute clock when the mandate duration is longer than the stored 30 code', async () => {
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
    // Mandate length is 58. A 30-minute clock is shorter than the mandate, so it is blocked.
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
    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(hha.visits.size).toBe(0);
    expect(result.errors[0]).toMatch(/shorter than the mandate/);
    expect(result.errors[0]).toMatch(/58 min/);
  });

  it('solo group-mandate visit bills individual service and individual pay', async () => {
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
      notes: 'No group available — seen individually',
      aiFlags: [],
    });
    // Group mandate stamp; solo visit must rewrite to individual service + individual pay.
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
      billingServiceName: 'PT school group 30',
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
    hha.payCodes.set('PT GROUP $34', 'pay-pt-grp-34');
    hha.payCodes.set('AM PT $34', 'pay-am-pt-34');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const visit = [...hha.visits.values()][0];
    expect(visit?.serviceCode).toBe('PT school 30');
    expect(visit?.payRate).toBe('70');
  });

  it('multi-peer group visit bills group service and group pay', async () => {
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
    const studentA = store.upsertStudent({
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
    const studentB = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Ben',
      lastName: 'Cole',
      dob: '',
      programId: '1012075',
      programType: 'Baldwin UFSD',
      hhaPatientId: '998',
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
    const sessionA = store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: studentA.id,
      dateOfService: '2026-09-01',
      beginTime: '09:00',
      endTime: '09:30',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School Group',
      location: 'School',
      notes: 'group',
      aiFlags: [],
    });
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: studentB.id,
      dateOfService: '2026-09-01',
      beginTime: '09:00',
      endTime: '09:30',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School Group',
      location: 'School',
      notes: 'group',
      aiFlags: [],
    });
    for (const sid of [studentA.id, studentB.id]) {
      store.upsertMandate({
        id: newId(),
        studentId: sid,
        providerId: provider.id,
        serviceType: 'Physical Therapy',
        discipline: 'PT',
        frequencyPerWeek: 2,
        ratioGroup: true,
        groupSize: 2,
        durationMinutes: 30,
        billingServiceName: 'PT school group 30',
        sourcePdfKey: 'caseload-csv',
        parsedAt: nowIso(),
        startOn: '2026-09-02',
        endOn: '2027-06-25',
        createdAt: nowIso(),
      });
    }

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-30');
    hha.serviceCodesByName.set('PT SCHOOL GROUP 30', 'sc-pt-grp-30');
    hha.payCodes.set('PT $70', 'pay-pt-70');
    hha.payCodes.set('PT GROUP $34', 'pay-pt-grp-34');
    hha.payCodes.set('AM PT $34', 'pay-am-pt-34');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const visits = [...hha.visits.values()];
    expect(visits.length).toBeGreaterThanOrEqual(1);
    const visitA = visits.find((v) => v.patientId === '999') ?? visits[0];
    expect(visitA?.serviceCode).toBe('PT school group 30');
    expect(visitA?.payRate).toBe('34');
    void sessionA;
  });

  it.each([
    ['Physical Therapy 5:1', 5],
    ['PT School 12:1', 12],
    ['Physical Therapy 1000:1', 1000],
  ] as const)('%s with a peer bills the group service and group pay', async (taggedService, groupSize) => {
    // Neelamben Patel 10/16/2026 2:00: "PT School 4:1" was sent as PT school group 30.
    // "Physical Therapy 5:1" used to miss the group regex and go out as PT school 30,
    // which HHA then rejected as a caregiver overlap. Any N:1 with N >= 2 uses that same group code.
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
    const studentA = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Shakai',
      lastName: 'Hill',
      dob: '',
      programId: '922524323',
      programType: 'Baldwin UFSD',
      hhaPatientId: '888',
      createdAt: nowIso(),
    });
    const studentB = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Amir',
      lastName: 'Fox',
      dob: '',
      programId: '111057610',
      programType: 'Baldwin UFSD',
      hhaPatientId: '777',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-10-12',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    for (const student of [studentA, studentB]) {
      store.upsertSession({
        id: newId(),
        weekId: week.id,
        studentId: student.id,
        dateOfService: '10/16/2026',
        beginTime: '2:00 pm',
        endTime: '2:30 pm',
        attendance: 'attended',
        cancelReason: '',
        makeupOfSessionId: '',
        serviceType: taggedService,
        location: 'School',
        notes: 'group',
        aiFlags: [],
      });
      store.upsertMandate({
        id: newId(),
        studentId: student.id,
        providerId: provider.id,
        serviceType: 'Physical Therapy',
        discipline: 'PT',
        frequencyPerWeek: 2,
        ratioGroup: true,
        groupSize,
        durationMinutes: 30,
        billingServiceName: 'PT school group 30',
        sourcePdfKey: 'caseload-csv',
        parsedAt: nowIso(),
        startOn: '2026-09-02',
        endOn: '2027-06-25',
        createdAt: nowIso(),
      });
    }

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-30');
    hha.serviceCodesByName.set('PT SCHOOL GROUP 30', 'sc-pt-grp-30');
    hha.payCodes.set('PT $70', 'pay-pt-70');
    hha.payCodes.set('PT GROUP $34', 'pay-pt-grp-34');
    hha.payCodes.set('AM PT $34', 'pay-am-pt-34');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const visits = [...hha.visits.values()];
    expect(visits).toHaveLength(2);
    for (const visit of visits) {
      expect(visit.serviceCode).toBe('PT school group 30');
      expect(visit.payRate).toBe('34');
      expect(visit.scheduleType).toBe('Skilled');
      expect(visit.startTime).toBe('2:00 pm');
      expect(visit.endTime).toBe('2:30 pm');
    }
  });

  it('blocks a 15-minute group clock on a 30-minute mandate', async () => {
    // Fatimah Dawan / Valley Stream Thirty, week of 2026-09-28:
    // Delilah attended + Lucas makeup, both 1:45–2:00 (15 min), mandate PT school group 30.
    // Edelia: shorter than the mandate is blocked. Do not send group 15 or individual 15.
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Fatimah',
      lastName: 'Dawan',
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
    const delilah = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Delilah',
      lastName: 'Gonzalez',
      dob: '',
      programId: 'vs-delilah',
      programType: 'Valley Stream School District Thirty',
      hhaPatientId: '111',
      createdAt: nowIso(),
    });
    const lucas = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Lucas',
      lastName: 'Martinez Giron',
      dob: '',
      programId: 'vs-lucas',
      programType: 'Valley Stream School District Thirty',
      hhaPatientId: '222',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-28',
      status: 'locked',
      signerName: 'F',
      signerEmail: 'f@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: delilah.id,
      dateOfService: '2026-09-30',
      beginTime: '1:45 pm',
      endTime: '2:00 pm',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School Group',
      location: 'School',
      notes: 'group',
      aiFlags: [],
    });
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: lucas.id,
      dateOfService: '2026-09-30',
      beginTime: '1:45 pm',
      endTime: '2:00 pm',
      attendance: 'makeup',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School Group',
      location: 'School',
      notes: 'group makeup',
      aiFlags: [],
    });
    for (const sid of [delilah.id, lucas.id]) {
      store.upsertMandate({
        id: newId(),
        studentId: sid,
        providerId: provider.id,
        serviceType: 'Physical Therapy',
        discipline: 'PT',
        frequencyPerWeek: 2,
        ratioGroup: true,
        groupSize: 2,
        durationMinutes: 30,
        billingServiceName: 'PT school group 30',
        sourcePdfKey: 'caseload-csv',
        parsedAt: nowIso(),
        startOn: '2026-09-02',
        endOn: '2027-06-25',
        createdAt: nowIso(),
      });
    }

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL GROUP 30', 'sc-pt-grp-30');
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-30');
    hha.serviceCodesByName.set('PT SCHOOL 15', 'sc-pt-15');
    hha.payCodes.set('PT $70', 'pay-pt-70');
    hha.payCodes.set('PT GROUP $34', 'pay-pt-grp-34');

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(hha.visits.size).toBe(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    for (const err of result.errors) {
      expect(err).toMatch(/shorter than the mandate/);
      expect(err).toMatch(/15 min/);
      expect(err).toMatch(/30 min/);
      expect(err).not.toMatch(/PT school 15/);
      expect(err).not.toMatch(/school group 15/);
    }
  });

  it('30-minute additional service looks up half the hourly pay code', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Wiglishai',
      lastName: 'Astacio',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: 52.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: 175,
      payRateAdditionalHourly: 88,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'No',
      lastName: 'Child',
      dob: '',
      programId: 'addl',
      programType: 'Baldwin UFSD',
      hhaPatientId: '555',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-10-05',
      status: 'locked',
      signerName: 'W',
      signerEmail: 'w@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-10-06',
      beginTime: '2:00 PM',
      endTime: '2:30 PM',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'ST Individual',
      additionalServiceType: 'documentation',
      location: 'School',
      notes: 'Documentation for the half hour.',
      aiFlags: [],
    });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('SLP ADDITIONAL SERVICES 30', 'sc-slp-addl');
    hha.payCodes.set('ST $88', 'pay-st-88');
    hha.payCodes.set('ST $44', 'pay-st-44');
    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const visit = [...hha.visits.values()][0];
    expect(visit?.payRate).toBe('44');
    expect(visit?.serviceCode).toBe('SLP additional services 30');
    expect(hha.calls.filter((c) => c === 'resolvePayCodeId')).toHaveLength(1);
  });

  it('sends a missed paid absence on the real child and skips unpaid misses', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Wiglishai',
      lastName: 'Astacio',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: 52.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: 175,
      payRateAdditionalHourly: 88,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Maya',
      lastName: 'Lopez',
      dob: '2016-04-02',
      programId: 'maya-1',
      programType: 'Baldwin UFSD',
      hhaPatientId: '555',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-10-05',
      status: 'locked',
      signerName: 'W',
      signerEmail: 'w@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    const attended = store.upsertSession({
      id: 'attended-already',
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-10-06',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'ST Individual',
      location: 'School',
      notes: 'Already in HHA.',
      aiFlags: [],
    });
    store.data.hhaTransfers = [
      {
        id: 'ok-attended',
        sessionId: attended.id,
        weekId: week.id,
        status: 'confirmed',
        hhaVisitId: '1337400620',
        lastError: '',
        payloadHash: 'old',
        updatedAt: nowIso(),
      },
    ];
    store.upsertSession({
      id: 'unpaid-miss',
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-10-07',
      beginTime: '',
      endTime: '',
      attendance: 'missed',
      cancelReason: 'Student absent',
      makeupOfSessionId: '',
      serviceType: 'ST Individual',
      location: 'School',
      notes: 'Student absent',
      aiFlags: [],
    });
    const paid = store.upsertSession({
      id: 'paid-miss',
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-10-08',
      beginTime: '2:00 PM',
      endTime: '2:30 PM',
      attendance: 'missed',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'ST Individual',
      additionalServiceType: 'paid_absence',
      location: 'School',
      notes: 'Paid absence',
      aiFlags: [],
    });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('SLP SCHOOL 30', 'sc-slp-30');
    hha.payCodes.set('ST $52.5', 'pay-st-52');
    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(2);
    expect(hha.calls.filter((c) => c === 'createPatient')).toHaveLength(0);
    expect(hha.calls.filter((c) => c.startsWith('discharge'))).toEqual([]);
    const visit = [...hha.visits.values()][0];
    expect(hha.visits.size).toBe(1);
    expect(visit?.patientId).toBe('555');
    expect(visit?.payRate).toBe('52.5');
    expect(visit?.payCodeId).toBe('pay-st-52');
    expect(visit?.serviceCode).toBe('SLP school 30');
    expect(visit?.startTime).toBe('2:00 PM');
    expect(visit?.endTime).toBe('2:30 PM');
    expect(store.transferForSession(paid.id)?.status).toBe('confirmed');
    expect(store.transferForSession(attended.id)?.hhaVisitId).toBe('1337400620');
    expect(store.transferForSession(attended.id)?.status).toBe('confirmed');
    expect(store.transferForSession('unpaid-miss')).toBeUndefined();
    expect(store.data.weeks.find((w) => w.id === week.id)?.hhaStatus).toBe('confirmed');
  });

  it('sends a no-child paid absence as a new patient on the week contract', async () => {
    const store = new MemoryStore();
    const school = store.upsertSchool({
      id: newId(),
      name: 'Fred S. Keller School',
      district: 'Fred S. Keller School',
      signerName: 'S',
      signerEmail: 's@school.test',
      address1: '',
      city: '',
      state: '',
      zipCode: '',
      createdAt: nowIso(),
    });
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Wiglishai',
      lastName: 'Astacio',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: 52.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: 88,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-21',
      schoolId: school.id,
      programType: 'Fred S. Keller School',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: 'paid-no-child',
      weekId: week.id,
      studentId: '',
      dateOfService: '2026-09-21',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      attendance: 'missed',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'Paid absence',
      additionalServiceType: 'paid_absence',
      location: '',
      notes: 'Paid absence',
      aiFlags: [],
    });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('SLP SCHOOL 30', 'sc-slp-30');
    hha.payCodes.set('SLP $52.5', 'pay-slp-52');
    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    expect(hha.calls.filter((c) => c === 'createPatient')).toHaveLength(1);
    expect(hha.calls.filter((c) => c.startsWith('discharge'))).toEqual([]);
    const visit = [...hha.visits.values()][0];
    expect(visit?.serviceCode).toBe('SLP school 30');
    expect(visit?.payRate).toBe('52.5');
    expect(visit?.contractId).toBe('72817');
    const created = [...hha.patients.values()].find((p) => p.id === visit?.patientId);
    expect(created?.firstName).toBe('no');
    expect(created?.lastName).toBe('child');
    expect(created?.address1).toBe('1 Placeholder St');
    expect(created?.city).toBe('New York');
    expect(created?.state).toBe('NY');
    expect(created?.zipCode).toBe('10001');
    expect(store.data.sessions.find((s) => s.id === 'paid-no-child')?.studentId).toBe('');
    expect(store.data.weeks.find((w) => w.id === week.id)?.hhaStatus).toBe('confirmed');
  });

  it('blocks a 15-minute group clock on a 30-minute mandate even when group 15 exists', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Fatimah',
      lastName: 'Dawan',
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
    const a = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Ada',
      lastName: 'One',
      dob: '',
      programId: 'p-a',
      programType: 'Valley Stream School District Thirty',
      hhaPatientId: '311',
      createdAt: nowIso(),
    });
    const b = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Bea',
      lastName: 'Two',
      dob: '',
      programId: 'p-b',
      programType: 'Valley Stream School District Thirty',
      hhaPatientId: '322',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-28',
      status: 'locked',
      signerName: 'F',
      signerEmail: 'f@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    for (const student of [a, b]) {
      store.upsertSession({
        id: newId(),
        weekId: week.id,
        studentId: student.id,
        dateOfService: '2026-09-30',
        beginTime: '1:45 pm',
        endTime: '2:00 pm',
        attendance: 'attended',
        cancelReason: '',
        makeupOfSessionId: '',
        serviceType: 'PT School Group',
        location: 'School',
        notes: 'group',
        aiFlags: [],
      });
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
        billingServiceName: 'PT school group 30',
        sourcePdfKey: 'caseload-csv',
        parsedAt: nowIso(),
        startOn: '2026-09-02',
        endOn: '2027-06-25',
        createdAt: nowIso(),
      });
    }
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL GROUP 15', 'sc-pt-grp-15');
    hha.serviceCodesByName.set('PT SCHOOL 15', 'sc-pt-15');
    hha.serviceCodesByName.set('PT SCHOOL GROUP 30', 'sc-pt-grp-30');
    hha.payCodes.set('PT GROUP $34', 'pay-pt-grp-34');

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(hha.visits.size).toBe(0);
    for (const err of result.errors) {
      expect(err).toMatch(/shorter than the mandate/);
    }
  });

  it('15-minute group mandate uses the provider group 15 pay rate', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Fatimah',
      lastName: 'Dawan',
      discipline: 'PT',
      payRatePerHour: 70,
      payRate30Min: 70,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup15Min: 22,
      payRateGroup30Min: 34,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const delilah = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Delilah',
      lastName: 'Gonzalez',
      dob: '',
      programId: 'vs-delilah',
      programType: 'Valley Stream School District Thirty',
      hhaPatientId: '111',
      createdAt: nowIso(),
    });
    const lucas = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Lucas',
      lastName: 'Martinez Giron',
      dob: '',
      programId: 'vs-lucas',
      programType: 'Valley Stream School District Thirty',
      hhaPatientId: '222',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-28',
      status: 'locked',
      signerName: 'F',
      signerEmail: 'f@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    for (const student of [delilah, lucas]) {
      store.upsertSession({
        id: newId(),
        weekId: week.id,
        studentId: student.id,
        dateOfService: '2026-09-30',
        beginTime: '1:45 pm',
        endTime: '2:00 pm',
        attendance: 'attended',
        cancelReason: '',
        makeupOfSessionId: '',
        serviceType: 'PT School Group',
        location: 'School',
        notes: 'group',
        aiFlags: [],
      });
      store.upsertMandate({
        id: newId(),
        studentId: student.id,
        providerId: provider.id,
        serviceType: 'Physical Therapy',
        discipline: 'PT',
        frequencyPerWeek: 2,
        ratioGroup: true,
        groupSize: 2,
        durationMinutes: 15,
        billingServiceName: 'PT school group 15',
        sourcePdfKey: 'caseload-csv',
        parsedAt: nowIso(),
        startOn: '2026-09-02',
        endOn: '2027-06-25',
        createdAt: nowIso(),
      });
    }
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL GROUP 15', 'sc-pt-grp-15');
    hha.serviceCodesByName.set('PT SCHOOL GROUP 30', 'sc-pt-grp-30');
    hha.payCodes.set('PT GROUP $22', 'pay-pt-grp-22');
    hha.payCodes.set('PT GROUP $34', 'pay-pt-grp-34');
    hha.payCodes.set('AM PT $22', 'pay-am-pt-22');

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.errors).toEqual([]);
    const visits = [...hha.visits.values()];
    expect(visits).toHaveLength(2);
    for (const visit of visits) {
      expect(visit.serviceCode).toBe('PT school group 15');
      expect(visit.payRate).toBe('22');
      expect(visit.payCodeId).toBe('pay-pt-grp-22');
    }
  });

  it('blocks a 15-minute individual clock on a 30-minute mandate', async () => {
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
      firstName: 'Sam',
      lastName: 'Solo',
      dob: '',
      programId: 'solo',
      programType: 'Valley Stream School District Thirty',
      hhaPatientId: '444',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-28',
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
      dateOfService: '2026-09-30',
      beginTime: '1:45 pm',
      endTime: '2:00 pm',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: 'School',
      notes: 'individual',
      aiFlags: [],
    });
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'Physical Therapy',
      discipline: 'PT',
      frequencyPerWeek: 2,
      ratioGroup: false,
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
    hha.serviceCodesByName.set('PT SCHOOL 15', 'sc-pt-15');
    hha.payCodes.set('PT $70', 'pay-pt-70');

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(hha.visits.size).toBe(0);
    expect(result.errors[0]).toMatch(/shorter than the mandate/);
    expect(result.errors[0]).toMatch(/30-minute mandate/);
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
    const studentA = store.upsertStudent({
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
    const studentB = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Ben',
      lastName: 'Cole',
      dob: '',
      programId: '1012075',
      programType: 'Baldwin UFSD',
      hhaPatientId: '998',
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
      studentId: studentA.id,
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
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: studentB.id,
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
    // Legacy wrong stamp (individual); multi-peer transfer must use school group.
    for (const sid of [studentA.id, studentB.id]) {
      store.upsertMandate({
        id: newId(),
        studentId: sid,
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
    }

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-30');
    hha.serviceCodesByName.set('PT SCHOOL GROUP 30', 'sc-pt-grp-30');
    hha.payCodes.set('PT $70', 'pay-pt-70');
    hha.payCodes.set('PT GROUP $34', 'pay-pt-grp-34');
    hha.payCodes.set('AM PT $34', 'pay-am-pt-34');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const visit = [...hha.visits.values()].find((v) => v.patientId === '999');
    expect(visit?.serviceCode).toBe('PT school group 30');
    expect(visit?.payRate).toBe('34');
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
    expect(result.errors[0]).toMatch(/^Kid One · 2026-09-01 09:00–09:30 · OT School:/);
  });

  it('labels missing provider pay-rate errors with child · DOS · time', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'James',
      lastName: 'Therapist',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
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
      firstName: 'Elizabeth',
      lastName: 'Klicpera',
      dob: '',
      programId: '1',
      programType: 'Baldwin UFSD',
      hhaPatientId: '999',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-07',
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
      dateOfService: '2026-09-08',
      beginTime: '10:00 am',
      endTime: '10:30 am',
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
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('PT SCHOOL 30', 'sc-pt-30');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(
      /^Elizabeth Klicpera · 2026-09-08 10:00 am–10:30 am · PT School: No HHA pay code rate for session/,
    );
    expect(store.data.weeks.find((w) => w.id === week.id)?.hhaError).toMatch(
      /^Elizabeth Klicpera · 2026-09-08 10:00 am–10:30 am · PT School: No HHA pay code rate for session/,
    );
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
    expect(result.errors[0]).toMatch(/^Kid One · /);
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

  it('creates a new no-child patient on the week contract for each documentation row', async () => {
    const store = new MemoryStore();
    const school = store.upsertSchool({
      id: newId(),
      name: 'Fred S. Keller School',
      district: 'Fred S. Keller School',
      signerName: 'S',
      signerEmail: 's@school.test',
      address1: '1 Keller Way',
      city: 'Yonkers',
      state: 'NY',
      zipCode: '10701',
      createdAt: nowIso(),
    });
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Wiglishai',
      lastName: 'Astacio',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: 52.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: 55,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-21',
      schoolId: school.id,
      programType: 'Fred S. Keller School',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    const sessionIds = ['doc-a', 'doc-b'].map((id) => {
      store.upsertSession({
        id,
        weekId: week.id,
        studentId: '',
        dateOfService: id === 'doc-a' ? '2026-09-21' : '2026-09-22',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        attendance: 'attended',
        cancelReason: '',
        makeupOfSessionId: '',
        serviceType: 'Documentation',
        additionalServiceType: 'documentation',
        location: '',
        notes: 'Chart documentation for the week.',
        aiFlags: [],
      });
      return id;
    });

    const hha = new MockHhaClient();
    // A "no child" patient already on a different contract must not be reused.
    const otherContractPatient = await hha.upsertPatient({
      firstName: 'no',
      lastName: 'child',
      caseId: 'OTHER-CONTRACT',
      externalId: 'OTHER-CONTRACT',
    });
    hha.calls.length = 0;
    hha.serviceCodesByName.set('SLP ADDITIONAL SERVICES 30', 'sc-slp-addl');
    hha.payCodes.set('SLP $27.5', 'pay-slp-275');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(2);
    expect(hha.calls.filter((c) => c === 'createPatient')).toHaveLength(2);
    expect(hha.calls).not.toContain('findPatient');
    expect(hha.calls).not.toContain('upsertPatient');

    const visits = [...hha.visits.values()];
    expect(visits).toHaveLength(2);
    const patientIds = visits.map((v) => v.patientId);
    expect(new Set(patientIds).size).toBe(2);
    expect(patientIds).not.toContain(otherContractPatient.id);
    expect(visits.every((v) => v.contractId === '72817')).toBe(true);
    expect(visits.every((v) => v.serviceCode === 'SLP additional services 30')).toBe(true);
    expect(visits.every((v) => v.payRate === '27.5')).toBe(true);

    for (const id of sessionIds) {
      expect(store.data.sessions.find((s) => s.id === id)?.studentId).toBe('');
    }
    const placeholders = store.data.students.filter(
      (s) => s.firstName === 'no' && s.lastName === 'child',
    );
    expect(placeholders).toHaveLength(2);
    expect(placeholders.every((s) => s.programType === 'Fred S. Keller School')).toBe(true);
    expect(new Set(placeholders.map((s) => s.programId)).size).toBe(2);
    expect(new Set(placeholders.map((s) => s.hhaPatientId))).toEqual(new Set(patientIds));
    const createdPatients = [...hha.patients.values()].filter(
      (p) => p.firstName === 'no' && p.lastName === 'child' && patientIds.includes(String(p.id)),
    );
    expect(createdPatients.every((p) => p.address1 === '1 Keller Way')).toBe(true);
    expect(createdPatients.every((p) => p.zipCode === '10701')).toBe(true);
    expect(store.data.schools.find((s) => s.id === school.id)?.address1).toBe('1 Keller Way');
    expect(adminStudentsList(store).some((s) => s.firstName === 'no' && s.lastName === 'child')).toBe(
      false,
    );
    expect(store.data.weeks.find((w) => w.id === week.id)?.hhaStatus).toBe('confirmed');
  });

  it('uses the saved session program when the week program is missing', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Wiglishai',
      lastName: 'Astacio',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: 52.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: 55,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-14',
      schoolId: '',
      programType: '',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: 'doc-missing-week',
      weekId: week.id,
      studentId: '',
      dateOfService: '2026-09-16',
      beginTime: '8:30 am',
      endTime: '9:00 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'Documentation',
      additionalServiceType: 'documentation',
      programType: 'Fred S. Keller School',
      location: '',
      notes: 'Chart documentation for the week.',
      aiFlags: [],
    });
    expect(store.data.students.some((s) => s.firstName === 'no' && s.lastName === 'child')).toBe(
      false,
    );
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('SLP ADDITIONAL SERVICES 30', 'sc-slp-addl');
    hha.payCodes.set('SLP $27.5', 'pay-slp-275');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const visits = [...hha.visits.values()];
    expect(visits).toHaveLength(1);
    expect(visits[0]?.contractId).toBe('72817');
    expect(store.data.sessions.find((s) => s.id === 'doc-missing-week')?.studentId).toBe('');
    const created = store.data.students.filter((s) => s.firstName === 'no' && s.lastName === 'child');
    expect(created).toHaveLength(1);
    expect(created[0]?.programType).toBe('Fred S. Keller School');
  });

  it('uses the sibling Fred S Keller week when the documentation sheet has no program', async () => {
    const store = new MemoryStore();
    const school = store.upsertSchool({
      id: newId(),
      name: 'Fred S. Keller School',
      district: 'Fred S. Keller School',
      signerName: 'S',
      signerEmail: 's@school.test',
      address1: '1 Keller Way',
      city: 'Yonkers',
      state: 'NY',
      zipCode: '10701',
      createdAt: nowIso(),
    });
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Wiglishai',
      lastName: 'Astacio',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: 52.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: 55,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const orphan = store.upsertWeek({
      id: 'wk-blank-doc',
      providerId: provider.id,
      weekStart: '2026-09-14',
      schoolId: school.id,
      programType: '',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'failed',
    });
    store.upsertWeek({
      id: 'wk-keller-kids',
      providerId: provider.id,
      weekStart: '2026-09-14',
      schoolId: school.id,
      programType: 'Fred S keller school',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'confirmed',
    });
    store.upsertSession({
      id: 'doc-916-blank',
      weekId: orphan.id,
      studentId: '',
      dateOfService: '9/16/2026',
      beginTime: '8:30 am',
      endTime: '9:00 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'Documentation',
      additionalServiceType: 'documentation',
      location: '',
      notes: 'Documentation',
      aiFlags: [],
    });
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('SLP ADDITIONAL SERVICES 30', 'sc-slp-addl');
    hha.payCodes.set('SLP $27.5', 'pay-slp-275');
    const result = await transferLockedWeek({
      store,
      week: orphan,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const visits = [...hha.visits.values()];
    expect(visits).toHaveLength(1);
    expect(visits[0]?.contractId).toBe('72817');
    expect(store.data.sessions.find((s) => s.id === 'doc-916-blank')?.programType || '').toBe('');
    expect(
      store.data.students.find((s) => s.firstName === 'no' && s.lastName === 'child')?.programType,
    ).toBe('Fred S. Keller School');
  });

  it('does not guess a program when the same week has two sibling contracts', async () => {
    const store = new MemoryStore();
    const school = store.upsertSchool({
      id: newId(),
      name: 'Shared',
      district: '',
      signerName: 'S',
      signerEmail: 's@school.test',
      createdAt: nowIso(),
    });
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Wiglishai',
      lastName: 'Astacio',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: 52.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: 55,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const weekBase = {
      providerId: provider.id,
      weekStart: '2026-09-14',
      schoolId: school.id,
      status: 'locked' as const,
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none' as const,
    };
    const orphan = store.upsertWeek({ ...weekBase, id: 'wk-blank', programType: '' });
    store.upsertWeek({ ...weekBase, id: 'wk-keller', programType: 'Fred S. Keller School' });
    store.upsertWeek({ ...weekBase, id: 'wk-baldwin', programType: 'Baldwin UFSD' });
    store.upsertSession({
      id: 'doc-ambiguous',
      weekId: orphan.id,
      studentId: '',
      dateOfService: '9/16/2026',
      beginTime: '8:30 am',
      endTime: '9:00 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'Documentation',
      additionalServiceType: 'documentation',
      location: '',
      notes: 'Documentation',
      aiFlags: [],
    });
    const hha = new MockHhaClient();
    const result = await transferLockedWeek({ store, week: orphan, hha, actorId: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/program type "\(missing\)"/);
  });

  it('uses each week contract for no-child rows and does not share the patient', async () => {
    const store = new MemoryStore();
    const school = store.upsertSchool({
      id: newId(),
      name: 'Baldwin',
      district: 'Baldwin UFSD',
      signerName: 'S',
      signerEmail: 's@school.test',
      address1: '2 School St',
      city: 'Baldwin',
      state: 'NY',
      zipCode: '11510',
      createdAt: nowIso(),
    });
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
    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('OT ADDITIONAL SERVICES 60', 'sc-ot-addl');
    hha.payCodes.set('OT $55', 'pay-ot-55');

    const patientIds: string[] = [];
    for (const programType of ['Fred S. Keller School', 'Baldwin UFSD'] as const) {
      const week = store.upsertWeek({
        id: newId(),
        providerId: provider.id,
        weekStart: programType.startsWith('Fred') ? '2026-09-21' : '2026-09-28',
        schoolId: school.id,
        programType,
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
        studentId: '',
        dateOfService: week.weekStart,
        beginTime: '9:00 am',
        endTime: '10:00 am',
        attendance: 'attended',
        cancelReason: '',
        makeupOfSessionId: '',
        serviceType: 'Documentation',
        additionalServiceType: 'documentation',
        location: '',
        notes: 'Documentation.',
        aiFlags: [],
      });
      const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
      expect(result.errors).toEqual([]);
      expect(result.transferred).toBe(1);
      const visit = [...hha.visits.values()].at(-1);
      patientIds.push(String(visit?.patientId));
      expect(visit?.contractId).toBe(programType.startsWith('Fred') ? '72817' : '68715');
      expect(visit?.serviceCode).toBe('OT additional services 60');
    }
    expect(new Set(patientIds).size).toBe(2);
  });

  it('sends a no-child patient with a placeholder address when no school address exists', async () => {
    const store = new MemoryStore();
    const blankSchool = store.upsertSchool({
      id: newId(),
      name: 'Fred S. Keller School',
      district: 'Fred S. Keller School',
      signerName: 'S',
      signerEmail: 's@school.test',
      address1: '',
      city: '',
      state: '',
      zipCode: '',
      createdAt: nowIso(),
    });
    const realSchool = store.upsertSchool({
      id: newId(),
      name: 'Real School',
      district: 'Other District',
      signerName: 'S',
      signerEmail: 's@real.test',
      address1: '9 Real Ave',
      city: 'Yonkers',
      state: 'NY',
      zipCode: '10701',
      createdAt: nowIso(),
    });
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Wiglishai',
      lastName: 'Astacio',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: 52.5,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: 55,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const realChild = store.upsertStudent({
      id: newId(),
      schoolId: realSchool.id,
      firstName: 'Fred',
      lastName: 'Keller',
      dob: '2016-04-02',
      programId: 'REAL-1',
      programType: 'Other District',
      hhaPatientId: 'real-patient',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-21',
      schoolId: blankSchool.id,
      programType: 'Fred S. Keller School',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: 'doc-no-addr',
      weekId: week.id,
      studentId: '',
      dateOfService: '2026-09-21',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'Documentation',
      additionalServiceType: 'documentation',
      location: '',
      notes: 'Chart documentation for the week.',
      aiFlags: [],
    });

    const hha = new MockHhaClient();
    hha.serviceCodesByName.set('SLP ADDITIONAL SERVICES 30', 'sc-slp-addl');
    hha.payCodes.set('SLP $27.5', 'pay-slp-275');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    expect(hha.calls.filter((c) => c === 'createPatient')).toHaveLength(1);

    const visit = [...hha.visits.values()][0];
    const created = [...hha.patients.values()].find((p) => p.id === visit?.patientId);
    expect(created?.firstName).toBe('no');
    expect(created?.lastName).toBe('child');
    expect(created?.address1).toBe('1 Placeholder St');
    expect(created?.city).toBe('New York');
    expect(created?.state).toBe('NY');
    expect(created?.zipCode).toBe('10001');

    const blankAfter = store.data.schools.find((s) => s.id === blankSchool.id);
    expect(blankAfter?.address1).toBe('');
    expect(blankAfter?.city).toBe('');
    expect(blankAfter?.state).toBe('');
    expect(blankAfter?.zipCode).toBe('');
    const realAfter = store.data.schools.find((s) => s.id === realSchool.id);
    expect(realAfter?.address1).toBe('9 Real Ave');
    expect(realAfter?.city).toBe('Yonkers');
    expect(realAfter?.zipCode).toBe('10701');
    const childAfter = store.data.students.find((s) => s.id === realChild.id);
    expect(childAfter?.hhaPatientId).toBe('real-patient');
    expect(childAfter?.schoolId).toBe(realSchool.id);
    expect(store.data.sessions.find((s) => s.id === 'doc-no-addr')?.studentId).toBe('');
  });

  it('fails a session with no service type and does not emit the provider PT pay code', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Kyrie',
      lastName: 'Spencer',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: 52.5,
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
      firstName: 'Fred',
      lastName: 'Keller',
      dob: '',
      programId: '1',
      programType: 'Fred S. Keller School',
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
      serviceType: '',
      location: 'School',
      notes: 'Service Provided: speech session with no service type on the note',
      aiFlags: [],
    });

    const hha = new MockHhaClient();
    hha.payCodes.set('PT $52.5', '300564');
    hha.payCodes.set('ST $52.5', '299841');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(false);
    expect(result.transferred).toBe(0);
    expect(result.errors[0]).toMatch(/Service type is required/i);
    expect(result.errors.join(' ')).not.toMatch(/PT \$/);
    expect(hha.calls).not.toContain('resolvePayCodeId');
    expect(hha.calls).not.toContain('locateOrScheduleVisit');
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
    const school = store.upsertSchool({
      id: newId(),
      name: 'Baldwin',
      district: 'Baldwin UFSD',
      signerName: 'S',
      signerEmail: 's@school.test',
      address1: '1 School Lane',
      city: 'Baldwin',
      state: 'NY',
      zipCode: '11510',
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: school.id,
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
    // Recovery finds the existing chart. CreatePatient must not add a second Ana.
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
    expect(hha.calls).toContain('createPatient');
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
    expect(hha.calls).toContain('createPatient');
    expect(hha.calls.filter((c) => c === 'createPatient')).toHaveLength(1);
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

  it('skips already-confirmed transfers with VisitID (no re-ConfirmVisits on Retry)', async () => {
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
      hhaStatus: 'confirmed',
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
    store.upsertTransfer({
      id: newId(),
      sessionId: session.id,
      weekId: week.id,
      status: 'confirmed',
      hhaVisitId: '1331688458',
      lastError: '',
      payloadHash: 'old',
      updatedAt: nowIso(),
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

    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    expect(hha.calls).not.toContain('approveVisit');
    expect(hha.calls).not.toContain('upsertAuthorization');
    expect(store.transferForSession(session.id)?.status).toBe('confirmed');
  });

  it('drops a blank failed sibling when the session is already confirmed', async () => {
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
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Maeve',
      lastName: 'Leahy',
      dob: '2018-01-01',
      programId: 'WGC-924938',
      programType: 'Island Park',
      hhaPatientId: '24745304',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-14',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'failed',
      hhaError: 'Maeve Leahy · 2026-09-17: overlap (ErrorID=-310)',
    });
    const session = store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-09-17',
      beginTime: '1:15 pm',
      endTime: '1:45 pm',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: 'School',
      notes: 'ok',
      aiFlags: [],
    });
    store.data.hhaTransfers = [
      {
        id: 'ok-row',
        sessionId: session.id,
        weekId: week.id,
        status: 'confirmed',
        hhaVisitId: '1337400620',
        lastError: '',
        payloadHash: 'old',
        updatedAt: nowIso(),
      },
      {
        id: 'bad-row',
        sessionId: session.id,
        weekId: week.id,
        status: 'failed',
        hhaVisitId: '',
        lastError: 'Overlapping shifts are not allowed (ErrorID=-310)',
        payloadHash: 'old',
        updatedAt: nowIso(),
      },
    ];
    seedSchoolMandate(store, {
      studentId: student.id,
      providerId: provider.id,
      durationMinutes: 30,
      serviceType: 'PT School',
    });

    const hha = new MockHhaClient();
    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.transferred).toBe(1);
    expect(hha.calls).not.toContain('approveVisit');
    expect(store.data.hhaTransfers.map((t) => t.id)).toEqual(['ok-row']);
    const saved = store.data.weeks.find((w) => w.id === week.id);
    expect(saved?.hhaError || '').not.toMatch(/-310/);
    expect(saved?.hhaStatus).toBe('confirmed');
  });

  it('heals failed transfers whose lastError is Already Billed (-401)', async () => {
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
      firstName: 'Kid',
      lastName: 'One',
      dob: '2018-01-01',
      programId: '909062926',
      programType: 'Baldwin UFSD',
      hhaPatientId: '24745304',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-07',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'failed',
      hhaError:
        'ConfirmVisits failed for visit 1331688458: Visit is already Billed (-401)',
    });
    const session = store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-09-08',
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
    store.upsertTransfer({
      id: newId(),
      sessionId: session.id,
      weekId: week.id,
      status: 'failed',
      hhaVisitId: '1331688458',
      lastError:
        'ConfirmVisits failed for visit 1331688458 after 22 reason pair(s): reason=107 action=111 ts=Yes/Yes: Visit is already Billed (-401)',
      payloadHash: 'old',
      updatedAt: nowIso(),
    });
    seedSchoolMandate(store, {
      studentId: student.id,
      providerId: provider.id,
      durationMinutes: 30,
      serviceType: 'PT School',
    });

    const hha = new MockHhaClient();
    const result = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
    expect(result.ok).toBe(true);
    expect(result.transferred).toBe(1);
    expect(result.errors).toEqual([]);
    expect(store.transferForSession(session.id)?.status).toBe('confirmed');
    expect(store.transferForSession(session.id)?.lastError).toBe('');
    expect(store.data.weeks.find((w) => w.id === week.id)?.hhaError).toBe('');
    expect(store.data.weeks.find((w) => w.id === week.id)?.hhaStatus).toBe('confirmed');
    expect(hha.calls).not.toContain('approveVisit');
  });

  it('fails with #38 note error (not pay-rate) when group-mandate solo lacks no-peer note', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'James',
      lastName: 'Vasaturo',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
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
      firstName: 'Elizabeth',
      lastName: 'Klicpera',
      dob: '',
      programId: '1',
      programType: 'Madison-Oneida BOCES',
      hhaPatientId: '999',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-07',
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
      dateOfService: '2026-09-10',
      beginTime: '10:00 am',
      endTime: '10:30 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: 'School',
      notes: 'Service Provided: fine motor only',
      aiFlags: [],
    });
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'PT School Group',
      discipline: 'PT',
      frequencyPerWeek: 2,
      ratioGroup: true,
      durationMinutes: 30,
      sourcePdfKey: '',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
    });

    const hha = new MockHhaClient();
    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/no peer was available|no partner available|seen individually/i);
    expect(result.errors[0]).not.toMatch(/No HHA pay code rate/i);
  });

  it('transfers when Elizabeth-style no-peer note is present', async () => {
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
      firstName: 'Elizabeth',
      lastName: 'Klicpera',
      dob: '',
      programId: '1012074',
      programType: 'Baldwin UFSD',
      hhaPatientId: '999',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-07',
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
      dateOfService: '2026-09-10',
      beginTime: '10:00 am',
      endTime: '10:30 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: 'School',
      notes:
        'Student can not be seen in a group as there is no one appropriate to group her with',
      aiFlags: [],
    });
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
      billingServiceName: 'PT school group 30',
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
    hha.payCodes.set('PT GROUP $34', 'pay-pt-grp-34');
    hha.payCodes.set('AM PT $34', 'pay-am-pt-34');

    const result = await transferLockedWeek({
      store,
      week,
      hha,
      actorId: 'admin',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('transferLockedWeek overlapping sends', () => {
  it('does not CreateSchedule when a second transfer of the same week is already running', async () => {
    const prevTable = process.env.TMS_STATE_TABLE;
    delete process.env.TMS_STATE_TABLE;
    const { resetTmsDocStoreCache } = await import('./dynamo-state.js');
    resetTmsDocStoreCache();

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
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Maeve',
      lastName: 'Sample',
      dob: '2018-01-01',
      programId: '909062926',
      programType: 'Baldwin UFSD',
      hhaPatientId: '24745304',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-09-14',
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
      dateOfService: '2026-09-17',
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
    let calls = 0;
    let releaseGate = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const orig = hha.locateOrScheduleVisit.bind(hha);
    hha.locateOrScheduleVisit = async (visit) => {
      calls += 1;
      if (calls === 1) await gate;
      return orig(visit);
    };

    try {
      const first = transferLockedWeek({ store, week, hha, actorId: 'admin' });
      await vi.waitFor(() => expect(calls).toBe(1));
      const second = await transferLockedWeek({ store, week, hha, actorId: 'admin' });
      expect(second.ok).toBe(false);
      expect(second.transferred).toBe(0);
      expect(second.errors[0]).toMatch(/already running/i);
      expect(calls).toBe(1);
      releaseGate();
      const done = await first;
      expect(done.transferred).toBe(1);
      expect(hha.calls.filter((c) => c === 'locateOrScheduleVisit').length).toBe(1);
    } finally {
      releaseGate();
      if (prevTable === undefined) delete process.env.TMS_STATE_TABLE;
      else process.env.TMS_STATE_TABLE = prevTable;
      resetTmsDocStoreCache();
    }
  });
});

