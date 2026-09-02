import type { Discipline, Mandate, SessionRow } from './types.js';

export function parseFrequencyPerWeek(raw: string): number | null {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const x = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(?:\/\s*)?(?:week|wk|weekly)?/);
  if (x) return Number(x[1]);
  const times = s.match(/(\d+(?:\.\d+)?)\s*(?:times|x)\s*(?:per|a|\/)?\s*(?:week|wk|weekly)/);
  if (times) return Number(times[1]);
  const slash = s.match(/(\d+)\s*\/\s*(?:week|wk)/);
  if (slash) return Number(slash[1]);
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Number(bare[1]);
  return null;
}

export function disciplineFromServiceType(serviceType: string): Discipline | '' {
  const s = String(serviceType || '').toUpperCase();
  if (/\bSLP\b|\bSPEECH\b|\bLANGUAGE\b/.test(s)) return 'SLP';
  if (/\bOT\b|\bOCCUPATIONAL\b/.test(s)) return 'OT';
  if (/\bPT\b|\bPHYSICAL\b/.test(s)) return 'PT';
  return '';
}

export interface MandateCheck {
  used: number;
  allowed: number;
  over: boolean;
  under: boolean;
  message: string;
}

/** Attended + makeup count toward the delivery week. Missed does not consume. */
export function checkMandate(
  mandate: Mandate | undefined,
  weekSessions: SessionRow[],
): MandateCheck {
  const allowed = mandate ? Number(mandate.frequencyPerWeek) : 0;
  const used = weekSessions.filter(
    (s) => s.attendance === 'attended' || s.attendance === 'makeup',
  ).length;
  if (!mandate || allowed <= 0) {
    return {
      used,
      allowed: 0,
      over: false,
      under: false,
      message: 'No mandate on file for this student.',
    };
  }
  const over = used > allowed;
  const under = used < allowed;
  let message = '';
  if (over) {
    message = `Over mandate: ${used} of ${allowed} allowed this week. Upload is blocked.`;
  } else if (under) {
    message = `Under mandate: ${used} of ${allowed} this week.`;
  }
  return { used, allowed, over, under, message };
}

export function checkMandatesForWeek(
  mandates: Mandate[],
  sessions: SessionRow[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byStudent = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const list = byStudent.get(s.studentId) ?? [];
    list.push(s);
    byStudent.set(s.studentId, list);
  }
  for (const [studentId, rows] of byStudent) {
    const mandate = mandates.find((m) => m.studentId === studentId);
    const result = checkMandate(mandate, rows);
    if (result.over) errors.push(result.message);
    else if (result.under) warnings.push(result.message);
    else if (!mandate) warnings.push(result.message);
  }
  return { errors, warnings };
}
