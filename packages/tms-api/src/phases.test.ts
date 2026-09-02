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
    store.upsertDueDate({
      id: 'd1',
      studentId: student.id,
      kind: 'progress',
      dueOn: '2001-01-01',
      completedAt: '',
      lastNagOn: '',
    });
    const mail = new MemoryMailer();
    const first = await runDueNags(store, mail, new Date('2026-09-01T12:00:00Z'));
    expect(first.nagged).toBe(1);
    expect(mail.sent.length).toBe(1);
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
      payRate: 72,
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
    expect(mail.sent.some((m) => /will be paid/i.test(m.text))).toBe(true);
    expect(envelopeCompleted({ event: 'completed', envelopeId: 'x' }).completed).toBe(true);
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
});
