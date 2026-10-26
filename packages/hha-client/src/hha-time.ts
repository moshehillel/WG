import { stripProviderDisciplineSuffixes } from '@white-glove/shared';

/** Minutes from midnight for "4:30 PM" style times. */
export function toMinutes12h(t: string | undefined): number | null {
  if (!t?.trim()) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]!.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

/** HHA datetime or HH:MM → minutes from midnight. */
export function extractHhaMinutes(s: string | undefined): number | null {
  if (!s?.trim()) return null;
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * HHA SOAP AllXsd xs:date. Always YYYY-MM-DD from ISO, M/D/YYYY, MM/DD/YYYY, or MM/DD/YY.
 * Two-digit years: 00–69 → 2000s, 70–99 → 1900s (school DOS 09/16/26 → 2026-09-16).
 */
export function psDateToIso(d: string | undefined): string | undefined {
  if (!d?.trim()) return undefined;
  const t = d.trim();
  const iso = t.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (iso) return iso[1];
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s+.*)?$/);
  if (!m) return t.slice(0, 10);
  const mm = m[1]!.padStart(2, '0');
  const dd = m[2]!.padStart(2, '0');
  const yearRaw = m[3]!;
  const yearNum = Number(yearRaw);
  const year = yearRaw.length === 4 ? yearNum : yearNum <= 69 ? 2000 + yearNum : 1900 + yearNum;
  return `${year}-${mm}-${dd}`;
}

/**
 * Minutes from midnight for a schedule clock.
 * Accepts "1:00 AM", "01:00", "0100", and datetimes that contain HH:MM.
 */
export function scheduleClockMinutes(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const compact = raw.match(/^(\d{2})(\d{2})$/);
  if (compact) {
    const h = Number(compact[1]);
    const m = Number(compact[2]);
    if (h <= 23 && m <= 59) return h * 60 + m;
  }
  const twelve = toMinutes12h(raw);
  if (twelve != null) return twelve;
  return extractHhaMinutes(raw);
}

/**
 * The EVV scaffolding visit is always 1:00–1:30 AM (0100–0130).
 * A daytime session is a different visit and must not match.
 */
export function isEvvPlaceholderSchedule(start: string | undefined, end: string | undefined): boolean {
  return scheduleClockMinutes(start) === 60 && scheduleClockMinutes(end) === 90;
}

/** "4:30 PM" → "1630" for CreateSchedule ScheduleStartTime. */
export function psTimeToHhmm(t: string | undefined): string | undefined {
  if (!t?.trim()) return undefined;
  const mins = toMinutes12h(t);
  if (mins == null) return t.replace(/:/g, '').slice(0, 4);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

/** ISO date + PS time → `2026-08-01T11:53:00`. */
export function psDateTimeIso(dateIso: string, time12h?: string): string {
  const mins = toMinutes12h(time12h);
  if (mins == null) return `${dateIso}T00:00:00`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${dateIso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/** ISO date + PS time → `2026-08-01 11:53` for ScheduleStartTime fields. */
export function psDateTimeSpace(dateIso: string, time12h?: string): string {
  return psDateTimeIso(dateIso, time12h).replace('T', ' ').slice(0, 16);
}

export function compareSessionClock(
  psBegin: string | undefined,
  psEnd: string | undefined,
  evvStart: string | undefined,
  evvEnd: string | undefined,
  toleranceMin = 5,
): { matches: boolean; startDiffMin: number | null; endDiffMin: number | null } {
  const expS = toMinutes12h(psBegin);
  const expE = toMinutes12h(psEnd);
  const actS = extractHhaMinutes(evvStart);
  const actE = extractHhaMinutes(evvEnd);
  const startDiff = expS != null && actS != null ? Math.abs(expS - actS) : null;
  const endDiff = expE != null && actE != null ? Math.abs(expE - actE) : null;
  return {
    startDiffMin: startDiff,
    endDiffMin: endDiff,
    matches:
      startDiff != null &&
      endDiff != null &&
      startDiff <= toleranceMin &&
      endDiff <= toleranceMin,
  };
}

/** Session duration in minutes from PS begin/end. */
export function sessionDurationMinutes(begin?: string, end?: string): number | undefined {
  const s = toMinutes12h(begin);
  const e = toMinutes12h(end);
  if (s == null || e == null || e < s) return undefined;
  return e - s;
}

/** Split "LAST FIRST" provider name from API Report. */
export function splitProviderName(full: string | undefined): { firstName: string; lastName: string } {
  if (!full?.trim()) return { firstName: '', lastName: '' };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { lastName: parts[0]!, firstName: parts.slice(1).join(' ') };
}

/**
 * SearchCaregivers name-order attempts for ProviderSoft "Provider Name".
 * PS sheets mix LAST FIRST and FIRST LAST — try both (and last-token-as-surname).
 * Also accepts "Last, First" (TMS transfer / PS) — commas must not stick to name tokens.
 * Multi-word surnames ("Donaldson Fortune, Shayena") keep the full last name and also
 * try first/last surname tokens (HHA often stores maiden-only LastName=Donaldson).
 */
export function caregiverSearchNameOrders(
  providerName: string | undefined,
): Array<{ firstName: string; lastName: string }> {
  const raw = (providerName ?? '').trim();
  if (!raw) return [];

  const attempts: Array<{ firstName: string; lastName: string }> = [];

  // Honor "Last, First" before strip collapses the comma into spaces — otherwise
  // "Donaldson Fortune, Shayena" becomes 3 tokens and never searches Last=Donaldson Fortune.
  const commaIdx = raw.indexOf(',');
  if (commaIdx > 0) {
    const last = stripProviderDisciplineSuffixes(raw.slice(0, commaIdx));
    const first = stripProviderDisciplineSuffixes(raw.slice(commaIdx + 1));
    if (last && first) {
      attempts.push({ lastName: last, firstName: first });
      attempts.push({ firstName: first, lastName: last });
      const lastParts = last.split(/\s+/).filter(Boolean);
      if (lastParts.length > 1) {
        attempts.push({ lastName: lastParts[0]!, firstName: first });
        attempts.push({ lastName: lastParts[lastParts.length - 1]!, firstName: first });
        attempts.push({ firstName: first, lastName: lastParts[0]! });
        attempts.push({ firstName: first, lastName: lastParts[lastParts.length - 1]! });
      }
    }
  }

  // Drop PT*/OT/SLP (and trailing *) so "Patel PT*, NEELAMBEN" searches as Patel / NEELAMBEN.
  const parts = stripProviderDisciplineSuffixes(providerName)
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return dedupeCaregiverNameAttempts(attempts);
  }
  if (parts.length === 1) {
    attempts.push(
      { firstName: parts[0]!, lastName: '' },
      { firstName: '', lastName: parts[0]! },
    );
    return dedupeCaregiverNameAttempts(attempts);
  }

  const base: Array<{ firstName: string; lastName: string }> = [
    { lastName: parts[0]!, firstName: parts.slice(1).join(' ') },
    { firstName: parts[0]!, lastName: parts.slice(1).join(' ') },
    { lastName: parts[parts.length - 1]!, firstName: parts.slice(0, -1).join(' ') },
  ];

  for (const a of base) {
    attempts.push(a);
    const firstParts = a.firstName.split(/\s+/).filter(Boolean);
    if (firstParts.length > 1) {
      attempts.push({ firstName: firstParts[0]!, lastName: a.lastName });
    }
  }

  return dedupeCaregiverNameAttempts(attempts);
}

function dedupeCaregiverNameAttempts(
  attempts: Array<{ firstName: string; lastName: string }>,
): Array<{ firstName: string; lastName: string }> {
  const seen = new Set<string>();
  const out: Array<{ firstName: string; lastName: string }> = [];
  for (const a of attempts) {
    const key = `${a.firstName.toUpperCase()}|${a.lastName.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}
