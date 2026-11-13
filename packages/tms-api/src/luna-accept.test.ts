import { describe, expect, it } from 'vitest';
import { MemoryStore, newId, nowIso, sessionLooksGroup, weekStartFromDos } from '@white-glove/tms-db';
import { handleTmsRequest } from './router.js';
import { MemoryMailer } from './mail.js';
import { BILLU_TICKET_EMAIL, MOSHE_OWNER_EMAIL, type BlockReportFileStore } from './block-reports.js';
import { explainBlockError } from './luna-knowledge.js';
import {
  LUNA_CHOOSE_PDF,
  LUNA_FLAG_QUESTION,
  LUNA_HOLD,
  LUNA_OKAY,
  LUNA_PENDING,
  LUNA_UNREADABLE,
  LUNA_UPLOADED,
  LUNA_WHAT_WRONG,
} from './luna-dispute.js';

process.env.TMS_ALLOW_DEV_HEADERS = '1';

const SIGNED_ERROR =
  'Maya Lopez — 10/20/2026 9:00 am–9:30 am: Session is not signed — each attended/makeup session needs a signature (Frontline Provider Signature/Credentials, or Therapist Activity Signed date + credentials).';

const CPT_ERROR =
  'Maya Lopez — 10/22/2026 9:00 am–9:30 am: CPT units (97110x1) cover 15 min but session is 30 min (need 2 unit(s)).';

const FREQUENCY_ERROR =
  'Maya Lopez — 10/22/2026 9:00 am–9:30 am: This exceeds the mandate for Maya Lopez. Mandate allows 2 session(s) per week; this upload would make it 3.';

const SIGNED_NOTE = `
Student Name: Maya Lopez
10/20/2026 9:00 am–9:30 am
Service Provided: gait training at Westbrook Academy gym.
Provider Signature/Credentials
Date
Pat Lee PT (NPI# ) (License# 1003072075)
Oct 20 2026 10:49AM
`;

const UNSIGNED_NOTE = `
Student Name: Maya Lopez
10/20/2026 9:00 am–9:30 am
Service Provided: gait training.
Provider Signature/Credentials
Date
`;

const GROUP_CPT_NOTE = `
Student Name: Maya Lopez
10/22/2026 9:00 am–9:30 am
Ratio 3:1
97150x1
Service Provided: group play.
`;

const SHORT_CPT_NOTE = `
Student Name: Maya Lopez
10/22/2026 9:00 am–9:30 am
97110x1
Service Provided: gait.
`;

const MAKEUP_NOTE = `
Student Name: Maya Lopez
10/22/2026 9:00 am–9:30 am
Service Provided: makeup for 10/15/2026 gait at Westbrook Academy gym.
`;

const ATTENDED_NOTE = `
Student Name: Maya Lopez
10/22/2026 9:00 am–9:30 am
Service Provided: gait training at the gym.
`;

const SCHOOL_ERROR =
  "Maya Lopez — 9/1/2026 9:00 am–9:30 am: School 'PS 1' does not match child's school 'PS 2'.";

const SCHOOL_NOTE = `
Student Name: Maya Lopez
9/1/2026 9:00 am–9:30 am
Service Provided: gait at PS 1.
`;

function memoryFiles(): BlockReportFileStore {
  const saved = new Map<string, Buffer>();
  return {
    async put(key, body) {
      saved.set(key, Buffer.from(body));
    },
    async get(key) {
      const hit = saved.get(key);
      return hit ? Buffer.from(hit) : null;
    },
  };
}

function therapistStore() {
  const store = new MemoryStore();
  const therapist = store.upsertUser({
    id: newId(),
    cognitoSub: 't',
    email: 'therapist@whiteglove.local',
    role: 'therapist',
    displayName: 'Pat Lee',
    providerId: '',
    active: true,
    createdAt: nowIso(),
  });
  const provider = store.upsertProvider({
    id: newId(),
    userId: therapist.id,
    firstName: 'Pat',
    lastName: 'Lee',
    discipline: 'PT',
    payRatePerHour: 72,
    payRate30Min: null,
    payRate42Min: null,
    payRate45Min: null,
    payRateGroup30Min: null,
    payRateGroup42Min: null,
    payRateGroup45Min: null,
    payRateEval: null,
    payRateAdditionalHourly: null,
    hhaCaregiverCode: 'WGC-1',
    active: true,
    createdAt: nowIso(),
  });
  store.upsertUser({ ...therapist, providerId: provider.id });
  store.upsertStudent({
    id: newId(),
    schoolId: '',
    firstName: 'Maya',
    lastName: 'Lopez',
    dob: '2018-01-01',
    programId: 'p',
    programType: 'School',
    hhaPatientId: '',
    createdAt: nowIso(),
  });
  const student = store.data.students[0]!;
  store.upsertMandate({
    id: newId(),
    studentId: student.id,
    providerId: provider.id,
    serviceType: 'PT School',
    discipline: 'PT',
    frequencyPerWeek: 2,
    ratioGroup: false,
    sourcePdfKey: '',
    parsedAt: '',
    startOn: '',
    endOn: '',
    createdAt: nowIso(),
  });
  return { store, provider };
}

const pdf = Buffer.from('%PDF-1.4\n%%EOF');

function dispute(
  store: MemoryStore,
  errors: string[],
  note: string,
  userText: string,
  read: (prompt: string) => Promise<string>,
  explain?: (prompt: string) => Promise<string>,
  extra: { stage?: string; pdf?: boolean; choice?: string } = {},
) {
  const mail = new MemoryMailer();
  const body: Record<string, unknown> = {
    errors,
    stage: extra.stage || 'awaiting-part',
    userText,
    fileName: 'notes.pdf',
  };
  if (extra.choice) body.choice = extra.choice;
  if (extra.pdf !== false) {
    body.pdfText = note;
    body.pdfBase64 = pdf.toString('base64');
  }
  return {
    mail,
    res: handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/support/luna/dispute',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body,
      },
      {
        mail,
        readLunaNote: read,
        explainBlockReport: explain,
        blockReportFiles: memoryFiles(),
      },
    ),
  };
}

const DOS = '10/27/2026';

function frontlineNote(input: {
  ratio: string;
  cpt: string;
  service: string;
  school?: string;
  begin?: string;
  end?: string;
  dos?: string;
}) {
  const school = input.school ? `Setting: ${input.school}\n` : '';
  return `
Student Name: Lopez, Maya
Service Provider: Pat Lee
Service: Physical Therapy
${input.dos || DOS} ${input.ratio} ${input.begin || '9:00 am'} ${input.end || '9:30 am'}
${school}Service Provided: ${input.service}
${input.cpt}
Provider Signature/Credentials
Date
Pat Lee PT (NPI# ) (License# 1003072075)
Oct 27 2026 10:49AM
`;
}

const GROUP_NOTE = frontlineNote({
  ratio: '3:1',
  cpt: '97150x1',
  service: 'group play in the therapy room',
});

const SIGNED_INDIVIDUAL_NOTE = frontlineNote({
  ratio: '1:1',
  cpt: '97110x2',
  service: 'gait training in the therapy room',
});

const SCHOOL_NOTE_FRESH = frontlineNote({
  ratio: '1:1',
  cpt: '97110x2',
  service: 'gait training',
  school: 'Westbrook School',
});

const EXTRA_NOTE = frontlineNote({
  ratio: '1:1',
  cpt: '97110x2',
  service: 'gait training in the therapy room',
  begin: '1:00 pm',
  end: '1:30 pm',
});

const MAKEUP_FRESH = frontlineNote({
  ratio: '1:1',
  cpt: '97110x2',
  service: 'makeup for 10/15/2026 gait training in the therapy room',
});

function aiFacts(partial: Record<string, unknown> = {}) {
  return {
    studentName: 'Lopez, Maya',
    dateOfService: DOS,
    beginTime: '9:00 am',
    endTime: '9:30 am',
    attendance: 'attended',
    makeupFor: '',
    signed: true,
    signatureQuote: 'License# 1003072075',
    cptCodes: ['97110'],
    cptUnits: 2,
    cptProcedures: ['97110x2'],
    group: false,
    ratio: '1:1',
    school: '',
    ...partial,
  };
}

function bedrockRead(snippet: string, facts: Record<string, unknown>) {
  return async (prompt: string) => {
    expect(prompt).toContain('Read with other AI');
    expect(prompt).toContain(snippet);
    expect(prompt).not.toMatch(/api\.openai\.com/i);
    return JSON.stringify(facts);
  };
}

function seedWeek(store: MemoryStore, providerId: string) {
  return store.upsertWeek({
    id: newId(),
    providerId,
    weekStart: weekStartFromDos(DOS),
    schoolId: '',
    programType: 'School',
    status: 'draft',
    signerName: '',
    signerEmail: '',
    timesheetKey: '',
    signedKey: '',
    envelopeId: '',
    hhaStatus: 'none',
  });
}

describe('Luna dispute conversation', () => {
  it('explains a known block and does not say the error is wrong', async () => {
    const known = [
      "Maya Lopez — 9/1/2026: School 'PS 1' does not match child's school 'PS 2'.",
      'CPT units (97110x1) cover 15 min but session is 30 min (need 2 unit(s)).',
      'Session is not signed — each attended/makeup session needs a signature.',
      'Mandate allows 2 session(s) per week; this upload would make it 3.',
      'Makeup-Weekly is full for this week (2 of 2).',
      'Group-mandate child seen individually — note must say no peer was available.',
      'Notes look copy-pasted from Ana (same as Ana on 9/1/2026).',
      'Select a notes PDF first.',
      'Provider in PDF does not match your account (PDF: "Other").',
      'Service type is required.',
      'Session date 9/1/2026 is older than 14 days.',
      'Cannot add a group session overlapping Ana on 9/1/2026.',
    ];
    for (const error of known) {
      const row = explainBlockError(error);
      expect(row.matched).toBe(true);
      expect(row.why).not.toMatch(/does not have a more specific catalog entry/i);
    }
    const { store } = therapistStore();
    const mail = new MemoryMailer();
    const out = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/support/luna/explain',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body: { errors: [FREQUENCY_ERROR] },
      },
      { mail, readLunaNote: async () => { throw new Error('explain must not read'); } },
    );
    const body = out.body as { reply: string; approved: boolean; pending: boolean };
    expect(body.approved).toBe(false);
    expect(body.pending).toBe(false);
    expect(body.reply).toMatch(/mandate/i);
    expect(body.reply).not.toMatch(/report the error|report that|wrongly flagged|^Yes\./i);
    expect(store.data.sessions).toEqual([]);
    expect(mail.sent).toEqual([]);
  });

  it('stops when the therapist clicks No and does not treat a typed yes as Luna deciding', async () => {
    const { store } = therapistStore();
    const no = dispute(store, [FREQUENCY_ERROR], GROUP_NOTE, '', async () => { throw new Error('no read'); }, undefined, {
      stage: 'explained',
      pdf: false,
      choice: 'no',
    });
    const noBody = (await no.res).body as { reply: string; stage: string; pending: boolean; approved: boolean };
    expect(noBody.reply).toBe(LUNA_OKAY);
    expect(noBody.stage).toBe('closed');
    expect(noBody.pending).toBe(false);
    expect(noBody.approved).toBe(false);
    expect(no.mail.sent).toEqual([]);
    expect(store.data.sessions).toEqual([]);
    expect(store.data.blockReports || []).toEqual([]);

    const typed = dispute(store, [SIGNED_ERROR], SIGNED_INDIVIDUAL_NOTE, 'yes', async () => { throw new Error('no read'); }, undefined, {
      stage: 'explained',
      pdf: false,
    });
    const typedBody = (await typed.res).body as { reply: string; stage: string; buttons: boolean };
    expect(typedBody.reply).toBe(LUNA_FLAG_QUESTION);
    expect(typedBody.reply).not.toMatch(/^Yes\./);
    expect(typedBody.stage).toBe('explained');
    expect(typedBody.buttons).toBe(true);
    expect(typed.mail.sent).toEqual([]);

    const yes = dispute(store, [SIGNED_ERROR], SIGNED_INDIVIDUAL_NOTE, '', async () => { throw new Error('no read'); }, undefined, {
      stage: 'explained',
      pdf: false,
      choice: 'yes',
    });
    const yesBody = (await yes.res).body as { reply: string; stage: string };
    expect(yesBody.reply).toBe(LUNA_WHAT_WRONG);
    expect(yesBody.reply).not.toMatch(/^Yes/);
    expect(yesBody.stage).toBe('awaiting-part');
    expect(store.data.hhaTransfers).toEqual([]);
  });

  it('saves a group session when the fresh read classifies group and emails Moshe', async () => {
    const { store } = therapistStore();
    store.data.mandates[0]!.ratioGroup = true;
    const individualBlock =
      'Maya Lopez — 10/27/2026 9:00 am–9:30 am: Group-mandate child seen individually — note must say no peer was available.';
    const { mail, res } = dispute(
      store,
      [individualBlock],
      GROUP_NOTE,
      'This note is a group, not an individual visit',
      bedrockRead('97150x1', aiFacts({
        group: true,
        ratio: '3:1',
        cptCodes: ['97150'],
        cptUnits: 1,
        cptProcedures: ['97150x1'],
      })),
    );
    const body = (await res).body as { approved: boolean; pending: boolean; reply: string };
    expect(body.approved).toBe(true);
    expect(body.pending).toBe(false);
    expect(body.reply).toBe(`${LUNA_HOLD}\n\n${LUNA_UPLOADED}`);
    expect(store.data.sessions).toHaveLength(1);
    expect(sessionLooksGroup(store.data.sessions[0]?.serviceType || '')).toBe(true);
    expect(store.data.sessions[0]?.cptCodes).toEqual(['97150']);
    expect((store.data.blockReports || []).filter((row) => row.status === 'pending')).toEqual([]);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toEqual([MOSHE_OWNER_EMAIL]);
    expect(mail.sent[0]?.text).toContain(individualBlock);
    expect(mail.sent[0]?.text).toMatch(/group/i);
    expect(mail.sent[0]?.text).toMatch(/97150/);
    expect(mail.sent[0]?.text).toMatch(/\/file\?t=/);
    expect(mail.sent[0]?.to.join(' ')).not.toMatch(/bmarkowitz/i);
    expect(store.data.hhaTransfers).toEqual([]);
  });

  it('saves a signature misread and a CPT misread from the same fresh read', async () => {
    const { store } = therapistStore();
    const signed = dispute(
      store,
      [SIGNED_ERROR],
      SIGNED_INDIVIDUAL_NOTE,
      'The signature is on the PDF',
      bedrockRead('License# 1003072075', aiFacts()),
    );
    const signedBody = (await signed.res).body as { approved: boolean; pending: boolean; reply: string };
    expect(signedBody.approved).toBe(true);
    expect(signedBody.pending).toBe(false);
    expect(signedBody.reply).toContain(LUNA_UPLOADED);
    expect(store.data.sessions[0]?.attendance).toBe('attended');
    expect(signed.mail.sent[0]?.to).toEqual([MOSHE_OWNER_EMAIL]);
    expect(signed.mail.sent[0]?.text).toContain('saved the session as signed');
    expect(signed.mail.sent[0]?.text).toContain('License# 1003072075');
    expect((store.data.blockReports || []).some((row) => row.status === 'pending')).toBe(false);

    const { store: cptStore } = therapistStore();
    cptStore.data.mandates[0]!.ratioGroup = true;
    const cpt = dispute(
      cptStore,
      [CPT_ERROR],
      GROUP_NOTE,
      'The CPT codes are already on the note',
      bedrockRead('97150x1', aiFacts({
        group: true,
        ratio: '3:1',
        cptCodes: ['97150'],
        cptUnits: 1,
        cptProcedures: ['97150x1'],
      })),
    );
    const cptBody = (await cpt.res).body as { approved: boolean; pending: boolean };
    expect(cptBody.approved).toBe(true);
    expect(cptBody.pending).toBe(false);
    expect(cptStore.data.sessions[0]?.cptCodes).toEqual(['97150']);
    expect(cpt.mail.sent[0]?.to).toEqual([MOSHE_OWNER_EMAIL]);
    expect(cpt.mail.sent[0]?.text).toContain('97150');
    expect((cptStore.data.blockReports || []).some((row) => row.status === 'pending')).toBe(false);
    expect(store.data.hhaTransfers).toEqual([]);
  });

  it('saves a makeup the AI found and uses that missed-session slot', async () => {
    const { store, provider } = therapistStore();
    const week = seedWeek(store, provider.id);
    const missedId = newId();
    store.upsertSession({
      id: missedId,
      weekId: week.id,
      studentId: store.data.students[0]!.id,
      dateOfService: '10/15/2026',
      beginTime: '',
      endTime: '',
      attendance: 'missed',
      cancelReason: 'Student Absence',
      makeupOfSessionId: '',
      serviceType: 'Physical Therapy 1:1',
      location: '',
      notes: 'Student Absence',
      cptCodes: [],
      cptUnits: 0,
      cptLabel: '',
      aiFlags: [],
      aiBlock: false,
    });
    const { mail, res } = dispute(
      store,
      [FREQUENCY_ERROR],
      MAKEUP_FRESH,
      'This was a makeup, not an extra visit',
      bedrockRead('makeup for 10/15/2026', aiFacts({
        attendance: 'makeup',
        makeupFor: '10/15/2026',
      })),
    );
    const body = (await res).body as { approved: boolean; pending: boolean; reply: string };
    expect(body.approved).toBe(true);
    expect(body.pending).toBe(false);
    expect(body.reply).toBe(`${LUNA_HOLD}\n\n${LUNA_UPLOADED}`);
    const saved = store.data.sessions.find((row) => row.attendance === 'makeup');
    expect(saved?.makeupOfSessionId).toBe(missedId);
    expect(saved?.notes).toMatch(/makeup for 10\/15\/2026/i);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toEqual([MOSHE_OWNER_EMAIL]);
    expect(mail.sent[0]?.text).toContain(FREQUENCY_ERROR);
    expect(mail.sent[0]?.text).toMatch(/makeup/i);
    expect((store.data.blockReports || []).some((row) => row.status === 'pending')).toBe(false);
    expect(store.data.hhaTransfers).toEqual([]);
  });

  it('sends a real school mismatch or a real extra visit to Billu and does not email Moshe', async () => {
    const { store, provider } = therapistStore();
    const schoolId = newId();
    store.upsertSchool({
      id: schoolId,
      name: 'Trinity School',
      district: '',
      signerName: '',
      signerEmail: '',
      createdAt: nowIso(),
    });
    store.data.students[0]!.schoolId = schoolId;
    const school = dispute(
      store,
      [SCHOOL_ERROR],
      SCHOOL_NOTE_FRESH,
      'The school on the PDF is the right one',
      bedrockRead('Westbrook School', aiFacts({ school: 'Westbrook School' })),
      async (prompt) => {
        expect(prompt).toContain('The school on the PDF is the right one');
        return 'The note names a different school. This is a school mismatch.';
      },
    );
    const schoolBody = (await school.res).body as { approved: boolean; pending: boolean; reply: string };
    expect(schoolBody.approved).toBe(false);
    expect(schoolBody.pending).toBe(true);
    expect(schoolBody.reply).toBe(`${LUNA_HOLD}\n\n${LUNA_PENDING}`);
    expect(store.data.sessions).toEqual([]);
    expect(store.data.blockReports.filter((row) => row.status === 'pending')).toHaveLength(1);
    expect(school.mail.sent[0]?.to).toEqual([BILLU_TICKET_EMAIL]);
    expect(school.mail.sent[0]?.text).toContain('The school on the PDF is the right one');
    expect(school.mail.sent.map((row) => row.to.join(' ')).join(' ')).not.toContain(MOSHE_OWNER_EMAIL);

    const { store: extraStore, provider: extraProvider } = therapistStore();
    const week = seedWeek(extraStore, extraProvider.id);
    const studentId = extraStore.data.students[0]!.id;
    for (const begin of ['8:00 am', '8:30 am']) {
      extraStore.upsertSession({
        id: newId(),
        weekId: week.id,
        studentId,
        dateOfService: DOS,
        beginTime: begin,
        endTime: begin === '8:00 am' ? '8:30 am' : '9:00 am',
        attendance: 'attended',
        cancelReason: '',
        makeupOfSessionId: '',
        serviceType: 'Physical Therapy 1:1',
        location: '',
        notes: 'earlier visit',
        cptCodes: ['97110'],
        cptUnits: 2,
        cptLabel: '97110x2',
        aiFlags: [],
        aiBlock: false,
      });
    }
    const extra = dispute(
      extraStore,
      [FREQUENCY_ERROR],
      EXTRA_NOTE,
      'I am allowed an extra visit this week',
      bedrockRead('1:00 pm', aiFacts({ beginTime: '1:00 pm', endTime: '1:30 pm' })),
      async () => 'This is another attended visit. The weekly allowance is already full.',
    );
    const extraBody = (await extra.res).body as { approved: boolean; pending: boolean; reply: string };
    expect(extraBody.approved).toBe(false);
    expect(extraBody.pending).toBe(true);
    expect(extraBody.reply).toContain(LUNA_PENDING);
    expect(extraStore.data.sessions).toHaveLength(2);
    expect(extra.mail.sent[0]?.to).toEqual([BILLU_TICKET_EMAIL]);
    expect(extra.mail.sent.map((row) => row.to.join(' ')).join(' ')).not.toContain(MOSHE_OWNER_EMAIL);
    expect(extraStore.data.hhaTransfers).toEqual([]);
    expect(provider.id).toBeTruthy();
  });

  it('does not upload or pend when the PDF is missing or cannot be read', async () => {
    const { store } = therapistStore();
    const missing = dispute(store, [SIGNED_ERROR], SIGNED_INDIVIDUAL_NOTE, 'The signature is on the PDF', async () => {
      throw new Error('should not read');
    }, undefined, { pdf: false });
    const missingBody = (await missing.res).body as { reply: string; pending: boolean; approved: boolean };
    expect(missingBody.reply).toBe(LUNA_CHOOSE_PDF);
    expect(missingBody.approved).toBe(false);
    expect(missingBody.pending).toBe(false);

    const unread = dispute(store, [SIGNED_ERROR], 'this is not a notes report', 'The signature is on the PDF', async () => {
      throw new Error('should not read');
    });
    const unreadBody = (await unread.res).body as { reply: string; pending: boolean; approved: boolean };
    expect(unreadBody.reply).toBe(LUNA_UNREADABLE);
    expect(unreadBody.approved).toBe(false);
    expect(unreadBody.pending).toBe(false);
    expect(store.data.sessions).toEqual([]);
    expect(unread.mail.sent).toEqual([]);
    expect(store.data.hhaTransfers).toEqual([]);
  });
});
