import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  applyCaseloadImport,
  formatFreqDisplay,
  mandateMatchKey,
  parseCaseloadCsv,
  parseCaseloadUpload,
  parseCaseloadWorkbook,
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
    expect(preview.createdMandates).toBe(6);
    expect(preview.rows.filter((r) => r.lastName === 'Haris')).toHaveLength(2);
    expect(preview.rows.find((r) => r.providerName === 'Unknown Provider')?.providerMatched).toBe(false);

    const committed = applyCaseloadImport(store, parsed);
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

  it('re-import upserts: no duplicate students/mandates; fills provider on second pass', () => {
    const store = new MemoryStore();
    const csvUnmatched = `Recommended School,Last Name,First Name,Grade,Decision,RS Start,RS End,Related Service,Ratio,Freq,Period,Location,RS Provider
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,"White, Glove"
Shaw Avenue,Diaz,Elmer,4,Approved,09/01/2025,06/30/2026,OT,Individual,2,6 day cycle,Push-In,"White, Glove"
`;
    const first = applyCaseloadImport(store, parseCaseloadCsv(csvUnmatched));
    expect(first.createdStudents).toBe(2);
    expect(first.createdMandates).toBe(2);
    expect(first.updatedMandates).toBe(0);
    expect(store.data.students).toHaveLength(2);
    expect(store.data.mandates).toHaveLength(2);
    expect(store.data.mandates.every((m) => !m.providerId)).toBe(true);
    expect(first.warnings.some((w) => /White,\s*Glove/i.test(w.problem))).toBe(true);

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
    expect(second.createdStudents).toBe(0);
    expect(second.createdMandates).toBe(0);
    expect(second.updatedMandates).toBe(2);
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

function kuAoa(extraTitle = false): (string | number)[][] {
  const data: (string | number)[][] = [
    KU_HEADERS,
    ['Shaw Avenue', 'Haris', 'Ahmad', 3, 'Approved', 45901, 46203, 'PT', 'Small Group', 1, 'Weekly', 'Push-In', 'Pat Lee'],
    ['Shaw Avenue', 'Diaz', 'Elmer', 4, 'Approved', '09/01/2025', '06/30/2026', 'OT', 'Individual', 2, '6 day cycle', 'Push-In', 'Pat Lee'],
  ];
  if (!extraTitle) return data;
  return [['KU SCHOOL YEAR Related Service Details by School'], [], ...data];
}

function writeKuBook(bookType: 'xlsx' | 'xls', extraTitle = false): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(kuAoa(extraTitle));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, extraTitle ? 'Sheet1' : 'Details');
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
});
