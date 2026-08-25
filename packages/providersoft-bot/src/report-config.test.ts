import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDate,
  dailyLookbackDays,
  defaultDateRange,
  formatPsDate,
  preferDateInputSelector,
  REPORT_DATE_INPUTS,
  verifiedSessionsTueMonRange,
} from './report-config.js';

describe('defaultDateRange', () => {
  it('uses today Eastern for daily reports when lookback is 0 (11 PM run)', () => {
    // 11:00 PM Eastern Mon Jul 27 2026 = 03:00 UTC Tue Jul 28
    const now = new Date('2026-07-28T03:00:00.000Z');
    const range = defaultDateRange('opened_cases', now, {
      PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '0',
      PROVIDERSOFT_TIMEZONE: 'America/New_York',
    });
    expect(range).toEqual({ from: '7/27/2026', to: '7/27/2026' });
  });

  it('uses yesterday Eastern when lookback is 1 (after-midnight run)', () => {
    const now = new Date('2026-07-28T06:00:00.000Z');
    const range = defaultDateRange('opened_cases', now, {
      PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '1',
      PROVIDERSOFT_TIMEZONE: 'America/New_York',
    });
    expect(range).toEqual({ from: '7/27/2026', to: '7/27/2026' });
  });

  it('verified_sessions uses Tuesday→Monday week ending on/after business Monday', () => {
    // Mon Jul 27 Eastern → previous Tuesday Jul 21 → Monday Jul 27
    const now = new Date('2026-07-28T03:00:00.000Z');
    const range = defaultDateRange('verified_sessions', now, {
      PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '0',
      PROVIDERSOFT_TIMEZONE: 'America/New_York',
    });
    expect(range).toEqual({ from: '7/21/2026', to: '7/27/2026' });
  });

  it('verified_sessions mid-week uses this week Tuesday through next Monday', () => {
    // Wed Jul 29 2026 15:00 Eastern = 19:00 UTC
    const now = new Date('2026-07-29T19:00:00.000Z');
    const range = defaultDateRange('verified_sessions', now, {
      PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '0',
      PROVIDERSOFT_TIMEZONE: 'America/New_York',
    });
    expect(range).toEqual({ from: '7/28/2026', to: '8/3/2026' });
  });

  it('new_services spans Service Begin Date lookback through business day', () => {
    const now = new Date('2026-07-28T03:00:00.000Z');
    const range = defaultDateRange('new_services', now, {
      PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '0',
      PROVIDERSOFT_NEW_SERVICE_LOOKBACK_DAYS: '14',
      PROVIDERSOFT_TIMEZONE: 'America/New_York',
    });
    expect(range.to).toBe('7/27/2026');
    expect(range.from).toBe(formatPsDate(addCalendarDays(calendarDate(2026, 7, 27), -14)));
  });

  it('defaults lookback to 0 days (same Eastern day)', () => {
    expect(dailyLookbackDays({})).toBe(0);
    expect(dailyLookbackDays({ PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '1' })).toBe(1);
  });

  it('sandbox and live share defaultDateRange (today for Gluck; 14d new service; Tue–Mon API)', () => {
    const now = new Date('2026-07-28T03:00:00.000Z');
    const env = {
      PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '0',
      PROVIDERSOFT_TIMEZONE: 'America/New_York',
    };
    expect(defaultDateRange('opened_cases', now, env)).toEqual({
      from: '7/27/2026',
      to: '7/27/2026',
    });
    expect(defaultDateRange('new_services', now, env).from).toBe(
      formatPsDate(addCalendarDays(calendarDate(2026, 7, 27), -14)),
    );
    expect(defaultDateRange('verified_sessions', now, env)).toEqual({
      from: '7/21/2026',
      to: '7/27/2026',
    });
  });
});

describe('verifiedSessionsTueMonRange', () => {
  it('maps Sun/Mon back to previous Tuesday', () => {
    expect(verifiedSessionsTueMonRange(calendarDate(2026, 7, 26))).toEqual({
      from: calendarDate(2026, 7, 21),
      to: calendarDate(2026, 7, 27),
    });
    expect(verifiedSessionsTueMonRange(calendarDate(2026, 7, 27))).toEqual({
      from: calendarDate(2026, 7, 21),
      to: calendarDate(2026, 7, 27),
    });
  });

  it('maps Tue–Sat to this week Tuesday through next Monday', () => {
    expect(verifiedSessionsTueMonRange(calendarDate(2026, 7, 28))).toEqual({
      from: calendarDate(2026, 7, 28),
      to: calendarDate(2026, 8, 3),
    });
    expect(verifiedSessionsTueMonRange(calendarDate(2026, 8, 1))).toEqual({
      from: calendarDate(2026, 7, 28),
      to: calendarDate(2026, 8, 3),
    });
  });
});

describe('REPORT_DATE_INPUTS / preferDateInputSelector', () => {
  it('API Verified Date uses ctl28 / DLColumControl_27 dateInput', () => {
    expect(REPORT_DATE_INPUTS.verified_sessions.from).toContain('ctl28_DLColumControl_27_1');
    expect(REPORT_DATE_INPUTS.verified_sessions.from).toMatch(/dateInput$/);
    expect(REPORT_DATE_INPUTS.new_services.from).toContain('ctl33_DLColumControl_32_1');
  });

  it('maps popupButton selectors to dateInput', () => {
    expect(
      preferDateInputSelector(
        '#ctl00_Content_dlREportColumns_ctl28_DLColumControl_27_1_datePicker_popupButton',
      ),
    ).toBe('#ctl00_Content_dlREportColumns_ctl28_DLColumControl_27_1_datePicker_dateInput');
  });
});
