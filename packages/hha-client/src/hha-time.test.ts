import { describe, expect, it } from 'vitest';
import { caregiverSearchNameOrders, isEvvPlaceholderSchedule, psDateToIso } from './hha-time.js';

describe('psDateToIso', () => {
  it('expands MM/DD/YY into YYYY-MM-DD (00–69 → 2000s)', () => {
    expect(psDateToIso('09/16/26')).toBe('2026-09-16');
    expect(psDateToIso('09/17/26')).toBe('2026-09-17');
  });

  it('pads M/D/YYYY', () => {
    expect(psDateToIso('9/16/2026')).toBe('2026-09-16');
  });

  it('leaves an ISO date unchanged', () => {
    expect(psDateToIso('2026-09-16')).toBe('2026-09-16');
  });

  it('maps YY 70–99 onto the 1900s', () => {
    expect(psDateToIso('03/09/85')).toBe('1985-03-09');
  });
});

describe('caregiverSearchNameOrders', () => {
  it('strips commas so Last, First searches clean tokens', () => {
    const attempts = caregiverSearchNameOrders('Vasaturo, James');
    expect(attempts).toEqual(
      expect.arrayContaining([
        { lastName: 'Vasaturo', firstName: 'James' },
        { firstName: 'James', lastName: 'Vasaturo' },
      ]),
    );
    expect(attempts.every((a) => !a.firstName.includes(',') && !a.lastName.includes(','))).toBe(
      true,
    );
  });

  it('is case-insensitive in order attempts (tokens preserved, HHA search is case-free)', () => {
    const upper = caregiverSearchNameOrders('VASATURO, JAMES');
    const lower = caregiverSearchNameOrders('vasaturo, james');
    expect(upper.map((a) => `${a.firstName}|${a.lastName}`.toUpperCase()).sort()).toEqual(
      lower.map((a) => `${a.firstName}|${a.lastName}`.toUpperCase()).sort(),
    );
  });

  it('still tries both orders for First Last', () => {
    expect(caregiverSearchNameOrders('James Vasaturo')).toEqual(
      expect.arrayContaining([
        { firstName: 'James', lastName: 'Vasaturo' },
        { lastName: 'James', firstName: 'Vasaturo' },
      ]),
    );
  });

  it('strips discipline suffixes like PT* before building search orders', () => {
    const attempts = caregiverSearchNameOrders('Patel PT*, NEELAMBEN');
    expect(attempts).toEqual(
      expect.arrayContaining([
        { lastName: 'Patel', firstName: 'NEELAMBEN' },
        { firstName: 'NEELAMBEN', lastName: 'Patel' },
      ]),
    );
    expect(
      attempts.every(
        (a) =>
          !/\bPT\b|\*/i.test(`${a.firstName} ${a.lastName}`) &&
          !a.firstName.includes('*') &&
          !a.lastName.includes('*'),
      ),
    ).toBe(true);
  });

  it('keeps multi-word surname from Last, First (Donaldson Fortune, Shayena)', () => {
    const attempts = caregiverSearchNameOrders('Donaldson Fortune, Shayena');
    expect(attempts).toEqual(
      expect.arrayContaining([
        { lastName: 'Donaldson Fortune', firstName: 'Shayena' },
        { firstName: 'Shayena', lastName: 'Donaldson Fortune' },
        // HHA often stores maiden-only LastName
        { lastName: 'Donaldson', firstName: 'Shayena' },
        { firstName: 'Shayena', lastName: 'Donaldson' },
        { lastName: 'Fortune', firstName: 'Shayena' },
      ]),
    );
  });
});

describe('isEvvPlaceholderSchedule', () => {
  it('matches the 1:00–1:30 AM scaffolding window in HHMM or 12-hour form', () => {
    expect(isEvvPlaceholderSchedule('0100', '0130')).toBe(true);
    expect(isEvvPlaceholderSchedule('1:00 AM', '1:30 AM')).toBe(true);
    expect(isEvvPlaceholderSchedule('09:00', '09:30')).toBe(false);
    expect(isEvvPlaceholderSchedule('13:00', '13:30')).toBe(false);
  });
});
