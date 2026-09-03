import { describe, expect, it } from 'vitest';
import { screenServiceNote } from './ai-screen.js';
import { dueDateStatus, migrateDueDatesToSchools, shouldNagDue } from './due-dates.js';
import { weekStartFromDos } from './ids.js';
import { checkMandate, parseFrequencyPerWeek } from './mandate.js';
import { parseMandatePdfText } from './mandate-parse.js';
import { unusedMissedForStudent, validateMakeup } from './makeup.js';
import { MemoryStore } from './memory-store.js';
import { adminWeeksList, dashboard, lastServiceByStudent, missingNotes } from './reports.js';
import { attendanceFromNotes, parseWeeklySessionText } from './session-parse.js';
import type { Mandate, SessionRow } from './types.js';
import { afterLock, afterReopen, therapistCanEdit } from './week-state.js';

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
    const rows = [sess({ id: 'a' }), sess({ id: 'b' }), sess({ id: 'c' })];
    const r = checkMandate(mandate(), rows);
    expect(r.over).toBe(true);
    expect(r.used).toBe(3);
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

describe('makeup', () => {
  it('blocks makeup without a missed id', () => {
    const err = validateMakeup(sess({ attendance: 'makeup', makeupOfSessionId: '' }), []);
    expect(err).toMatch(/documented missed/i);
  });

  it('allows one makeup per missed', () => {
    const missed = sess({ id: 'miss', attendance: 'missed' });
    const makeup = sess({ id: 'mu', attendance: 'makeup', makeupOfSessionId: 'miss' });
    expect(validateMakeup(makeup, [missed, makeup])).toBeNull();
    expect(unusedMissedForStudent([missed, makeup], 'st1')).toEqual([]);
  });
});

describe('week lock', () => {
  it('locks after sign and blocks therapist edits', () => {
    expect(therapistCanEdit('draft')).toBe(true);
    expect(therapistCanEdit('locked')).toBe(false);
    expect(afterLock('signed')).toBe('locked');
    expect(afterReopen('locked')).toBe('reopened');
    expect(therapistCanEdit('reopened')).toBe(true);
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
    store.upsertSession(sess({ notes: 'short', weekId: 'w1', studentId: 'st' }));
    const rows = missingNotes(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.studentName).toBe('Aiden Odne');
    expect(rows[0]?.date).toBe('09/01/2026');
    expect(rows[0]?.weekId).toBe('w1');
  });

  it('lists admin weeks with provider name and session count', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRate: 72,
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
});

describe('week start', () => {
  it('uses Monday', () => {
    expect(weekStartFromDos('09/01/2026')).toBe('2026-08-31');
  });
});

describe('AI heuristic', () => {
  it('blocks short notes on attended sessions', () => {
    const r = screenServiceNote({
      notes: 'ok',
      attendance: 'attended',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      makeupOfSessionId: '',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(true);
    expect(r.blockFlags.some((f) => /incomplete/i.test(f))).toBe(true);
  });

  it('blocks short notes on makeup sessions', () => {
    const r = screenServiceNote({
      notes: 'brief',
      attendance: 'makeup',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      makeupOfSessionId: 'missed-1',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(true);
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

  it('warns on missed notes without blocking', () => {
    const r = screenServiceNote({
      notes: 'No detail given',
      attendance: 'missed',
      beginTime: '',
      endTime: '',
      makeupOfSessionId: '',
      dateOfService: '09/01/2026',
    });
    expect(r.block).toBe(false);
    expect(r.warnFlags.length).toBeGreaterThan(0);
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
