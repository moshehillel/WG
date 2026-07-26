import { describe, expect, it } from 'vitest';
import {
  validateClosedCaseBilling,
  validateDischargeServiceBilling,
  validateOpenCaseBilling,
} from './billing-guards.js';

describe('billing-guards', () => {
  it('requires auth and demographics on open cases', () => {
    const missing = validateOpenCaseBilling({
      caseId: '1',
      firstName: 'A',
      lastName: 'B',
      serviceCode: 'SI',
    });
    expect(missing).toContain('Authorization Number');
    expect(missing).toContain('Date of Birth');
  });

  it('requires closure date on closed cases', () => {
    expect(validateClosedCaseBilling({ caseId: '1' })).toContain('Closure Date');
  });

  it('requires discharge date on discharge service rows', () => {
    expect(
      validateDischargeServiceBilling({
        serviceCode: 'SI',
        startDate: '1/1/2026',
      }),
    ).toContain('Service Discharge Date');
  });
});
