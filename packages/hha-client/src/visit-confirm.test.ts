import { describe, expect, it } from 'vitest';
import {
  parseTimesheetFlags,
  parseVisitConfirmTimes,
  parseVisitEditReasonPairs,
  toConfirmIso,
  timesheetConfirmAttempts,
  isAlreadyBilledConfirmFault,
  isVisitAlreadyBilledXml,
  isVisitAlreadyPayConfirmedXml,
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

  it('prefers TimesheetApproved=Yes for payroll (never Approved=No first)', () => {
    const attempts = timesheetConfirmAttempts({
      timesheetRequired: 'No',
      timesheetApproved: 'No',
    });
    expect(attempts[0]).toEqual({ timesheetRequired: 'Yes', timesheetApproved: 'Yes' });
    expect(attempts.every((a) => a.timesheetApproved === 'Yes')).toBe(true);
    expect(attempts.length).toBeGreaterThan(1);
  });

  it('reads nested Timesheet Required/Approved from GetVisitInfoV2', () => {
    expect(
      parseTimesheetFlags('<Timesheet><Required>Yes</Required><Approved>Yes</Approved></Timesheet>'),
    ).toEqual({ timesheetRequired: 'Yes', timesheetApproved: 'Yes' });
  });

  it('detects Already Billed (-401) as confirm success', () => {
    expect(isAlreadyBilledConfirmFault('-401', 'Visit is already Billed')).toBe(true);
    expect(isAlreadyBilledConfirmFault(undefined, 'Visit is already Billed (-401)')).toBe(true);
    expect(isAlreadyBilledConfirmFault('-74', 'TimesheetRequired')).toBe(false);
  });

  it('detects billed / pay-confirmed visit XML', () => {
    expect(isVisitAlreadyBilledXml('<VisitStatus>Billed</VisitStatus>')).toBe(true);
    expect(
      isVisitAlreadyPayConfirmedXml(
        '<VisitStatus>Confirmed</VisitStatus><TimesheetApproved>Yes</TimesheetApproved>',
      ),
    ).toBe(true);
    expect(
      isVisitAlreadyPayConfirmedXml(
        '<VisitStatus>Scheduled</VisitStatus><TimesheetApproved>No</TimesheetApproved>',
      ),
    ).toBe(false);
  });
});
