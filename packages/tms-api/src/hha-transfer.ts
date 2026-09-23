import { createHash } from 'node:crypto';
import {
  inferCreateScheduleType,
  isAlreadyBilledConfirmFault,
  isInvalidHhaPatientError,
  isInvalidHhaVisitError,
  isTrustedHhaPatientId,
  mapServiceToDiscipline,
  payCodeLookupCandidates,
  psDateToIso,
  type HhaClient,
} from '@white-glove/hha-client';
import {
  buildPayCodeName,
  buildSchoolBillingServiceName,
  extractDisciplineFromServiceType,
  isGroupSchoolBillingServiceName,
  isIndividualSchoolBillingServiceName,
} from '@white-glove/shared';
import {
  labelHhaTransferError,
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
  soloGroupMandateNoteError,
  sessionServiceTypeRequiredError,
  isAdditionalServiceType,
  weekHhaErrorFromTransfers,
  weekHhaRollup,
  type Mandate,
  type MemoryStore,
  type SessionRow,
  type WeeklyPeriod,
} from '@white-glove/tms-db';
import { acquireHhaWeekLock } from './hha-week-lock.js';

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
  /** Mandate / billing service or discipline — sets CreatePatient AcceptedServices. */
  serviceCode?: string;
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
    serviceCode: student.serviceCode?.trim() || undefined,
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
 * Attach the school program-type contract as a patient placement before CreateSchedule.
 * CreatePatient does not set Primary ContractID; without AddPatientContract, HHA returns
 * ErrorID=-74 Invalid "Primary ContractID". Contract comes from student.programType
 * (caseload mandate program), never a stale/default placement on another contract.
 */
export async function ensurePatientProgramContract(options: {
  hha: HhaClient;
  patientId: string;
  programType: string | undefined;
  /** Mandate start when known; else visit / session date (AddPatientContract StartDate). */
  startDate?: string;
  /** Session DOS — used for GetPatientContracts cover-date reuse (avoids -74 miss). */
  visitDate?: string;
  /** School billing ServiceCodeID (e.g. PT School 30) — set on placement when HHA allows. */
  serviceCodeId?: string;
  serviceCode?: string;
}): Promise<number> {
  const { hha, patientId, programType } = options;
  const contractNum = await hha.resolveContractId(programType);
  if (!contractNum) {
    throw new Error(
      `No HHA ContractID for program type "${programType?.trim() || '(missing)'}" — needed for patient primary contract / CreateSchedule`,
    );
  }
  await hha.upsertContract({
    patientId,
    contractExternalId: String(contractNum),
    startDate: options.startDate?.trim() || undefined,
    visitDate: options.visitDate?.trim() || options.startDate?.trim() || undefined,
    serviceCodeId: options.serviceCodeId,
    serviceCode: options.serviceCode,
  });
  return contractNum;
}

/** Stable HHA AuthorizationNumber for TMS pushes (idempotent CreatePatientAuthorization). */
export function tmsAuthorizationNumber(options: {
  programId?: string;
  patientId: string;
  serviceCodeId: string;
  /** Include DOS so each school day gets its own Entire-Period auth (matches WG office). */
  visitDate?: string;
}): string {
  const scope = (options.programId?.trim() || options.patientId).replace(/[^\w-]+/g, '');
  const sc = String(options.serviceCodeId).replace(/[^\w-]+/g, '');
  const day = (options.visitDate || '').trim().slice(0, 10).replace(/[^\d-]/g, '');
  const base = day ? `TMS2-${scope}-${sc}-${day}` : `TMS2-${scope}-${sc}`;
  return base.slice(0, 50);
}

/**
 * School/office HHA auths are same-day Entire Period.
 * Peer auths use EntirePeriodMaxAuthorization=15 for PT School 30 — pass that as MaxHoursPeriod.
 */
export function mandateToAuthPeriodMaximum(
  mandate: Mandate | undefined,
  options?: { visitDurationMinutes?: number | null },
): {
  period: string;
  maximum: number;
} {
  const duration = Math.max(1, Number(options?.visitDurationMinutes) || Number(mandate?.durationMinutes) || 30);
  // Match working WG school auths (EntirePeriodMaxAuthorization ≈ 15 for 30-min school).
  // Value is sent as MaxHoursPeriod (hours/units per HHA WSDL), not minutes.
  const maximum = duration <= 30 ? 15 : Math.max(15, Math.round((duration / 60) * 100) / 100);
  return { period: 'Entire Period', maximum };
}

function authDateIso(raw: string | undefined, fallback: string): string {
  const primary = psDateToIso(raw);
  if (primary && /^\d{4}-\d{2}-\d{2}$/.test(primary)) return primary;
  const fb = psDateToIso(fallback);
  if (fb && /^\d{4}-\d{2}-\d{2}$/.test(fb)) return fb;
  return (fallback || '').trim().slice(0, 10);
}

/**
 * Ensure patient has usable HHA authorization for this visit’s billing service
 * before CreateSchedule (same CreatePatientAuthorization path as opened/new_services).
 * Prefers existing auth by AuthorizationNumber; otherwise creates from mandate Period/Maximum.
 * HHA auto-allocates patient-level auth units onto visits — no visit-level AuthID on CreateSchedule.
 */
export async function ensurePatientAuthorizationForVisit(options: {
  hha: HhaClient;
  patientId: string;
  contractId: string;
  serviceCodeId: string;
  serviceCode: string;
  programType?: string;
  programId?: string;
  mandate?: Mandate;
  /** Visit / session DOS — used when mandate dates are blank. */
  visitDate: string;
  /** Frontline / mandate duration minutes — Entire Period Maximum. */
  visitDurationMinutes?: number | null;
}): Promise<{ id: string; created: boolean; authorizationNumber: string }> {
  const { hha, patientId, contractId, serviceCodeId, serviceCode } = options;
  const { period, maximum } = mandateToAuthPeriodMaximum(options.mandate, {
    visitDurationMinutes: options.visitDurationMinutes ?? options.mandate?.durationMinutes,
  });
  const visitDay = authDateIso(options.visitDate, options.visitDate);
  const authorizationNumber = tmsAuthorizationNumber({
    programId: options.programId,
    patientId,
    serviceCodeId,
    visitDate: visitDay,
  });
  // Same-day Entire Period (office pattern) so units apply to this DOS.
  const startDate = visitDay;
  const endDate = visitDay;
  const result = await hha.upsertAuthorization({
    patientId,
    authorizationNumber,
    serviceCode,
    serviceCodeId,
    programType: options.programType,
    contractId,
    startDate,
    endDate,
    period,
    maximum,
  });
  return { ...result, authorizationNumber };
}

/**
 * CreateSchedule / visit resolve. On ErrorID=-56 (bad stored PatientID):
 * clear → search HHA → CreatePatient only if missing → save new ID →
 * re-attach program-type contract → retry CreateSchedule once.
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
      student: {
        ...live,
        hhaPatientId: '',
        serviceCode: options.visit.serviceCode || live.programType,
      },
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

    // New/recovered patients have no placement — attach program-type contract before retry.
    await ensurePatientProgramContract({
      hha,
      patientId,
      programType: options.visit.programType ?? live.programType,
      startDate: options.visit.visitDate,
      visitDate: options.visit.visitDate,
    });


    // Auth was created against the invalid PatientID; recreate on the recovered patient.
    if (options.visit.contractId && options.visit.serviceCodeId && options.visit.serviceCode) {
      await ensurePatientAuthorizationForVisit({
        hha,
        patientId,
        contractId: options.visit.contractId,
        serviceCodeId: options.visit.serviceCodeId,
        serviceCode: options.visit.serviceCode,
        programType: options.visit.programType ?? live.programType,
        programId: live.programId,
        visitDate: options.visit.visitDate || '',
      });
    }

    // 4) Retry CreateSchedule once with the recovered ID.
    const result = await hha.locateOrScheduleVisit({ ...options.visit, patientId });
    return { result, patientId };
  }
}

/**
 * Discipline for pay/billing from the session Service Type token.
 * Provider discipline is used only when the session has a non-blank service type
 * that is not itself a discipline (Eval, Paid absence). A blank service type
 * must never become the provider's stored discipline (for example PT).
 */
export function sessionDiscipline(
  session: Pick<SessionRow, 'serviceType'>,
  providerDiscipline: string | undefined,
): string | undefined {
  const fromSession = extractDisciplineFromServiceType(session.serviceType);
  const sessionOk =
    fromSession &&
    ['OT', 'PT', 'SLP', 'ST', 'SI', 'COTA', 'PTA'].includes(fromSession)
      ? fromSession
      : undefined;
  if (sessionOk) return sessionOk;
  if (!String(session.serviceType || '').trim()) return undefined;
  // Additional labels like "Eval" / "Paid absence" are not disciplines — fall back.
  return (
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
  const lock = await acquireHhaWeekLock(week.id);
  if (!lock.ok) {
    return { ok: false, transferred: 0, errors: [lock.error] };
  }
  try {
  const provider = store.data.providers.find((p) => p.id === week.providerId);
  const sessions = store
    .sessionsForWeek(week.id)
    .filter((s) => s.attendance === 'attended' || s.attendance === 'makeup');
  const errors: string[] = [];
  let transferred = 0;
  for (const session of sessions) {
    const existing = store.transferForSession(session.id);
    const priorVisitId = existing?.hhaVisitId?.trim() || '';
    const priorVisitIdOk = /^\d+$/.test(priorVisitId);
    const alreadyBilledErr = isAlreadyBilledConfirmFault(undefined, existing?.lastError);
    // Moshe rule: never resync sessions that already entered HHA successfully.
    // Hard-skip confirmed/ok, Already Billed (-401), and transfers with VisitID that
    // already succeeded (do not re-CreateSchedule / re-ConfirmVisits).
    if (existing?.status === 'confirmed' || existing?.status === 'sent') {
      if (existing.status === 'confirmed' || priorVisitIdOk) {
        transferred += 1;
        continue;
      }
    }
    if (priorVisitIdOk && alreadyBilledErr) {
      store.upsertTransfer({
        ...existing!,
        status: 'confirmed',
        lastError: '',
        updatedAt: nowIso(),
      });
      transferred += 1;
      continue;
    }
    if (existing?.status === 'failed' && priorVisitIdOk && alreadyBilledErr) {
      store.upsertTransfer({
        ...existing,
        status: 'confirmed',
        lastError: '',
        updatedAt: nowIso(),
      });
      transferred += 1;
      continue;
    }
    const student = store.data.students.find((s) => s.id === session.studentId);
    let scheduledVisitId = priorVisitId;
    try {
      if (!provider) {
        throw new Error('No provider on week for HHA pay/service codes');
      }

      const serviceTypeErr = sessionServiceTypeRequiredError(session.serviceType);
      if (serviceTypeErr) {
        throw new Error(serviceTypeErr);
      }

      const discipline = sessionDiscipline(session, provider.discipline);
      const clockMinutes = sessionDurationMinutes(session.beginTime, session.endTime);
      const matchedMandate = preferredMandateForSession(session, store.data.mandates);
      const mandateMinutes = mandateDurationMinutesForSession(session, store.data.mandates);
      const billingKind = sessionBillingKind(session);
      // School billing duration bucket from mandate (not Frontline clock rounding).
      // Fall back to session clock when mandate is unmatched / missing RS Duration —
      // otherwise buildSchoolBillingServiceName fails with duration=(missing).
      const billingDurationMinutes =
        billingKind === 'school' ? (mandateMinutes ?? clockMinutes) : clockMinutes;
      // Peers first: Moshe rule — never bill group while paying individual.
      // Solo / no-peer → individual service code AND individual pay.
      // True multi-peer groups → group billing + group/AM pay.
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
      // Locker #38: hard-fail with the note error — never fall through to a confusing pay-rate miss.
      if (!isAdditionalServiceType(session.additionalServiceType || '')) {
        const soloNoteErr = soloGroupMandateNoteError({
          notes: session.notes || '',
          serviceType: session.serviceType || '',
          studentId: session.studentId,
          attendance: session.attendance,
          mandates: store.data.mandates,
          presentGroupPeerCount: payOpts.presentGroupPeerCount,
        });
        if (soloNoteErr) {
          throw new Error(soloNoteErr);
        }
      }
      const useGroupPay = sessionUsesGroupPayRate(session, payOpts);
      const isGroupMandate =
        Boolean(matchedMandate?.ratioGroup) ||
        (matchedMandate?.groupSize != null && Number(matchedMandate.groupSize) > 1);
      // Group billing only when this visit also uses group pay (peers present).
      const useGroupBilling = billingKind === 'school' && isGroupMandate && useGroupPay;
      const storedBillingName =
        billingKind === 'school' ? matchedMandate?.billingServiceName?.trim() : '';
      // Multi-peer: rewrite legacy individual stamp → group.
      // Solo: rewrite group stamp → individual (never group-bill + individual-pay).
      const storedOkForVisit =
        Boolean(storedBillingName) &&
        (useGroupBilling
          ? !isIndividualSchoolBillingServiceName(storedBillingName)
          : !isGroupSchoolBillingServiceName(storedBillingName));
      const billingServiceName =
        (storedOkForVisit ? storedBillingName : '') ||
        buildSchoolBillingServiceName({
          discipline,
          kind: billingKind,
          durationMinutes: billingDurationMinutes,
          group: useGroupBilling,
        });
      if (!billingServiceName) {
        throw new Error(
          `Cannot build HHA billing service name (discipline=${discipline ?? '(missing)'}, kind=${billingKind}, duration=${billingDurationMinutes ?? '(missing)'})`,
        );
      }

      // CreatePatient AcceptedServices must match therapy discipline (not silent OT default).
      const createServiceHint =
        billingServiceName ||
        matchedMandate?.serviceType ||
        discipline ||
        session.serviceType ||
        undefined;
      let patientId = await resolveHhaPatientId({
        hha,
        student: student
          ? { ...student, serviceCode: createServiceHint }
          : undefined,
        schoolAddress: schoolAddressForStudent(store, student),
      });
      if (!patientId) {
        throw new Error(`No HHA patient for ${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim());
      }
      persistStudentHhaPatientId(store, student?.id, patientId);
      if (student) student.hhaPatientId = patientId;

      // Program-type contract from caseload (student.programType) → AddPatientContract
      // so CreateSchedule PrimaryBillTo is a valid primary placement (avoids -74).
      // Resolve billing ServiceCodeID first so the placement can carry PT/OT school code
      // (peers have ServiceCode on placement; blank placement → OT inconsistency -310).
      const contractNum = await hha.resolveContractId(student?.programType);
      if (!contractNum) {
        throw new Error(
          `No HHA ContractID for program type "${student?.programType?.trim() || '(missing)'}" — needed for patient primary contract / CreateSchedule`,
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
      // Existing HHA patients may be locked to PCA/RN/OT-only AcceptedServices.
      // Expand allow-list before AddPatientContract / CreateSchedule.
      const ensureDisc = mapServiceToDiscipline(
        billingServiceName || discipline || session.serviceType || '',
      );
      if (ensureDisc) {
        await hha.ensureAcceptedServices(patientId, [ensureDisc]);
      }
      const contractStart =
        matchedMandate?.startOn?.trim() || session.dateOfService || undefined;
      await ensurePatientProgramContract({
        hha,
        patientId,
        programType: student?.programType,
        startDate: contractStart,
        visitDate: session.dateOfService,
        serviceCodeId,
        serviceCode: billingServiceName,
      });

      // Patient-level auth (Period + Maximum from mandate) so HHA can pay the visit.
      // Mirror opened/new_services CreatePatientAuthorization — CreateSchedule has no AuthID field.
      await ensurePatientAuthorizationForVisit({
        hha,
        patientId,
        contractId: String(contractNum),
        serviceCodeId,
        serviceCode: billingServiceName,
        programType: student?.programType,
        programId: student?.programId,
        mandate: matchedMandate,
        visitDate: session.dateOfService,
        visitDurationMinutes: clockMinutes ?? matchedMandate?.durationMinutes ?? undefined,
      });

      const rate = sessionPayCodeRate(provider, session, payOpts);
      const pay = buildPayCodeName(discipline, rate ?? undefined, {
        group: useGroupPay,
      });
      if (!pay) {
        throw new Error(
          `No HHA pay code rate for session (discipline=${discipline ?? '(missing)'}, attendance=${session.attendance}) — set provider duration/group/eval/additional rates`,
        );
      }
      const payCodeId = await hha.resolvePayCodeId(pay.payCodeName);
      if (!payCodeId) {
        const tried = payCodeLookupCandidates(pay.payCodeName);
        const triedNote =
          tried.length > 1 ? ` (also tried ${tried.filter((n) => n !== pay.payCodeName).join(', ')})` : '';
        throw new Error(
          `Pay code "${pay.payCodeName}" not found in HHA GetPayRateCodes${triedNote} — create pay code with that exact name or AM equivalent`,
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

      // Therapy (PT/OT/ST) must be Skilled — Non-Skilled yields false ErrorID=-310.
      const scheduleType =
        inferCreateScheduleType(billingServiceName) === 'Skilled' ||
        inferCreateScheduleType(discipline) === 'Skilled'
          ? 'Skilled'
          : 'Non-Skilled';

      const priorVisitId = existing?.hhaVisitId?.trim() || '';
      const scheduled = await locateOrScheduleVisitWithPatientRecovery({
        store,
        hha,
        student,
        patientId,
        visit: {
          patientId,
          // Prior HHA VisitID for rematch — never TMS session UUID (UUIDs are not VisitIDs).
          // findExistingVisit ignores -415 on this id and falls through to SearchVisits/CreateSchedule.
          visitExternalId: /^\d+$/.test(priorVisitId) ? priorVisitId : undefined,
          visitDate: session.dateOfService,
          startTime: session.beginTime,
          endTime: session.endTime,
          serviceCode: billingServiceName,
          serviceCodeId,
          contractId: String(contractNum),
          caregiverId,
          payCodeId,
          scheduleType,
          programType: student?.programType,
          providerName: `${provider.firstName} ${provider.lastName}`,
          payRate: String(rate),
          // Visit clock length stays Frontline begin/end; pay/billing buckets use mandate above.
          durationMinutes: clockMinutes ?? undefined,
        },
      });
      patientId = scheduled.patientId;
      const result = scheduled.result;
      scheduledVisitId = result.id;
      // Pay path requires ConfirmVisits with TimesheetApproved=Yes (Auth + Confirmed + Timesheet).
      // Do not soft-skip Timesheet Required / -415 — those left visits unpaid while TMS marked confirmed.
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
      const raw = err instanceof Error ? err.message : String(err);
      // -401 Already Billed: visit is done in HHA for payroll — keep/restore confirmed, do not fail week.
      if (isAlreadyBilledConfirmFault(undefined, raw)) {
        const visitFromErr = scheduledVisitId || raw.match(/visit\s+(\d{6,})/i)?.[1] || '';
        store.upsertTransfer({
          id: existing?.id || newId(),
          sessionId: session.id,
          weekId: week.id,
          status: 'confirmed',
          hhaVisitId: visitFromErr || existing?.hhaVisitId || '',
          lastError: '',
          payloadHash: hashSession(session),
          updatedAt: nowIso(),
        });
        transferred += 1;
        continue;
      }
      // Surface clearer admin text for overloaded ErrorID=-310 variants.
      let message = raw;
      if (/Overlapping shifts are not allowed/i.test(raw) || /Your shift is overlapping with Patient/i.test(raw)) {
        const peer =
          raw.match(/overlapping with Patient:\s*\[([^\]]+)\]/i)?.[1]?.trim() ||
          raw.match(/Patient:\s*\[([^\]]+)\]/i)?.[1]?.trim();
        message =
          `HHA caregiver shift overlaps an existing visit` +
          (peer ? ` for ${peer}` : '') +
          ` at this time — cancel/reschedule the conflicting HHA visit or change the TMS session time, then re-send. (${raw})`;
      } else if (/only select OT Service Code/i.test(raw) || /Service code inconsistency/i.test(raw)) {
        message =
          `HHA patient AcceptedServices does not allow this visit’s service code (often OT-only patient + PT visit). ` +
          `Automation should have widened AcceptedServices via UpdatePatientDemographics; if this persists, check ensureAcceptedServices errors or update in HHA UI, then re-send. (${raw})`;
      } else if (/Timesheet Required from Configuration/i.test(raw)) {
        message =
          `HHA visit was scheduled but ConfirmVisits could not set Timesheet Approved (office timesheet configuration). ` +
          `Re-send after office config allows ConfirmVisits with TimesheetApproved=Yes. (${raw})`;
      } else if (isInvalidHhaVisitError(err)) {
        message =
          `HHA visit was scheduled but ConfirmVisits could not read the VisitID yet (ErrorID=-415). ` +
          `Re-send to confirm + approve timesheet — VisitID ${scheduledVisitId || '(unknown)'}. (${raw})`;
      }
      const childName = student
        ? `${student.firstName} ${student.lastName}`.trim()
        : '';
      message = labelHhaTransferError(message, { childName, session });
      const visitFromErr = scheduledVisitId || raw.match(/visit\s+(\d{6,})/i)?.[1] || '';
      errors.push(message);
      store.upsertTransfer({
        id: existing?.id || newId(),
        sessionId: session.id,
        weekId: week.id,
        status: 'failed',
        hhaVisitId: visitFromErr,
        lastError: message,
        payloadHash: hashSession(session),
        updatedAt: nowIso(),
      });
    }
  }
  // Double-send can leave a blank failed row beside a confirmed sibling. Drop it
  // so triage cannot show a -310 (or other) error for a visit already in HHA.
  const droppedStaleFailed = store.dropSupersededFailedTransfers({ weekId: week.id });
  const rollup = weekHhaRollup(store, week.id);
  store.upsertWeek({
    ...week,
    // Derive from all eligible sessions — never mark the week confirmed while failures remain.
    hhaStatus: rollup.status,
    // Triage text = currently-failed transfers only (do not keep stale -401 blobs after heal).
    hhaError: weekHhaErrorFromTransfers(store, week.id),
  });
  store.audit(options.actorId, 'hha_transfer', `week:${week.id}`, null, {
    transferred,
    errors,
    droppedStaleFailed: droppedStaleFailed.length,
    staleFailedTransferDrop: droppedStaleFailed.length
      ? 'drop superseded failed HHA transfer'
      : '',
  });
  return { ok: errors.length === 0, transferred, errors };
  } finally {
    await lock.release();
  }
}

function hashSession(session: SessionRow): string {
  return createHash('sha256')
    .update(
      [session.id, session.dateOfService, session.beginTime, session.endTime, session.studentId].join('|'),
    )
    .digest('hex')
    .slice(0, 16);
}

