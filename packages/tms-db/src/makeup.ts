import { parseDos } from './ids.js';
import { isMakeupAuthMandate } from './mandate.js';
import type { Mandate, SessionRow } from './types.js';

export function unusedMissedForStudent(
  allSessions: SessionRow[],
  studentId: string,
): SessionRow[] {
  const used = new Set(
    allSessions.filter((s) => s.makeupOfSessionId).map((s) => s.makeupOfSessionId),
  );
  return allSessions.filter(
    (s) => s.studentId === studentId && s.attendance === 'missed' && !used.has(s.id),
  );
}

const MAKEUP_RE = /\bmakeup\b|\bmake[\s-]?up\b/i;

/** Pull the "makeup for / missed on …" date from Frontline-style notes. */
export function extractMakeupForDate(notes: string): string {
  const n = String(notes || '');
  if (!MAKEUP_RE.test(n)) return '';
  const m = n.match(
    /(?:missed(?:\s+session)?(?:\s+on)?|makeup for|make[\s-]?up for|original(?:\s+date|\s+dos)?|for(?:\s+date)?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  );
  return m?.[1] || '';
}

export function notesContainMakeupWord(notes: string): boolean {
  return MAKEUP_RE.test(String(notes || ''));
}

function dateTokens(dos: string): string[] {
  const raw = String(dos || '').trim();
  const tokens = new Set<string>([raw]);
  const dt = parseDos(raw);
  if (dt) {
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    const mm = String(mo).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    tokens.add(`${mo}/${d}/${y}`);
    tokens.add(`${mm}/${dd}/${y}`);
    tokens.add(`${mo}/${dd}/${y}`);
    tokens.add(`${mm}/${d}/${y}`);
    tokens.add(`${y}-${mm}-${dd}`);
    tokens.add(`${String(y).slice(2)}`);
    tokens.add(`${mo}/${d}/${String(y).slice(2)}`);
    tokens.add(`${mm}/${dd}/${String(y).slice(2)}`);
  }
  return [...tokens].filter(Boolean);
}

/** True when two DOS strings refer to the same calendar day. */
export function dosDatesEqual(a: string, b: string): boolean {
  const da = parseDos(a);
  const db = parseDos(b);
  if (da && db) return da.getTime() === db.getTime();
  const ta = new Set(dateTokens(a));
  return dateTokens(b).some((t) => ta.has(t));
}

export function notesContainMissedDate(notes: string, missedDos: string): boolean {
  const n = String(notes || '');
  if (!missedDos) return false;
  const compact = n.replace(/\s+/g, '');
  return dateTokens(missedDos).some((t) => n.includes(t) || compact.includes(t.replace(/\s+/g, '')));
}

/** Makeup sessions that consume leftover makeup-auth capacity (not linked to a miss). */
export function isMakeupAuthPoolSession(session: SessionRow): boolean {
  return session.attendance === 'makeup' && !session.makeupOfSessionId;
}

export function makeupAuthMandatesForStudent(
  mandates: Mandate[],
  studentId: string,
): Mandate[] {
  return mandates.filter((m) => m.studentId === studentId && isMakeupAuthMandate(m));
}

/** Remaining makeup-auth slots for a student (pool makeups only; miss-linked excluded). */
export function makeupAuthRemaining(
  studentId: string,
  mandates: Mandate[],
  allSessions: SessionRow[],
  opts?: { excludeSessionId?: string },
): { mandate: Mandate | null; allowed: number; used: number; remaining: number } {
  const auth =
    makeupAuthMandatesForStudent(mandates, studentId).sort(
      (a, b) =>
        (Number(b.sessionsPerPeriod ?? b.frequencyPerWeek) || 0) -
        (Number(a.sessionsPerPeriod ?? a.frequencyPerWeek) || 0),
    )[0] || null;
  if (!auth) {
    return { mandate: null, allowed: 0, used: 0, remaining: 0 };
  }
  const allowed = Number(auth.sessionsPerPeriod ?? auth.frequencyPerWeek) || 0;
  const used = allSessions.filter(
    (s) =>
      s.studentId === studentId &&
      isMakeupAuthPoolSession(s) &&
      s.id !== opts?.excludeSessionId,
  ).length;
  return {
    mandate: auth,
    allowed,
    used,
    remaining: Math.max(0, allowed - used),
  };
}

function findUnusedMissOnDate(
  allSessions: SessionRow[],
  studentId: string,
  forDate: string,
  excludeSessionId?: string,
): SessionRow | undefined {
  return unusedMissedForStudent(allSessions, studentId)
    .filter((m) => m.id !== excludeSessionId && dosDatesEqual(m.dateOfService, forDate))
    .sort(
      (a, b) =>
        a.dateOfService.localeCompare(b.dateOfService) || a.id.localeCompare(b.id),
    )[0];
}

/**
 * Product rule:
 * 1) Link to unused miss on the makeup-for date (same child) when possible.
 * 2) Else use leftover makeup-auth capacity.
 * 3) Else error.
 */
export function resolveMakeupOfSessionId(
  session: Pick<SessionRow, 'id' | 'attendance' | 'studentId' | 'notes' | 'makeupOfSessionId'>,
  allSessions: SessionRow[],
  mandates: Mandate[] = [],
): { makeupOfSessionId: string; via: 'miss' | 'makeup_auth' | 'none' } | { error: string } {
  if (session.attendance !== 'makeup') {
    return { makeupOfSessionId: '', via: 'none' };
  }

  // Explicit manual link wins when valid.
  if (session.makeupOfSessionId) {
    const missed = allSessions.find((s) => s.id === session.makeupOfSessionId);
    if (!missed || missed.attendance !== 'missed') {
      return { error: 'Makeup must point at a missed session that exists.' };
    }
    if (missed.studentId !== session.studentId) {
      return { error: 'Makeup must be for the same student as the missed session.' };
    }
    const taken = allSessions.find(
      (s) =>
        s.id !== session.id && s.makeupOfSessionId === session.makeupOfSessionId,
    );
    if (taken) return { error: 'That missed session already has a makeup.' };
    return { makeupOfSessionId: session.makeupOfSessionId, via: 'miss' };
  }

  const forDate = extractMakeupForDate(session.notes);
  if (forDate) {
    const miss = findUnusedMissOnDate(
      allSessions,
      session.studentId,
      forDate,
      session.id,
    );
    if (miss) return { makeupOfSessionId: miss.id, via: 'miss' };
  }

  const auth = makeupAuthRemaining(session.studentId, mandates, allSessions, {
    excludeSessionId: session.id,
  });
  if (auth.mandate && auth.allowed > 0 && auth.remaining > 0) {
    return { makeupOfSessionId: '', via: 'makeup_auth' };
  }

  if (forDate) {
    if (auth.mandate && auth.allowed > 0) {
      return {
        error: `No unused missed session on ${forDate}, and makeup authorization is full (${auth.used} of ${auth.allowed}).`,
      };
    }
    return {
      error: `No unused missed session on ${forDate} and no makeup authorization for this student — cannot record makeup.`,
    };
  }

  if (auth.mandate && auth.allowed > 0) {
    return {
      error: `Makeup authorization is full (${auth.used} of ${auth.allowed}). Link a missed session or ask the office to add capacity.`,
    };
  }
  return {
    error:
      'Makeup requires a missed session on that date, or a makeup authorization mandate with remaining capacity.',
  };
}

export function validateMakeup(
  row: SessionRow,
  allSessions: SessionRow[],
  mandates: Mandate[] = [],
): string | null {
  if (row.attendance !== 'makeup') return null;
  if (!notesContainMakeupWord(row.notes)) {
    return 'Makeup notes must include the word makeup.';
  }

  if (row.makeupOfSessionId) {
    const missed = allSessions.find((s) => s.id === row.makeupOfSessionId);
    if (!missed || missed.attendance !== 'missed') {
      return 'Makeup must point at a missed session that exists.';
    }
    if (missed.studentId !== row.studentId) {
      return 'Makeup must be for the same student as the missed session.';
    }
    const taken = allSessions.find(
      (s) => s.id !== row.id && s.makeupOfSessionId === row.makeupOfSessionId,
    );
    if (taken) return 'That missed session already has a makeup.';
    if (!notesContainMissedDate(row.notes, missed.dateOfService)) {
      return `Makeup notes must include the date of the missed session (${missed.dateOfService}).`;
    }
    return null;
  }

  // Unlinked makeup → must fit leftover makeup-auth pool (room for this row).
  const others = makeupAuthRemaining(row.studentId, mandates, allSessions, {
    excludeSessionId: row.id,
  });
  if (!others.mandate || others.allowed <= 0) {
    return 'Makeup is only allowed when tied to a documented missed session, or a makeup authorization mandate.';
  }
  if (others.remaining <= 0) {
    return `Over makeup authorization: ${others.used} of ${others.allowed} leftover makeup session(s).`;
  }
  return null;
}
