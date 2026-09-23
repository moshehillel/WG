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
    expect(mapServiceToDiscipline('PT school 30')).toBe('PT');
    expect(mapServiceToDiscipline('Physical Therapy')).toBe('PT');
    expect(mapServiceToDiscipline('COTA')).toBe('COTA');
    expect(mapServiceToDiscipline(undefined)).toBe('');
  });

  it('maps SLP-led service types to HHA discipline "ST" (not "SLP" or "SP")', () => {
    // HHA rejects AcceptedServices "SLP" and "SP" with -411; speech must be "ST".
    expect(mapServiceToDiscipline('SLP CHHA')).toBe('ST');
    expect(mapServiceToDiscipline('SLP HC EVAL')).toBe('ST');
    expect(mapServiceToDiscipline('slp school')).toBe('ST');
    expect(mapServiceToDiscipline('SLP')).toBe('ST');
    expect(mapServiceToDiscipline('Speech Therapy')).toBe('ST');
    expect(mapServiceToDiscipline('ST CHHA')).toBe('ST');
    expect(mapServiceToDiscipline('SP')).toBe('ST');
    expect(mapServiceToDiscipline('SP ')).toBe('ST');
  });

  it('emits AcceptedServices Discipline "ST" for an SLP CHHA patient', () => {
    const xml = buildCreatePatientBody(
      {
        firstName: 'Adam',
        lastName: 'Martinez',
        dateOfBirth: '2020-05-04',
        caseId: '258267734',
        serviceCode: 'SLP CHHA',
        address1: '1 Main St',
        city: 'Brooklyn',
        state: 'NY',
        zipCode: '11201',
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
    expect(xml).toContain('<Discipline>ST</Discipline>');
    expect(xml).not.toContain('<Discipline>SLP</Discipline>');
    expect(xml).not.toContain('<Discipline>SP</Discipline>');
  });

  it('omits AcceptedServices when discipline cannot be inferred (no silent OT)', () => {
    const xml = buildCreatePatientBody(
      {
        firstName: 'Ana',
        lastName: 'Binaj',
        dateOfBirth: '2021-02-22',
        caseId: '21021322',
        address1: '1 Main St',
        city: 'Island Park',
        state: 'NY',
        zipCode: '11558',
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
    expect(xml).not.toContain('<AcceptedServices>');
    expect(xml).not.toContain('<Discipline>OT</Discipline>');
  });

  it('sets AcceptedServices PT from school billing name', () => {
    const xml = buildCreatePatientBody(
      {
        firstName: 'Ana',
        lastName: 'Binaj',
        dateOfBirth: '2021-02-22',
        caseId: '21021322',
        serviceCode: 'PT school 30',
        address1: '1 Main St',
        city: 'Island Park',
        state: 'NY',
        zipCode: '11558',
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
    expect(xml).toContain('<Discipline>PT</Discipline>');
  });

  it('formats medicaid and admission ids', () => {
    expect(formatMedicaidNumber('1012074')).toMatch(/^ZW\d{5}[A-Z]$/);
    expect(formatAdmissionId('1012074')).toBe('PS1012074');
  });

  it('parses zip codes', () => {
    expect(parseZipCode('10801-4721')).toEqual({ zip5: 10801, zip4: '4721' });
    expect(parseZipCode('11710')).toEqual({ zip5: 11710 });
    expect(parseZipCode('11710-0000')).toEqual({ zip5: 11710, zip4: '0000' });
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
    expect(xml).toContain('<Zip4>4721</Zip4>');
  });

  it('omits Zip4 for 5-digit zip (HHA rejects Zip4=0 length)', () => {
    const xml = buildCreatePatientBody(
      {
        firstName: 'Martin',
        lastName: 'Solomon',
        dateOfBirth: '12/01/1947',
        caseId: '06771684',
        intakeDate: '09/08/2026',
        serviceCode: 'OT HC Eval',
        address1: '2486 JACKSON PLACE',
        city: 'North Bellmore',
        state: 'NY',
        zipCode: '11710',
        gender: 'Male',
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
    expect(xml).toContain('<Zip5>11710</Zip5>');
    expect(xml).not.toContain('<Zip4>');
  });
});
