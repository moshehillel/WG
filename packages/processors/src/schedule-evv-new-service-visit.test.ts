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

  it('preview requires Provider Name and Service Begin Date', () => {
    const missingProvider = previewEvvNewServiceVisit({
      caseId: 'c1',
      firstName: 'A',
      lastName: 'B',
      sourceReport: 'new_services',
      programType: 'Extended Home Care Therapy',
      startDate: '08/01/2026',
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
    });
    expect(missingDate?.message).toContain('Service Begin Date');
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
      },
      { caregiverFound: false },
    );
    expect(notFound?.message).toBe(
      '[preview/new_services] case/session c1: Provider "LEUNG KA MEI" not found in HHA',
    );
    expect(notFound?.message).not.toMatch(/Fix:/i);
    expect(notFound?.message).not.toMatch(/name order/i);
  });

  it('uses 9:00–9:30 placeholder times', () => {
    expect(NEW_SERVICE_EVV_VISIT_START).toBe('9:00 AM');
    expect(NEW_SERVICE_EVV_VISIT_END).toBe('9:30 AM');
  });

  it('sends ISO VisitDate to locateOrScheduleVisit (not PS MM/DD/YYYY)', async () => {
    const locateOrScheduleVisit = vi.fn(async () => ({ id: 'v1', created: true }));
    const hha = {
      resolveCaregiverId: vi.fn(async () => 'cg-1'),
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
        serviceCode: 'OT',
      },
      hha: hha as never,
      patientId: 'p1',
      contractId: 'c1',
      serviceCodeId: 's1',
    });
    expect(locateOrScheduleVisit).toHaveBeenCalledWith(
      expect.objectContaining({ visitDate: '2026-08-20' }),
    );
  });
});
