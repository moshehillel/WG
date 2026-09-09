import { describe, expect, it } from 'vitest';
import {
  emptySchoolCalendar,
  hasConfiguredSchoolCalendar,
  hasSchoolAddressForPatient,
  isSchoolDay,
  parseOffDaysCsv,
  schoolCalendarMonFriFallbackWarning,
  schoolCalendarSummary,
  schoolDaysBetween,
  schoolSetupIncomplete,
} from './school-calendar.js';

const cal = {
  schoolId: 's1',
  yearStart: '2025-09-01',
  yearEnd: '2026-06-30',
  offDays: ['2025-09-01', '2025-11-27'],
};

describe('school calendar helpers', () => {
  it('isSchoolDay respects weekdays, range, and off days', () => {
    expect(isSchoolDay('2025-09-02', cal)).toBe(true); // Tue
    expect(isSchoolDay('2025-09-06', cal)).toBe(false); // Sat
    expect(isSchoolDay('2025-09-01', cal)).toBe(false); // Labor Day off
    expect(isSchoolDay('2025-11-27', cal)).toBe(false); // Thanksgiving off
    expect(isSchoolDay('2025-11-28', cal)).toBe(true); // Fri in range
    expect(isSchoolDay('2025-08-31', cal)).toBe(false); // before year
  });

  it('isSchoolDay with empty bounds counts weekdays only', () => {
    const open = emptySchoolCalendar('s1');
    expect(isSchoolDay('2026-09-01', open)).toBe(true);
    expect(isSchoolDay('2026-09-06', open)).toBe(false);
  });

  it('schoolDaysBetween counts inclusive school days', () => {
    const weekCal = {
      schoolId: 's1',
      yearStart: '2026-09-01',
      yearEnd: '2026-12-31',
      offDays: ['2026-09-07'],
    };
    // Tue 9/1 – Fri 9/4 = 4; Mon 9/7 off; Tue 9/8 – Fri 9/11 = 4 → 8
    expect(schoolDaysBetween('2026-09-01', '2026-09-12', weekCal)).toBe(8);
  });

  it('parseOffDaysCsv handles commas and newlines', () => {
    expect(parseOffDaysCsv('2026-09-07\n2026-11-27, 2026-12-25')).toEqual([
      '2026-09-07',
      '2026-11-27',
      '2026-12-25',
    ]);
    expect(parseOffDaysCsv('bad, 2026-01-02')).toEqual(['2026-01-02']);
  });

  it('schoolCalendarSummary formats range and off-day count', () => {
    expect(
      schoolCalendarSummary({
        schoolId: 's1',
        yearStart: '2026-09-02',
        yearEnd: '2027-06-25',
        offDays: ['2026-09-07', '2026-11-27'],
      }),
    ).toBe('Sep 2 – Jun 25, 2 off days');
    expect(schoolCalendarSummary(emptySchoolCalendar('s1'))).toBe('');
  });

  it('hasConfiguredSchoolCalendar detects empty vs saved calendars', () => {
    expect(hasConfiguredSchoolCalendar(null)).toBe(false);
    expect(hasConfiguredSchoolCalendar(emptySchoolCalendar('s1'))).toBe(false);
    expect(
      hasConfiguredSchoolCalendar({
        schoolId: 's1',
        yearStart: '2026-09-01',
        yearEnd: '',
        offDays: [],
      }),
    ).toBe(true);
    expect(
      hasConfiguredSchoolCalendar({
        schoolId: 's1',
        yearStart: '',
        yearEnd: '',
        offDays: ['2026-11-27'],
      }),
    ).toBe(true);
  });

  it('schoolCalendarMonFriFallbackWarning names the school', () => {
    expect(schoolCalendarMonFriFallbackWarning('PS 118')).toBe(
      'No school calendar for PS 118 — falling back to Mon–Fri (weekends excluded; no holiday off-days).',
    );
    expect(schoolCalendarMonFriFallbackWarning('')).toMatch(/this school/);
  });

  it('schoolSetupIncomplete requires calendar and full address', () => {
    const school = {
      name: 'Hegarty',
      address1: '1 Main St',
      city: 'Island Park',
      state: 'NY',
      zipCode: '11558',
    };
    expect(hasSchoolAddressForPatient(school)).toBe(true);
    expect(hasSchoolAddressForPatient({ ...school, zipCode: '' })).toBe(false);

    const missingBoth = schoolSetupIncomplete(
      { name: 'Hegarty' },
      emptySchoolCalendar('s1'),
    );
    expect(missingBoth.incomplete).toBe(true);
    expect(missingBoth.missingCalendar).toBe(true);
    expect(missingBoth.missingAddress).toBe(true);
    expect(missingBoth.message).toMatch(/calendar and address/i);

    const missingCal = schoolSetupIncomplete(school, emptySchoolCalendar('s1'));
    expect(missingCal.missingCalendar).toBe(true);
    expect(missingCal.missingAddress).toBe(false);
    expect(missingCal.message).toMatch(/calendar/i);

    const complete = schoolSetupIncomplete(school, {
      schoolId: 's1',
      yearStart: '2026-09-02',
      yearEnd: '2027-06-25',
      offDays: [],
    });
    expect(complete.incomplete).toBe(false);
    expect(complete.message).toBe('');
  });
});
