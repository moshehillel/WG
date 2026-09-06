import { parseDos, isoDate } from './ids.js';
import type { AppSettings } from './types.js';
import { defaultAppSettings } from './types.js';

export { defaultAppSettings };

export function appSettingsFromStore(settings: AppSettings[] | undefined): AppSettings {
  const row = (settings || []).find((s) => s.id === 'global');
  if (!row) return defaultAppSettings();
  return {
    ...defaultAppSettings(),
    ...row,
    id: 'global',
    unlockedWeekIds: Array.isArray(row.unlockedWeekIds) ? row.unlockedWeekIds.map(String) : [],
    unlockedProviderIds: Array.isArray(row.unlockedProviderIds)
      ? row.unlockedProviderIds.map(String)
      : [],
    sessionImportMaxAgeDays:
      Number(row.sessionImportMaxAgeDays) > 0 ? Number(row.sessionImportMaxAgeDays) : 14,
  };
}

/** Calendar days from DOS to today (UTC). Null if DOS cannot be parsed. */
export function sessionAgeDays(dateOfService: string, todayIso = isoDate(new Date())): number | null {
  const dos = parseDos(dateOfService);
  const today = parseDos(todayIso);
  if (!dos || !today) return null;
  const ms = today.getTime() - dos.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function sessionImportAgeError(
  dateOfService: string,
  opts: {
    settings: AppSettings;
    providerId: string;
    weekId?: string;
    isAdmin?: boolean;
    todayIso?: string;
  },
): string | null {
  if (opts.isAdmin) return null;
  const settings = opts.settings;
  if (!settings.sessionImportAgeLockEnabled) return null;
  if (opts.weekId && settings.unlockedWeekIds.includes(opts.weekId)) return null;
  if (opts.providerId && settings.unlockedProviderIds.includes(opts.providerId)) return null;
  const age = sessionAgeDays(dateOfService, opts.todayIso);
  if (age == null) return null;
  const max = settings.sessionImportMaxAgeDays;
  if (age > max) {
    return `Session date ${dateOfService} is older than ${max} days. Ask an admin to unlock the 14-day locker for this week or provider.`;
  }
  return null;
}
