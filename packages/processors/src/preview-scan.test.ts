import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { previewOpenedCaseWithHha, previewVerifiedSessionWithHha } from './preview-scan.js';

describe('preview-scan with HHA lookup', () => {
  it('flags unknown program and service types via HHA lookup', async () => {
    const hha = new MockHhaClient();
    const opened = await previewOpenedCaseWithHha(
      {
        caseId: 'c1',
        firstName: 'A',
        lastName: 'B',
        programType: 'Unknown Program',
        serviceCode: 'NOPE',
        authorizationNumber: 'AUTH-1',
        dateOfBirth: '1/1/2020',
        address1: '1 Main',
        city: 'NYC',
        state: 'NY',
        zipCode: '10001',
      },
      hha,
    );
    expect(opened.some((e) => e.code === 'other')).toBe(true);
    expect(opened.some((e) => e.code === 'unknown_service_code')).toBe(true);

    const session = await previewVerifiedSessionWithHha(
      {
        sessionId: 's1',
        programType: 'Extended Home Care Therapy',
        serviceCode: 'OT CHHA EXTENDED',
        providerName: 'FORTUNE JOHANA',
        payRate: '72',
      },
      hha,
    );
    expect(session).toHaveLength(0);
  });
});
