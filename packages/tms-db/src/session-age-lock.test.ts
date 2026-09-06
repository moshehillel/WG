import { describe, expect, it } from 'vitest';
import {
  appSettingsFromStore,
  defaultAppSettings,
  sessionAgeDays,
  sessionImportAgeError,
} from './session-age-lock.js';

describe('session age lock', () => {
  it('computes age in days', () => {
    expect(sessionAgeDays('09/01/2026', '2026-09-15')).toBe(14);
    expect(sessionAgeDays('2026-09-01', '2026-09-16')).toBe(15);
  });

  it('blocks over max age when enabled', () => {
    const settings = {
      ...defaultAppSettings(),
      sessionImportAgeLockEnabled: true,
      sessionImportMaxAgeDays: 14,
    };
    expect(
      sessionImportAgeError('08/01/2026', {
        settings,
        providerId: 'p1',
        todayIso: '2026-09-06',
      }),
    ).toMatch(/older than 14 days/i);
    expect(
      sessionImportAgeError('09/01/2026', {
        settings,
        providerId: 'p1',
        todayIso: '2026-09-06',
      }),
    ).toBeNull();
  });

  it('respects unlocks and admin', () => {
    const settings = {
      ...defaultAppSettings(),
      unlockedProviderIds: ['p1'],
      unlockedWeekIds: ['w1'],
    };
    expect(
      sessionImportAgeError('01/01/2020', {
        settings,
        providerId: 'p1',
        todayIso: '2026-09-06',
      }),
    ).toBeNull();
    expect(
      sessionImportAgeError('01/01/2020', {
        settings: defaultAppSettings(),
        providerId: 'p2',
        weekId: 'w1',
        todayIso: '2026-09-06',
      }),
    ).toMatch(/older than/);
    expect(
      sessionImportAgeError('01/01/2020', {
        settings: { ...defaultAppSettings(), unlockedWeekIds: ['w1'] },
        providerId: 'p2',
        weekId: 'w1',
        todayIso: '2026-09-06',
      }),
    ).toBeNull();
    expect(
      sessionImportAgeError('01/01/2020', {
        settings: defaultAppSettings(),
        providerId: 'p2',
        isAdmin: true,
        todayIso: '2026-09-06',
      }),
    ).toBeNull();
  });

  it('merges settings defaults', () => {
    expect(appSettingsFromStore(undefined).sessionImportMaxAgeDays).toBe(14);
    expect(appSettingsFromStore([{ id: 'global', sessionImportAgeLockEnabled: false } as never]).sessionImportAgeLockEnabled).toBe(false);
  });
});
