import { describe, expect, it } from 'vitest';
import { filterOpenedCases, triageVerifiedSession } from './rules.js';

describe('filterOpenedCases', () => {
  it('skips early intervention cases', () => {
    const { kept, skippedEi } = filterOpenedCases([
      {
        caseId: '1',
        firstName: 'A',
        lastName: 'B',
        programType: 'Early Intervention',
      },
      {
        caseId: '2',
        firstName: 'C',
        lastName: 'D',
        programType: 'Home Health',
      },
    ]);
    expect(skippedEi).toHaveLength(1);
    expect(kept.map((r) => r.caseId)).toEqual(['2']);
  });
});

describe('triageVerifiedSession', () => {
  it('skips Early Intervention sessions', () => {
    const decision = triageVerifiedSession({
      sessionId: 's-ei',
      serviceCode: 'PCA001',
      programType: 'Early Intervention',
    });
    expect(decision.triage).toBe('skip');
    expect(decision.reason).toBe('early_intervention');
  });

  it('blocks explicit unmapped service types at triage', () => {
    const decision = triageVerifiedSession({
      sessionId: 's2',
      serviceCode: 'SI- ABA 1 NYC',
    });
    expect(decision.triage).toBe('skip');
    expect(decision.reason).toBe('unknown_service_code');
  });

  it('allows new service types through to live HHA resolve', () => {
    const decision = triageVerifiedSession({
      sessionId: 's-new',
      serviceCode: 'ZZZ999',
    });
    expect(decision.triage).toBe('verify_clocking');
    expect(decision.reason).toBe('service_resolve_live');
  });

  it('auto-approves mapped service types for no-EVV programs', () => {
    const decision = triageVerifiedSession({
      sessionId: 's1',
      serviceCode: 'OT CHHA EXTENDED',
      programType: 'Garden City UFSD Therapy',
    });
    expect(decision.triage).toBe('auto_approve');
  });

  it('skips cancelled status', () => {
    const decision = triageVerifiedSession({
      sessionId: 's3',
      serviceCode: 'OT CHHA EXTENDED',
      status: 'Cancelled',
    });
    expect(decision.triage).toBe('skip');
  });

  it('verify_clocking for EVV program types', () => {
    const decision = triageVerifiedSession({
      sessionId: 's-evv',
      programType: 'Extended Home Care Therapy',
      serviceCode: 'OT CHHA EXTENDED',
    });
    expect(decision.triage).toBe('verify_clocking');
    expect(decision.reason).toContain('program_evv');
  });

  it('auto_approve for no-EVV program types', () => {
    const decision = triageVerifiedSession({
      sessionId: 's-no-evv',
      programType: 'Garden City UFSD Therapy',
      serviceCode: 'OT CHHA EXTENDED',
    });
    expect(decision.triage).toBe('auto_approve');
    expect(decision.reason).toContain('program_no_evv');
  });
});
