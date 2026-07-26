import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDate,
  dailyLookbackDays,
  defaultDateRange,
  formatPsDate,
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

  it('verified_sessions ends on business day and spans 7 days back', () => {
    const now = new Date('2026-07-28T03:00:00.000Z');
    const range = defaultDateRange('verified_sessions', now, {
      PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '0',
      PROVIDERSOFT_TIMEZONE: 'America/New_York',
    });
    expect(range.to).toBe('7/27/2026');
    expect(range.from).toBe(formatPsDate(addCalendarDays(calendarDate(2026, 7, 27), -7)));
  });

  it('defaults lookback to 0 days (same Eastern day)', () => {
    expect(dailyLookbackDays({})).toBe(0);
    expect(dailyLookbackDays({ PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '1' })).toBe(1);
  });
});
