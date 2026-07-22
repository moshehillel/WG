import { describe, expect, it } from 'vitest';
import {
  parseVisitConfirmTimes,
  parseVisitEditReasonPairs,
  toConfirmIso,
  timesheetConfirmAttempts,
} from './visit-confirm.js';

describe('visit-confirm', () => {
  it('parses VisitEdit reason pairs from prod XML shape', () => {
    const xml = `<VisitEditReasonID>107</VisitEditReasonID><VisitEditActionTakenReasonID>19</VisitEditActionTakenReasonID>
      <VisitEditReasonID>108</VisitEditReasonID><VisitEditActionTakenReasonID>10</VisitEditActionTakenReasonID>`;
    expect(parseVisitEditReasonPairs(xml)).toEqual([
      { reasonCode: '107', actionCode: '19' },
      { reasonCode: '108', actionCode: '10' },
    ]);
  });

  it('converts schedule times to ISO', () => {
    expect(toConfirmIso('2026-07-10', '2026-07-10 09:00')).toBe('2026-07-10T09:00:00');
    expect(toConfirmIso('2026-07-22', '13:00')).toBe('2026-07-22T13:00:00');
  });

  it('parses visit confirm window from GetVisitInfoV2 XML', () => {
    const xml = `<VisitDate>2026-07-10</VisitDate><ScheduleStartTime>2026-07-10 09:00</ScheduleStartTime><ScheduleEndTime>2026-07-10 13:00</ScheduleEndTime>`;
    expect(parseVisitConfirmTimes(xml)).toEqual({
      startIso: '2026-07-10T09:00:00',
      endIso: '2026-07-10T13:00:00',
    });
  });

  it('dedupes timesheet confirm attempts', () => {
    const attempts = timesheetConfirmAttempts({
      timesheetRequired: 'No',
      timesheetApproved: 'No',
    });
    expect(attempts[0]).toEqual({ timesheetRequired: 'No', timesheetApproved: 'No' });
    expect(attempts.length).toBeGreaterThan(1);
  });
});
