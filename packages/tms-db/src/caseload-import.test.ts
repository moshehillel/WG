import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  applyCaseloadImport,
  consolidateDuplicateProviderMandates,
  findProviderByName,
  formatFreqDisplay,
  isAgencyProviderName,
  isOrphanProvider,
  mandateMatchKey,
  nameTokenKey,
  parseCaseloadCsv,
  parseCaseloadUpload,
  parseCaseloadWorkbook,
  providerDisplayNameKey,
  purgeOrphanProviders,
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

  it('emits one structured error per field problem', () => {
    const csv = `Recommended School,Last Name,First Name,Grade,Decision,RS Start,RS End,Related Service,Ratio,Freq,Period,Location,RS Provider
Shaw Avenue,,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Push-In,Pat Lee
Shaw Avenue,Diaz,Elmer,4,Approved,not-a-date,06/30/2026,OT,Individual,1,Weekly,Push-In,Pat Lee
Shaw Avenue,Khan,Musa,2,Approved,09/01/2025,06/30/2026,PT,Individual,1,Biweekly,Push-In,Pat Lee
Shaw Avenue,Ok,Good,1,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Push-In,Pat Lee
`;
    const parsed = parseCaseloadCsv(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].lastName).toBe('Ok');
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          rowNumber: 2,
          field: 'Last Name',
          problem: 'Last Name is empty.',
          fix: "Add the student's last name.",
          message: expect.stringMatching(/Last Name is empty/i),
        }),
        expect.objectContaining({
          row: 3,
          field: 'RS Start',
          student: 'Elmer Diaz',
          problem: expect.stringMatching(/RS Start date "not-a-date"/i),
          fix: expect.stringMatching(/MM\/DD\/YYYY/i),
        }),
        expect.objectContaining({
          row: 4,
          field: 'Period',
          student: 'Musa Khan',
          problem: 'Period "Biweekly" is not recognized.',
          fix: expect.stringMatching(/Weekly|6 day cycle/i),
        }),
      ]),
    );
    expect(parsed.errors.every((e) => e.problem && e.fix && e.message)).toBe(true);
  });

  it('dry-run does not persist; confirm creates dual mandates', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p1',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const parsed = parseCaseloadCsv(KU_SAMPLE);
    const preview = applyCaseloadImport(store, parsed, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(store.data.students).toHaveLength(0);
    expect(store.data.mandates).toHaveLength(0);
    expect(preview.createdMandates).toBe(5);
    expect(preview.rows.filter((r) => r.lastName === 'Haris')).toHaveLength(2);
    expect(preview.errors.some((e) => /Unknown Provider/i.test(e.problem))).toBe(true);
    expect(preview.rows.find((r) => r.providerName === 'Unknown Provider')).toBeUndefined();

    const committed = applyCaseloadImport(store, parsed);
    expect(committed.dryRun).toBe(false);
    expect(store.data.students.length).toBeGreaterThanOrEqual(3);
    expect(store.findStudentByName('Mary Ann', "O'Brien")).toBeUndefined();
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

  it('unmatched RS Provider is a hard error — no empty-provider mandate', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-pat',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    const csv = `Recommended School,Last Name,First Name,Grade,Decision,RS Start,RS End,Related Service,Ratio,Freq,Period,Location,RS Provider
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,Pat Lee
Shaw Avenue,Diaz,Elmer,4,Approved,09/01/2025,06/30/2026,OT,Individual,1,Weekly,Pull-Out,Nobody Here
Shaw Avenue,Fox,Sincere,2,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,White Glove
`;
    const applied = applyCaseloadImport(store, parseCaseloadCsv(csv));
    expect(applied.createdMandates).toBe(1);
    expect(applied.errors.length).toBe(2);
    expect(applied.errors.some((e) => /Nobody Here/i.test(e.problem))).toBe(true);
    expect(applied.errors.some((e) => /agency label/i.test(e.problem))).toBe(true);
    expect(store.data.mandates).toHaveLength(1);
    expect(store.data.mandates[0]?.providerId).toBe('p-pat');
    expect(store.findStudentByName('Elmer', 'Diaz')).toBeUndefined();
    expect(store.findStudentByName('Sincere', 'Fox')).toBeUndefined();
  });

  it('re-import upserts: no duplicate students/mandates; fills provider on second pass', () => {
    const store = new MemoryStore();
    const csvUnmatched = `Recommended School,Last Name,First Name,Grade,Decision,RS Start,RS End,Related Service,Ratio,Freq,Period,Location,RS Provider
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,"White, Glove"
Shaw Avenue,Diaz,Elmer,4,Approved,09/01/2025,06/30/2026,OT,Individual,2,6 day cycle,Push-In,"White, Glove"
`;
    const first = applyCaseloadImport(store, parseCaseloadCsv(csvUnmatched));
    expect(first.createdStudents).toBe(0);
    expect(first.createdMandates).toBe(0);
    expect(first.errors.length).toBe(2);
    expect(store.data.students).toHaveLength(0);
    expect(store.data.mandates).toHaveLength(0);
    expect(first.errors.some((e) => /White,\s*Glove/i.test(e.problem))).toBe(true);

    store.upsertProvider({
      id: 'p-pat',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });

    const csvFixed = csvUnmatched.replace(/"White, Glove"/g, 'Pat Lee');
    const second = applyCaseloadImport(store, parseCaseloadCsv(csvFixed));
    expect(second.createdStudents).toBe(2);
    expect(second.createdMandates).toBe(2);
    expect(second.updatedMandates).toBe(0);
    expect(store.data.students).toHaveLength(2);
    expect(store.data.mandates).toHaveLength(2);
    expect(store.data.mandates.every((m) => m.providerId === 'p-pat')).toBe(true);
    expect(second.rows.every((r) => r.providerMatched)).toBe(true);
  });

  it('mandateMatchKey normalizes discipline aliases and dates', () => {
    expect(
      mandateMatchKey({
        discipline: 'PT',
        serviceType: 'PT School',
        ratioGroup: false,
        frequencyKind: 'weekly',
        sessionsPerPeriod: 1,
        startOn: '2025-09-01',
        endOn: '2026-06-30',
      }),
    ).toBe(
      mandateMatchKey({
        discipline: '',
        serviceType: 'PT School Individual',
        ratioGroup: false,
        frequencyKind: 'weekly',
        sessionsPerPeriod: 1,
        frequencyPerWeek: 1,
        startOn: '09/01/2025',
        endOn: '6/30/2026',
      }),
    );
  });
  it('parses final WG CSV header aliases (weekly + 6 day cycle)', () => {
    const csv = `Student Gen Ed ID#,CR Recommended School,Student Last Name,Student First Name,CR Expected Grade,CR Decision/Status,Related Service,RS Start,RS End,RS Ratio,RS Frequency,RS Period,RS Duration,RS Location,RS Provider
1,Shaw Avenue,Haris,Ahmad,03,Classified,Physical Therapy,09/01/2025,06/30/2026,Individual,1,Weekly,30,School,"White, Glove"
2,Shaw Avenue,Diaz,Elmer,04,Classified,Occupational Therapy,09/01/2025,06/30/2026,Small Group,2,6 day cycle,30,School,White Glove
`;
    const parsed = parseCaseloadCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      schoolName: 'Shaw Avenue',
      frequencyKind: 'weekly',
      frequencyPerWeek: 1,
      providerName: 'White, Glove',
    });
    expect(parsed.rows[1]).toMatchObject({
      frequencyKind: 'school_day_cycle',
      sessionsPerPeriod: 2,
      periodSchoolDays: 6,
      frequencyPerWeek: 0,
      ratioGroup: true,
      providerName: 'White Glove',
    });
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

const KU_HEADERS = [
  'Recommended School',
  'Last Name',
  'First Name',
  'Grade',
  'Decision',
  'RS Start',
  'RS End',
  'Related Service',
  'Ratio',
  'Freq',
  'Period',
  'Location',
  'RS Provider',
];

/** Final KU “Related Service by serviceschool (WG)” Listing Results headers. */
const WG_HEADERS = [
  'Student Gen Ed ID#',
  'CR Recommended School',
  'Student Last Name',
  'Student First Name',
  'CR Expected Grade',
  'CR Decision/Status',
  'Related Service',
  'RS Start',
  'RS End',
  'RS Ratio',
  'RS Frequency',
  'RS Period',
  'RS Duration',
  'RS Location',
  'RS Provider',
];

function kuAoa(extraTitle = false): (string | number)[][] {
  const data: (string | number)[][] = [
    KU_HEADERS,
    ['Shaw Avenue', 'Haris', 'Ahmad', 3, 'Approved', 45901, 46203, 'PT', 'Small Group', 1, 'Weekly', 'Push-In', 'Pat Lee'],
    ['Shaw Avenue', 'Diaz', 'Elmer', 4, 'Approved', '09/01/2025', '06/30/2026', 'OT', 'Individual', 2, '6 day cycle', 'Push-In', 'Pat Lee'],
  ];
  if (!extraTitle) return data;
  return [['KU SCHOOL YEAR Related Service Details by School'], [], ...data];
}

function wgAoa(): (string | number)[][] {
  return [
    WG_HEADERS,
    [
      '922522794',
      'Alden Terrace School',
      'Abedin',
      'Omar',
      '04',
      'Classified',
      'Physical Therapy',
      '9/2/2026',
      '6/25/2027',
      'Individual',
      '2',
      'Weekly',
      '30',
      'School',
      'Vasaturo, James',
    ],
    [
      '111055897',
      'Alden Terrace School',
      'Fox',
      'Sincere',
      '06',
      'Classified',
      'Physical Therapy',
      '9/2/2026',
      '6/25/2027',
      'Individual',
      '2',
      'Weekly',
      '30',
      'Therapy Room',
      'White, Glove',
    ],
    [
      '909062464',
      'Shaw Avenue',
      'Diaz',
      'Elmer',
      '04',
      'Classified',
      'Occupational Therapy',
      '9/2/2026',
      '6/25/2027',
      'Small Group',
      '2',
      '6 day cycle',
      '30',
      'School',
      'White Glove',
    ],
  ];
}

function writeKuBook(bookType: 'xlsx' | 'xls', extraTitle = false): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(kuAoa(extraTitle));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, extraTitle ? 'Sheet1' : 'Details');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType }) as Buffer);
}

function writeWgBook(bookType: 'xlsx' | 'xls' = 'xls'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(wgAoa());
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Listing Results');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Sheet2');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType }) as Buffer);
}

describe('caseload Excel parser', () => {
  it('parses generated xlsx with KU headers and Excel date serials', () => {
    const parsed = parseCaseloadWorkbook(writeKuBook('xlsx'));
    expect(parsed.errors.filter((e) => e.rowNumber === 0)).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    const ahmad = parsed.rows.find((r) => r.lastName === 'Haris');
    expect(ahmad?.firstName).toBe('Ahmad');
    expect(ahmad?.startOn).toBe('2025-09-01');
    expect(ahmad?.endOn).toBe('2026-06-30');
    expect(ahmad?.frequencyKind).toBe('weekly');
    expect(ahmad?.ratioGroup).toBe(true);
    const elmer = parsed.rows.find((r) => r.lastName === 'Diaz');
    expect(elmer?.frequencyKind).toBe('school_day_cycle');
    expect(elmer?.sessionsPerPeriod).toBe(2);
    expect(elmer?.periodSchoolDays).toBe(6);
  });

  it('parses generated BIFF8 xls and skips a title row', () => {
    const parsed = parseCaseloadWorkbook(writeKuBook('xls', true));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].rowNumber).toBeGreaterThan(2);
    expect(parsed.rows.map((r) => r.lastName).sort()).toEqual(['Diaz', 'Haris']);
  });

  it('parses final Related Service by serviceschool (WG) layout', () => {
    const parsed = parseCaseloadWorkbook(writeWgBook('xls'));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(3);

    const omar = parsed.rows.find((r) => r.lastName === 'Abedin');
    expect(omar).toMatchObject({
      schoolName: 'Alden Terrace School',
      firstName: 'Omar',
      grade: '04',
      decision: 'Classified',
      serviceType: 'Physical Therapy',
      discipline: 'PT',
      ratioGroup: false,
      durationMinutes: 30,
      groupSize: 1,
      frequencyKind: 'weekly',
      frequencyPerWeek: 2,
      sessionsPerPeriod: 2,
      location: 'School',
      providerName: 'Vasaturo, James',
      startOn: '2026-09-02',
      endOn: '2027-06-25',
      freqDisplay: '2 / week',
    });

    const sincere = parsed.rows.find((r) => r.lastName === 'Fox');
    expect(sincere?.location).toBe('Therapy Room');
    expect(sincere?.durationMinutes).toBe(30);
    expect(sincere?.groupSize).toBe(1);
    expect(sincere?.providerName).toBe('White, Glove');

    const elmer = parsed.rows.find((r) => r.lastName === 'Diaz');
    expect(elmer?.frequencyKind).toBe('school_day_cycle');
    expect(elmer?.frequencyPerWeek).toBe(0);
    expect(elmer?.sessionsPerPeriod).toBe(2);
    expect(elmer?.periodSchoolDays).toBe(6);
    expect(elmer?.freqDisplay).toBe('2 / 6 school days');
    expect(elmer?.ratioGroup).toBe(true);
    expect(elmer?.durationMinutes).toBe(30);
    expect(elmer?.groupSize).toBeNull();
    expect(elmer?.discipline).toBe('OT');
    expect(elmer?.providerName).toBe('White Glove');
  });

  it('maps RS Duration and derives group size from Ratio / Group Size column', () => {
    const csv = `Student Last Name,Student First Name,Related Service,RS Ratio,RS Frequency,RS Period,RS Duration,Group Size,RS Provider
Haris,Ahmad,PT,Individual,1,Weekly,45,,Pat Lee
Diaz,Elmer,OT,Small Group,2,Weekly,30,3,Pat Lee
Fox,Sincere,PT,2:1,1,Weekly,42,,Pat Lee
`;
    const parsed = parseCaseloadCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.find((r) => r.lastName === 'Haris')).toMatchObject({
      durationMinutes: 45,
      groupSize: 1,
      ratioGroup: false,
    });
    expect(parsed.rows.find((r) => r.lastName === 'Diaz')).toMatchObject({
      durationMinutes: 30,
      groupSize: 3,
      ratioGroup: true,
    });
    expect(parsed.rows.find((r) => r.lastName === 'Fox')).toMatchObject({
      durationMinutes: 42,
      groupSize: 2,
      ratioGroup: true,
    });
  });

  it('treats White Glove as agency and hard-errors unmatched providers (no default)', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-fatimah',
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
      payRateAdditionalHourly: null,
      hhaCaregiverCode: 'FD-1',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertProvider({
      id: 'p-james',
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
      payRateAdditionalHourly: null,
      hhaCaregiverCode: 'JV-1',
      active: true,
      createdAt: nowIso(),
    });
    const applied = applyCaseloadImport(store, parseCaseloadWorkbook(writeWgBook('xlsx')));
    const fox = applied.rows.find((r) => r.lastName === 'Fox');
    const elmer = applied.rows.find((r) => r.lastName === 'Diaz');
    const omar = applied.rows.find((r) => r.lastName === 'Abedin');
    expect(omar?.providerMatched).toBe(true);
    expect(omar?.providerId).toBe('p-james');
    expect(fox).toBeUndefined();
    expect(elmer).toBeUndefined();
    expect(applied.errors.some((e) => /White,\s*Glove|White Glove|agency/i.test(e.problem))).toBe(
      true,
    );
    expect(store.data.mandates.filter((m) => m.providerId === 'p-james').length).toBe(1);
    expect(store.data.mandates.every((m) => Boolean(m.providerId))).toBe(true);
    expect(store.data.students.every((s) => !('providerId' in s) || !(s as { providerId?: string }).providerId)).toBe(
      true,
    );
  });

  it('has no default-provider fallback path', () => {
    const csv = `Recommended School,Last Name,First Name,Grade,Decision,RS Start,RS End,Related Service,Ratio,Freq,Period,Location,RS Provider
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,Pat Lee
Shaw Avenue,Diaz,Elmer,4,Approved,09/01/2025,06/30/2026,OT,Individual,1,Weekly,Pull-Out,White Glove
Shaw Avenue,Fox,Sincere,2,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,Unknown Nobody
`;
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-pat',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertProvider({
      id: 'p-default',
      userId: '',
      firstName: 'Default',
      lastName: 'Therapist',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    const applied = applyCaseloadImport(store, parseCaseloadCsv(csv), {
      // @ts-expect-error defaultProviderId removed — must be ignored if passed
      defaultProviderId: 'p-default',
    });
    const ahmad = applied.rows.find((r) => r.lastName === 'Haris');
    expect(ahmad?.providerId).toBe('p-pat');
    expect(ahmad?.providerMatched).toBe(true);
    expect(applied.rows.find((r) => r.lastName === 'Diaz')).toBeUndefined();
    expect(applied.rows.find((r) => r.lastName === 'Fox')).toBeUndefined();
    expect(store.data.mandates.every((m) => m.providerId === 'p-pat')).toBe(true);
    expect(store.data.mandates.some((m) => m.providerId === 'p-default')).toBe(false);
  });

  it('imports Program ID, Program Type, and DOB when columns are present', () => {
    const csv = `Recommended School,Last Name,First Name,Grade,Decision,RS Start,RS End,Related Service,Ratio,Freq,Period,Location,RS Provider,Program ID,Program Type,Date of Birth
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,Pat Lee,PROG-99,CPSE,01/15/2018
`;
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-pat',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: 'WGC-1',
      active: true,
      createdAt: nowIso(),
    });
    const parsed = parseCaseloadCsv(csv);
    expect(parsed.rows[0]).toMatchObject({
      programId: 'PROG-99',
      programType: 'CPSE',
      dob: '2018-01-15',
    });
    const applied = applyCaseloadImport(store, parsed);
    const student = store.findStudentByName('Ahmad', 'Haris');
    expect(student?.programId).toBe('PROG-99');
    expect(student?.programType).toBe('CPSE');
    expect(student?.dob).toBe('2018-01-15');
    expect(applied.rows[0]?.providerMatched).toBe(true);
  });

  it('matches Last, First and First Last provider names', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-james',
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
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    expect(findProviderByName(store.data.providers, 'Vasaturo, James')?.id).toBe('p-james');
    expect(findProviderByName(store.data.providers, 'James Vasaturo')?.id).toBe('p-james');
    expect(findProviderByName(store.data.providers, 'White, Glove')).toBeUndefined();
    expect(isAgencyProviderName('White Glove')).toBe(true);
  });

  it('matches provider names order-independently and case-insensitively', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-fatimah',
      userId: 'u-fatimah',
      firstName: 'Fatimah',
      lastName: 'Ali',
      discipline: 'OT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertProvider({
      id: 'p-john',
      userId: '',
      firstName: 'John',
      lastName: 'Smith',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    for (const raw of [
      'Fatimah Ali',
      'Ali Fatimah',
      'Ali, Fatimah',
      'fatimah ali',
      'ALI, FATIMAH',
      '  Ali ,  Fatimah  ',
    ]) {
      expect(findProviderByName(store.data.providers, raw)?.id).toBe('p-fatimah');
    }
    expect(findProviderByName(store.data.providers, 'John Doe')).toBeUndefined();
    expect(findProviderByName(store.data.providers, 'John')).toBeUndefined();
    expect(findProviderByName(store.data.providers, 'Smith')).toBeUndefined();
    expect(findProviderByName(store.data.providers, 'John Smith Jr')).toBeUndefined();
  });

  it('prefers linked login provider when duplicate names exist', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-orphan',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertProvider({
      id: 'p-linked',
      userId: 'u-pat',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    expect(findProviderByName(store.data.providers, 'Pat Lee')?.id).toBe('p-linked');
    expect(findProviderByName(store.data.providers, 'Lee, Pat')?.id).toBe('p-linked');
    store.upsertStudent({
      id: 'st1',
      schoolId: 'sch',
      firstName: 'A',
      lastName: 'B',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    store.upsertMandate({
      ...mandate({ id: 'm-orphan', studentId: 'st1', providerId: 'p-orphan' }),
    });
    expect(consolidateDuplicateProviderMandates(store)).toBe(1);
    expect(store.data.mandates[0]?.providerId).toBe('p-linked');
  });

  it('consolidates aliases when first/last fields are swapped', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-orphan-swapped',
      userId: '',
      firstName: 'Lee',
      lastName: 'Pat',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertProvider({
      id: 'p-linked-pat',
      userId: 'u-pat2',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertStudent({
      id: 'st-swap',
      schoolId: 'sch',
      firstName: 'A',
      lastName: 'B',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    store.upsertMandate({
      ...mandate({ id: 'm-swapped', studentId: 'st-swap', providerId: 'p-orphan-swapped' }),
    });
    expect(consolidateDuplicateProviderMandates(store)).toBe(1);
    expect(store.data.mandates[0]?.providerId).toBe('p-linked-pat');
  });

  it('purgeOrphanProviders merges onto linked twin then deletes orphan', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-orphan',
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertProvider({
      id: 'p-linked',
      userId: 'u-pat',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertStudent({
      id: 'st1',
      schoolId: 'sch',
      firstName: 'A',
      lastName: 'B',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    store.upsertMandate({
      ...mandate({ id: 'm-orphan', studentId: 'st1', providerId: 'p-orphan' }),
    });
    store.addAdminNote({
      id: 'n1',
      providerId: 'p-orphan',
      authorId: 'admin',
      body: 'follow up',
      tags: [],
      createdAt: nowIso(),
    });

    const result = purgeOrphanProviders(store);
    expect(result.consolidatedMandates).toBe(1);
    expect(result.deleted).toEqual([
      expect.objectContaining({
        id: 'p-orphan',
        reason: 'merged_into_linked',
        mergedIntoId: 'p-linked',
      }),
    ]);
    expect(result.retained).toEqual([]);
    expect(store.data.providers.map((p) => p.id)).toEqual(['p-linked']);
    expect(store.data.mandates[0]?.providerId).toBe('p-linked');
    expect(store.data.adminNotes[0]?.providerId).toBe('p-linked');
    expect(isOrphanProvider(store, store.data.providers[0]!)).toBe(false);
  });

  it('purgeOrphanProviders keeps orphan that uniquely holds caseload', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-solo-orphan',
      userId: '',
      firstName: 'Solo',
      lastName: 'Orphan',
      discipline: 'OT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertStudent({
      id: 'st-solo',
      schoolId: 'sch',
      firstName: 'Kid',
      lastName: 'One',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    store.upsertMandate({
      ...mandate({ id: 'm-solo', studentId: 'st-solo', providerId: 'p-solo-orphan' }),
    });

    const result = purgeOrphanProviders(store);
    expect(result.deleted).toEqual([]);
    expect(result.retained).toEqual([
      expect.objectContaining({
        id: 'p-solo-orphan',
        reason: 'has_data_no_linked_match',
        mandates: 1,
      }),
    ]);
    expect(store.data.providers.map((p) => p.id)).toEqual(['p-solo-orphan']);
    expect(store.data.mandates[0]?.providerId).toBe('p-solo-orphan');
  });

  it('purgeOrphanProviders deletes empty duplicate orphans but keeps sole pre-provision', () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-empty-solo',
      userId: '',
      firstName: 'Solo',
      lastName: 'Empty',
      discipline: 'SLP',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertProvider({
      id: 'p-dup-a',
      userId: '',
      firstName: 'Dup',
      lastName: 'Name',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertProvider({
      id: 'p-dup-b',
      userId: '',
      firstName: 'Dup',
      lastName: 'Name',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    const result = purgeOrphanProviders(store);
    expect(result.deleted.some((d) => d.reason === 'empty')).toBe(true);
    expect(store.data.providers.find((p) => p.id === 'p-empty-solo')).toBeTruthy();
    expect(store.data.providers.filter((p) => providerDisplayNameKey(p) === nameTokenKey('Dup Name'))).toHaveLength(
      1,
    );
  });

  it('parseCaseloadUpload reads xlsx from base64', () => {
    const buf = writeKuBook('xlsx');
    const parsed = parseCaseloadUpload({
      fileName: 'KU-Related-Service-Details.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileBase64: buf.toString('base64'),
    });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].schoolName).toBe('Shaw Avenue');
  });

  it('parseCaseloadUpload reads WG xls by filename', () => {
    const parsed = parseCaseloadUpload({
      fileName: 'Related Service by serviceschool (WG).xls',
      mime: 'application/vnd.ms-excel',
      fileBase64: writeWgBook('xls').toString('base64'),
    });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0].schoolName).toBe('Alden Terrace School');
  });
});
