import {
  alertBodyForDue,
  nagKey,
  newId,
  nowIso,
  shouldNagDue,
  type MemoryStore,
} from '@white-glove/tms-db';
import type { Mailer } from './mail.js';

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
    const student = store.data.students.find((s) => s.id === due.studentId);
    const label = student ? `${student.firstName} ${student.lastName}` : due.studentId;
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
    const mandate = store.mandateForStudent(due.studentId);
    const provider = mandate?.providerId
      ? store.data.providers.find((p) => p.id === mandate.providerId)
      : undefined;
    const user = provider ? store.userById(provider.userId) : undefined;
    const admins = store.data.users.filter((u) => u.role === 'admin').map((u) => u.email);
    const to = [...new Set([user?.email, ...admins].filter(Boolean) as string[])];
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
