import { createHash } from 'node:crypto';
import type { HhaClient } from '@white-glove/hha-client';
import { buildPayCodeName } from '@white-glove/shared';
import {
  newId,
  type MemoryStore,
  type SessionRow,
  type WeeklyPeriod,
} from '@white-glove/tms-db';

export async function transferLockedWeek(options: {
  store: MemoryStore;
  week: WeeklyPeriod;
  hha: HhaClient;
  actorId: string;
}): Promise<{ ok: boolean; transferred: number; errors: string[] }> {
  const { store, week, hha } = options;
  if (week.status !== 'locked' && week.status !== 'signed') {
    return { ok: false, transferred: 0, errors: ['Week must be signed or locked before HHA.'] };
  }
  const provider = store.data.providers.find((p) => p.id === week.providerId);
  const sessions = store
    .sessionsForWeek(week.id)
    .filter((s) => s.attendance === 'attended' || s.attendance === 'makeup');
  const errors: string[] = [];
  let transferred = 0;
  for (const session of sessions) {
    const existing = store.transferForSession(session.id);
    if (existing?.status === 'confirmed') continue;
    const student = store.data.students.find((s) => s.id === session.studentId);
    try {
      let patientId =
        student?.hhaPatientId ||
        (await hha.findPatient({
          firstName: student?.firstName,
          lastName: student?.lastName,
          dateOfBirth: student?.dob,
        }));
      if (!patientId && student) {
        const created = await hha.upsertPatient({
          firstName: student.firstName,
          lastName: student.lastName,
          dateOfBirth: student.dob || undefined,
        });
        patientId = created.id;
      }
      if (!patientId) {
        throw new Error(`No HHA patient for ${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim());
      }
      if (student && student.hhaPatientId !== patientId) {
        store.upsertStudent({ ...student, hhaPatientId: patientId });
      }
      const pay =
        provider?.payRate != null
          ? buildPayCodeName(session.serviceType || provider.discipline, provider.payRate)
          : undefined;
      const payCodeId = pay ? await hha.resolvePayCodeId(pay.payCodeName) : undefined;
      const caregiverId = provider
        ? await hha.resolveCaregiverId(`${provider.lastName}, ${provider.firstName}`)
        : undefined;
      const result = await hha.locateOrScheduleVisit({
        patientId,
        visitExternalId: session.id,
        visitDate: session.dateOfService,
        startTime: session.beginTime,
        endTime: session.endTime,
        serviceCode: session.serviceType,
        caregiverId,
        payCodeId,
        programType: student?.programType,
        providerName: provider ? `${provider.firstName} ${provider.lastName}` : undefined,
        payRate: provider?.payRate != null ? String(provider.payRate) : undefined,
      });
      await hha.approveVisit(result.id);
      store.upsertTransfer({
        id: existing?.id || newId(),
        sessionId: session.id,
        weekId: week.id,
        status: 'confirmed',
        hhaVisitId: result.id,
        lastError: '',
        payloadHash: hashSession(session),
      });
      transferred += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      store.upsertTransfer({
        id: existing?.id || newId(),
        sessionId: session.id,
        weekId: week.id,
        status: 'failed',
        hhaVisitId: '',
        lastError: message,
        payloadHash: hashSession(session),
      });
    }
  }
  store.upsertWeek({
    ...week,
    hhaStatus: errors.length ? 'failed' : transferred ? 'confirmed' : week.hhaStatus,
  });
  store.audit(options.actorId, 'hha_transfer', `week:${week.id}`, null, {
    transferred,
    errors,
  });
  return { ok: errors.length === 0, transferred, errors };
}

function hashSession(session: SessionRow): string {
  return createHash('sha256')
    .update(
      [session.id, session.dateOfService, session.beginTime, session.endTime, session.studentId].join('|'),
    )
    .digest('hex')
    .slice(0, 16);
}
