import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { resolveSessionVisit } from './session-resolve.js';

function schoolRow(overrides: {
  serviceCode: string;
  startTime: string;
  endTime: string;
  payRate: string;
}) {
  return {
    sessionId: 'S-group',
    patientExternalId: 'p1',
    serviceCode: overrides.serviceCode,
    programType: 'Garden City UFSD Therapy',
    visitDate: '2026-08-14',
    startTime: overrides.startTime,
    endTime: overrides.endTime,
    providerName: 'FORTUNE JOHANA',
    payRate: overrides.payRate,
  };
}

describe('resolveSessionVisit group remap', () => {
  it('resolves remapped individual service type before HHA lookup', async () => {
    const hha = new MockHhaClient();
    hha.payCodes.set('PT45', 'pay-pt45');
    const seen: Array<string | undefined> = [];
    const orig = hha.resolveServiceCodeId.bind(hha);
    hha.resolveServiceCodeId = async (serviceType, contractId, programType) => {
      seen.push(serviceType);
      return orig(serviceType, contractId, programType);
    };

    const resolved = await resolveSessionVisit({
      row: schoolRow({
        serviceCode: 'PT School Group',
        startTime: '09:00 AM',
        endTime: '09:30 AM',
        payRate: '45',
      }),
      caregiverMap: new Map(),
      hha,
      needsEvv: false,
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(seen).toEqual(['PT School']);
    expect(resolved.resolved.visit.serviceCode).toBe('PT School');
    expect(resolved.resolved.visit.serviceCodeId).toBe('alias:PT School');
  });

  it('resolves PT SCHOOL GROUP against mixed-case HHA/Excel names', async () => {
    const hha = new MockHhaClient();
    hha.payCodes.set('PT45', 'pay-pt45');
    const seen: Array<string | undefined> = [];
    const orig = hha.resolveServiceCodeId.bind(hha);
    hha.resolveServiceCodeId = async (serviceType, contractId, programType) => {
      seen.push(serviceType);
      return orig(serviceType, contractId, programType);
    };

    const resolved = await resolveSessionVisit({
      row: schoolRow({
        serviceCode: 'PT SCHOOL GROUP',
        startTime: '09:00 AM',
        endTime: '09:30 AM',
        payRate: '45',
      }),
      caregiverMap: new Map(),
      hha,
      needsEvv: false,
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(seen[0]?.toLowerCase()).toBe('pt school');
    expect(resolved.resolved.visit.serviceCode?.toLowerCase()).toBe('pt school');
    expect(resolved.resolved.visit.serviceCode).toBe('PT School');
    expect(resolved.resolved.visit.serviceCodeId).toBe('alias:PT School');
  });

  it('keeps group service type when pay rate is below threshold', async () => {
    const hha = new MockHhaClient();
    hha.payCodes.set('PT10.99', 'pay-pt1099');
    const seen: Array<string | undefined> = [];
    const orig = hha.resolveServiceCodeId.bind(hha);
    hha.resolveServiceCodeId = async (serviceType, contractId, programType) => {
      seen.push(serviceType);
      return orig(serviceType, contractId, programType);
    };

    const resolved = await resolveSessionVisit({
      row: schoolRow({
        serviceCode: 'PT School Group',
        startTime: '09:00 AM',
        endTime: '09:15 AM',
        payRate: '10.99',
      }),
      caregiverMap: new Map(),
      hha,
      needsEvv: false,
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(seen).toEqual(['PT School Group']);
    expect(resolved.resolved.visit.serviceCode).toBe('PT School Group');
    expect(resolved.resolved.visit.serviceCodeId).toBe('alias:PT Group');
  });

  it('resolves without pay-code lookup when Pay Rate is 0 (missed)', async () => {
    const hha = new MockHhaClient();
    hha.payCodes.set('PT45', 'pay-pt45');
    let payLookups = 0;
    const orig = hha.resolvePayCodeId.bind(hha);
    hha.resolvePayCodeId = async (name) => {
      payLookups += 1;
      return orig(name);
    };

    const resolved = await resolveSessionVisit({
      row: schoolRow({
        serviceCode: 'PT School',
        startTime: '09:00 AM',
        endTime: '09:30 AM',
        payRate: '0.0000',
      }),
      caregiverMap: new Map(),
      hha,
      needsEvv: false,
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error(resolved.error.message);
    }
    expect(payLookups).toBe(0);
    expect(resolved.resolved.visit.payCodeId).toBeUndefined();
  });
});
