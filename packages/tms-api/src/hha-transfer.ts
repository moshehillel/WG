import { createHash } from 'node:crypto';
import { isTrustedHhaPatientId, type HhaClient } from '@white-glove/hha-client';
import {
  buildPayCodeName,
  buildSchoolBillingServiceName,
  extractDisciplineFromServiceType,
} from '@white-glove/shared';
import {
  newId,
  nowIso,
  presentGroupPeerCount,
  providerDaySessions,
  sessionBillingKind,
  sessionDurationMinutes,
  sessionPayCodeRate,
  sessionUsesGroupPayRate,
  type MemoryStore,
  type SessionRow,
  type WeeklyPeriod,
} from '@white-glove/tms-db';

/**
 * Resolve HHA PatientID for a TMS student.
 * Order: trusted hhaPatientId → Program Id / Case Id (+ name/DOB fallback inside find) → CreatePatient last.
 */
export async function resolveHhaPatientId(options: {
  hha: HhaClient;
  student:
    | {
        firstName: string;
        lastName: string;
        dob?: string;
        programId?: string;
        hhaPatientId?: string;
      }
    | undefined;
}): Promise<string | undefined> {
  const { hha, student } = options;
  if (!student) return undefined;

  const programId = student.programId?.trim() || undefined;
  if (isTrustedHhaPatientId(student.hhaPatientId, programId)) {
    return student.hhaPatientId!.trim();
  }

  const found = await hha.findPatient({
    caseId: programId,
    externalId: programId,
    firstName: student.firstName,
    lastName: student.lastName,
    dateOfBirth: student.dob || undefined,
  });
  if (found) return found;

  // Create only as last resort — needs demographics; most kids already exist in HHA.
  const created = await hha.upsertPatient({
    firstName: student.firstName,
    lastName: student.lastName,
    dateOfBirth: student.dob || undefined,
    caseId: programId,
    externalId: programId,
  });
  return created.id;
}

/** Discipline for pay/billing: session Service Type token, else provider discipline. */
export function sessionDiscipline(
  session: Pick<SessionRow, 'serviceType'>,
  providerDiscipline: string | undefined,
): string | undefined {
  const fromSession = extractDisciplineFromServiceType(session.serviceType);
  // Additional labels like "Eval" / "Paid absence" are not disciplines — fall back.
  const sessionOk =
    fromSession &&
    ['OT', 'PT', 'SLP', 'ST', 'SI', 'COTA', 'PTA'].includes(fromSession)
      ? fromSession
      : undefined;
  return (
    sessionOk ||
    extractDisciplineFromServiceType(providerDiscipline) ||
    providerDiscipline?.trim().toUpperCase() ||
    undefined
  );
}

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
      const patientId = await resolveHhaPatientId({ hha, student });
      if (!patientId) {
        throw new Error(`No HHA patient for ${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim());
      }
      if (student && student.hhaPatientId !== patientId) {
        store.upsertStudent({ ...student, hhaPatientId: patientId });
      }

      if (!provider) {
        throw new Error('No provider on week for HHA pay/service codes');
      }

      const discipline = sessionDiscipline(session, provider.discipline);
      const durationMinutes = sessionDurationMinutes(session.beginTime, session.endTime);
      const billingKind = sessionBillingKind(session);
      const billingServiceName = buildSchoolBillingServiceName({
        discipline,
        kind: billingKind,
        durationMinutes,
      });
      if (!billingServiceName) {
        throw new Error(
          `Cannot build HHA billing service name (discipline=${discipline ?? '(missing)'}, kind=${billingKind}, duration=${durationMinutes ?? '(missing)'})`,
        );
      }

      const contractNum = await hha.resolveContractId(student?.programType);
      if (!contractNum) {
        throw new Error(
          `No HHA ContractID for program type "${student?.programType?.trim() || '(missing)'}" — needed to look up billing code "${billingServiceName}"`,
        );
      }

      const serviceCodeId = await hha.resolveServiceCodeId(
        billingServiceName,
        contractNum,
        student?.programType,
      );
      if (!serviceCodeId) {
        throw new Error(
          `Service code "${billingServiceName}" not found in HHA billing codes for this contract — create it under the contract (case-insensitive name match)`,
        );
      }

      const ratePeers = providerDaySessions(
        store.data.sessions,
        store.data.weeks,
        week.providerId,
        session.dateOfService,
        session.id,
      );
      const payOpts = {
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: session,
          peers: ratePeers,
          mandates: store.data.mandates,
        }),
      };
      const rate = sessionPayCodeRate(provider, session, payOpts);
      const pay = buildPayCodeName(discipline, rate, {
        group: sessionUsesGroupPayRate(session, payOpts),
      });
      if (!pay) {
        throw new Error(
          `No HHA pay code rate for session (discipline=${discipline ?? '(missing)'}, attendance=${session.attendance}) — set provider duration/group/eval/additional rates`,
        );
      }
      const payCodeId = await hha.resolvePayCodeId(pay.payCodeName);
      if (!payCodeId) {
        throw new Error(
          `Pay code "${pay.payCodeName}" not found in HHA GetPayRateCodes — create pay code with that exact name`,
        );
      }

      const caregiverId = await hha.resolveCaregiverId(
        `${provider.lastName}, ${provider.firstName}`,
      );
      if (!caregiverId) {
        throw new Error(
          `Caregiver not found in HHA for provider "${provider.firstName} ${provider.lastName}"`,
        );
      }

      const result = await hha.locateOrScheduleVisit({
        patientId,
        visitExternalId: session.id,
        visitDate: session.dateOfService,
        startTime: session.beginTime,
        endTime: session.endTime,
        serviceCode: billingServiceName,
        serviceCodeId,
        contractId: String(contractNum),
        caregiverId,
        payCodeId,
        programType: student?.programType,
        providerName: `${provider.firstName} ${provider.lastName}`,
        payRate: String(rate),
        durationMinutes: durationMinutes ?? undefined,
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
        updatedAt: nowIso(),
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
        updatedAt: nowIso(),
      });
    }
  }
  store.upsertWeek({
    ...week,
    hhaStatus: errors.length ? 'failed' : transferred ? 'confirmed' : week.hhaStatus,
    hhaError: errors.length ? errors.join('\n') : '',
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

