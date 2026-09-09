import { describe, expect, it } from 'vitest';
import {
  mergeSchoolCalendarParse,
  parseSchoolCalendarPdfText,
} from './school-calendar-parse.js';

describe('parseSchoolCalendarPdfText', () => {
  it('extracts labeled first/last days and holiday ranges', () => {
    const text = `
      Sample District School Calendar 2025-2026
      First Day of School: September 2, 2025
      Last Day of School: June 25, 2026

      Holidays / Closed
      Labor Day September 1, 2025
      Thanksgiving Recess November 27–28, 2025
      Winter Recess Dec 24 – Jan 2, 2026
      Martin Luther King Jr. Day January 19, 2026
      Spring Recess April 6-10, 2026
    `;
    const parsed = parseSchoolCalendarPdfText(text);
    expect(parsed.yearStart).toBe('2025-09-02');
    expect(parsed.yearEnd).toBe('2026-06-25');
    expect(parsed.offDays).toContain('2025-09-01');
    expect(parsed.offDays).toContain('2025-11-27');
    expect(parsed.offDays).toContain('2025-11-28');
    expect(parsed.offDays).toContain('2025-12-24');
    expect(parsed.offDays).toContain('2026-01-02');
    expect(parsed.offDays).toContain('2026-01-19');
    expect(parsed.offDays).toContain('2026-04-06');
    expect(parsed.offDays).toContain('2026-04-10');
    expect(parsed.offDays).not.toContain('2025-09-02');
    expect(parsed.offDays).not.toContain('2026-06-25');
  });

  it('parses MM/DD/YYYY slash dates and ranges', () => {
    const text = `
      School Year 2026-2027
      Closed: 09/07/2026 Labor Day
      Thanksgiving 11/26/2026 - 11/27/2026
      Holiday 12/24/26 – 01/02/27
    `;
    const parsed = parseSchoolCalendarPdfText(text);
    expect(parsed.offDays).toEqual(
      expect.arrayContaining([
        '2026-09-07',
        '2026-11-26',
        '2026-11-27',
        '2026-12-24',
        '2027-01-02',
      ]),
    );
  });

  it('infers year from academic year when month names omit year', () => {
    const text = `
      2025-2026 Calendar
      No School
      Thanksgiving Recess Nov 27-28
      Mid-Winter Recess Feb 16-20
    `;
    const parsed = parseSchoolCalendarPdfText(text);
    expect(parsed.offDays).toContain('2025-11-27');
    expect(parsed.offDays).toContain('2025-11-28');
    expect(parsed.offDays).toContain('2026-02-16');
    expect(parsed.offDays).toContain('2026-02-20');
  });

  it('returns empty with warning when no dates found', () => {
    const parsed = parseSchoolCalendarPdfText('Welcome to our school handbook.');
    expect(parsed.offDays).toEqual([]);
    expect(parsed.yearStart).toBe('');
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('dedupes and sorts off days', () => {
    const text = `
      Closed holiday 12/25/2025
      Christmas holiday December 25, 2025
    `;
    const parsed = parseSchoolCalendarPdfText(text);
    expect(parsed.offDays.filter((d) => d === '2025-12-25')).toHaveLength(1);
  });
});

describe('mergeSchoolCalendarParse', () => {
  it('merges off days and prefers PDF year bounds when present', () => {
    const merged = mergeSchoolCalendarParse(
      {
        yearStart: '2025-09-01',
        yearEnd: '2026-06-20',
        offDays: ['2025-11-27'],
      },
      {
        yearStart: '2025-09-02',
        yearEnd: '2026-06-25',
        offDays: ['2025-12-25', '2025-11-27'],
        warnings: [],
      },
    );
    expect(merged.yearStart).toBe('2025-09-02');
    expect(merged.yearEnd).toBe('2026-06-25');
    expect(merged.offDays).toEqual(['2025-11-27', '2025-12-25']);
  });

  it('keeps existing year bounds when PDF omits them', () => {
    const merged = mergeSchoolCalendarParse(
      { yearStart: '2025-09-02', yearEnd: '2026-06-25', offDays: [] },
      { yearStart: '', yearEnd: '', offDays: ['2025-12-25'], warnings: [] },
    );
    expect(merged.yearStart).toBe('2025-09-02');
    expect(merged.yearEnd).toBe('2026-06-25');
    expect(merged.offDays).toEqual(['2025-12-25']);
  });
});
