import { describe, expect, it } from 'vitest';
import { patientIdentityMatches } from './patient-identity.js';

describe('patientIdentityMatches', () => {
  const max = { firstName: 'Max', lastName: 'Campbell', dob: '2018-03-12' };

  it('matches case, punctuation, discipline suffixes, and equivalent DOB formats', () => {
    expect(
      patientIdentityMatches(max, {
        firstName: 'MAX',
        lastName: 'Campbell PT*',
        dateOfBirth: '03/12/2018',
      }),
    ).toBe(true);
    expect(
      patientIdentityMatches(
        { firstName: 'Max', lastName: "O'Brien", dob: '2018-03-12' },
        { firstName: 'max', lastName: 'OBrien', dateOfBirth: '2018-03-12' },
      ),
    ).toBe(true);
  });

  it('rejects a different child even when one name contains the other', () => {
    expect(
      patientIdentityMatches(max, {
        firstName: 'Maxine',
        lastName: 'Campbell',
        dateOfBirth: '2018-03-12',
      }),
    ).toBe(false);
    expect(
      patientIdentityMatches(
        { firstName: 'Ann', lastName: 'Lee', dob: '2018-03-12' },
        { firstName: 'Anna', lastName: 'Lee', dateOfBirth: '2018-03-12' },
      ),
    ).toBe(false);
    expect(
      patientIdentityMatches(max, {
        firstName: 'Elijah',
        lastName: 'George',
        dateOfBirth: '2018-10-03',
      }),
    ).toBe(false);
    expect(
      patientIdentityMatches(max, {
        firstName: 'Max',
        lastName: 'Campbell',
        dateOfBirth: '2018-10-03',
      }),
    ).toBe(false);
  });

  it('rejects when date of birth is missing on either side', () => {
    expect(
      patientIdentityMatches(
        { firstName: 'Max', lastName: 'Campbell', dob: '' },
        { firstName: 'Max', lastName: 'Campbell', dateOfBirth: '2018-03-12' },
      ),
    ).toBe(false);
    expect(
      patientIdentityMatches(max, {
        firstName: 'Max',
        lastName: 'Campbell',
      }),
    ).toBe(false);
  });
});
