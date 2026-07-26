import { describe, expect, it } from 'vitest';
import {
  buildCreatePatientBody,
  canCreatePatient,
  formatAdmissionId,
  formatMedicaidNumber,
  mapServiceToDiscipline,
  parseZipCode,
} from './create-patient-builder.js';

describe('create-patient-builder', () => {
  it('maps service type to discipline', () => {
    expect(mapServiceToDiscipline('OT CHHA EXTENDED')).toBe('OT');
    expect(mapServiceToDiscipline('SI- ABA 1 West')).toBe('SI');
  });

  it('formats medicaid and admission ids', () => {
    expect(formatMedicaidNumber('1012074')).toMatch(/^ZW\d{5}[A-Z]$/);
    expect(formatAdmissionId('1012074')).toBe('PS1012074');
  });

  it('parses zip codes', () => {
    expect(parseZipCode('10801-4721')).toEqual({ zip5: 10801, zip4: 4721 });
  });

  it('validates required create fields', () => {
    const check = canCreatePatient(
      { firstName: 'Zachary', lastName: 'Aboagye', dateOfBirth: '12/19/2023' },
      { officeId: 1025, coordinatorId: 81103 },
    );
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.missing).toContain('address1');
  });

  it('builds CreatePatient XML body', () => {
    const xml = buildCreatePatientBody(
      {
        firstName: 'Zachary',
        lastName: 'Aboagye',
        dateOfBirth: '12/19/2023',
        caseId: '1012074',
        intakeDate: '07/16/2026',
        serviceCode: 'SI',
        address1: '75 COOPER DR APT 1B',
        city: 'New Rochelle',
        state: 'NY',
        zipCode: '10801-4721',
        homePhone: '3473244088',
        emergencyContactName: 'Goulder Kportufe',
      },
      {
        officeId: 1025,
        coordinatorId: 81103,
        sourceOfAdmission: 9300,
        branchId: 10073742,
        teamId: 2036,
        locationId: 12284,
        mobilityStatusId: 2495,
        evacuationZoneId: 10003239,
        defaultGender: 'Male',
      },
      {
        branchId: 10073742,
        teamId: 2036,
        locationId: 12284,
        mobilityStatusId: 2495,
        evacuationZoneId: 10003239,
      },
    );
    expect(xml).toContain('<AdmissionID>PS1012074</AdmissionID>');
    expect(xml).toContain('<Discipline>SI</Discipline>');
    expect(xml).toContain('<Zip5>10801</Zip5>');
  });
});
