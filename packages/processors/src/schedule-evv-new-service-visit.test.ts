import { describe, expect, it, vi } from 'vitest';
import {
  NEW_SERVICE_EVV_VISIT_END,
  NEW_SERVICE_EVV_VISIT_START,
  NEW_SERVICE_PROVIDER_COLUMN,
  previewEvvNewServiceVisit,
  scheduleEvvNewServiceVisit,
  shouldScheduleEvvVisitForNewService,
} from './schedule-evv-new-service-visit.js';

describe('schedule-evv-new-service-visit helpers', () => {
  it('schedules only EVV new_services rows', () => {
    expect(
      shouldScheduleEvvVisitForNewService({
        caseId: '1',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'new_services',
        programType: 'Americare Certified',
      }),
    ).toBe(true);
    expect(
      shouldScheduleEvvVisitForNewService({
        caseId: '1',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'opened_cases',
        programType: 'Americare Certified',
      }),
    ).toBe(false);
    expect(
      shouldScheduleEvvVisitForNewService({
        caseId: '1',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'new_services',
        programType: 'Herricks UFSD Therapy',
      }),
    ).toBe(false);
  });

  it('preview requires Provider Name and Service Begin Date; blank Pay Rate is ok', () => {
    const missingProvider = previewEvvNewServiceVisit({
      caseId: 'c1',
      firstName: 'A',
      lastName: 'B',
      sourceReport: 'new_services',
      programType: 'Extended Home Care Therapy',
      startDate: '08/01/2026',
      serviceCode: 'OT CHHA',
      payRate: '72',
    });
    expect(missingProvider?.message).toContain(NEW_SERVICE_PROVIDER_COLUMN);
    expect(missingProvider?.details?.expectedColumn).toBe(NEW_SERVICE_PROVIDER_COLUMN);

    const missingDate = previewEvvNewServiceVisit({
      caseId: 'c1',
      firstName: 'A',
      lastName: 'B',
      sourceReport: 'new_services',
      programType: 'Extended Home Care Therapy',
      providerName: 'X Y',
      serviceCode: 'OT CHHA',
      payRate: '72',
    });
    expect(missingDate?.message).toContain('Service Begin Date');

    const blankPayRateOk = previewEvvNewServiceVisit({
      caseId: 'c1',
      firstName: 'A',
      lastName: 'B',
      sourceReport: 'new_services',
      programType: 'Extended Home Care Therapy',
      providerName: 'X Y',
      startDate: '08/01/2026',
      serviceCode: 'OT CHHA',
    });
    expect(blankPayRateOk).toBeUndefined();
  });

  it('caregiver-not-found preview has no Fix or name-order hint', () => {
    const notFound = previewEvvNewServiceVisit(
      {
        caseId: 'c1',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'new_services',
        programType: 'Extended Home Care Therapy',
        providerName: 'LEUNG KA MEI',
        startDate: '08/01/2026',
        serviceCode: 'OT CHHA',
        payRate: '72',
      },
      { caregiverFound: false },
    );
    expect(notFound?.message).toBe(
      '[preview/new_services] case/session c1: Provider "LEUNG KA MEI" not found in HHA',
    );
    expect(notFound?.message).not.toMatch(/Fix:/i);
    expect(notFound?.message).not.toMatch(/name order/i);
  });

  it('preview flags unknown HHA pay code from Service Type + Pay Rate', () => {
    const missing = previewEvvNewServiceVisit(
      {
        caseId: 'c1',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'new_services',
        programType: 'Extended Home Care Therapy',
        providerName: 'X Y',
        startDate: '08/01/2026',
        serviceCode: 'OT CHHA',
        payRate: '72',
      },
      { payCodeId: null },
    );
    expect(missing?.message).toContain('OT $72');
    expect(missing?.details?.payCodeName).toBe('OT $72');
  });

  it('preview flags missing catalog when blank Pay Rate and no discipline rates', () => {
    const missing = previewEvvNewServiceVisit(
      {
        caseId: 'c1',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'new_services',
        programType: 'Extended Home Care Therapy',
        providerName: 'X Y',
        startDate: '08/01/2026',
        serviceCode: 'OT CHHA',
      },
      { payCodeId: null },
    );
    expect(missing?.details?.payRateFallback).toBe(true);
    expect(missing?.message).toMatch(/any catalog rate/i);
  });

  it('uses 9:00–9:30 placeholder times', () => {
    expect(NEW_SERVICE_EVV_VISIT_START).toBe('9:00 AM');
    expect(NEW_SERVICE_EVV_VISIT_END).toBe('9:30 AM');
  });

  it('sends PayCodeID from Service Type + Pay Rate to locateOrScheduleVisit', async () => {
    const locateOrScheduleVisit = vi.fn(async () => ({ id: 'v1', created: true }));
    const hha = {
      resolveCaregiverId: vi.fn(async () => 'cg-1'),
      resolvePayCodeId: vi.fn(async (name: string) =>
        name === 'OT $72' ? 'pay-ot72' : undefined,
      ),
      listPayRateCodes: vi.fn(async () => []),
      locateOrScheduleVisit,
    };
    await scheduleEvvNewServiceVisit({
      row: {
        caseId: '258267496',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'new_services',
        programType: 'Americare Certified',
        providerName: 'TEST AIDE',
        startDate: '08/20/2026',
        serviceCode: 'OT CHHA',
        payRate: '72.0000',
      },
      hha: hha as never,
      patientId: 'p1',
      contractId: 'c1',
      serviceCodeId: 's1',
    });
    expect(hha.resolvePayCodeId).toHaveBeenCalledWith('OT $72');
    expect(hha.listPayRateCodes).not.toHaveBeenCalled();
    expect(locateOrScheduleVisit).toHaveBeenCalledWith(
      expect.objectContaining({
        visitDate: '2026-08-20',
        payCodeId: 'pay-ot72',
        payRate: '72.0000',
      }),
    );
  });

  it('falls back to first catalog pay rate when Pay Rate is blank', async () => {
    const locateOrScheduleVisit = vi.fn(async () => ({ id: 'v1', created: true }));
    const hha = {
      resolveCaregiverId: vi.fn(async () => 'cg-1'),
      resolvePayCodeId: vi.fn(async () => undefined),
      listPayRateCodes: vi.fn(async () => [
        { id: 'pay-pt70', name: 'PT $70' },
        { id: 'pay-ot70', name: 'OT $70' },
        { id: 'pay-ot72', name: 'OT $72' },
      ]),
      locateOrScheduleVisit,
    };
    await scheduleEvvNewServiceVisit({
      row: {
        caseId: '166448',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'new_services',
        programType: 'Americare Certified',
        providerName: 'TEST AIDE',
        startDate: '08/20/2026',
        serviceCode: 'OT HC Eval',
      },
      hha: hha as never,
      patientId: 'p1',
      contractId: 'c1',
      serviceCodeId: 's1',
    });
    expect(hha.resolvePayCodeId).not.toHaveBeenCalled();
    expect(hha.listPayRateCodes).toHaveBeenCalled();
    expect(locateOrScheduleVisit).toHaveBeenCalledWith(
      expect.objectContaining({
        payCodeId: 'pay-ot70',
        payRate: '70',
      }),
    );
  });

  it('fails when Pay Rate is blank and discipline has no catalog rates', async () => {
    const locateOrScheduleVisit = vi.fn(async () => ({ id: 'v1', created: true }));
    const hha = {
      resolveCaregiverId: vi.fn(async () => 'cg-1'),
      resolvePayCodeId: vi.fn(async () => undefined),
      listPayRateCodes: vi.fn(async () => [{ id: 'pay-pt70', name: 'PT $70' }]),
      locateOrScheduleVisit,
    };
    await expect(
      scheduleEvvNewServiceVisit({
        row: {
          caseId: '166448',
          firstName: 'A',
          lastName: 'B',
          sourceReport: 'new_services',
          programType: 'Americare Certified',
          providerName: 'TEST AIDE',
          startDate: '08/20/2026',
          serviceCode: 'OT HC Eval',
        },
        hha: hha as never,
        patientId: 'p1',
        contractId: 'c1',
        serviceCodeId: 's1',
      }),
    ).rejects.toThrow(/no HHA pay rate codes for discipline "OT"/);
    expect(locateOrScheduleVisit).not.toHaveBeenCalled();
  });

  it('does not schedule for no-EVV program even if called path is gated', () => {
    expect(
      shouldScheduleEvvVisitForNewService({
        caseId: '1',
        firstName: 'A',
        lastName: 'B',
        sourceReport: 'new_services',
        programType: 'Garden City UFSD Therapy',
      }),
    ).toBe(false);
  });
});
