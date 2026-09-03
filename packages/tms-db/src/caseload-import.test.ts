import { describe, expect, it } from 'vitest';
import {
  applyCaseloadImport,
  formatFreqDisplay,
  parseCaseloadCsv,
  splitCsvLine,
} from './caseload-import.js';
import { checkMandatesForWeek } from './mandate.js';
import { MemoryStore } from './memory-store.js';
import type { Mandate, SessionRow } from './types.js';
import { nowIso } from './ids.js';

const KU_SAMPLE = `Recommended School,Last Name,First Name,Grade,Decision,RS Start,RS End,Related Service,Ratio,Freq,Period,Location,RS Provider
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Small Group,1,Weekly,Push-In,Pat Lee
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,Pat Lee
Shaw Avenue,Diaz,Elmer Cruz,4,Approved,09/01/2025,06/30/2026,OT,Small Group,2,6 day cycle,Push-In,Pat Lee
Shaw Avenue,Khan,Musa,2,Approved,09/01/2025,06/30/2026,PT,Small Group,1,6 day cycle,Push-In,Pat Lee
Shaw Avenue,Khan,Musa,2,Approved,09/01/2025,06/30/2026,PT,Individual,1,6 day cycle,Pull-Out,Pat Lee
"Oak Street","O'Brien","Mary Ann",1,Approved,9/1/2025,6/30/2026,SLP,Individual,1,Weekly,"Therapy, room 12",Unknown Provider
`;

function mandate(over: Partial<Mandate> = {}): Mandate {
  return {
    id: 'm1',
    studentId: 'st1',
    providerId: 'p1',
    serviceType: 'PT School',
    discipline: 'PT',
    frequencyPerWeek: 2,
    frequencyKind: 'weekly',
    sessionsPerPeriod: 2,
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

describe('caseload CSV parser', () => {
  it('splits quoted commas', () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(['a', 'b, c', 'd']);
  });

  it('parses KU sample: weekly dual + 6-day cycle', () => {
    const parsed = parseCaseloadCsv(KU_SAMPLE);
    expect(parsed.errors.filter((e) => e.rowNumber === 0)).toEqual([]);
    expect(parsed.rows.length).toBe(6);

    const ahmad = parsed.rows.filter((r) => r.lastName === 'Haris' && r.firstName === 'Ahmad');
    expect(ahmad).toHaveLength(2);
    expect(ahmad.every((r) => r.frequencyKind === 'weekly')).toBe(true);
    expect(ahmad.every((r) => r.frequencyPerWeek === 1)).toBe(true);
    expect(ahmad.some((r) => r.ratioGroup)).toBe(true);
    expect(ahmad.some((r) => !r.ratioGroup)).toBe(true);
    expect(ahmad[0].freqDisplay).toBe('1 / week');

    const elmer = parsed.rows.find((r) => r.lastName === 'Diaz');
    expect(elmer?.firstName).toBe('Elmer Cruz');
    expect(elmer?.frequencyKind).toBe('school_day_cycle');
    expect(elmer?.frequencyPerWeek).toBe(0);
    expect(elmer?.sessionsPerPeriod).toBe(2);
    expect(elmer?.periodSchoolDays).toBe(6);
    expect(elmer?.freqDisplay).toBe('2 / 6 school days');
    expect(elmer?.discipline).toBe('OT');

    const musa = parsed.rows.filter((r) => r.lastName === 'Khan');
    expect(musa).toHaveLength(2);
    expect(musa.every((r) => r.frequencyKind === 'school_day_cycle')).toBe(true);
    expect(musa.every((r) => r.frequencyPerWeek === 0)).toBe(true);

    const mary = parsed.rows.find((r) => r.lastName === "O'Brien");
    expect(mary?.location).toBe('Therapy, room 12');
    expect(mary?.discipline).toBe('SLP');
  });

  it('formatFreqDisplay', () => {
    expect(formatFreqDisplay('weekly', 1, 0)).toBe('1 / week');
    expect(formatFreqDisplay('school_day_cycle', 2, 6)).toBe('2 / 6 school days');
  });

  it('dry-run does not persist; confirm creates dual mandates', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p1',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRate: null,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const parsed = parseCaseloadCsv(KU_SAMPLE);
    const preview = applyCaseloadImport(store, parsed, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(store.data.students).toHaveLength(0);
    expect(store.data.mandates).toHaveLength(0);
    expect(preview.createdMandates).toBe(6);
    expect(preview.rows.filter((r) => r.lastName === 'Haris')).toHaveLength(2);
    expect(preview.rows.find((r) => r.providerName === 'Unknown Provider')?.providerMatched).toBe(false);

    const committed = applyCaseloadImport(store, parsed, { dryRun: false });
    expect(committed.dryRun).toBe(false);
    expect(store.data.students.length).toBeGreaterThanOrEqual(4);
    const ahmad = store.findStudentByName('Ahmad', 'Haris');
    expect(ahmad).toBeTruthy();
    expect(store.mandatesForStudent(ahmad!.id)).toHaveLength(2);
    const musa = store.findStudentByName('Musa', 'Khan');
    expect(store.mandatesForStudent(musa!.id)).toHaveLength(2);
    const cycle = store.mandatesForStudent(musa!.id)[0];
    expect(cycle.frequencyKind).toBe('school_day_cycle');
    expect(cycle.frequencyPerWeek).toBe(0);
    expect(cycle.sessionsPerPeriod).toBe(1);
    expect(cycle.periodSchoolDays).toBe(6);
  });
});

describe('multi-mandate weekly check', () => {
  it('checks individual and group separately', () => {
    const mandates = [
      mandate({ id: 'm-ind', ratioGroup: false, frequencyPerWeek: 1, sessionsPerPeriod: 1 }),
      mandate({ id: 'm-grp', ratioGroup: true, frequencyPerWeek: 1, sessionsPerPeriod: 1, serviceType: 'PT School Group' }),
    ];
    const ok = checkMandatesForWeek(mandates, [
      sess({ id: 'a', serviceType: 'PT School Individual' }),
      sess({ id: 'b', serviceType: 'PT School Group' }),
    ]);
    expect(ok.errors).toEqual([]);

    const over = checkMandatesForWeek(mandates, [
      sess({ id: 'a', serviceType: 'PT School Individual' }),
      sess({ id: 'b', serviceType: 'PT School Individual' }),
      sess({ id: 'c', serviceType: 'PT School Group' }),
    ]);
    expect(over.errors.some((e) => /Over mandate/i.test(e))).toBe(true);
  });

  it('skips weekly over-check for 6-day cycle mandates', () => {
    const mandates = [
      mandate({
        id: 'm-cycle',
        frequencyKind: 'school_day_cycle',
        frequencyPerWeek: 0,
        sessionsPerPeriod: 2,
        periodSchoolDays: 6,
      }),
    ];
    const r = checkMandatesForWeek(mandates, [
      sess({ id: 'a' }),
      sess({ id: 'b' }),
      sess({ id: 'c' }),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => /weekly over-check skipped/i.test(w))).toBe(true);
  });
});
