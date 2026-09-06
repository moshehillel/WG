import type { MemoryStore } from '@white-glove/tms-db';
import type { Mailer } from './mail.js';

export interface HhaDigestFailure {
  weekId: string;
  weekStart: string;
  providerName: string;
  childName: string;
  sessionDate: string;
  sessionTime: string;
  error: string;
  adminUrl: string;
}

export interface HhaErrorDigestResult {
  day: string;
  failures: number;
  emailed: boolean;
  skippedReason?: string;
  messageId?: string;
}

/** Calendar date YYYY-MM-DD in America/New_York. */
export function easternDateYmd(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function isoDayInEastern(iso: string | undefined): string | undefined {
  if (!iso?.trim()) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return easternDateYmd(new Date(t));
}

function spaBase(): string {
  const raw =
    process.env.TMS_SPA_ORIGIN ||
    process.env.TMS_CORS_ORIGIN ||
    'https://wgfront.netlify.app';
  return raw.replace(/\/$/, '');
}

function digestRecipient(): string {
  return (
    (process.env.TMS_HHA_ERROR_EMAIL || 'mgluck@whiteglovecare.net').trim().toLowerCase() ||
    'mgluck@whiteglovecare.net'
  );
}

/** Week IDs that had a failed HHA transfer attempt on the Eastern calendar day. */
export function weekIdsFailedOnDay(store: MemoryStore, day: string): Set<string> {
  const ids = new Set<string>();
  for (const t of store.data.hhaTransfers || []) {
    if (t.status !== 'failed') continue;
    if (isoDayInEastern(t.updatedAt) === day) ids.add(t.weekId);
  }
  for (const ev of store.data.audit || []) {
    if (ev.action !== 'hha_transfer') continue;
    if (isoDayInEastern(ev.at) !== day) continue;
    let after: { errors?: unknown } | null = null;
    try {
      after = JSON.parse(ev.afterJson || 'null') as { errors?: unknown } | null;
    } catch {
      after = null;
    }
    const errs = Array.isArray(after?.errors) ? after!.errors : [];
    if (!errs.length) continue;
    const m = /^week:(.+)$/.exec(ev.entity || '');
    if (m?.[1]) ids.add(m[1]);
  }
  return ids;
}

export function collectHhaFailuresForDay(
  store: MemoryStore,
  day = easternDateYmd(),
): HhaDigestFailure[] {
  const weekIds = weekIdsFailedOnDay(store, day);
  const base = spaBase();
  const out: HhaDigestFailure[] = [];

  for (const t of store.data.hhaTransfers || []) {
    if (t.status !== 'failed') continue;
    const onDay = isoDayInEastern(t.updatedAt) === day || weekIds.has(t.weekId);
    if (!onDay) continue;

    const week = store.data.weeks.find((w) => w.id === t.weekId);
    const session = store.data.sessions.find((s) => s.id === t.sessionId);
    const provider = week
      ? store.data.providers.find((p) => p.id === week.providerId)
      : undefined;
    const student = session
      ? store.data.students.find((s) => s.id === session.studentId)
      : undefined;
    const providerName = provider
      ? `${provider.firstName} ${provider.lastName}`.trim()
      : 'Unknown provider';
    const childName = student
      ? `${student.firstName} ${student.lastName}`.trim()
      : 'Unknown child';
    const error =
      (t.lastError || '').trim() ||
      (week?.hhaError || '').trim() ||
      'HHA transfer failed (no detail stored)';

    out.push({
      weekId: t.weekId,
      weekStart: week?.weekStart || '—',
      providerName,
      childName,
      sessionDate: session?.dateOfService || '—',
      sessionTime:
        session?.beginTime && session?.endTime
          ? `${session.beginTime}–${session.endTime}`
          : session?.beginTime || '—',
      error,
      adminUrl: `${base}/?hhaWeek=${encodeURIComponent(t.weekId)}`,
    });
  }

  // Weeks marked failed today with no per-session transfer rows yet.
  for (const weekId of weekIds) {
    if (out.some((f) => f.weekId === weekId)) continue;
    const week = store.data.weeks.find((w) => w.id === weekId);
    if (!week || week.hhaStatus !== 'failed') continue;
    const provider = store.data.providers.find((p) => p.id === week.providerId);
    out.push({
      weekId: week.id,
      weekStart: week.weekStart,
      providerName: provider
        ? `${provider.firstName} ${provider.lastName}`.trim()
        : 'Unknown provider',
      childName: '(week-level)',
      sessionDate: '—',
      sessionTime: '—',
      error: (week.hhaError || '').trim() || 'HHA transfer failed (no detail stored)',
      adminUrl: `${base}/?hhaWeek=${encodeURIComponent(week.id)}`,
    });
  }

  out.sort((a, b) => {
    const p = a.providerName.localeCompare(b.providerName);
    if (p) return p;
    const w = a.weekStart.localeCompare(b.weekStart);
    if (w) return w;
    return `${a.sessionDate} ${a.sessionTime}`.localeCompare(`${b.sessionDate} ${b.sessionTime}`);
  });
  return out;
}

export function formatHhaErrorDigestEmail(
  day: string,
  failures: HhaDigestFailure[],
): { subject: string; text: string } {
  const subject = `HHA errors for ${day}`;
  const lines: string[] = [
    `HHA transfer failures recorded on ${day} (America/New_York).`,
    '',
    `${failures.length} session/week failure(s). Fix the data, then open the admin app and click Send to HHA to retry.`,
    '',
  ];
  let n = 0;
  for (const f of failures) {
    n += 1;
    lines.push(`${n}. Provider: ${f.providerName}`);
    lines.push(`   Child: ${f.childName}`);
    lines.push(`   Week of: ${f.weekStart}`);
    lines.push(`   Session: ${f.sessionDate} ${f.sessionTime}`);
    lines.push(`   Error: ${f.error}`);
    lines.push(`   Retry: ${f.adminUrl}`);
    lines.push('');
  }
  lines.push('Admin dashboard: ' + spaBase() + '/');
  lines.push('Look for the warning triangle on failed weeks, then Send to HHA after fixing.');
  return { subject, text: lines.join('\n') };
}

export async function runHhaErrorDigest(
  store: MemoryStore,
  mail: Mailer,
  today = new Date(),
): Promise<HhaErrorDigestResult> {
  const day = easternDateYmd(today);
  const failures = collectHhaFailuresForDay(store, day);
  if (!failures.length) {
    return { day, failures: 0, emailed: false, skippedReason: 'no_failures' };
  }
  const { subject, text } = formatHhaErrorDigestEmail(day, failures);
  const to = digestRecipient();
  const sent = await mail.send({ to: [to], subject, text });
  return {
    day,
    failures: failures.length,
    emailed: true,
    messageId: sent.id,
  };
}
