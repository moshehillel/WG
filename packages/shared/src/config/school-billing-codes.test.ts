import { describe, expect, it } from 'vitest';
import {
  SCHOOL_BILLING_SERVICE_NAMES,
  buildSchoolBillingServiceName,
  exactSchoolDurationBucket,
  isGroupSchoolBillingServiceName,
  isIndividualSchoolBillingServiceName,
  nearestSchoolDurationBucket,
  normalizeSchoolBillingDiscipline,
  schoolBillingDurationMinutes,
  schoolBillingServiceNameCandidates,
} from './school-billing-codes.js';

describe('school-billing-codes', () => {
  it('lists canonical HHA names for billing (indiv + group + eval + additional)', () => {
    expect(SCHOOL_BILLING_SERVICE_NAMES).toHaveLength(48);
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('OT School eval');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('PT school 15');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('PT school group 15');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('PT school 42');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('PT school group 42');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('OT school group 30');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('SLP school group 60');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('SLP additional services 30');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('PT additional services 60');
  });

  it('buckets duration to nearest 15/30/42/45 within 3 min else 60', () => {
    expect(nearestSchoolDurationBucket(15)).toBe(15);
    expect(nearestSchoolDurationBucket(12)).toBe(15);
    expect(nearestSchoolDurationBucket(18)).toBe(15);
    expect(nearestSchoolDurationBucket(20)).toBe(60);
    expect(nearestSchoolDurationBucket(30)).toBe(30);
    expect(nearestSchoolDurationBucket(28)).toBe(30);
    expect(nearestSchoolDurationBucket(42)).toBe(42);
    expect(nearestSchoolDurationBucket(44)).toBe(45);
    expect(nearestSchoolDurationBucket(45)).toBe(45);
    expect(nearestSchoolDurationBucket(50)).toBe(60);
    expect(nearestSchoolDurationBucket(60)).toBe(60);
    expect(exactSchoolDurationBucket(15)).toBe(15);
    expect(exactSchoolDurationBucket(30)).toBe(30);
    expect(exactSchoolDurationBucket(40)).toBeUndefined();
  });

  it('maps ST → SLP for billing names', () => {
    expect(normalizeSchoolBillingDiscipline('ST')).toBe('SLP');
    expect(normalizeSchoolBillingDiscipline('slp')).toBe('SLP');
  });

  it('builds eval / additional / school / school group names', () => {
    expect(
      buildSchoolBillingServiceName({ discipline: 'OT', kind: 'eval' }),
    ).toBe('OT School eval');
    expect(
      buildSchoolBillingServiceName({ discipline: 'Pt', kind: 'additional', durationMinutes: 30 }),
    ).toBe('PT additional services 30');
    expect(
      buildSchoolBillingServiceName({ discipline: 'PT', kind: 'additional', durationMinutes: 60 }),
    ).toBe('PT additional services 60');
    expect(
      buildSchoolBillingServiceName({ discipline: 'PT', kind: 'additional', durationMinutes: 50 }),
    ).toBeUndefined();
    expect(
      buildSchoolBillingServiceName({ discipline: 'SLP', kind: 'school', durationMinutes: 30 }),
    ).toBe('SLP school 30');
    expect(
      buildSchoolBillingServiceName({
        discipline: 'PT',
        kind: 'school',
        durationMinutes: 15,
        group: true,
      }),
    ).toBe('PT school group 15');
    expect(
      buildSchoolBillingServiceName({ discipline: 'PT', kind: 'school', durationMinutes: 15 }),
    ).toBe('PT school 15');
    expect(
      buildSchoolBillingServiceName({
        discipline: 'PT',
        kind: 'school',
        durationMinutes: 30,
        group: true,
      }),
    ).toBe('PT school group 30');
    expect(schoolBillingServiceNameCandidates({
      discipline: 'PT',
      kind: 'school',
      durationMinutes: 15,
      group: true,
    })).toEqual(['PT school group 15']);
    expect(schoolBillingServiceNameCandidates({
      discipline: 'PT',
      kind: 'school',
      durationMinutes: 30,
      group: true,
    })).toEqual(['PT school group 30']);
    expect(
      buildSchoolBillingServiceName({
        discipline: 'OT',
        kind: 'school',
        durationMinutes: 42,
        group: true,
      }),
    ).toBe('OT school group 42');
    expect(
      buildSchoolBillingServiceName({
        discipline: 'SLP',
        kind: 'school',
        durationMinutes: 58,
        group: true,
      }),
    ).toBe('SLP school group 60');
    expect(
      buildSchoolBillingServiceName({ discipline: 'OT', kind: 'school', durationMinutes: 42 }),
    ).toBe('OT school 42');
    expect(
      buildSchoolBillingServiceName({ discipline: 'OT', kind: 'school', durationMinutes: 58 }),
    ).toBe('OT school 60');
  });

  it('requires duration for school kind', () => {
    expect(
      buildSchoolBillingServiceName({ discipline: 'OT', kind: 'school', durationMinutes: null }),
    ).toBeUndefined();
    expect(
      buildSchoolBillingServiceName({
        discipline: 'OT',
        kind: 'school',
        durationMinutes: null,
        group: true,
      }),
    ).toBeUndefined();
  });

  it('detects individual school names missing "group"', () => {
    expect(isIndividualSchoolBillingServiceName('PT school 30')).toBe(true);
    expect(schoolBillingDurationMinutes('PT school 15')).toBe(15);
    expect(schoolBillingDurationMinutes('PT school 30')).toBe(30);
    expect(schoolBillingDurationMinutes('PT school group 15')).toBe(15);
    expect(schoolBillingDurationMinutes('PT school group 60')).toBe(60);
    expect(isIndividualSchoolBillingServiceName('PT school 15')).toBe(true);
    expect(isGroupSchoolBillingServiceName('PT school group 15')).toBe(true);
    expect(schoolBillingDurationMinutes('PT School eval')).toBeUndefined();
    expect(isIndividualSchoolBillingServiceName('PT school group 30')).toBe(false);
    expect(isIndividualSchoolBillingServiceName('OT School eval')).toBe(false);
    expect(isGroupSchoolBillingServiceName('PT school group 30')).toBe(true);
    expect(isGroupSchoolBillingServiceName('PT school 30')).toBe(false);
  });
});
