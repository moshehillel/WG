import {
  alertBodyForDue,
  nagKey,
  newId,
  nowIso,
  shouldNagDue,
  type MemoryStore,
} from '@white-glove/tms-db';
import type { Mailer } from './mail.js';

/** Addresses that must never get due-date alert emails (they bounce). Also any `.local` address. */
export const DUE_NAG_EXCLUDED_EMAILS: readonly string[] = ['testy@whiteglovecare.net'];

/** True when a due-date alert may be emailed to this address. */
export function isDueNagRecipient(email: string | undefined | null): boolean {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return false;
  if (e.endsWith('.local')) return false;
  if (DUE_NAG_EXCLUDED_EMAILS.includes(e)) return false;
  return true;
}

export async function runDueNags(
  store: MemoryStore,
  mail: Mailer,
  today = new Date(),
): Promise<{ nagged: number; emails: number }> {
  let nagged = 0;
  let emails = 0;
  const day = today.toISOString().slice(0, 10);
  for (const due of store.data.dueDates) {
    if (!shouldNagDue(due, today)) continue;
    if (due.lastNagOn === day) continue;
    const school = store.data.schools.find((s) => s.id === due.schoolId);
    const label = school?.name || due.schoolId;
    const body = alertBodyForDue(due, label);
    store.addAlert({
      id: newId(),
      userId: '',
      kind: `due_${due.kind}`,
      severity: dueDateOverdue(due, today) ? 'error' : 'warning',
      body,
      entityRef: nagKey(due.id, today),
      resolved: false,
      createdAt: nowIso(),
    });
    store.upsertDueDate({ ...due, lastNagOn: day });
    nagged += 1;
    const providerEmails = store
      .providerIdsForSchool(due.schoolId)
      .map((pid) => {
        const provider = store.data.providers.find((p) => p.id === pid);
        return provider ? store.userById(provider.userId)?.email : undefined;
      })
      .filter(Boolean) as string[];
    const admins = store.data.users.filter((u) => u.role === 'admin').map((u) => u.email);
    const to = [
      ...new Map(
        [...providerEmails, ...admins]
          .filter(isDueNagRecipient)
          .map((e) => [e.trim().toLowerCase(), e.trim()] as const),
      ).values(),
    ];
    if (to.length) {
      await mail.send({
        to,
        subject: `Due date: ${body}`,
        text: `${body}\nThis alert continues until the report is marked complete in the admin app.`,
      });
      emails += 1;
    }
  }
  return { nagged, emails };
}

function dueDateOverdue(due: { dueOn: string; completedAt: string }, today: Date): boolean {
  if (due.completedAt) return false;
  return new Date(`${due.dueOn}T00:00:00Z`).getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}
