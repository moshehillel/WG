import { describe, expect, it } from 'vitest';
import { screenServiceNote } from './ai-screen.js';
import { dueDateStatus, migrateDueDatesToSchools, shouldNagDue } from './due-dates.js';
import { weekStartFromDos } from './ids.js';
import { checkMandate, checkMandatesForWeek, isMakeupAuthMandate, maxSessionsInSchoolDayCycle, parseFrequencyPerWeek, schoolDayWindowStart } from './mandate.js';
import { parseMandatePdfText } from './mandate-parse.js';
import { unusedMissedForStudent, validateMakeup, resolveMakeupOfSessionId } from './makeup.js';
import { MemoryStore } from './memory-store.js';
import {
  adminWeeksList,
  dashboard,
  lastServiceByStudent,
  missingNotes,
  weekProgressReport,
} from './reports.js';
import { attendanceFromNotes, parseWeeklySessionText } from './session-parse.js';
import type { Mandate, SchoolCalendar, SessionRow } from './types.js';
import { afterLock, afterReopen, therapistCanEdit, therapistCanImportOrAddServices, therapistCanMutateExistingSession, weekIsProcessed } from './week-state.js';

function mandate(over: Partial<Mandate> = {}): Mandate {
  return {
    id: 'm1',
    studentId: 'st1',
    providerId: 'p1',
    serviceType: 'PT School',
    discipline: 'PT',
    frequencyPerWeek: 2,
    ratioGroup: false,
    sourcePdfKey: '',
    parsedAt: '',
    startOn: '',
    endOn: '',
    createdAt: '',
    ...over,
  };
}

function sess(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    weekId: 'w1',
    studentId: 'st1',
    dateOfService: '09/01/2026',
    beginTime: '9:00 am',
    endTime: '9:30 am',
    attendance: 'attended',
    cancelReason: '',
    makeupOfSessionId: '',
    serviceType: 'PT School',
    location: '',
    notes: 'Service Provided: gait',
    aiFlags: [],
    ...over,
  };
}

describe('mandate math', () => {
  it('parses 2x/week', () => {
    expect(parseFrequencyPerWeek('2x/week')).toBe(2);
    expect(parseFrequencyPerWeek('2 times per week')).toBe(2);
  });

  it('blocks over mandate', () => {
    const rows = [
      sess({ id: 'a', dateOfService: '09/01/2026', beginTime: '9:00 am', endTime: '9:30 am' }),
      sess({ id: 'b', dateOfService: '09/02/2026', beginTime: '10:00 am', endTime: '10:30 am' }),
      sess({ id: 'c', dateOfService: '09/03/2026', beginTime: '11:00 am', endTime: '11:30 am' }),
    ];
    const r = checkMandate(mandate(), rows, rows, { studentLabel: 'Aiden Odne' });
    expect(r.over).toBe(true);
    expect(r.used).toBe(3);
    expect(r.message).toMatch(/This exceeds the mandate for Aiden Odne/i);
    expect(r.message).toMatch(/09\/01\/2026 9:00 am–9:30 am/);
    expect(r.message).toMatch(/09\/02\/2026 10:00 am–10:30 am/);
    expect(r.message).toMatch(/Mandate allows 2 session\(s\) per week; this upload would make it 3/);
  });

  it('ignores additional services in mandate count', () => {
    const rows = [
      sess({ id: 'a' }),
      sess({ id: 'b' }),
      sess({ id: 'eval', additionalServiceType: 'eval', serviceType: 'Eval' }),
    ];
    const r = checkMandate(mandate({ frequencyPerWeek: 2 }), rows);
    expect(r.over).toBe(false);
    expect(r.used).toBe(2);
  });

  it('alerts under mandate', () => {
    const r = checkMandate(mandate(), [sess()]);
    expect(r.under).toBe(true);
    expect(r.over).toBe(false);
  });

  it('missed does not consume', () => {
    const r = checkMandate(mandate(), [
      sess({ id: 'a', attendance: 'missed' }),
      sess({ id: 'b' }),
    ]);
    expect(r.used).toBe(1);
    expect(r.under).toBe(true);
  });
});

describe('school_day_cycle calendar windows', () => {
  const cycleMandate = (): Mandate =>
    mandate({
      frequencyKind: 'school_day_cycle',
      frequencyPerWeek: 0,
      sessionsPerPeriod: 2,
      periodSchoolDays: 6,
    });

  const yearCal = (offDays: string[] = []): SchoolCalendar => ({
    schoolId: 'sch-1',
    yearStart: '2026-08-01',
    yearEnd: '2027-06-25',
    offDays,
  });

  it('excludes weekends from school-day windows (Mon–Fri only)', () => {
    // Fri 09/04 → back 6 school days: Fri Thu Wed Tue Mon Fri(prev) = start Mon 08/31
    // Weekend 09/05–06 are not school days.
    expect(schoolDayWindowStart('09/04/2026', 6)).toBe('2026-08-28');
    const densest = maxSessionsInSchoolDayCycle(
      [
        sess({ id: 'a', dateOfService: '08/28/2026' }),
        sess({ id: 'b', dateOfService: '09/01/2026' }),
        sess({ id: 'c', dateOfService: '09/04/2026' }),
      ],
      6,
    );
    expect(densest.used).toBe(3);
    expect(densest.windowStart).toBe('2026-08-28');
  });

  it('excludes admin off-days from the densest N school-day window', () => {
    // Without off day: window of 3 ending Thu 09/03 = Tue Wed Thu → sessions Tue+Thu = 2
    // With Wed off: window ending Thu = Mon Tue Thu → sessions Mon+Tue+Thu = 3
    const cal = yearCal(['2026-09-02']); // Wed
    const rows = [
      sess({ id: 'mon', dateOfService: '08/31/2026' }),
      sess({ id: 'tue', dateOfService: '09/01/2026' }),
      sess({ id: 'thu', dateOfService: '09/03/2026' }),
    ];
    expect(maxSessionsInSchoolDayCycle(rows, 3).used).toBe(2);
    expect(maxSessionsInSchoolDayCycle(rows, 3, cal).used).toBe(3);
    expect(schoolDayWindowStart('09/03/2026', 3, cal)).toBe('2026-08-31');
  });

  it('hard-blocks when densest school-day window exceeds cycle Freq', () => {
    const cal = yearCal(['2026-09-07']); // Labor Day Mon
    // 3 attended in a 6-school-day window with allowed=2 → over
    const rows = [
      sess({ id: 'a', dateOfService: '09/01/2026' }),
      sess({ id: 'b', dateOfService: '09/02/2026' }),
      sess({ id: 'c', dateOfService: '09/03/2026' }),
    ];
    const r = checkMandate(cycleMandate(), rows, rows, {
      studentLabel: 'Elmer',
      calendar: cal,
    });
    expect(r.cycleCheck).toBe(true);
    expect(r.over).toBe(true);
    expect(r.used).toBe(3);
    expect(r.allowed).toBe(2);
    expect(r.message).toMatch(/exceeds the cycle mandate for Elmer/i);
  });

  it('allows 2-of-2 when off-days stretch the window but densest stays within Freq', () => {
    const cal = yearCal(['2026-09-07', '2026-09-08']);
    const rows = [
      sess({ id: 'a', dateOfService: '09/01/2026' }),
      sess({ id: 'b', dateOfService: '09/03/2026' }),
    ];
    const r = checkMandate(cycleMandate(), rows, rows, { calendar: cal });
    expect(r.over).toBe(false);
    expect(r.used).toBe(2);
    expect(r.allowed).toBe(2);
  });

  it('checkMandatesForWeek uses per-student calendar for cycle over-check', () => {
    const mandates = [cycleMandate()];
    const rows = [
      sess({ id: 'a', dateOfService: '09/01/2026' }),
      sess({ id: 'b', dateOfService: '09/02/2026' }),
      sess({ id: 'c', dateOfService: '09/03/2026' }),
    ];
    const cal = yearCal(['2026-11-27']);
    const over = checkMandatesForWeek(
      mandates,
      rows,
      rows,
      new Map([['st1', 'Elmer']]),
      { calendarByStudentId: new Map([['st1', cal]]) },
    );
    expect(over.errors.some((e) => /exceeds the cycle mandate for Elmer/i.test(e))).toBe(true);
  });

  it('warns when cycle check falls back to Mon–Fri with no school calendar', () => {
    const mandates = [cycleMandate()];
    const rows = [sess({ id: 'a', dateOfService: '09/01/2026' })];
    const empty = checkMandatesForWeek(
      mandates,
      rows,
      rows,
      new Map([['st1', 'Elmer']]),
      {
        calendarByStudentId: new Map([['st1', null]]),
        schoolNameByStudentId: new Map([['st1', 'PS 118']]),
      },
    );
    expect(
      empty.warnings.some((w) =>
        /No school calendar for PS 118 — falling back to Mon–Fri/i.test(w),
      ),
    ).toBe(true);
    expect(empty.errors).toHaveLength(0);

    const withCal = checkMandatesForWeek(
      mandates,
      rows,
      rows,
      new Map([['st1', 'Elmer']]),
      {
        calendarByStudentId: new Map([['st1', yearCal()]]),
        schoolNameByStudentId: new Map([['st1', 'PS 118']]),
      },
    );
    expect(withCal.warnings.some((w) => /falling back to Mon–Fri/i.test(w))).toBe(false);
  });
});

describe('makeup', () => {
  it('blocks makeup without a missed id or makeup-auth', () => {
    const err = validateMakeup(
      sess({
        attendance: 'makeup',
        makeupOfSessionId: '',
        notes: 'Makeup session without a miss link',
      }),
      [],
    );
    expect(err).toMatch(/missed session|makeup authorization/i);
  });

  it('requires makeup word and missed date in notes', () => {
    const missed = sess({ id: 'miss', attendance: 'missed', dateOfService: '08/31/2026' });
    const noWord = sess({
      id: 'mu',
      attendance: 'makeup',
      makeupOfSessionId: 'miss',
      notes: 'for 08/31/2026',
    });
    expect(validateMakeup(noWord, [missed, noWord])).toMatch(/word makeup/i);
    const noDate = sess({
      id: 'mu2',
      attendance: 'makeup',
      makeupOfSessionId: 'miss',
      notes: 'Makeup session',
    });
    expect(validateMakeup(noDate, [missed, noDate])).toMatch(/date of the missed/i);
    const ok = sess({
      id: 'mu3',
      attendance: 'makeup',
      makeupOfSessionId: 'miss',
      notes: 'Makeup for missed session on 08/31/2026',
    });
    expect(validateMakeup(ok, [missed, ok])).toBeNull();
  });

  it('allows one makeup per missed', () => {
    const missed = sess({ id: 'miss', attendance: 'missed' });
    const makeup = sess({
      id: 'mu',
      attendance: 'makeup',
      makeupOfSessionId: 'miss',
      notes: 'Makeup for 09/01/2026',
      dateOfService: '09/03/2026',
    });
    expect(validateMakeup(makeup, [missed, makeup])).toBeNull();
    expect(unusedMissedForStudent([missed, makeup], 'st1')).toEqual([]);
  });

  it('resolves miss on date first, then makeup-auth, else errors', () => {
    const missed = sess({ id: 'miss', attendance: 'missed', dateOfService: '09/03/2026' });
    const other = sess({ id: 'miss2', attendance: 'missed', dateOfService: '09/01/2026' });
    const makeup = sess({
      id: 'mu',
      attendance: 'makeup',
      makeupOfSessionId: '',
      notes: 'Makeup for missed session on 09/03/2026',
      dateOfService: '09/05/2026',
    });
    expect(resolveMakeupOfSessionId(makeup, [missed, other, makeup], [])).toEqual({
      makeupOfSessionId: 'miss',
      via: 'miss',
    });

    const auth = mandate({
      id: 'm-auth',
      mandateKind: 'makeup_auth',
      serviceType: 'PT Makeup authorization',
      frequencyPerWeek: 0,
      sessionsPerPeriod: 2,
    });
    const noMiss = sess({
      id: 'mu2',
      attendance: 'makeup',
      makeupOfSessionId: '',
      notes: 'Makeup for missed session on 09/10/2026',
      dateOfService: '09/12/2026',
    });
    expect(resolveMakeupOfSessionId(noMiss, [missed, noMiss], [auth])).toEqual({
      makeupOfSessionId: '',
      via: 'makeup_auth',
    });
    expect(validateMakeup(noMiss, [missed, noMiss], [auth])).toBeNull();

    expect(resolveMakeupOfSessionId(noMiss, [missed, noMiss], [])).toMatchObject({
      error: expect.stringMatching(/No unused missed session on 09\/10/i),
    });

    const weekly = mandate({
      id: 'm-week',
      mandateKind: 'regular',
      frequencyPerWeek: 2,
      sessionsPerPeriod: 2,
    });
    expect(resolveMakeupOfSessionId(noMiss, [missed, noMiss], [weekly])).toMatchObject({
      error: expect.stringMatching(/no makeup authorization/i),
    });
  });

  it('does not count linked makeup against weekly mandate', () => {
    const missed = sess({ id: 'miss', attendance: 'missed' });
    const attended = sess({ id: 'a' });
    const makeup = sess({
      id: 'mu',
      attendance: 'makeup',
      makeupOfSessionId: 'miss',
      notes: 'Makeup for 09/01/2026',
    });
    const r = checkMandate(mandate({ frequencyPerWeek: 1 }), [missed, attended, makeup]);
    expect(r.over).toBe(false);
    expect(r.used).toBe(1);
  });

  it('counts only unlinked makeups against makeup-auth pool', () => {
    const auth = mandate({
      id: 'm-auth',
      mandateKind: 'makeup_auth',
      serviceType: 'PT Makeup authorization',
      frequencyPerWeek: 0,
      sessionsPerPeriod: 12,
    });
    expect(isMakeupAuthMandate(auth)).toBe(true);
    const linked = sess({
      id: 'mu1',
      attendance: 'makeup',
      makeupOfSessionId: 'm1',
      notes: 'Makeup for 09/01/2026',
    });
    const pool = [
      sess({ id: 'mu2', attendance: 'makeup', makeupOfSessionId: '', notes: 'Makeup session leftover' }),
      sess({ id: 'mu3', attendance: 'makeup', makeupOfSessionId: '', notes: 'Makeup session leftover two' }),
    ];
    const r = checkMandate(auth, [linked, ...pool], [linked, ...pool]);
    expect(r.over).toBe(false);
    expect(r.used).toBe(2);
    expect(r.allowed).toBe(12);
    const over = checkMandate(auth, pool, [
      ...pool,
      ...Array.from({ length: 11 }, (_, i) =>
        sess({ id: `x${i}`, attendance: 'makeup', makeupOfSessionId: '', notes: 'Makeup leftover' }),
      ),
    ]);
    expect(over.over).toBe(true);
  });
});

describe('week lock', () => {
  it('locks after sign and blocks therapist edits of existing sessions', () => {
    expect(therapistCanEdit('draft')).toBe(true);
    expect(therapistCanEdit('locked')).toBe(false);
    expect(afterLock('signed')).toBe('locked');
    expect(afterReopen('locked')).toBe('reopened');
    expect(therapistCanEdit('reopened')).toBe(true);
  });

  it('allows import/add on processed weeks but not mutate existing', () => {
    expect(weekIsProcessed('locked')).toBe(true);
    expect(therapistCanImportOrAddServices('locked')).toBe(false);
    expect(therapistCanImportOrAddServices('signed')).toBe(false);
    expect(therapistCanImportOrAddServices('submitted')).toBe(false);
    expect(therapistCanImportOrAddServices('draft')).toBe(true);
    expect(therapistCanMutateExistingSession('locked')).toBe(false);
    expect(therapistCanMutateExistingSession('submitted')).toBe(false);
    expect(therapistCanMutateExistingSession('signed', { isAdmin: true })).toBe(true);
  });
});

describe('mandate PDF parse-once', () => {
  it('reads last-first name and frequency', () => {
    const parsed = parseMandatePdfText(`
Child's Name: De Oliveira Jack
Date of Birth: 01/02/2018
Service Type: PT School Group
Mandate frequency: 2x/week
Program Type: Carle Place
`);
    expect(parsed.firstName).toBe('Jack');
    expect(parsed.lastName).toBe('De Oliveira');
    expect(parsed.frequencyPerWeek).toBe(2);
    expect(parsed.ratioGroup).toBe(true);
    expect(parsed.discipline).toBe('PT');
  });
});

describe('weekly notes', () => {
  it('marks student absence as missed', () => {
    expect(attendanceFromNotes('Student Absence: student not in school', '9:00 am', '9:30 am')).toBe(
      'missed',
    );
  });

  it('parses Frontline Student Absence rows as missed', () => {
    const rows = parseWeeklySessionText(`
Student Name: Odne, Aiden
Service Provider: Pat Lee
Service: Physical Therapy
09/02/2026 1:1 9:00 am 9:30 am Student Absence: student not in school
`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.attendance).toBe('missed');
    expect(rows[0]?.cancelReason).toMatch(/Student Absence|not in school|Absent/i);
  });

  it('parses a session date from text', () => {
    const rows = parseWeeklySessionText(`
Student Name: Jack De Oliveira
Service: Physical Therapy
09/01/2026 1:1 9:00 am 9:30 am Service Provided: gait Forest Road School
`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.attendance).toBe('attended');
  });

  it('skips From/To header dates on Frontline-style reports', () => {
    const rows = parseWeeklySessionText(`
Service: Physical Therapy
Service Provider: Pat Lee
From: 08/10/2026 To: 08/14/2026
Student Name: Aiden Odne, D.O.B. 07/12/2019
08/11/2026
1:1
8:50 am
9:20 am
Forest Road School
Service Provided: balance work
`);
    expect(rows.map((r) => r.dateOfService)).toEqual(['08/11/2026']);
    expect(rows[0]?.studentName).toBe('Aiden Odne');
    expect(rows[0]?.providerName).toBe('Pat Lee');
    expect(rows[0]?.schoolName).toMatch(/Forest Road School/i);
  });
});

describe('due dates and dashboard', () => {
  it('flags overdue', () => {
    expect(dueDateStatus({ id: 'd', schoolId: 'sch', kind: 'progress', dueOn: '2000-01-01', completedAt: '', lastNagOn: '' })).toBe(
      'overdue',
    );
  });
  it('nags until complete', () => {
    expect(shouldNagDue({ completedAt: '', dueOn: '2001-01-01' })).toBe(true);
    expect(shouldNagDue({ completedAt: '2026-01-01T00:00:00.000Z', dueOn: '2001-01-01' })).toBe(false);
  });

  it('lifts unambiguous student due dates onto schools and drops ambiguous', () => {
    const students = [
      {
        id: 's1',
        schoolId: 'sch1',
        firstName: 'A',
        lastName: 'B',
        dob: '',
        programId: '',
        programType: '',
        hhaPatientId: '',
        createdAt: '',
      },
      {
        id: 's2',
        schoolId: 'sch1',
        firstName: 'C',
        lastName: 'D',
        dob: '',
        programId: '',
        programType: '',
        hhaPatientId: '',
        createdAt: '',
      },
      {
        id: 's3',
        schoolId: 'sch2',
        firstName: 'E',
        lastName: 'F',
        dob: '',
        programId: '',
        programType: '',
        hhaPatientId: '',
        createdAt: '',
      },
    ];
    const lifted = migrateDueDatesToSchools(
      [
        { id: 'd1', studentId: 's1', kind: 'progress', dueOn: '2026-10-01', completedAt: '', lastNagOn: '' },
        { id: 'd2', studentId: 's2', kind: 'progress', dueOn: '2026-10-01', completedAt: '', lastNagOn: '' },
        { id: 'd3', studentId: 's3', kind: 'annual', dueOn: '2026-11-01', completedAt: '', lastNagOn: '' },
        { id: 'd4', studentId: 's1', kind: 'reeval', dueOn: '2026-12-01', completedAt: '', lastNagOn: '' },
        { id: 'd5', studentId: 's2', kind: 'reeval', dueOn: '2026-12-15', completedAt: '', lastNagOn: '' },
        { id: 'orphan', studentId: 'missing', kind: 'progress', dueOn: '2026-01-01', completedAt: '', lastNagOn: '' },
      ],
      students,
    );
    expect(lifted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ schoolId: 'sch1', kind: 'progress', dueOn: '2026-10-01' }),
        expect.objectContaining({ schoolId: 'sch2', kind: 'annual', dueOn: '2026-11-01' }),
      ]),
    );
    expect(lifted.find((d) => d.kind === 'reeval')).toBeUndefined();
    expect(lifted.find((d) => d.id === 'orphan')).toBeUndefined();
  });

  it('builds dashboard counts', () => {
    const store = new MemoryStore();
    store.upsertWeek({
      id: 'w',
      providerId: 'p',
      weekStart: '2026-08-31',
      status: 'submitted',
      signerName: '',
      signerEmail: '',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    expect(dashboard(store).timesheet.submitted).toBe(1);
    expect(lastServiceByStudent(store)).toEqual([]);
  });

  it('last service filters by provider and returns school', () => {
    const store = new MemoryStore();
    store.upsertSchool({
      id: 'sch',
      name: 'Forest',
      district: '',
      signerName: '',
      signerEmail: '',
      createdAt: '',
    });
    store.upsertProvider({
      id: 'p1',
      userId: '',
      firstName: 'Fatimah',
      lastName: 'Dawan',
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
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    });
    store.upsertStudent({
      id: 'st',
      schoolId: 'sch',
      firstName: 'Aiden',
      lastName: 'Odne',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: '',
    });
    store.upsertWeek({
      id: 'w',
      providerId: 'p1',
      weekStart: '2026-08-31',
      status: 'draft',
      signerName: '',
      signerEmail: '',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession(sess({ weekId: 'w', studentId: 'st', dateOfService: '09/02/2026' }));
    const rows = lastServiceByStudent(store, { providerId: 'p1' });
    expect(rows).toEqual([
      expect.objectContaining({
        studentId: 'st',
        name: 'Aiden Odne',
        providerName: 'Fatimah Dawan',
        schoolName: 'Forest',
        lastDos: '09/02/2026',
      }),
    ]);
    expect(lastServiceByStudent(store, { providerId: 'other' })).toEqual([]);
  });

  it('enriches missing notes with name, date, weekId', () => {
    const store = new MemoryStore();
    store.upsertStudent({
      id: 'st',
      schoolId: '',
      firstName: 'Aiden',
      lastName: 'Odne',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: '',
    });
    store.upsertSession(sess({ notes: '', weekId: 'w1', studentId: 'st' }));
    const rows = missingNotes(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.studentName).toBe('Aiden Odne');
    expect(rows[0]?.date).toBe('09/01/2026');
    expect(rows[0]?.weekId).toBe('w1');
    expect(rows[0]?.reason).toMatch(/missing/i);
    // Very short notes count as posted for missing-notes / pay progress.
    store.upsertSession(sess({ notes: 'ok', weekId: 'w1', studentId: 'st' }));
    expect(missingNotes(store)).toHaveLength(0);
  });

  it('lists admin weeks with provider name and session count', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: 72,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    });
    store.upsertWeek({
      id: 'w',
      providerId: 'p',
      weekStart: '2026-08-31',
      status: 'submitted',
      signerName: 'Principal',
      signerEmail: 'p@school.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession(sess({ weekId: 'w', studentId: 'st' }));
    const rows = adminWeeksList(store);
    expect(rows[0]?.providerName).toBe('Pat Lee');
    expect(rows[0]?.sessionCount).toBe(1);
    expect(rows[0]?.signerName).toBe('Principal');
  });

  it('admin weeks list survives missing hhaTransfers and merges transfer errors', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: 72,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    });
    store.upsertWeek({
      id: 'w',
      providerId: 'p',
      weekStart: '2026-08-31',
      status: 'signed',
      signerName: 'Principal',
      signerEmail: 'p@school.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'failed',
      hhaError: '',
    });
    // Simulate a corrupted/partial snapshot (legacy field name / missing array).
    (store.data as { transfers?: unknown }).transfers = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store.data as any).hhaTransfers = undefined;
    expect(() => adminWeeksList(store)).not.toThrow();
    expect(adminWeeksList(store)[0]?.hhaError).toBe('');

    store.data.hhaTransfers = [
      {
        id: 't1',
        sessionId: 's1',
        weekId: 'w',
        status: 'failed',
        hhaVisitId: '',
        lastError: 'HHA reject: bad auth',
        payloadHash: '',
      },
    ];
    expect(adminWeeksList(store)[0]?.hhaError).toContain('HHA reject');
  });

  it('week progress: provided = 50%, notes = 100%', () => {
    const store = new MemoryStore();
    store.upsertSchool({
      id: 'sch',
      name: 'Forest',
      district: '',
      signerName: '',
      signerEmail: '',
      createdAt: '',
    });
    store.upsertProvider({
      id: 'p1',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: 72,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    });
    store.upsertStudent({
      id: 'st',
      schoolId: 'sch',
      firstName: 'Aiden',
      lastName: 'Odne',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: '',
    });
    store.upsertMandate(
      mandate({ id: 'm1', studentId: 'st', providerId: 'p1', serviceType: 'PT School' }),
    );
    store.upsertWeek({
      id: 'w',
      providerId: 'p1',
      weekStart: '2026-08-31',
      status: 'draft',
      signerName: '',
      signerEmail: '',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession(
      sess({
        id: 'a',
        weekId: 'w',
        studentId: 'st',
        attendance: 'attended',
        notes: '',
      }),
    );
    store.upsertSession(
      sess({
        id: 'b',
        weekId: 'w',
        studentId: 'st',
        attendance: 'missed',
        notes: '',
      }),
    );
    const half = weekProgressReport(store, { from: '2026-08-31', to: '2026-08-31' });
    expect(half).toHaveLength(1);
    expect(half[0]?.mandateExpected).toBe(2);
    expect(half[0]?.sessionsProvided).toBe(1);
    expect(half[0]?.notesPosted).toBe(0);
    expect(half[0]?.sessionsDeliveredPct).toBe(50);
    expect(half[0]?.notesPostedPct).toBe(0);
    expect(half[0]?.progressPct).toBe(50);
    expect(half[0]?.belowMandate).toBe(true);
    expect(half[0]?.childName).toMatch(/Aiden/);
    expect(half[0]?.mandateLabel).toMatch(/PT/);

    store.upsertSession(
      sess({
        id: 'a',
        weekId: 'w',
        studentId: 'st',
        attendance: 'attended',
        notes: 'ok',
      }),
    );
    store.upsertSession(
      sess({
        id: 'b',
        weekId: 'w',
        studentId: 'st',
        attendance: 'missed',
        notes: 'Provider Absence:',
      }),
    );
    const mixed = weekProgressReport(store, { from: '2026-08-31', to: '2026-08-31' });
    // Mandate 2×: one delivered + one miss with note → delivered 50%, notes posted 100%.
    expect(mixed[0]?.sessionsProvided).toBe(1);
    expect(mixed[0]?.sessionsDeliveredPct).toBe(50);
    expect(mixed[0]?.notesPosted).toBe(2);
    expect(mixed[0]?.notesPostedPct).toBe(100);
    expect(mixed[0]?.belowMandate).toBe(true);
    expect(mixed[0]?.progressPct).toBe(50);
    expect(weekProgressReport(store, { from: '2026-09-07', to: '2026-09-07' })).toHaveLength(0);
  });
});

describe('week start', () => {
  it('uses Monday', () => {
    expect(weekStartFromDos('09/01/2026')).toBe('2026-08-31');
  });
});

describe('AI heuristic', () => {
  it('allows very short notes on attended sessions', () => {
    const r = screenServiceNote({
      notes: 'ok',
      attendance: 'attended',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      makeupOfSessionId: '',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(false);
    expect(r.flags).toEqual([]);
  });

  it('blocks empty notes on attended sessions', () => {
    const r = screenServiceNote({
      notes: '   ',
      attendance: 'attended',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      makeupOfSessionId: '',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(true);
    expect(r.blockFlags.some((f) => /required/i.test(f))).toBe(true);
  });

  it('allows very short makeup notes that include the word makeup', () => {
    const r = screenServiceNote({
      notes: 'makeup ok',
      attendance: 'makeup',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      makeupOfSessionId: 'missed-1',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(false);
  });

  it('blocks attended sessions missing times', () => {
    const r = screenServiceNote({
      notes: 'Service Provided: balance work in gym today',
      attendance: 'attended',
      beginTime: '',
      endTime: '',
      makeupOfSessionId: '',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(true);
    expect(r.blockFlags.some((f) => /time/i.test(f))).toBe(true);
  });

  it('allows empty missed notes without warning or block', () => {
    const r = screenServiceNote({
      notes: '',
      attendance: 'missed',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      makeupOfSessionId: '',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(false);
    expect(r.flags).toEqual([]);
    expect(r.warnFlags).toEqual([]);
  });

  it('passes a complete attended note', () => {
    const r = screenServiceNote({
      notes: 'Service Provided: balance work in gym',
      attendance: 'attended',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      makeupOfSessionId: '',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(false);
    expect(r.flags).toEqual([]);
  });
});
