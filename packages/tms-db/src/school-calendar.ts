import { isoDate, parseDos } from './ids.js';
import type { SchoolCalendar } from './types.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(String(value || '').trim());
}

export function emptySchoolCalendar(schoolId: string): SchoolCalendar {
  return { schoolId, yearStart: '', yearEnd: '', offDays: [] };
}

/** True when first/last day or at least one off day is on file (not the empty Mon–Fri default). */
export function hasConfiguredSchoolCalendar(
  calendar: SchoolCalendar | null | undefined,
): boolean {
  if (!calendar) return false;
  if (String(calendar.yearStart || '').trim()) return true;
  if (String(calendar.yearEnd || '').trim()) return true;
  return (calendar.offDays || []).some((d) => isIsoDate(String(d || '')));
}

/** Explicit warning when cycle / school-day logic falls back to weekday-only. */
export function schoolCalendarMonFriFallbackWarning(schoolName?: string): string {
  const name = String(schoolName || '').trim() || 'this school';
  return (
    `No school calendar for ${name} — falling back to Mon–Fri ` +
    `(weekends excluded; no holiday off-days).`
  );
}

/** True when school has street/city/state/zip for HHA CreatePatient. */
export function hasSchoolAddressForPatient(school: {
  address1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
} | null | undefined): boolean {
  if (!school) return false;
  return Boolean(
    String(school.address1 || '').trim() &&
      String(school.city || '').trim() &&
      String(school.state || '').trim() &&
      String(school.zipCode || '').trim(),
  );
}

export type SchoolSetupIncomplete = {
  missingCalendar: boolean;
  missingAddress: boolean;
  /** True when calendar and/or address still needed. */
  incomplete: boolean;
  /** Clear admin message, e.g. "Needs calendar and address". */
  message: string;
};

/** School stays incomplete (red in admin) until calendar AND address are set. */
export function schoolSetupIncomplete(
  school: {
    name?: string;
    address1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  } | null | undefined,
  calendar: SchoolCalendar | null | undefined,
): SchoolSetupIncomplete {
  const missingCalendar = !hasConfiguredSchoolCalendar(calendar);
  const missingAddress = !hasSchoolAddressForPatient(school);
  const parts: string[] = [];
  if (missingCalendar) parts.push('calendar');
  if (missingAddress) parts.push('address');
  const incomplete = parts.length > 0;
  const name = String(school?.name || '').trim() || 'This school';
  let message = '';
  if (incomplete) {
    if (parts.length === 2) {
      message = `${name} needs a calendar and address before HHA patient create and school-day mandate tracking are complete.`;
    } else if (missingCalendar) {
      message = `${name} needs a school calendar (first/last day and off days).`;
    } else {
      message = `${name} needs a full address (street, city, state, zip) for HHA CreatePatient.`;
    }
  }
  return { missingCalendar, missingAddress, incomplete, message };
}

/** Normalize and dedupe off-day strings (YYYY-MM-DD). */
export function normalizeOffDays(days: string[]): string[] {
  return [...new Set(days.map((d) => String(d).trim()).filter(isIsoDate))].sort();
}

/** Parse comma- or newline-separated ISO dates for bulk import. */
export function parseOffDaysCsv(text: string): string[] {
  const raw = String(text || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return normalizeOffDays(raw);
}

function weekdayUtc(date: string): number {
  const dt = parseDos(date);
  if (!dt) return -1;
  return dt.getUTCDay();
}

function inCalendarRange(date: string, calendar: SchoolCalendar): boolean {
  const { yearStart, yearEnd } = calendar;
  if (yearStart && date < yearStart) return false;
  if (yearEnd && date > yearEnd) return false;
  return true;
}

/**
 * Weekday Mon–Fri within calendar range (when set), excluding off days.
 * When year bounds are empty, only weekday + off-day rules apply.
 */
export function isSchoolDay(date: string, calendar: SchoolCalendar | null | undefined): boolean {
  const iso = String(date || '').trim();
  if (!isIsoDate(iso)) return false;
  const dow = weekdayUtc(iso);
  if (dow < 1 || dow > 5) return false;
  const cal = calendar ?? emptySchoolCalendar('');
  if (!inCalendarRange(iso, cal)) return false;
  return !cal.offDays.includes(iso);
}

/** Count school days from start through end (inclusive). Dates must be YYYY-MM-DD. */
export function schoolDaysBetween(
  start: string,
  end: string,
  calendar: SchoolCalendar | null | undefined,
): number {
  const from = String(start || '').trim();
  const to = String(end || '').trim();
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return 0;
  let count = 0;
  const dt = parseDos(from);
  if (!dt) return 0;
  const endDt = parseDos(to);
  if (!endDt) return 0;
  while (dt <= endDt) {
    const iso = isoDate(dt);
    if (isSchoolDay(iso, calendar)) count += 1;
    dt.setUTCDate(dt.getUTCDate() + 1);
  }
  return count;
}

/** Short label for admin UI, e.g. "Sep 2 – Jun 25, 12 off days". */
export function schoolCalendarSummary(calendar: SchoolCalendar | null | undefined): string {
  if (!calendar?.yearStart || !calendar?.yearEnd) return '';
  const fmt = (iso: string) => {
    const dt = parseDos(iso);
    if (!dt) return iso;
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const n = calendar.offDays?.length ?? 0;
  const offLabel = n === 1 ? '1 off day' : `${n} off days`;
  return `${fmt(calendar.yearStart)} – ${fmt(calendar.yearEnd)}, ${offLabel}`;
}
