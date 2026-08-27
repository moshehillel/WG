import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { enrichOpenedRowFromHha } from './enrich-opened-from-hha.js';

describe('enrichOpenedRowFromHha', () => {
  it('fills gender from HHA when PS row omits it', async () => {
    const hha = new MockHhaClient();
    await hha.upsertPatient({
      caseId: '66976',
      externalId: '66976',
      firstName: 'Pat',
      lastName: 'Two',
      gender: 'Female',
    });

    const row = {
      caseId: '66976',
      firstName: 'Pat',
      lastName: 'Two',
      programType: 'Extended Home Care Therapy',
      serviceCode: 'OT CHHA EXTENDED',
      sourceReport: 'new_services' as const,
    };

    const { row: enriched, patientFound } = await enrichOpenedRowFromHha(row, hha);
    expect(patientFound).toBe(true);
    expect(enriched.gender).toBe('Female');
  });

  it('looks up patient even when PS gender is present', async () => {
    const hha = new MockHhaClient();
    await hha.upsertPatient({
      caseId: '66976',
      externalId: '66976',
      firstName: 'Pat',
      lastName: 'Two',
      gender: 'Female',
    });
    const row = {
      caseId: '66976',
      firstName: 'Pat',
      lastName: 'Two',
      gender: 'Male',
      address1: '1 Main',
      city: 'Brooklyn',
      state: 'NY',
      zipCode: '11201',
      sourceReport: 'new_services' as const,
    };
    const { row: enriched, patientFound } = await enrichOpenedRowFromHha(row, hha);
    expect(patientFound).toBe(true);
    expect(enriched.gender).toBe('Male');
    expect(hha.calls).toContain('findPatient');
    expect(hha.calls).not.toContain('getPatientDemographicsFields');
  });

  it('returns patientFound false when child is not in HHA', async () => {
    const hha = new MockHhaClient();
    const { row: enriched, patientFound } = await enrichOpenedRowFromHha(
      {
        caseId: 'missing-kid',
        firstName: 'Pat',
        lastName: 'Missing',
        sourceReport: 'new_services',
      },
      hha,
    );
    expect(patientFound).toBe(false);
    expect(enriched.gender).toBeUndefined();
    expect(hha.calls).toContain('findPatient');
    expect(hha.calls).not.toContain('getPatientDemographicsFields');
  });

  it('does not look up HHA gender for Gluck open rows', async () => {
    const hha = new MockHhaClient();
    await hha.upsertPatient({
      caseId: '66976',
      externalId: '66976',
      firstName: 'Pat',
      lastName: 'Two',
      gender: 'Female',
    });
    const { row: enriched, patientFound } = await enrichOpenedRowFromHha(
      { caseId: '66976', firstName: 'Pat', lastName: 'Two', sourceReport: 'opened_cases' },
      hha,
    );
    expect(patientFound).toBeUndefined();
    expect(enriched.gender).toBeUndefined();
    expect(hha.calls).not.toContain('findPatient');
  });

  it('fills city/state/zip from HHA when PS row omits them', async () => {
    const hha = new MockHhaClient();
    await hha.upsertPatient({
      caseId: '66976',
      externalId: '66976',
      firstName: 'Kemuel',
      lastName: 'Bethea',
      gender: 'Male',
      address1: '10 Main St',
      city: 'Brooklyn',
      state: 'NY',
      zipCode: '11201',
    });

    const { row: enriched } = await enrichOpenedRowFromHha(
      {
        caseId: '66976',
        firstName: 'Kemuel',
        lastName: 'Bethea',
        gender: 'Male',
        address1: '10 Main St',
        sourceReport: 'new_services',
      },
      hha,
    );
    expect(enriched.city).toBe('Brooklyn');
    expect(enriched.state).toBe('NY');
    expect(enriched.zipCode).toBe('11201');
  });

  it('finds HHA gender when PS caseId is zero-padded', async () => {
    const hha = new MockHhaClient();
    await hha.upsertPatient({
      caseId: '2877125',
      externalId: '2877125',
      firstName: 'Pat',
      lastName: 'Two',
      gender: 'Female',
    });

    const { row: enriched, patientFound } = await enrichOpenedRowFromHha(
      {
        caseId: '02877125',
        firstName: 'Pat',
        lastName: 'Two',
        sourceReport: 'new_services',
      },
      hha,
    );
    expect(patientFound).toBe(true);
    expect(enriched.gender).toBe('Female');
  });

  it('fills gender via unique exact name + DOB when ID misses', async () => {
    const hha = new MockHhaClient();
    await hha.upsertPatient({
      // Different IDs so MR/case lookup misses (HHA empty-MR scenario).
      caseId: 'hha-internal-rios',
      externalId: 'hha-internal-rios',
      firstName: 'Yehoshua',
      lastName: 'Rios',
      dateOfBirth: '05/01/2010',
      gender: 'Male',
    });

    const { row: enriched, patientFound } = await enrichOpenedRowFromHha(
      {
        caseId: '082081547101',
        firstName: 'Yehoshua',
        lastName: 'Rios',
        dateOfBirth: '05/01/2010',
        sourceReport: 'new_services',
      },
      hha,
    );
    expect(patientFound).toBe(true);
    expect(enriched.gender).toBe('Male');
  });

  it('does not auto-pick gender when multiple same name + DOB matches exist', async () => {
    const hha = new MockHhaClient();
    for (const n of [1, 2, 3]) {
      await hha.upsertPatient({
        caseId: `orner-${n}`,
        externalId: `orner-${n}`,
        firstName: 'JUDITH',
        lastName: 'ORNER',
        dateOfBirth: '12/16/2009',
        gender: 'Female',
      });
    }

    const { row: enriched, patientFound } = await enrichOpenedRowFromHha(
      {
        caseId: '258265612',
        firstName: 'JUDITH',
        lastName: 'ORNER',
        dateOfBirth: '12/16/2009',
        sourceReport: 'new_services',
      },
      hha,
    );
    expect(patientFound).toBe(false);
    expect(enriched.gender).toBeUndefined();
  });

  it('still prefers exact ID when present over name', async () => {
    const hha = new MockHhaClient();
    await hha.upsertPatient({
      caseId: '11203',
      externalId: '11203',
      firstName: 'Other',
      lastName: 'Person',
      gender: 'Male',
    });
    await hha.upsertPatient({
      caseId: 'name-only',
      externalId: 'name-only',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'Female',
    });

    const { row: enriched } = await enrichOpenedRowFromHha(
      {
        caseId: '11203',
        firstName: 'Ada',
        lastName: 'Lovelace',
        sourceReport: 'new_services',
      },
      hha,
    );
    expect(enriched.gender).toBe('Male');
  });
});
