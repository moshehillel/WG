import { describe, expect, it } from 'vitest';
import { buildCreateScheduleBody } from './schedule-builder.js';

const base = {
  patientId: '123',
  contractId: '456',
  serviceCodeId: '789',
  caregiverId: '1011',
  startTime: '9:00 AM',
  endTime: '9:30 AM',
};

describe('buildCreateScheduleBody', () => {
  it('converts MM/DD/YYYY VisitDate to YYYY-MM-DD for AllXsd', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '09/04/2026',
    });
    expect(xml).toContain('<VisitDate>2026-09-04</VisitDate>');
    expect(xml).not.toContain('09/04/2026');
  });

  it('keeps ISO VisitDate unchanged', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-04',
    });
    expect(xml).toContain('<VisitDate>2026-09-04</VisitDate>');
  });
});
