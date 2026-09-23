import { describe, expect, it } from 'vitest';
import { caregiverSearchNameOrders, psDateToIso } from './hha-time.js';

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
});
