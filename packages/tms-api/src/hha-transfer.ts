import { createHash } from 'node:crypto';
import {
  canCreatePatient,
  createPatientDefaultsFromEnv,
  formatHhaPatientMismatch,
  inferCreateScheduleType,
  isAlreadyBilledConfirmFault,
  isInvalidHhaPatientError,
  isInvalidHhaVisitError,
  isTrustedHhaPatientId,
  mapServiceToDiscipline,
  patientIdentityMatches,
  payCodeLookupCandidates,
  psDateToIso,
  type HhaClient,
  type PatientDemoFields,
} from '@white-glove/hha-client';
import {
  buildPayCodeName,
  buildSchoolBillingServiceName,
  extractDisciplineFromServiceType,
  isGroupSchoolBillingServiceName,
  isIndividualSchoolBillingServiceName,
  canonicalContractProgramName,
  lookupContractId,
  schoolBillingDurationMinutes,
  schoolBillingServiceNameCandidates,
} from '@white-glove/shared';
import {
  dominantProgramTypeForSessions,
  labelHhaTransferError,
  mandateDurationMinutesForSession,
  newId,
  nowIso,
  preferredMandateForSession,
  sessionShorterThanMandateError,
  presentGroupPeerCount,
  providerDaySessions,
  hhaOverlapGroupMate,
  sessionBillingKind,
  sessionDurationMinutes,
  sessionPayCodeRate,
  sessionUsesGroupPayRate,
  isHhaTransferSession,
  isPaidAbsenceSession,
  soloGroupMandateNoteError,
  sessionServiceTypeRequiredError,
  additionalServiceWithoutChild,
  isAdditionalServiceType,
  isNoChildPlaceholderName,
  normalizeProgramTypeKey,
  resolveWeekProgramType,
  unambiguousSiblingProgramType,
  weekHhaErrorFromTransfers,
  weekHhaRollup,
  type Mandate,
  type MemoryStore,
  type SessionRow,
  type Student,
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
 * → CreatePatient when no chart matches this child's first name, last name, and DOB.
 * A chosen chart (stored id, MR/program-id hit, or name hit) is used only when
 * first name, last name, and date of birth are this TMS child. A mismatch is
 * not saved and does not CreateSchedule. That mismatch does not block creating
 * the real child, and the new PatientID is saved only after the returned chart matches.
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
  /**
   * Stored hhaPatientId failed the name+DOB check. Caller clears it so the
   * next send cannot reuse the other child. Matching ids are not cleared.
   */
  clearStoredPatientId?: (patientId: string) => void;
}): Promise<string | undefined> {
  const { hha, student, schoolAddress, forceResearch } = options;
  if (!student) return undefined;

  const programId = student.programId?.trim() || undefined;

  if (!forceResearch && isTrustedHhaPatientId(student.hhaPatientId, programId)) {
    const stored = student.hhaPatientId!.trim();
    const demo = await hha.getPatientDemographicsFields(stored);
    if (!demo.chartLoaded) {
      // No chart on this client (unit-test stub). A live chart is always compared.
      return stored;
    }
    if (patientIdentityMatches(student, demo)) return stored;
    options.clearStoredPatientId?.(stored);
  }

  // MR / admission / name search. The MR hit is not used until the chart matches.
  const found = await hha.findPatient({
    caseId: programId,
    externalId: programId,
    firstName: student.firstName,
    lastName: student.lastName,
    dateOfBirth: student.dob || undefined,
  });
  if (found) {
    const accepted = await acceptPatientChart(hha, student, found);
    if (accepted === found) return found;
    if (!accepted) {
      throw new Error(
        `HHA patient ${found} was found but the chart name and date of birth could not be verified. Refusing to transfer.`,
      );
    }
    // Confirmed different child. The existing name search may still find this child.
    // Do not invent another fallback. A mismatch does not get the visit.
    const byName =
      student.firstName?.trim() && student.lastName?.trim()
        ? await hha.findPatient({
            firstName: student.firstName,
            lastName: student.lastName,
            dateOfBirth: student.dob || undefined,
          })
        : undefined;
    if (byName && byName !== found) {
      const named = await acceptPatientChart(hha, student, byName);
      if (named === byName) return byName;
      if (!named) {
        throw new Error(
          `HHA patient ${byName} was found but the chart name and date of birth could not be verified. Refusing to transfer.`,
        );
      }
    }
    // No name+DOB match. Create this child. upsertPatient would return the MR hit.
  }

  return createPatientWhenUnmatched({ hha, student, schoolAddress, programId });
}

const CREATE_PATIENT_FIELD_LABELS: Record<string, string> = {
  officeId: 'Office',
  coordinatorId: 'Coordinator',
  firstName: 'First Name',
  lastName: 'Last Name',
  dateOfBirth: 'Date of Birth',
  address1: 'Address',
  city: 'City',
  state: 'State',
  zipCode: 'Zip Code',
  caseId: 'Program Id / Case Id',
  gender: 'Gender',
};

/**
 * CreatePatient with the demographics TMS already has.
 * Does not search again: a prior MR or name hit that failed the name+DOB check
 * must not be returned or scheduled. The new id is returned only when the
 * chart HHA gives back is this child.
 */
async function createPatientWhenUnmatched(options: {
  hha: HhaClient;
  student: StudentForHha;
  schoolAddress?: SchoolAddressForPatient;
  programId?: string;
}): Promise<string> {
  const { hha, student, schoolAddress, programId } = options;
  const patient = {
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
  };
  const readiness = canCreatePatient(patient, createPatientDefaultsFromEnv());
  if (!readiness.ok) {
    const missingLabels = readiness.missing.map((key) => CREATE_PATIENT_FIELD_LABELS[key] ?? key);
    throw new Error(
      `CreatePatient FAILED — missing required field(s): ${missingLabels.join(', ')}.`,
    );
  }

  // createPatient does not look up MR or name. upsertPatient would hand back the mismatch.
  const created = await hha.createPatient(patient);
  const demo = await hha.getPatientDemographicsFields(created.id);
  if (!demo.chartLoaded || !patientIdentityMatches(student, demo)) {
    throw new Error(
      demo.chartLoaded
        ? formatHhaPatientMismatch({ patientId: created.id, chart: demo, student })
        : `CreatePatient returned PatientID ${created.id} but the chart name and date of birth could not be verified. Not saving it.`,
    );
  }
  return created.id;
}

/**
 * Loaded chart that is this child → the PatientID.
 * Loaded chart that is someone else → that chart, so the caller can refuse it.
 * No chart → undefined (caller must not treat the id as verified).
 */
async function acceptPatientChart(
  hha: HhaClient,
  student: StudentForHha,
  patientId: string,
): Promise<string | { patientId: string; demo: PatientDemoFields } | undefined> {
  const demo = await hha.getPatientDemographicsFields(patientId);
  if (!demo.chartLoaded) return undefined;
  if (patientIdentityMatches(student, demo)) return patientId;
  return { patientId, demo };
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

/** CreatePatient requires a birth date. This is not a real student's DOB. */
const NO_CHILD_PLACEHOLDER_DOB = '2000-01-01';

/**
 * CreatePatient requires a street address. Used only on a new "no child"
 * patient when the week and its students have no complete school address.
 * Never written onto a school or a real child.
 */
const NO_CHILD_PLACEHOLDER_ADDRESS: Required<SchoolAddressForPatient> = {
  address1: '1 Placeholder St',
  city: 'New York',
  state: 'NY',
  zipCode: '10001',
};

/** Unique Program Id / AdmissionID so each no-child row is a new HHA patient. */
function noChildCaseId(sessionId: string): string {
  const hex = createHash('sha256')
    .update(`${sessionId}|${nowIso()}|${Math.random()}`)
    .digest('hex');
  const digits = BigInt(`0x${hex.slice(0, 12)}`).toString(10).padStart(10, '0').slice(0, 10);
  return `NC${digits}`;
}

function completeSchoolAddress(
  school: { id?: string; address1?: string; city?: string; state?: string; zipCode?: string } | undefined,
): (SchoolAddressForPatient & { schoolId: string }) | undefined {
  if (!school) return undefined;
  const address1 = school.address1?.trim();
  const city = school.city?.trim();
  const state = school.state?.trim();
  const zipCode = school.zipCode?.trim();
  if (!address1 || !city || !state || !zipCode) return undefined;
  return { address1, city, state, zipCode, schoolId: String(school.id || '').trim() };
}

/**
 * Address for a no-child placeholder: the week's school, else a real student
 * on this week, else any student already on this program type.
 * Undefined when none of those have a complete address; the caller then puts
 * NO_CHILD_PLACEHOLDER_ADDRESS on the new patient only.
 */
function schoolAddressForNoChild(
  store: MemoryStore,
  week: WeeklyPeriod,
  programType: string,
): (SchoolAddressForPatient & { schoolId: string }) | undefined {
  const fromWeek = completeSchoolAddress(store.data.schools.find((s) => s.id === week.schoolId));
  if (fromWeek) return fromWeek;

  const key = normalizeProgramTypeKey(programType);
  const onWeek = new Set(
    store
      .sessionsForWeek(week.id)
      .map((s) => String(s.studentId || '').trim())
      .filter(Boolean),
  );
  const ranked = store.data.students
    .filter((st) => !isNoChildPlaceholderName(st))
    .filter((st) => onWeek.has(st.id) || (key && normalizeProgramTypeKey(st.programType) === key))
    .sort((a, b) => Number(onWeek.has(b.id)) - Number(onWeek.has(a.id)));
  for (const st of ranked) {
    const addr = completeSchoolAddress(store.data.schools.find((s) => s.id === st.schoolId));
    if (addr) return addr;
  }
  return undefined;
}

/**
 * New TMS child + HHA patient (first "no", last "child") on this week's contract.
 * Never searches or reuses an existing "no child" patient — one patient per row.
 * Does not write the session's studentId.
 */
async function createNoChildPlaceholderForSession(options: {
  store: MemoryStore;
  hha: HhaClient;
  week: WeeklyPeriod;
  sessionId: string;
  serviceCode?: string;
  /** Saved on the no-child row. Does not require a caseload child named "no child". */
  programType?: string;
}): Promise<Student> {
  const { store, hha, week } = options;
  const programType =
    canonicalContractProgramName(options.programType) ||
    canonicalContractProgramName(week.programType) ||
    canonicalContractProgramName(resolveWeekProgramType(store, week)) ||
    canonicalContractProgramName(unambiguousSiblingProgramType(store, week));
  const contractNum = await hha.resolveContractId(programType);
  if (!contractNum) {
    throw new Error(
      `No HHA ContractID for program type "${programType || '(missing)'}" — needed to create a no-child patient for this additional service`,
    );
  }
  const schoolAddress = schoolAddressForNoChild(store, week, programType);
  const address = schoolAddress ?? NO_CHILD_PLACEHOLDER_ADDRESS;
  const caseId = noChildCaseId(options.sessionId);
  const student = store.upsertStudent({
    id: newId(),
    schoolId: schoolAddress?.schoolId || String(week.schoolId || '').trim(),
    firstName: 'no',
    lastName: 'child',
    dob: NO_CHILD_PLACEHOLDER_DOB,
    programId: caseId,
    programType,
    hhaPatientId: '',
    createdAt: nowIso(),
  });
  const created = await hha.createPatient({
    firstName: 'no',
    lastName: 'child',
    dateOfBirth: NO_CHILD_PLACEHOLDER_DOB,
    caseId,
    externalId: caseId,
    serviceCode: options.serviceCode?.trim() || undefined,
    address1: address.address1,
    city: address.city,
    state: address.state,
    zipCode: address.zipCode,
  });
  student.hhaPatientId = created.id;
  store.upsertStudent(student);
  return student;
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

    // 2) Real children: search first, CreatePatient only if not found.
    //    No-child placeholders: always a new patient (never reuse another "no child").
    let recovered: string | undefined;
    if (isNoChildPlaceholderName(live)) {
      const caseId = noChildCaseId(live.id);
      const addr = schoolAddressForStudent(store, live);
      const created = await hha.createPatient({
        firstName: 'no',
        lastName: 'child',
        dateOfBirth: live.dob?.trim() || NO_CHILD_PLACEHOLDER_DOB,
        caseId,
        externalId: caseId,
        serviceCode: options.visit.serviceCode || undefined,
        address1: addr?.address1,
        city: addr?.city,
        state: addr?.state,
        zipCode: addr?.zipCode,
      });
      live.programId = caseId;
      live.hhaPatientId = created.id;
      store.upsertStudent(live);
      recovered = created.id;
    } else {
      recovered = await resolveHhaPatientId({
        hha,
        student: {
          ...live,
          hhaPatientId: '',
          serviceCode: options.visit.serviceCode || live.programType,
        },
        schoolAddress: schoolAddressForStudent(store, live),
        forceResearch: true,
      });
    }
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
  /** Flush after each session write so a dropped HTTP response still shows triage. */
  afterSession?: () => Promise<void>;
}): Promise<{ ok: boolean; transferred: number; errors: string[] }> {
  const { store, week, hha } = options;
  const checkpoint = async () => {
    if (!options.afterSession) return;
    try {
      await options.afterSession();
    } catch (err) {
      console.error('[hha-transfer] checkpoint persist failed', err);
    }
  };
  if (week.status !== 'locked' && week.status !== 'signed') {
    return { ok: false, transferred: 0, errors: ['Week must be signed or locked before HHA.'] };
  }
  const lock = await acquireHhaWeekLock(week.id);
  if (!lock.ok) {
    return { ok: false, transferred: 0, errors: [lock.error] };
  }
  try {
  let workingWeek = week;
  // Locked weeks keep a stamped programType forever. If caseload was renamed
  // (e.g. Related Services → Valley Stream School District 24) after lock, the
  // dashboard still shows the stale label. Refresh when stamp has no HHA
  // ContractID but session students do — transfer already uses student.programType.
  const liveProgram = dominantProgramTypeForSessions(
    store,
    store.sessionsForWeek(workingWeek.id),
  );
  const stampedProgram = String(workingWeek.programType || '').trim();
  if (
    liveProgram &&
    lookupContractId(liveProgram) &&
    (!stampedProgram || !lookupContractId(stampedProgram))
  ) {
    workingWeek = store.upsertWeek({ ...workingWeek, programType: liveProgram });
  }
  const provider = store.data.providers.find((p) => p.id === workingWeek.providerId);
  const sessions = store.sessionsForWeek(workingWeek.id).filter((s) => isHhaTransferSession(s));
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
      await checkpoint();
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
      await checkpoint();
      continue;
    }
    let student = store.data.students.find((s) => s.id === session.studentId);
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
      // Edelia: school billing and pay follow the mandate length, never the clock.
      // A visit shorter than that mandate is blocked (15 min on a 30-min mandate).
      // Additional services are the exception and still use the clock.
      // A group-mandate child seen individually (no peer / individual tag) is
      // billed and paid as individual at that same mandate length.
      const shortErr = sessionShorterThanMandateError(session, store.data.mandates);
      if (shortErr) {
        throw new Error(shortErr);
      }
      const billingDurationMinutes =
        billingKind === 'school' ? (mandateMinutes ?? clockMinutes) : clockMinutes;
      // Peers first: Moshe rule — never bill group while paying individual.
      // Solo / no-peer → individual service code AND individual pay.
      // True multi-peer groups → group billing + group/AM pay.
      const ratePeers = providerDaySessions(
        store.data.sessions,
        store.data.weeks,
        workingWeek.providerId,
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
          cptCodes: session.cptCodes,
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
      // Stored name follows the mandate duration. A real group stays on the
      // group code. Seen individually rewrites that stamp to the individual code.
      const storedDuration = schoolBillingDurationMinutes(storedBillingName);
      const storedDurationOk =
        billingDurationMinutes == null ||
        storedDuration == null ||
        storedDuration === billingDurationMinutes;
      const storedOkForVisit =
        Boolean(storedBillingName) &&
        storedDurationOk &&
        (useGroupBilling
          ? !isIndividualSchoolBillingServiceName(storedBillingName)
          : !isGroupSchoolBillingServiceName(storedBillingName));
      const clockCandidates = schoolBillingServiceNameCandidates({
        discipline,
        kind: billingKind,
        durationMinutes: billingDurationMinutes,
        group: useGroupBilling,
      });
      const mandateGroupName =
        useGroupBilling && storedBillingName && isGroupSchoolBillingServiceName(storedBillingName)
          ? storedBillingName
          : useGroupBilling
            ? buildSchoolBillingServiceName({
                discipline,
                kind: billingKind,
                durationMinutes: mandateMinutes ?? undefined,
                group: true,
              })
            : undefined;
      const nameCandidates = [
        ...(storedOkForVisit && storedBillingName ? [storedBillingName] : []),
        ...clockCandidates.filter((name) => name !== storedBillingName),
      ];
      if (
        mandateGroupName &&
        isGroupSchoolBillingServiceName(mandateGroupName) &&
        !nameCandidates.includes(mandateGroupName)
      ) {
        nameCandidates.push(mandateGroupName);
      }
      let billingServiceName =
        nameCandidates[0] ||
        buildSchoolBillingServiceName({
          discipline,
          kind: billingKind,
          durationMinutes: billingDurationMinutes,
          group: useGroupBilling,
        });
      if (!billingServiceName && billingKind === 'additional') {
        const disc = discipline ?? 'PT';
        throw new Error(
          clockMinutes == null
            ? `Additional service has no start and end time. A 30-minute visit uses "${disc} additional services 30". A 60-minute visit uses "${disc} additional services 60".`
            : `Additional service is ${clockMinutes} min. Use a 30-minute visit for "${disc} additional services 30" or a 60-minute visit for "${disc} additional services 60".`,
        );
      }
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
      let patientId: string | undefined;
      const paidAbsenceNoChild =
        !String(session.studentId || '').trim() && isPaidAbsenceSession(session);
      if (additionalServiceWithoutChild(session) || paidAbsenceNoChild) {
        // New patient on this week's contract, then CreateSchedule on that patient.
        // Session stays without a studentId so it is not attached to a real child.
        student = await createNoChildPlaceholderForSession({
          store,
          hha,
          week: workingWeek,
          sessionId: session.id,
          serviceCode: createServiceHint,
          programType: session.programType,
        });
        patientId = student.hhaPatientId;
      } else {
        patientId = await resolveHhaPatientId({
          hha,
          student: student
            ? { ...student, serviceCode: createServiceHint }
            : undefined,
          schoolAddress: schoolAddressForStudent(store, student),
          clearStoredPatientId: (badId) => {
            if (!student) return;
            const live = store.data.students.find((s) => s.id === student.id);
            if (!live || (live.hhaPatientId || '').trim() !== badId) return;
            live.hhaPatientId = '';
            store.upsertStudent({ ...live, hhaPatientId: '' });
            student.hhaPatientId = '';
          },
        });
      }
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
      const tryNames = nameCandidates.length ? nameCandidates : [billingServiceName];
      let serviceCodeId: string | undefined;
      for (const name of tryNames) {
        const id = await hha.resolveServiceCodeId(name, contractNum, student?.programType);
        if (!id) continue;
        billingServiceName = name;
        serviceCodeId = id;
        break;
      }
      if (!serviceCodeId) {
        const also = tryNames.length > 1 ? ` (also tried ${tryNames.slice(1).join(', ')})` : '';
        throw new Error(
          `Service code "${tryNames[0]}" not found in HHA billing codes for this contract — create it under the contract (case-insensitive name match)${also}`,
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
          `No HHA pay code rate for session (discipline=${discipline ?? '(missing)'}, attendance=${session.attendance}${isPaidAbsenceSession(session) ? ', paid absence' : ''}) — set provider duration/group/eval/additional rates`,
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

      // HHA CreateSchedule requires PrimaryBillTo hours+minutes to equal the schedule
      // window, and the service-code unit must match that window. Minutes stay 0–59
      // (60 min is Hours=1, Minutes=0). PT School 30 + 60-min clock → ErrorID=-11.
      const billingUnitMinutes = schoolBillingDurationMinutes(billingServiceName);
      if (
        billingKind === 'school' &&
        billingUnitMinutes != null &&
        clockMinutes != null &&
        billingUnitMinutes !== clockMinutes
      ) {
        throw new Error(
          `Session clock is ${clockMinutes} min but HHA billing "${billingServiceName}" is ${billingUnitMinutes} min — ` +
            `the rate and service code stay on the mandate. Change the session times to ${billingUnitMinutes} min, then re-send. ` +
            `CreateSchedule fails with ErrorID=-11 when these disagree.`,
        );
      }

      const priorVisitId = existing?.hhaVisitId?.trim() || '';
      // Paid absence stays "paid absence" on the timesheet. CreateSchedule has no
      // attendance field, so the visit is the same attended school visit HHA confirms.
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
          // Must equal schedule window (begin/end). School billing name comes from mandate above.
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
        weekId: workingWeek.id,
        status: 'confirmed',
        hhaVisitId: result.id,
        lastError: '',
        payloadHash: hashSession(session),
        updatedAt: nowIso(),
      });
      transferred += 1;
      await checkpoint();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // -401 Already Billed: visit is done in HHA for payroll — keep/restore confirmed, do not fail week.
      if (isAlreadyBilledConfirmFault(undefined, raw)) {
        const visitFromErr = scheduledVisitId || raw.match(/visit\s+(\d{6,})/i)?.[1] || '';
        store.upsertTransfer({
          id: existing?.id || newId(),
          sessionId: session.id,
          weekId: workingWeek.id,
          status: 'confirmed',
          hhaVisitId: visitFromErr || existing?.hhaVisitId || '',
          lastError: '',
          payloadHash: hashSession(session),
          updatedAt: nowIso(),
        });
        transferred += 1;
        await checkpoint();
        continue;
      }
      // Surface clearer admin text for overloaded ErrorID=-310 variants.
      let message = raw;
      if (/Overlapping shifts are not allowed/i.test(raw) || /Your shift is overlapping with Patient/i.test(raw)) {
        const peer =
          raw.match(/overlapping with Patient:\s*\[([^\]]+)\]/i)?.[1]?.trim() ||
          raw.match(/Patient:\s*\[([^\]]+)\]/i)?.[1]?.trim();
        const groupMate = hhaOverlapGroupMate({
          message: raw,
          candidate: session,
          peers: providerDaySessions(
            store.data.sessions,
            store.data.weeks,
            workingWeek.providerId,
            session.dateOfService,
            session.id,
          ),
          mandates: store.data.mandates,
          students: store.data.students,
        });
        if (groupMate) {
          const mateName = `${groupMate.firstName || ''} ${groupMate.lastName || ''}`.trim() || peer || 'the group mate';
          // HHA CreateSchedule has no overlap bypass. CreateLinkedSchedule is for payer-linked
          // contracts, not a second patient on the same caregiver clock. Each group child still
          // needs their own visit; the office must allow overlapping caregiver shifts.
          message =
            `This is a group visit at the same time as ${mateName}. ` +
            `HHA already has that group mate and will not put this caregiver on a second patient at that time. ` +
            `Do not cancel the group mate. ` +
            `CreateSchedule has no group-overlap exception — allow overlapping caregiver shifts in HHA, then re-send. (${raw})`;
        } else {
          message =
            `HHA caregiver shift overlaps an existing visit` +
            (peer ? ` for ${peer}` : '') +
            ` at this time — cancel/reschedule the conflicting HHA visit or change the TMS session time, then re-send. (${raw})`;
        }
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
          `HHA visit was scheduled but the new VisitID was still unreadable after waiting (ErrorID=-415). ` +
          `The schedule is in HHA and Confirm Visit was not checked. ` +
          `Re-send to confirm it — VisitID ${scheduledVisitId || '(unknown)'}. (${raw})`;
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
        weekId: workingWeek.id,
        status: 'failed',
        hhaVisitId: visitFromErr,
        lastError: message,
        payloadHash: hashSession(session),
        updatedAt: nowIso(),
      });
      await checkpoint();
    }
  }
  // Double-send can leave a blank failed row beside a confirmed sibling. Drop it
  // so triage cannot show a -310 (or other) error for a visit already in HHA.
  const droppedStaleFailed = store.dropSupersededFailedTransfers({ weekId: workingWeek.id });
  const rollup = weekHhaRollup(store, workingWeek.id);
  store.upsertWeek({
    ...workingWeek,
    // Derive from all eligible sessions — never mark the week confirmed while failures remain.
    hhaStatus: rollup.status,
    // Triage text = currently-failed transfers only (do not keep stale -401 blobs after heal).
    hhaError: weekHhaErrorFromTransfers(store, workingWeek.id),
  });
  store.audit(options.actorId, 'hha_transfer', `week:${workingWeek.id}`, null, {
    transferred,
    errors,
    droppedStaleFailed: droppedStaleFailed.length,
    staleFailedTransferDrop: droppedStaleFailed.length
      ? 'drop superseded failed HHA transfer'
      : '',
  });
  await checkpoint();
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

