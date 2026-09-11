import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory-store.js';
import { nowIso, newId } from './ids.js';
import {
  splitWeekBySchoolBins,
  timesheetBinKeyForSchool,
  weekMatchesSchoolBin,
} from './week-school.js';

function emptyStore() {
  return new MemoryStore();
}

describe('week-school bins', () => {
  it('groups schools that share a signer email', () => {
    expect(
      timesheetBinKeyForSchool({ id: 'a', signerEmail: 'Principal@School.Test' }),
    ).toBe(timesheetBinKeyForSchool({ id: 'b', signerEmail: 'principal@school.test' }));
  });

  it('splits schools with different signers', () => {
    expect(timesheetBinKeyForSchool({ id: 'a', signerEmail: 'a@x.com' })).not.toBe(
      timesheetBinKeyForSchool({ id: 'b', signerEmail: 'b@x.com' }),
    );
  });

  it('splitWeekBySchoolBins moves other-signer sessions onto a new week', () => {
    const store = emptyStore();
    const schoolA = store.upsertSchool({
      id: 'sa',
      name: 'School A',
      district: 'District A',
      signerName: 'A',
      signerEmail: 'a@school.test',
      createdAt: nowIso(),
    });
    const schoolB = store.upsertSchool({
      id: 'sb',
      name: 'School B',
      district: 'District B',
      signerName: 'B',
      signerEmail: 'b@school.test',
      createdAt: nowIso(),
    });
    const childA = store.upsertStudent({
      id: 'ca',
      schoolId: schoolA.id,
      firstName: 'Ann',
      lastName: 'A',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const childB = store.upsertStudent({
      id: 'cb',
      schoolId: schoolB.id,
      firstName: 'Bob',
      lastName: 'B',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: 'w1',
      providerId: 'p1',
      weekStart: '2026-09-07',
      status: 'draft',
      signerName: schoolA.signerName,
      signerEmail: schoolA.signerEmail,
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: 's1',
      weekId: week.id,
      studentId: childA.id,
      dateOfService: '09/08/2026',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT',
      location: 'school',
      notes: 'a',
      cptCodes: [],
      cptLabel: '',
      aiFlags: [],
      aiBlock: false,
    });
    store.upsertSession({
      id: 's2',
      weekId: week.id,
      studentId: childB.id,
      dateOfService: '09/09/2026',
      beginTime: '10:00 am',
      endTime: '10:30 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT',
      location: 'school',
      notes: 'b',
      cptCodes: [],
      cptLabel: '',
      aiFlags: [],
      aiBlock: false,
    });

    const bins = splitWeekBySchoolBins(store, week, () => newId());
    expect(bins).toHaveLength(2);
    expect(store.data.weeks).toHaveLength(2);
    const weekA = store.data.weeks.find((w) => w.schoolId === schoolA.id)!;
    const weekB = store.data.weeks.find((w) => w.schoolId === schoolB.id)!;
    expect(store.sessionsForWeek(weekA.id)).toHaveLength(1);
    expect(store.sessionsForWeek(weekB.id)).toHaveLength(1);
    expect(weekMatchesSchoolBin(store, weekA, schoolA.id)).toBe(true);
    expect(weekMatchesSchoolBin(store, weekB, schoolB.id)).toBe(true);
    expect(weekMatchesSchoolBin(store, weekA, schoolB.id)).toBe(false);
  });

  it('keeps same-signer buildings on one timesheet bin', () => {
    const store = emptyStore();
    const hegarty = store.upsertSchool({
      id: 'h',
      name: 'Hegarty',
      district: 'Carle Place',
      signerName: 'Madison',
      signerEmail: 'm@wg.test',
      createdAt: nowIso(),
    });
    const carle = store.upsertSchool({
      id: 'c',
      name: 'Carle MS',
      district: 'Carle Place',
      signerName: 'Madison',
      signerEmail: 'm@wg.test',
      createdAt: nowIso(),
    });
    const childA = store.upsertStudent({
      id: 'ca',
      schoolId: hegarty.id,
      firstName: 'Ann',
      lastName: 'A',
      dob: '',
      programId: '',
      programType: 'Carle Place UFSD',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const childB = store.upsertStudent({
      id: 'cb',
      schoolId: carle.id,
      firstName: 'Bob',
      lastName: 'B',
      dob: '',
      programId: '',
      programType: 'Carle Place UFSD',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: 'w1',
      providerId: 'p1',
      weekStart: '2026-09-07',
      status: 'draft',
      signerName: 'Madison',
      signerEmail: 'm@wg.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    for (const [id, studentId] of [
      ['s1', childA.id],
      ['s2', childB.id],
    ] as const) {
      store.upsertSession({
        id,
        weekId: week.id,
        studentId,
        dateOfService: '09/08/2026',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        attendance: 'attended',
        cancelReason: '',
        makeupOfSessionId: '',
        serviceType: 'PT',
        location: 'school',
        notes: id,
        cptCodes: [],
        cptLabel: '',
        aiFlags: [],
        aiBlock: false,
      });
    }
    const bins = splitWeekBySchoolBins(store, week, () => newId());
    expect(bins).toHaveLength(1);
    expect(store.data.weeks).toHaveLength(1);
  });
});
