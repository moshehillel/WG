import { describe, expect, it } from 'vitest';
import { resolveServiceCodeIdFromRows } from './resolve-service-code-order.js';

describe('resolveServiceCodeIdFromRows (map before name)', () => {
  it('uses Excel alias HHA name when PS name is absent on contract', () => {
    const rows = [
      { id: '100', name: 'PT School' },
      { id: '200', name: 'Other' },
    ];
    // Exact PS name "PT School Makeup" is NOT on contract ΓÇö alias maps to "PT School".
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT School Makeup',
        programType: 'Arc Hudson Brookside School',
        rows,
      }),
    ).toBe('100');
  });

  it('prefers mapped HHA name over a misleading exact PS name row', () => {
    const rows = [
      { id: '1', name: 'PT GE CHHA' }, // would wrongly win if name-first
      { id: '56330', name: 'PT' },
    ];
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT GE CHHA',
        programType: 'Americare Certified',
        rows,
      }),
    ).toBe('56330');
  });

  it('resolves the five known failure types via aliases', () => {
    const cases: Array<{
      serviceType: string;
      programType: string;
      hhaName: string;
      id: string;
    }> = [
      {
        serviceType: 'PT School Makeup',
        programType: 'Arc Hudson Brookside School',
        hhaName: 'PT School',
        id: 'A1',
      },
      {
        serviceType: 'OT NYS 101',
        programType: 'NYS Medical Indemnity Fund Therapy',
        hhaName: 'OT 97110 101',
        id: 'B2',
      },
      {
        serviceType: 'PT GE CHHA',
        programType: 'Americare Certified',
        hhaName: 'PT',
        id: 'C3',
      },
      {
        serviceType: 'PT HIP',
        programType: 'HIP Therapy',
        hhaName: 'G0151',
        id: 'D4',
      },
      {
        serviceType: 'SLP NYS 114 45 MIN',
        programType: 'NYS Medical Indemnity Fund Therapy',
        hhaName: 'SLP 92507 114',
        id: 'E5',
      },
    ];

    for (const c of cases) {
      expect(
        resolveServiceCodeIdFromRows({
          serviceType: c.serviceType,
          programType: c.programType,
          rows: [{ id: c.id, name: c.hhaName }],
        }),
      ).toBe(c.id);
    }
  });

  it('falls back to case-insensitive PS/HHA name when no alias', () => {
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'OT CHHA EXTENDED',
        programType: 'Some Unknown Program',
        rows: [{ id: '9', name: 'OT CHHA EXTENDED' }],
      }),
    ).toBe('9');
  });

  it('matches mixed-case PS names to HHA billing names and SERVICE_CODE_MAP', () => {
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT SCHOOL',
        programType: 'Some Unknown Program',
        rows: [{ id: '42', name: 'pt school' }],
      }),
    ).toBe('42');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT SCHOOL',
        rows: [{ id: '1276986', name: 'PT school' }],
      }),
    ).toBe('1276986');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT SCHOOL',
        programType: 'Garden City UFSD Therapy',
        rows: [{ id: '100', name: 'PT school' }],
      }),
    ).toBe('100');
  });

  it('returns undefined when alias exists but mapped name missing on contract', () => {
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT HIP',
        programType: 'HIP Therapy',
        rows: [{ id: '9', name: 'PT HIP' }], // PS name present, mapped G0151 absent
      }),
    ).toBeUndefined();
  });

  it('maps Americare / Extended HC Eval and CHHA aliases (not flat static IDs)', () => {
    const americare = [
      { id: '313581', name: 'OT' },
      { id: '313582', name: 'PT' },
      { id: '313583', name: 'ST' },
      { id: '973449', name: 'OT HC Eval' }, // poisoned flat-map decoy (other contract)
      { id: '232853', name: 'PT' }, // agency-wide decoy also named PT
      { id: '530451', name: 'PT' },
    ];
    // Contract-scoped list would only include 31358x — alias must pick that PT, not 232853.
    const americareScoped = americare.filter((r) => r.id.startsWith('31358'));
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'OT HC Eval',
        programType: 'Americare Certified',
        rows: americareScoped,
      }),
    ).toBe('313581');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT HC Eval',
        programType: 'Americare Certified',
        rows: americareScoped,
      }),
    ).toBe('313582');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'SLP CHHA',
        programType: 'Americare Certified',
        rows: americareScoped,
      }),
    ).toBe('313583');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'OT CHHA',
        programType: 'Americare Certified',
        rows: americareScoped,
      }),
    ).toBe('313581');

    const extended = [
      { id: 'e-ot', name: 'Occupational Therapy' },
      { id: 'e-pt', name: 'Physical Therapy' },
      { id: 'e-st', name: 'Speech Therapy' },
      { id: 'e-ot-eval', name: 'OT SOC/ROC OASIS' },
      { id: 'e-pt-eval', name: 'PT SOC/ROC OASIS' },
      { id: '973449', name: 'OT HC Eval' },
      { id: '785136', name: 'PT CHHA EXTENDED' },
    ];
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'OT HC Eval',
        programType: 'Extended Home Care Therapy',
        rows: extended,
      }),
    ).toBe('e-ot-eval');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT HC Eval',
        programType: 'Extended Home Care Therapy',
        rows: extended,
      }),
    ).toBe('e-pt-eval');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'SLP CHHA',
        programType: 'Extended Home Care Therapy',
        rows: extended,
      }),
    ).toBe('e-st');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'OT CHHA',
        programType: 'Extended Home Care Therapy',
        rows: extended,
      }),
    ).toBe('e-ot');
  });

  it('maps NYS PT EVAL 107 to sheet HHA name (no dash) and tolerates dash variants', () => {
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT NYS EVAL 107',
        programType: 'NYS Medical Indemnity Fund Therapy',
        rows: [{ id: 'nys-107', name: 'PT Eval 97162 107' }],
      }),
    ).toBe('nys-107');
    expect(
      resolveServiceCodeIdFromRows({
        serviceType: 'PT NYS EVAL 104',
        programType: 'NYS Medical Indemnity Fund Therapy',
        // Alias has "97162 - 104"; live/HHA may omit spaces around the dash.
        rows: [{ id: 'nys-104', name: 'PT Eval 97162-104' }],
      }),
    ).toBe('nys-104');
  });
});
