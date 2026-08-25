import { describe, expect, it } from 'vitest';
import {
  isAlreadyDischargedError,
  isTrustedHhaPatientId,
  toFindPatientOptions,
} from './resolve-patient-id.js';

describe('isTrustedHhaPatientId', () => {
  it('rejects Program Id when equal to caseId (ErrorID=-56 footgun)', () => {
    expect(isTrustedHhaPatientId('49247', '49247')).toBe(false);
    expect(isTrustedHhaPatientId('33726', '33726')).toBe(false);
  });

  it('accepts real HHA PatientID distinct from caseId', () => {
    expect(isTrustedHhaPatientId('25149934', '49247')).toBe(true);
  });

  it('rejects non-numeric and blank', () => {
    expect(isTrustedHhaPatientId('P0100012106301', 'P0100012106301')).toBe(false);
    expect(isTrustedHhaPatientId(undefined, '49247')).toBe(false);
    expect(isTrustedHhaPatientId('  ', '49247')).toBe(false);
  });
});

describe('toFindPatientOptions', () => {
  it('includes name + DOB for fallback after MR/admission miss', () => {
    expect(
      toFindPatientOptions({
        caseId: '49247',
        patientExternalId: '49247',
        firstName: 'Tianming',
        lastName: 'Chen',
        dateOfBirth: '12/25/1995',
      }),
    ).toEqual({
      caseId: '49247',
      externalId: '49247',
      firstName: 'Tianming',
      lastName: 'Chen',
      dateOfBirth: '12/25/1995',
    });
  });
});

describe('isAlreadyDischargedError', () => {
  it('detects no-active-placement messages', () => {
    expect(isAlreadyDischargedError(new Error('No active HHA placements found for patient'))).toBe(
      true,
    );
    expect(isAlreadyDischargedError(new Error('No active HHA placements to discharge for patient 1'))).toBe(
      true,
    );
    expect(isAlreadyDischargedError(new Error('ErrorID=-56'))).toBe(false);
  });
});
