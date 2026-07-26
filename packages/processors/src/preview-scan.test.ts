import { describe, expect, it } from 'vitest';
import { previewOpenedCase, previewVerifiedSession } from './preview-scan.js';

describe('preview-scan', () => {
  it('flags unknown program and service types', () => {
    const opened = previewOpenedCase({
      caseId: 'c1',
      firstName: 'A',
      lastName: 'B',
      programType: 'Unknown Program',
      serviceCode: 'NOPE',
    });
    expect(opened.length).toBeGreaterThanOrEqual(2);

    const session = previewVerifiedSession({
      sessionId: 's1',
      programType: 'Extended Home Care Therapy',
      serviceCode: 'OT CHHA EXTENDED',
      providerName: 'FORTUNE JOHANA',
      payRate: '72',
    });
    expect(session).toHaveLength(0);
  });
});
