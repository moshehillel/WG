import { describe, expect, it } from 'vitest';
import {
  SCHOOL_BILLING_SERVICE_NAMES,
  buildSchoolBillingServiceName,
  nearestSchoolDurationBucket,
  normalizeSchoolBillingDiscipline,
} from './school-billing-codes.js';

describe('school-billing-codes', () => {
  it('lists 18 canonical HHA names for billing', () => {
    expect(SCHOOL_BILLING_SERVICE_NAMES).toHaveLength(18);
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('OT School eval');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('PT school 42');
    expect(SCHOOL_BILLING_SERVICE_NAMES).toContain('SLP additional services');
  });

  it('buckets duration to nearest 30/42/45 within 3 min else 60', () => {
    expect(nearestSchoolDurationBucket(30)).toBe(30);
    expect(nearestSchoolDurationBucket(28)).toBe(30);
    expect(nearestSchoolDurationBucket(42)).toBe(42);
    expect(nearestSchoolDurationBucket(44)).toBe(45);
    expect(nearestSchoolDurationBucket(45)).toBe(45);
    expect(nearestSchoolDurationBucket(50)).toBe(60);
    expect(nearestSchoolDurationBucket(60)).toBe(60);
  });

  it('maps ST → SLP for billing names', () => {
    expect(normalizeSchoolBillingDiscipline('ST')).toBe('SLP');
    expect(normalizeSchoolBillingDiscipline('slp')).toBe('SLP');
  });

  it('builds eval / additional / school names', () => {
    expect(
      buildSchoolBillingServiceName({ discipline: 'OT', kind: 'eval' }),
    ).toBe('OT School eval');
    expect(
      buildSchoolBillingServiceName({ discipline: 'Pt', kind: 'additional' }),
    ).toBe('PT additional services');
    expect(
      buildSchoolBillingServiceName({ discipline: 'SLP', kind: 'school', durationMinutes: 30 }),
    ).toBe('SLP school 30');
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
  });
});
