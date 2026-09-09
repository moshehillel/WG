import { createHash } from 'node:crypto';
import {
  isInvalidHhaPatientError,
  isTrustedHhaPatientId,
  type HhaClient,
} from '@white-glove/hha-client';
import {
  buildPayCodeName,
  buildSchoolBillingServiceName,
  extractDisciplineFromServiceType,
  isIndividualSchoolBillingServiceName,
} from '@white-glove/shared';
import {
  mandateDurationMinutesForSession,
  newId,
  nowIso,
  preferredMandateForSession,
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

/** School address fields mapped onto HHA CreatePatient demographics. */
export type SchoolAddressForPatient = {
  address1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
};

type StudentForHha = {
  firstName: string;
  lastName: string;
  dob?: string;
  programId?: string;
  hhaPatientId?: string;
};

/**
 * Resolve HHA PatientID for a TMS student.
 * Order: trusted hhaPatientId → findPatient (MR/Program Id, admission, name+DOB)
 * → CreatePatient only if no match. Never create when a search hit exists.
 * CreatePatient address = school address (when provided). DOB = student.dob from caseload
 * (“Student BirthDate”) or admin edit — no fake DOB.
 */
export async function resolveHhaPatientId(options: {
  hha: HhaClient;
  student: StudentForHha | undefined;
  /** Prefer the child’s school address for CreatePatient. */
  schoolAddress?: SchoolAddressForPatient;
  /**
   * Skip stored hhaPatientId and re-run find → create-if-missing.
   * Used after ErrorID=-56 (invalid PatientID for agency).
   */
  forceResearch?: boolean;
}): Promise<string | undefined> {
  const { hha, student, schoolAddress, forceResearch } = options;
  if (!student) return undefined;

  const programId = student.programId?.trim() || undefined;
  if (!forceResearch && isTrustedHhaPatientId(student.hhaPatientId, programId)) {
    return student.hhaPatientId!.trim();
  }

  // Always search before create (MR / admission / name+DOB inside findPatient).
  const found = await hha.findPatient({
    caseId: programId,
    externalId: programId,
    firstName: student.firstName,
    lastName: student.lastName,
    dateOfBirth: student.dob || undefined,
  });
  if (found) return found;

  // Create only when no HHA child matches — upsertPatient also re-checks before CreatePatient.
  const created = await hha.upsertPatient({
    firstName: student.firstName,
    lastName: student.lastName,
    dateOfBirth: student.dob || undefined,
    caseId: programId,
    externalId: programId,
    address1: schoolAddress?.address1?.trim() || undefined,
    city: schoolAddress?.city?.trim() || undefined,
    state: schoolAddress?.state?.trim() || undefined,
    zipCode: schoolAddress?.zipCode?.trim() || undefined,
  });
  return created.id;
}

function schoolAddressForStudent(
  store: MemoryStore,
  student: { schoolId?: string } | undefined,
): SchoolAddressForPatient | undefined {
  if (!student?.schoolId) return undefined;
  const school = store.data.schools.find((s) => s.id === student.schoolId);
  if (!school) return undefined;
  return {
    address1: school.address1,
    city: school.city,
    state: school.state,
    zipCode: school.zipCode,
  };
}

function persistStudentHhaPatientId(
  store: MemoryStore,
  studentId: string | undefined,
  patientId: string,
): void {
  if (!studentId) return;
  const student = store.data.students.find((s) => s.id === studentId);
  if (!student || student.hhaPatientId === patientId) return;
  store.upsertStudent({ ...student, hhaPatientId: patientId });
}

/**
 * CreateSchedule / visit resolve. On ErrorID=-56 (bad stored PatientID):
 * clear → search HHA → CreatePatient only if missing → save new ID → retry once.
 */
async function locateOrScheduleVisitWithPatientRecovery(options: {
  store: MemoryStore;
  hha: HhaClient;
  student: { id: string } | undefined;
  patientId: string;
  visit: Parameters<HhaClient['locateOrScheduleVisit']>[0];
}): Promise<{ result: Awaited<ReturnType<HhaClient['locateOrScheduleVisit']>>; patientId: string }> {
  const { store, hha } = options;
  let patientId = options.patientId;
  try {
    const result = await hha.locateOrScheduleVisit({ ...options.visit, patientId });
    return { result, patientId };
  } catch (err) {
    if (!options.student || !isInvalidHhaPatientError(err)) throw err;

    const live = store.data.students.find((s) => s.id === options.student!.id);
    if (!live) throw err;

    // 1) Drop the bad stored ID so we do not reuse it.
    store.upsertStudent({ ...live, hhaPatientId: '' });
    live.hhaPatientId = '';

    // 2) Search first; 3) CreatePatient only if not found; then persist.
    const recovered = await resolveHhaPatientId({
      hha,
      student: { ...live, hhaPatientId: '' },
      schoolAddress: schoolAddressForStudent(store, live),
      forceResearch: true,
    });
    if (!recovered) {
      throw new Error(
        `HHA PatientID ${patientId} invalid for agency (ErrorID=-56); search/create found no patient for ${live.firstName} ${live.lastName}`.trim(),
      );
    }
    persistStudentHhaPatientId(store, live.id, recovered);
    patientId = recovered;

    // 4) Retry CreateSchedule once with the recovered ID.
    const result = await hha.locateOrScheduleVisit({ ...options.visit, patientId });
    return { result, patientId };
  }
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
      let patientId = await resolveHhaPatientId({
        hha,
        student,
        schoolAddress: schoolAddressForStudent(store, student),
      });
      if (!patientId) {
        throw new Error(`No HHA patient for ${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim());
      }
      persistStudentHhaPatientId(store, student?.id, patientId);
      if (student) student.hhaPatientId = patientId;

      if (!provider) {
        throw new Error('No provider on week for HHA pay/service codes');
      }

      const discipline = sessionDiscipline(session, provider.discipline);
      const clockMinutes = sessionDurationMinutes(session.beginTime, session.endTime);
      const matchedMandate = preferredMandateForSession(session, store.data.mandates);
      const mandateMinutes = mandateDurationMinutesForSession(session, store.data.mandates);
      const billingKind = sessionBillingKind(session);
      // School billing duration bucket from mandate (not Frontline clock rounding).
      const billingDurationMinutes = billingKind === 'school' ? mandateMinutes : clockMinutes;
      // Prefer name stored at caseload import; fall back for legacy mandates.
      // Group mandate billing stays "school group" even for solo-group sessions
      // (pay rate may still be individual when no peers present).
      const isGroupMandate =
        Boolean(matchedMandate?.ratioGroup) ||
        (matchedMandate?.groupSize != null && Number(matchedMandate.groupSize) > 1);
      const storedBillingName =
        billingKind === 'school' ? matchedMandate?.billingServiceName?.trim() : '';
      const storedWrongForGroup =
        billingKind === 'school' &&
        isGroupMandate &&
        isIndividualSchoolBillingServiceName(storedBillingName);
      const billingServiceName =
        (storedBillingName && !storedWrongForGroup ? storedBillingName : '') ||
        buildSchoolBillingServiceName({
          discipline,
          kind: billingKind,
          durationMinutes: billingDurationMinutes,
          group: billingKind === 'school' ? isGroupMandate : false,
        });
      if (!billingServiceName) {
        throw new Error(
          `Cannot build HHA billing service name (discipline=${discipline ?? '(missing)'}, kind=${billingKind}, duration=${billingDurationMinutes ?? '(missing)'})`,
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
        mandateDurationMinutes: mandateMinutes,
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
        { caregiverCode: provider.hhaCaregiverCode || undefined },
      );
      if (!caregiverId) {
        throw new Error(
          `Caregiver not found in HHA for provider "${provider.firstName} ${provider.lastName}"`,
        );
      }
      // Persist HHA CaregiverID so the next transfer prefers code over name match.
      if (provider.hhaCaregiverCode !== caregiverId) {
        store.upsertProvider({ ...provider, hhaCaregiverCode: caregiverId });
        provider.hhaCaregiverCode = caregiverId;
      }

      const scheduled = await locateOrScheduleVisitWithPatientRecovery({
        store,
        hha,
        student,
        patientId,
        visit: {
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
          // Visit clock length stays Frontline begin/end; pay/billing buckets use mandate above.
          durationMinutes: clockMinutes ?? undefined,
        },
      });
      patientId = scheduled.patientId;
      const result = scheduled.result;
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

