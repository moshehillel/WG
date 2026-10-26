import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import { runDueNags } from './due-nags.js';
import { envelopeCompleted } from './esign.js';
import { MemoryMailer } from './mail.js';
import { extractPdfLatinText } from './pdf-text.js';
import { handleTmsRequest } from './router.js';
import { buildTimesheetPdf } from './timesheet.js';

process.env.TMS_ALLOW_DEV_HEADERS = '1';

describe('phase 2–3', () => {
  it('nags due dates until complete', async () => {
    const store = new MemoryStore();
    store.upsertUser({
      id: 'admin',
      cognitoSub: 'a',
      email: 'admin@whiteglove.local',
      role: 'admin',
      displayName: 'Admin',
      providerId: '',
      active: true,
      createdAt: nowIso(),
    });
    const school = store.upsertSchool({
      id: newId(),
      name: 'Shaw Avenue',
      district: '',
      signerName: '',
      signerEmail: '',
      createdAt: nowIso(),
    });
    store.upsertDueDate({
      id: 'd1',
      schoolId: school.id,
      kind: 'progress',
      dueOn: '2001-01-01',
      completedAt: '',
      lastNagOn: '',
    });
    const mail = new MemoryMailer();
    const first = await runDueNags(store, mail, new Date('2026-09-01T12:00:00Z'));
    expect(first.nagged).toBe(1);
    expect(mail.sent.length).toBe(1);
    expect(mail.sent[0]?.text).toMatch(/Shaw Avenue/);
    const second = await runDueNags(store, mail, new Date('2026-09-01T18:00:00Z'));
    expect(second.nagged).toBe(0);
  });

  it('locks the week from an e-sign webhook and emails the therapist', async () => {
    const store = new MemoryStore();
    const therapist = store.upsertUser({
      id: newId(),
      cognitoSub: 't',
      email: 'therapist@whiteglove.local',
      role: 'therapist',
      displayName: 'Pat',
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
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    store.upsertUser({ ...therapist, providerId: provider.id });
    const week = store.upsertWeek({
      id: 'week-1',
      providerId: provider.id,
      weekStart: '2026-08-31',
      status: 'submitted',
      signerName: 'Principal',
      signerEmail: 'p@school.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: 'env-99',
      hhaStatus: 'none',
    });
    const mail = new MemoryMailer();
    const hha = new MockHhaClient();
    const res = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/webhooks/esign',
        headers: {},
        query: {},
        body: { envelopeId: week.envelopeId, event: 'completed' },
      },
      { mail, hha },
    );
    expect(res.status).toBe(200);
    expect(store.data.weeks[0]?.status).toBe('locked');
    expect(mail.sent.some((m) => /signed and finalized/i.test(m.text))).toBe(true);
    expect(mail.sent.some((m) => /Payment will be processed accordingly/i.test(m.text))).toBe(true);
    expect(mail.sent.some((m) => m.subject === 'Timesheet signed and finalized')).toBe(true);
    expect(envelopeCompleted({ event: 'completed', envelopeId: 'x' }).completed).toBe(true);
  });

  it('accepts SignNow document_id on the query string (docid_queryparam)', async () => {
    const store = new MemoryStore();
    const week = store.upsertWeek({
      id: 'week-q',
      providerId: 'p1',
      weekStart: '2026-08-31',
      status: 'submitted',
      signerName: 'Principal',
      signerEmail: 'p@school.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: 'doc-query-1',
      hhaStatus: 'none',
    });
    const res = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/webhooks/esign',
        headers: {},
        query: { document_id: week.envelopeId },
        body: { meta: { event: 'document.complete' } },
      },
      { hha: new MockHhaClient() },
    );
    expect(res.status).toBe(200);
    expect(store.data.weeks[0]?.status).toBe('locked');
  });

  it('refuses to lock when solo-group #38 note is missing', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
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
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Aiden',
      lastName: 'Odne',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'PT School Group',
      discipline: 'PT',
      frequencyPerWeek: 2,
      ratioGroup: true,
      durationMinutes: 30,
      sourcePdfKey: '',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: 'week-lock-refuse',
      providerId: provider.id,
      weekStart: '2026-08-31',
      status: 'submitted',
      signerName: 'Principal',
      signerEmail: 'p@school.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: 'env-refuse-38',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-09-01',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: 'School',
      notes: 'Service Provided: gait only',
      aiFlags: [],
    });
    const res = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/webhooks/esign',
        headers: {},
        query: {},
        body: { envelopeId: week.envelopeId, event: 'completed' },
      },
      { hha: new MockHhaClient() },
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(
      /no peer was available|no partner available|seen individually/i,
    );
    expect(store.data.weeks.find((w) => w.id === week.id)?.status).toBe('submitted');
  });

  it('builds a PDF timesheet and extracts PDF text', () => {
    const pdf = buildTimesheetPdf({
      week: {
        id: 'w',
        providerId: 'p',
        weekStart: '2026-08-31',
        status: 'submitted',
        signerName: 'A',
        signerEmail: 'a@b.c',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      },
      providerLabel: 'Pat Lee',
      signerName: 'A',
      signerEmail: 'a@b.c',
      rows: [],
    });
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
    const extracted = extractPdfLatinText(Buffer.from(pdf));
    expect(extracted).toMatch(/Timesheet/);
  });

  it('stamps provider signature date on the timesheet PDF when provided', () => {
    const pdf = buildTimesheetPdf({
      week: {
        id: 'w',
        providerId: 'p',
        weekStart: '2026-08-31',
        status: 'submitted',
        signerName: 'A',
        signerEmail: 'a@b.c',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      },
      providerLabel: 'Pat Lee',
      signerName: 'A',
      signerEmail: 'a@b.c',
      providerSignDate: '09/09/2026',
      rows: [],
    });
    const extracted = extractPdfLatinText(Buffer.from(pdf));
    expect(extracted).toMatch(/Provider signature/);
    expect(extracted).toMatch(/09\/09\/2026/);
  });

  it('excludes missed sessions from the timesheet PDF but keeps attended and makeup', () => {
    const baseSession = {
      weekId: 'w',
      dateOfService: '09/01/2026',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      serviceType: 'OT Individual',
      location: 'School',
      notes: 'Worked on handwriting',
      cancelReason: '',
      makeupOfSessionId: '',
      aiFlags: [] as string[],
    };
    const pdf = buildTimesheetPdf({
      week: {
        id: 'w',
        providerId: 'p',
        weekStart: '2026-08-31',
        status: 'submitted',
        signerName: 'A',
        signerEmail: 'a@b.c',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      },
      providerLabel: 'Pat Lee',
      signerName: 'A',
      signerEmail: 'a@b.c',
      rows: [
        {
          session: { ...baseSession, id: 'att', attendance: 'attended', studentId: 'st-ava' },
          student: {
            id: 'st-ava',
            firstName: 'Ava',
            lastName: 'Nguyen',
            schoolId: '',
            dob: '',
            programId: '',
            programType: '',
            hhaPatientId: '',
            createdAt: nowIso(),
          },
          payAmount: 42.5,
        },
        {
          session: {
            ...baseSession,
            id: 'miss',
            attendance: 'missed',
            studentId: 'st-mia',
            notes: 'Student Absent',
            cancelReason: 'Student Absent',
          },
          student: {
            id: 'st-mia',
            firstName: 'Mia',
            lastName: 'Patel',
            schoolId: '',
            dob: '',
            programId: '',
            programType: '',
            hhaPatientId: '',
            createdAt: nowIso(),
          },
          payAmount: null,
        },
        {
          session: {
            ...baseSession,
            id: 'mu',
            attendance: 'makeup',
            studentId: 'st-noah',
            dateOfService: '09/03/2026',
            notes: 'Makeup session',
          },
          student: {
            id: 'st-noah',
            firstName: 'Noah',
            lastName: 'Kim',
            schoolId: '',
            dob: '',
            programId: '',
            programType: '',
            hhaPatientId: '',
            createdAt: nowIso(),
          },
          payAmount: 38,
        },
      ],
    });
    const extracted = extractPdfLatinText(Buffer.from(pdf));
    expect(extracted).toMatch(/Ava Nguyen/);
    expect(extracted).toMatch(/Noah Kim/);
    expect(extracted).toMatch(/attended/);
    expect(extracted).toMatch(/makeup/);
    expect(extracted).not.toMatch(/Mia Patel/);
    expect(extracted).not.toMatch(/missed/);
    expect(extracted).not.toMatch(/\bPay\b/);
    expect(extracted).not.toMatch(/\$42\.50/);
    expect(extracted).not.toMatch(/\$38/);
    expect(extracted).toMatch(/Powered by advancedautomations\.net/);
  });

  it('includes paid absences stored as missed and keeps unpaid misses off', () => {
    const baseSession = {
      weekId: 'w',
      dateOfService: '09/04/2026',
      beginTime: '9:15 am',
      endTime: '9:30 am',
      serviceType: 'Paid absence',
      location: '',
      notes: 'School closed',
      cancelReason: '',
      makeupOfSessionId: '',
      aiFlags: [] as string[],
    };
    const student = (id: string, firstName: string, lastName: string) => ({
      id,
      firstName,
      lastName,
      schoolId: '',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const pdf = buildTimesheetPdf({
      week: {
        id: 'w',
        providerId: 'p',
        weekStart: '2026-08-31',
        status: 'draft',
        signerName: 'A',
        signerEmail: 'a@b.c',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      },
      providerLabel: 'Pat Lee',
      signerName: 'A',
      signerEmail: 'a@b.c',
      rows: [
        {
          session: {
            ...baseSession,
            id: 'att',
            attendance: 'attended',
            studentId: 'st-ava',
            dateOfService: '09/01/2026',
            beginTime: '9:00 am',
            endTime: '9:30 am',
            serviceType: 'OT Individual',
            additionalServiceType: '',
            notes: 'Worked on handwriting',
          },
          student: student('st-ava', 'Ava', 'Nguyen'),
          payAmount: 42.5,
        },
        {
          session: {
            ...baseSession,
            id: 'paid-none',
            attendance: 'missed',
            studentId: '',
            additionalServiceType: 'paid_absence',
          },
          student: undefined,
          payAmount: 15,
        },
        {
          session: {
            ...baseSession,
            id: 'paid-child',
            attendance: 'missed',
            studentId: 'st-noah',
            dateOfService: '09/02/2026',
            beginTime: '10:00 am',
            endTime: '10:30 am',
            additionalServiceType: 'paid_absence',
            notes: 'Payable miss',
          },
          student: student('st-noah', 'Noah', 'Kim'),
          payAmount: 40,
        },
        {
          session: {
            ...baseSession,
            id: 'unpaid',
            attendance: 'missed',
            studentId: 'st-mia',
            serviceType: 'PT School',
            additionalServiceType: '',
            notes: 'Student Absent',
            cancelReason: 'Student Absence',
          },
          student: student('st-mia', 'Mia', 'Patel'),
          payAmount: 42.5,
        },
      ],
    });
    const extracted = extractPdfLatinText(Buffer.from(pdf));
    expect(extracted).toMatch(/Ava Nguyen/);
    expect(extracted).toMatch(/9:00 am/);
    expect(extracted).toMatch(/No child/);
    expect(extracted).toMatch(/09\/04\/2026/);
    expect(extracted).toMatch(/9:15 am/);
    expect(extracted).toMatch(/9:30 am/);
    expect(extracted).toMatch(/Noah Kim/);
    expect(extracted).toMatch(/09\/02\/2026/);
    expect(extracted).toMatch(/10:00 am/);
    expect(extracted).toMatch(/10:30 am/);
    expect(extracted).not.toMatch(/Additional: Paid absence/);
    expect(extracted).toMatch(/Paid absence/);
    expect(extracted).toMatch(/\$15\.00/);
    expect(extracted).toMatch(/\$40\.00/);
    expect(extracted).not.toMatch(/Mia Patel/);
    expect(extracted).not.toMatch(/Student Absent/);
    expect(extracted).not.toMatch(/\$42\.50/);
  });

  it('includes all additional service types on the timesheet PDF with regular sessions', () => {
    const therapy = {
      id: 'therapy',
      weekId: 'w',
      studentId: 'st-ava',
      dateOfService: '10/06/2026',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      attendance: 'attended' as const,
      serviceType: 'ST School',
      additionalServiceType: '' as const,
      location: 'School',
      notes: 'Articulation',
      cancelReason: '',
      makeupOfSessionId: '',
      aiFlags: [] as string[],
    };
    const addlTypes = [
      'eval',
      'progress_report',
      'consultation',
      'meetings',
      'documentation',
    ] as const;
    const addlRows = addlTypes.map((t, i) => ({
      session: {
        ...therapy,
        id: `addl-${t}`,
        studentId: '',
        beginTime: `${10 + i}:00 am`,
        endTime: `${10 + i}:30 am`,
        serviceType: t === 'progress_report' ? 'Progress report' : t[0]!.toUpperCase() + t.slice(1),
        additionalServiceType: t,
        notes: `Additional ${t}`,
        cptCodes: [] as string[],
        cptLabel: '',
      },
      student: undefined,
      payAmount: 55,
    }));
    const pdf = buildTimesheetPdf({
      week: {
        id: 'w',
        providerId: 'p',
        weekStart: '2026-10-05',
        status: 'draft',
        signerName: 'A',
        signerEmail: 'a@b.c',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      },
      providerLabel: 'Wiglishai Astacio',
      signerName: 'A',
      signerEmail: 'a@b.c',
      rows: [
        {
          session: therapy,
          student: {
            id: 'st-ava',
            firstName: 'Ava',
            lastName: 'Nguyen',
            schoolId: '',
            dob: '',
            programId: '',
            programType: '',
            hhaPatientId: '',
            createdAt: nowIso(),
          },
          payAmount: 42.5,
        },
        ...addlRows,
      ],
    });
    const extracted = extractPdfLatinText(Buffer.from(pdf));
    expect(extracted).toMatch(/Ava Nguyen/);
    expect(extracted).toMatch(/No child/);
    expect(extracted).toMatch(/Additional: Eval/);
    expect(extracted).toMatch(/Additional: Progress report/);
    expect(extracted).toMatch(/Additional: Consultation/);
    expect(extracted).toMatch(/Additional: Meetings/);
    expect(extracted).toMatch(/Additional: Documentation/);
    expect(extracted).not.toMatch(/Additional: Paid absence/);
  });

  it('orders timesheet rows by date of service, then begin time, then child name', () => {
    const week = {
      id: 'w',
      providerId: 'p',
      weekStart: '2026-10-05',
      status: 'draft' as const,
      signerName: 'Billu Markowitz',
      signerEmail: 'bmarkowitz@example.com',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none' as const,
    };
    const student = (id: string, firstName: string, lastName: string) => ({
      id,
      firstName,
      lastName,
      schoolId: '',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const session = (
      id: string,
      studentId: string,
      dateOfService: string,
      beginTime: string,
      extra: Record<string, string> = {},
    ) => ({
      id,
      weekId: 'w',
      studentId,
      dateOfService,
      beginTime,
      endTime: '3:00 pm',
      attendance: extra.attendance || 'attended',
      serviceType: extra.serviceType || 'PT School',
      additionalServiceType: extra.additionalServiceType || '',
      location: '',
      notes: extra.notes || 'Service Provided',
      cancelReason: extra.cancelReason || '',
      makeupOfSessionId: '',
      aiFlags: [] as string[],
    });
    const pdf = buildTimesheetPdf({
      week,
      providerLabel: 'Neelamben Patel',
      signerName: week.signerName,
      signerEmail: week.signerEmail,
      schoolDistrict: 'Elmont UFSD Therapy',
      rows: [
        {
          session: session('cy', 'st-cy', '10/08/2026', '10:10 am'),
          student: student('st-cy', 'Cy', 'Rutherford'),
        },
        {
          session: session('zara', 'st-zara', '10/07/2026', '9:10 am'),
          student: student('st-zara', 'Zara', 'Quinn'),
        },
        {
          session: session('anthony', 'st-anthony', '10/07/2026', '9:10 am'),
          student: student('st-anthony', 'Anthony', 'Duroseau'),
        },
        {
          session: session('michelle', 'st-michelle', '10/05/2026', '10:30 am'),
          student: student('st-michelle', 'Michelle', 'Benny'),
        },
        {
          session: session('amir', 'st-amir', '10/09/2026', '11:40 am'),
          student: student('st-amir', 'Amir', 'Darby'),
        },
        {
          session: session('gabrielle', 'st-gabrielle', '10/5/2026', '2:30 PM'),
          student: student('st-gabrielle', 'Gabrielle', 'Bogues'),
        },
        {
          session: session('paid', '', '10/06/2026', '8:00 am', {
            attendance: 'missed',
            additionalServiceType: 'paid_absence',
            serviceType: 'Paid absence',
            notes: 'School closed',
          }),
          student: undefined,
          payAmount: 20,
        },
        {
          session: session('unpaid', 'st-mia', '10/05/2026', '8:00 am', {
            attendance: 'missed',
            notes: 'Student Absent',
            cancelReason: 'Student Absent',
            serviceType: 'PT School',
          }),
          student: student('st-mia', 'Mia', 'Patel'),
        },
        {
          session: session('ayan', 'st-ayan', '10/06/2026', '1:00 pm'),
          student: student('st-ayan', 'Ayan', 'Keshwani'),
        },
      ],
    });
    const extracted = extractPdfLatinText(Buffer.from(pdf));
    const names = [
      'Michelle Benny',
      'Gabrielle Bogues',
      'No child',
      'Ayan Keshwani',
      'Anthony Duroseau',
      'Zara Quinn',
      'Cy Rutherford',
      'Amir Darby',
    ];
    const positions = names.map((name) => extracted.indexOf(name));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(extracted).not.toMatch(/Mia Patel/);
    expect(extracted).toMatch(/Paid absence/);
    expect(extracted).toMatch(/\$20\.00/);
  });

  it('merges selected weeks into one timesheet sorted by date of service then start time', async () => {
    const store = new MemoryStore();
    store.upsertProvider({
      id: 'p-merge',
      userId: '',
      firstName: 'Neelamben',
      lastName: 'Patel',
      discipline: 'PT',
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRatePerHour: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateEval: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    const student = (id: string, firstName: string, lastName: string) =>
      store.upsertStudent({
        id,
        schoolId: '',
        firstName,
        lastName,
        dob: '',
        programId: '',
        programType: 'Elmont UFSD Therapy',
        hhaPatientId: '',
        createdAt: nowIso(),
      });
    student('st-zara', 'Zara', 'Quinn');
    student('st-amir', 'Amir', 'Darby');
    student('st-cy', 'Cy', 'Rutherford');
    const week = (id: string, weekStart: string) =>
      store.upsertWeek({
        id,
        providerId: 'p-merge',
        weekStart,
        status: 'draft',
        signerName: 'Billu Markowitz',
        signerEmail: 'bmarkowitz@example.com',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      });
    week('w-later', '2026-10-05');
    week('w-earlier', '2026-09-28');
    const session = (
      id: string,
      weekId: string,
      studentId: string,
      dateOfService: string,
      beginTime: string,
      extra: Record<string, string> = {},
    ) =>
      store.upsertSession({
        id,
        weekId,
        studentId,
        dateOfService,
        beginTime,
        endTime: '3:00 pm',
        attendance: (extra.attendance as 'attended' | 'missed') || 'attended',
        serviceType: extra.serviceType || 'PT School',
        location: '',
        notes: extra.notes || 'Service Provided',
        cancelReason: extra.cancelReason || '',
        makeupOfSessionId: '',
        aiFlags: [],
      });
    session('zara', 'w-later', 'st-zara', '10/09/2026', '9:00 am');
    session('amir', 'w-earlier', 'st-amir', '10/01/2026', '10:00 am');
    session('cy', 'w-earlier', 'st-cy', '10/01/2026', '8:00 am');
    session('mia', 'w-later', 'st-zara', '10/02/2026', '8:00 am', {
      attendance: 'missed',
      notes: 'Student Absent',
      cancelReason: 'Student Absent',
    });
    const res = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/admin/weeks/timesheets/merge',
        headers: { 'x-tms-role': 'admin', 'x-tms-email': 'admin@whiteglove.local' },
        query: {},
        body: { weekIds: ['w-later', 'w-earlier', 'w-later'] },
      },
      { hha: new MockHhaClient() },
    );
    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    const extracted = extractPdfLatinText(res.body as Buffer);
    const names = ['Cy Rutherford', 'Amir Darby', 'Zara Quinn'];
    const positions = names.map((name) => extracted.indexOf(name));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(extracted).toMatch(/Neelamben Patel/);
    expect(extracted).toMatch(/2026-09-28 to 2026-10-05/);
    expect(extracted).toMatch(/Combined/);
    expect(extracted).not.toMatch(/Student Absent/);
    expect(store.data.weeks.map((w) => w.id).sort()).toEqual(['w-earlier', 'w-later']);
  });
});
