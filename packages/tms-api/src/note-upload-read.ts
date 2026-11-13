import {
  appSettingsFromStore,
  checkMandatesForWeek,
  cptDurationError,
  findProviderByName,
  findStudentForActivityName,
  isGenericSettingLabel,
  isNonSchoolLikeSetting,
  missedSessionReasonError,
  newId,
  notesLookCopyPasted,
  noteCopyPasteError,
  noteIsCopyPasteSource,
  parseWeeklySessionText,
  pdfSchoolConflictsWithChild,
  sameDistrictSchoolNames,
  presentGroupPeerCount,
  providerDaySessions,
  resolveMakeupOfSessionId,
  screenServiceNote,
  sessionImportAgeError,
  sessionProviderDisciplineMismatchError,
  sessionIsSigned,
  sessionLooksGroup,
  sessionOverlapError,
  sessionServiceTypeRequiredError,
  sessionSignatureError,
  sessionSlotLabel,
  soloGroupMandateNoteError,
  therapistCanImportOrAddServices,
  validateMakeup,
  weekIsProcessed,
  weekStartFromDos,
  type AppUser,
  type MemoryStore,
  type ParsedSessionNote,
  type SessionRow,
} from '@white-glove/tms-db';

export type FreshUploadRead = {
  readable: boolean;
  errors: string[];
  sessions: SessionRow[];
  showed: string;
};

function rowLabel(name: string, row: { dateOfService?: string; beginTime?: string; endTime?: string }): string {
  const who = String(name || '').trim() || 'Unknown child';
  const slot = sessionSlotLabel({
    dateOfService: String(row.dateOfService || ''),
    beginTime: String(row.beginTime || ''),
    endTime: String(row.endTime || ''),
  } as SessionRow);
  return `${who} — ${slot}`;
}

function cptLabel(codes: string[], procedures: string[], units: number): string {
  if (procedures.length) return procedures.join(', ');
  if (codes.length) return codes.map((code) => (units > 0 && codes.length === 1 ? `${code}x${units}` : code)).join(', ');
  return '';
}

function uploadKey(row: {
  studentId: string;
  dateOfService: string;
  beginTime: string;
  endTime: string;
  attendance?: string;
}): string {
  return [
    String(row.studentId || '').trim().toLowerCase(),
    String(row.dateOfService || '').trim().toLowerCase(),
    String(row.beginTime || '').trim().toLowerCase().replace(/\./g, ''),
    String(row.endTime || '').trim().toLowerCase().replace(/\./g, ''),
    String(row.attendance || 'attended').trim().toLowerCase() || 'attended',
  ].join('|');
}

function showedFor(row: ParsedSessionNote): string {
  const group = sessionLooksGroup(row.serviceType) === true ? 'group' : sessionLooksGroup(row.serviceType) === false ? 'individual' : 'unspecified ratio';
  const cpt = row.cptProcedures.join(', ') || row.cptCodes.join(', ') || 'no CPT codes';
  const slice = row.sourceSlice || row.notes;
  const signed = sessionIsSigned(slice) ? 'signed' : 'not signed';
  const license = slice.match(/License#\s*\d+/)?.[0] || '';
  return `${row.studentName || 'Child'} ${row.dateOfService} ${row.beginTime}–${row.endTime}: ${row.attendance}, ${group}, service ${row.serviceType || '(none)'}, CPT ${cpt}, ${signed}${license ? ` (${license})` : ''}.`;
}

/**
 * Apply the notes-upload checks. Pass `rows` from the Bedrock re-read.
 * Without rows, this falls back to the non-AI parser and is not Luna's decision.
 */
export function readNotesAsUpload(input: {
  store: MemoryStore;
  user: AppUser;
  noteText: string;
  /** When set, including an empty list, do not parse the note again. */
  rows?: ParsedSessionNote[] | null;
}): FreshUploadRead {
  const noteText = String(input.noteText || '').trim();
  const parsed = input.rows != null ? input.rows : noteText ? parseWeeklySessionText(noteText) : [];
  if (!parsed.length) return { readable: false, errors: [], sessions: [], showed: '' };

  const provider =
    input.user.role === 'admin'
      ? undefined
      : input.store.data.providers.find((row) => row.id === input.user.providerId) ||
        input.store.data.providers.find((row) => row.userId === input.user.id);
  if (!provider) {
    return {
      readable: true,
      errors: ['Your provider profile is not linked yet. Ask the office for help.'],
      sessions: [],
      showed: parsed.map(showedFor).join('\n'),
    };
  }

  const pdfProviderName = parsed.map((row) => row.providerName).find((name) => String(name || '').trim()) || '';
  if (pdfProviderName && !findProviderByName([provider], pdfProviderName)) {
    return {
      readable: true,
      errors: [`Provider in PDF does not match your account (PDF: "${pdfProviderName}").`],
      sessions: [],
      showed: parsed.map(showedFor).join('\n'),
    };
  }

  const settings = appSettingsFromStore(input.store.data.settings);
  const names = new Map(
    input.store.data.students.map((student) => [
      student.id,
      `${student.firstName} ${student.lastName}`.trim(),
    ]),
  );
  const errors: string[] = [];
  const sessions: SessionRow[] = [];
  const pendingNames: string[] = [];

  const ordered = [...parsed].sort((a, b) => {
    const da = String(a.dateOfService || '');
    const db = String(b.dateOfService || '');
    if (da !== db) return da.localeCompare(db);
    return String(a.beginTime || '').localeCompare(String(b.beginTime || ''));
  });

  for (const row of ordered) {
    const display = String(row.studentName || '').trim() || 'Unknown';
    const label = rowLabel(display, row);
    if (!String(row.studentName || '').trim()) {
      errors.push(`${label}: Could not read the student name from this PDF row.`);
      continue;
    }
    const student = findStudentForActivityName(input.store.data.students, row.studentName);
    if (!student) {
      errors.push(`${label}: Not found. Please reach out to your administrator to import the caseload first.`);
      continue;
    }
    const studentName = `${student.firstName} ${student.lastName}`.trim() || display;
    const named = rowLabel(studentName, row);
    const weekStart = weekStartFromDos(row.dateOfService);
    const week = input.store.data.weeks.find(
      (item) => item.providerId === provider.id && item.weekStart === weekStart,
    );
    if (week && !therapistCanImportOrAddServices(week.status) && input.user.role !== 'admin') {
      const lockMsg = weekIsProcessed(week.status)
        ? 'Week is signed/locked — revoke the signature before importing.'
        : 'This week cannot accept imports.';
      errors.push(`${named}: ${lockMsg}`);
      continue;
    }
    const ageErr = sessionImportAgeError(row.dateOfService, {
      settings,
      providerId: provider.id,
      weekId: week?.id,
      isAdmin: input.user.role === 'admin',
    });
    if (ageErr) {
      errors.push(`${named}: ${ageErr}`);
      continue;
    }

    const rawSchool = String(row.schoolName || row.location || '').trim();
    const pdfSchool =
      rawSchool && !isGenericSettingLabel(rawSchool) && !isNonSchoolLikeSetting(rawSchool) ? rawSchool : '';
    if (pdfSchool) {
      const knownSchool = input.store.data.schools.find((school) => school.id === student.schoolId);
      if (
        knownSchool &&
        pdfSchoolConflictsWithChild(pdfSchool, knownSchool, student.programType, {
          sameDistrictSchoolNames: sameDistrictSchoolNames(
            input.store,
            knownSchool,
            student.programType,
          ),
        })
      ) {
        errors.push(`${named}: School '${pdfSchool}' does not match child's school '${knownSchool.name}'.`);
        continue;
      }
      if (!knownSchool) {
        const exists = input.store.data.schools.some(
          (school) =>
            Boolean(String(school.name || '').trim()) &&
            !pdfSchoolConflictsWithChild(pdfSchool, school, undefined, {
              sameDistrictSchoolNames: sameDistrictSchoolNames(input.store, school, undefined),
            }),
        );
        if (!exists) {
          errors.push(`${named}: School '${pdfSchool}' not found`);
          continue;
        }
      }
    }

    const draftKey = uploadKey({
      studentId: student.id,
      dateOfService: row.dateOfService,
      beginTime: row.attendance === 'missed' ? '' : row.beginTime,
      endTime: row.attendance === 'missed' ? '' : row.endTime,
      attendance: row.attendance,
    });
    const existing = input.store.data.sessions.find((saved) => {
      const savedWeek = input.store.data.weeks.find((item) => item.id === saved.weekId);
      return savedWeek?.providerId === provider.id && uploadKey(saved) === draftKey;
    });

    let session: SessionRow = {
      id: existing?.id || newId(),
      weekId: existing?.weekId || week?.id || '',
      studentId: student.id,
      dateOfService: row.dateOfService,
      beginTime: row.attendance === 'missed' ? '' : row.beginTime,
      endTime: row.attendance === 'missed' ? '' : row.endTime,
      attendance: row.attendance,
      cancelReason: row.cancelReason,
      makeupOfSessionId: existing?.makeupOfSessionId || '',
      serviceType: row.serviceType,
      additionalServiceType: '',
      location: row.location,
      notes: row.notes,
      cptCodes: row.cptCodes || [],
      cptUnits: row.cptUnits || 0,
      cptLabel: cptLabel(row.cptCodes || [], row.cptProcedures || [], row.cptUnits || 0),
      aiFlags: [],
      aiBlock: false,
    };

    const serviceTypeErr = sessionServiceTypeRequiredError(session.serviceType);
    if (serviceTypeErr) {
      errors.push(`${named}: ${serviceTypeErr}`);
      continue;
    }

    {
      // Always on: service-type discipline must match the provider's (not switchable).
      const disciplineErr = sessionProviderDisciplineMismatchError(session, provider, input.store.data.mandates);
      if (disciplineErr) {
        errors.push(`${named}: ${disciplineErr}`);
        continue;
      }
    }

    const weekSessions = (week ? input.store.sessionsForWeek(week.id) : []).filter((saved) => saved.id !== session.id);
    const projected = [
      ...weekSessions,
      ...sessions.filter((saved) => !week || saved.weekId === week.id),
      session,
    ];
    const allSessions = [
      ...input.store.data.sessions.filter((saved) => saved.id !== session.id && (!week || saved.weekId !== week.id)),
      ...projected,
    ];

    if (session.attendance === 'makeup') {
      const resolved = resolveMakeupOfSessionId(session, allSessions, input.store.data.mandates);
      if ('error' in resolved) {
        errors.push(`${named}: ${resolved.error}`);
        continue;
      }
      session = { ...session, makeupOfSessionId: resolved.makeupOfSessionId };
      const makeupErr = validateMakeup(session, allSessions, input.store.data.mandates);
      if (makeupErr) {
        errors.push(`${named}: ${makeupErr}`);
        continue;
      }
    }

    const missedReasonErr = missedSessionReasonError(session.attendance, session.cancelReason, session.notes);
    if (missedReasonErr) {
      errors.push(`${named}: ${missedReasonErr}`);
      continue;
    }

    const cptErr = cptDurationError(
      session.beginTime,
      session.endTime,
      { codes: row.cptCodes || [], totalUnits: row.cptUnits || 0, procedures: row.cptProcedures || [] },
      session.attendance,
      { serviceType: session.serviceType, ratio: row.ratio },
    );
    if (cptErr) {
      errors.push(`${named}: ${cptErr}`);
      continue;
    }

    const sigErr = sessionSignatureError(row.sourceSlice || row.notes || '', session.attendance);
    if (sigErr) {
      errors.push(`${named}: ${sigErr}`);
      continue;
    }

    const dayPeers = [
      ...providerDaySessions(input.store.data.sessions, input.store.data.weeks, provider.id, session.dateOfService, session.id),
      ...sessions.filter((saved) => saved.dateOfService === session.dateOfService && saved.id !== session.id),
    ];
    const overlapErr = sessionOverlapError({
      candidate: session,
      peers: dayPeers,
      studentNameById: names,
      mandates: input.store.data.mandates,
    });
    if (overlapErr) {
      errors.push(`${named}: ${overlapErr}`);
      continue;
    }

    if (session.attendance === 'attended' || session.attendance === 'makeup') {
      const peers = [
        ...sessions.map((saved, index) => ({
          studentId: saved.studentId,
          studentName: pendingNames[index] || saved.studentId,
          notes: saved.notes,
          dateOfService: saved.dateOfService,
          attendance: saved.attendance,
        })),
        ...(week ? input.store.sessionsForWeek(week.id) : [])
          .filter((saved) => saved.studentId !== student.id && saved.id !== session.id)
          .map((saved) => ({
            studentId: saved.studentId,
            studentName: names.get(saved.studentId) || saved.studentId,
            notes: saved.notes,
            dateOfService: saved.dateOfService,
            attendance: saved.attendance,
          })),
      ];
      const peer = peers.find(
        (item) =>
          item.studentId !== student.id &&
          noteIsCopyPasteSource(item.attendance, item.notes) &&
          notesLookCopyPasted(session.notes, item.notes),
      );
      if (peer) {
        errors.push(`${named}: ${noteCopyPasteError(studentName, peer.studentName, peer.dateOfService)}`);
        continue;
      }
    }

    const screened = screenServiceNote(session);
    if (screened.block) {
      errors.push(`${named}: ${screened.blockFlags.join('; ') || 'Note screening failed'}`);
      continue;
    }
    if (screened.warnFlags.length && settings.yellowWarningsBlockImport !== false) {
      errors.push(`${named}: ${screened.warnFlags.join('; ')}`);
      continue;
    }
    session = { ...session, aiFlags: screened.flags, aiBlock: false };

    const check = checkMandatesForWeek(input.store.data.mandates, projected, allSessions, names, {
      allowShortSession: settings.allowShortSessionVsMandate === true,
    });
    if (check.errors.length) {
      const detail =
        check.errors.find((error) => error.includes(studentName) || error.includes(session.dateOfService)) ||
        check.errors[0] ||
        'This exceeds the mandate.';
      errors.push(`${named}: ${detail}`);
      continue;
    }

    const soloNoteErr = soloGroupMandateNoteError({
      notes: session.notes,
      serviceType: session.serviceType,
      cptCodes: session.cptCodes,
      studentId: session.studentId,
      attendance: session.attendance,
      mandates: input.store.data.mandates,
      ratio: row.ratio,
      presentGroupPeerCount: presentGroupPeerCount({
        candidate: session,
        peers: dayPeers,
        mandates: input.store.data.mandates,
      }),
    });
    if (soloNoteErr) {
      errors.push(`${named}: ${soloNoteErr}`);
      continue;
    }

    sessions.push(session);
    pendingNames.push(studentName);
  }

  return {
    readable: true,
    errors,
    sessions: errors.length ? [] : sessions,
    showed: parsed.map(showedFor).join('\n'),
  };
}
