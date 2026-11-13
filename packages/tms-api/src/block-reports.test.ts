import { describe, expect, it } from 'vitest';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import { MemoryMailer } from './mail.js';
import { handleTmsRequest } from './router.js';
import { explainBlockError } from './luna-knowledge.js';
import { lunaSupportEmail, sendLunaHandoff } from './luna.js';
import {
  allowBlockReport,
  BILLU_TICKET_EMAIL,
  blockReportPdfKey,
  blockReportPdfUrl,
  blockReportPublic,
  buildBilluBlockReportEmail,
  buildMosheOverrideEmail,
  buildPendingBlockReport,
  declineBlockReport,
  MOSHE_OWNER_EMAIL,
  NO_THERAPIST_REPORT_PDF,
  normalizeBilluNote,
  normalizeTherapistMessage,
  notesPdfBytes,
  polishBlockReportExplanation,
  withReportPdf,
  type BlockReportFileStore,
} from './block-reports.js';

process.env.TMS_ALLOW_DEV_HEADERS = '1';

const sampleErrors = [
  "Maya Lopez — 9/1/2026 9:00–9:30: School 'PS 1' does not match child's school 'PS 2'.",
];

function pendingReport() {
  return buildPendingBlockReport({
    id: 'rep-1',
    createdAt: '2026-10-28T00:00:00.000Z',
    providerId: 'prov-1',
    providerName: 'Pat Lee',
    therapistUserId: 'user-1',
    therapistName: 'Pat Lee',
    therapistEmail: 'pat@example.com',
    therapistMessage: 'The district header is the school on file.',
    errors: sampleErrors,
    fileName: 'notes.pdf',
    pendingText: 'Student Name: Maya Lopez\nDate: 9/1/2026',
    aiExplanation: 'Row for Maya on 9/1 was blocked because the PDF school did not match PS 2.',
    aiExplanationStatus: 'ok',
  });
}

describe('incorrect-error reports', () => {
  it('cannot be filed without a therapist message', () => {
    expect(() => normalizeTherapistMessage('   ')).toThrow(/message/i);
    expect(() =>
      buildPendingBlockReport({
        ...pendingReport(),
        therapistMessage: '',
      }),
    ).toThrow(/message/i);
  });

  it('cannot be allowed without Billu’s note', () => {
    expect(() => normalizeBilluNote('  ')).toThrow(/note/i);
    expect(() =>
      allowBlockReport(pendingReport(), {
        note: '',
        actorId: 'admin-1',
        actorName: 'Billu Markowitz',
        actorEmail: BILLU_TICKET_EMAIL,
        at: '2026-10-28T01:00:00.000Z',
      }),
    ).toThrow(/note/i);
  });

  it('records both notes and the overridden error', () => {
    const allowed = allowBlockReport(pendingReport(), {
      note: 'The PDF district header is the child’s school, so the mismatch rule was wrong.',
      actorId: 'admin-1',
      actorName: 'Billu Markowitz',
      actorEmail: BILLU_TICKET_EMAIL,
      at: '2026-10-28T01:00:00.000Z',
    });
    expect(allowed.status).toBe('allowed');
    expect(allowed.therapistMessage).toBe('The district header is the school on file.');
    expect(allowed.billuNote).toMatch(/mismatch rule was wrong/);
    expect(allowed.errors).toEqual(sampleErrors);
    expect(allowed.decidedByName).toBe('Billu Markowitz');
    const letter = buildMosheOverrideEmail(allowed);
    expect(letter.to).toEqual([MOSHE_OWNER_EMAIL]);
    expect(letter.to.join(' ')).not.toMatch(/bmarkowitz|miris@/i);
    expect(letter.text).toContain(allowed.therapistMessage);
    expect(letter.text).toContain(allowed.billuNote);
    expect(letter.text).toContain(sampleErrors[0]);
    expect(letter.text).toMatch(/Maya Lopez/);
    expect(letter.text).toMatch(/Pat Lee/);
  });

  it('does not email Billu until a report with a message exists', () => {
    const letter = buildBilluBlockReportEmail(pendingReport());
    expect(letter.to).toEqual([BILLU_TICKET_EMAIL]);
    expect(letter.text).toContain('The district header is the school on file.');
    expect(letter.text).toContain(sampleErrors[0]);
    expect(letter.text).toContain('Row for Maya');
    expect(letter.text).toMatch(/has not been sent to HHA/i);
  });

  it('stores the explanation, and a Bedrock failure still accepts the report', async () => {
    const ok = await polishBlockReportExplanation(
      {
        errors: sampleErrors,
        therapistMessage: 'The school is right.',
        providerName: 'Pat Lee',
        childSummary: 'Maya Lopez',
        dateSummary: '9/1/2026',
      },
      async () => 'Maya’s 9/1 row was blocked on a school mismatch. It would be valid if PS 1 were her school.',
    );
    expect(ok.aiExplanationStatus).toBe('ok');
    expect(ok.aiExplanation).toMatch(/school mismatch/);
    const failed = await polishBlockReportExplanation(
      {
        errors: sampleErrors,
        therapistMessage: 'The school is right.',
        providerName: 'Pat Lee',
        childSummary: 'Maya Lopez',
        dateSummary: '9/1/2026',
      },
      async () => {
        throw new Error('bedrock down');
      },
    );
    expect(failed.aiExplanationStatus).toBe('unavailable');
    expect(failed.aiExplanation).toMatch(/could not be generated/i);
    const report = buildPendingBlockReport({
      ...pendingReport(),
      therapistMessage: 'The school is right.',
      aiExplanation: failed.aiExplanation,
      aiExplanationStatus: failed.aiExplanationStatus,
    });
    expect(report.aiExplanation).toMatch(/could not be generated/i);
    expect(report.therapistMessage).toBe('The school is right.');
    expect(report.status).toBe('pending');
    const letter = buildBilluBlockReportEmail(report);
    expect(letter.text).toContain(report.therapistMessage);
    expect(letter.text).toContain(sampleErrors[0]);
    expect(letter.text).toMatch(/could not be generated/i);
  });

  it('does not send a second override notice', () => {
    const allowed = allowBlockReport(pendingReport(), {
      note: 'The block compared the wrong header.',
      actorId: 'admin-1',
      actorName: 'Billu Markowitz',
      actorEmail: BILLU_TICKET_EMAIL,
      at: '2026-10-28T01:00:00.000Z',
    });
    const once = { ...allowed, overrideNotifiedAt: '2026-10-28T01:01:00.000Z', importedAt: '2026-10-28T01:00:30.000Z' };
    const again = allowBlockReport(once, {
      note: 'A different note that must not resend.',
      actorId: 'admin-1',
      actorName: 'Billu Markowitz',
      actorEmail: BILLU_TICKET_EMAIL,
      at: '2026-10-28T02:00:00.000Z',
    });
    expect(again).toBe(once);
    expect(again.overrideNotifiedAt).toBe('2026-10-28T01:01:00.000Z');
    expect(again.billuNote).toBe('The block compared the wrong header.');
  });

  it('exposes a stored PDF reference in the report and in the approval email', () => {
    expect(notesPdfBytes('Select a notes PDF first.')).toBeNull();
    expect(notesPdfBytes('')).toBeNull();
    const pdf = Buffer.from('%PDF-1.4\ntherapist notes\n%%EOF');
    expect(notesPdfBytes(pdf.toString('base64'))?.subarray(0, 5).toString()).toBe('%PDF-');
    const stored = withReportPdf(pendingReport(), {
      pdfKey: blockReportPdfKey('rep-1'),
      pdfToken: 'email-token-value',
    });
    expect(stored.pdfKey).toBe('tms/block-reports/rep-1.pdf');
    const published = blockReportPublic(stored);
    expect(published.pdfKey).toBe(stored.pdfKey);
    expect(published).not.toHaveProperty('pdfToken');
    expect(JSON.stringify(published)).not.toContain('email-token-value');
    expect(JSON.stringify(published)).not.toContain('%PDF');
    const savedOrigin = process.env.TMS_SPA_ORIGIN;
    process.env.TMS_SPA_ORIGIN = 'https://tms.whiteglovecare.net/api';
    const url = blockReportPdfUrl(stored);
    expect(url).toBe(
      'https://tms.whiteglovecare.net/api/block-reports/rep-1/file?t=email-token-value',
    );
    const billu = buildBilluBlockReportEmail(stored);
    expect(billu.text).toContain("Therapist's report PDF (notes.pdf)");
    expect(billu.text).toContain(url);
    expect(billu.text).not.toContain('%PDF');
    const allowed = allowBlockReport(stored, {
      note: 'The PDF district header is the child’s school, so the mismatch rule was wrong.',
      actorId: 'admin-1',
      actorName: 'Billu Markowitz',
      actorEmail: BILLU_TICKET_EMAIL,
      at: '2026-10-28T01:00:00.000Z',
    });
    const moshe = buildMosheOverrideEmail(allowed);
    expect(moshe.to).toEqual([MOSHE_OWNER_EMAIL]);
    expect(moshe.text).toContain(url);
    expect(moshe.text).toContain(allowed.therapistMessage);
    expect(moshe.text).toContain(allowed.billuNote);
    expect(moshe.text).toContain(sampleErrors[0]);
    expect(moshe.text).not.toContain('%PDF');
    delete process.env.TMS_SPA_ORIGIN;
    const savedCors = process.env.TMS_CORS_ORIGIN;
    delete process.env.TMS_CORS_ORIGIN;
    expect(blockReportPdfUrl(stored).startsWith('https://tms.whiteglovecare.net/api/block-reports/')).toBe(
      true,
    );
    if (savedOrigin === undefined) delete process.env.TMS_SPA_ORIGIN;
    else process.env.TMS_SPA_ORIGIN = savedOrigin;
    if (savedCors === undefined) delete process.env.TMS_CORS_ORIGIN;
    else process.env.TMS_CORS_ORIGIN = savedCors;
    expect(blockReportPublic(allowed).pdfKey).toBe(stored.pdfKey);
    const bareBillu = buildBilluBlockReportEmail(pendingReport());
    const bareMoshe = buildMosheOverrideEmail(
      allowBlockReport(pendingReport(), {
        note: 'No file was part of this block.',
        actorId: 'admin-1',
        actorName: 'Billu Markowitz',
        actorEmail: BILLU_TICKET_EMAIL,
        at: '2026-10-28T01:00:00.000Z',
      }),
    );
    expect(bareBillu.text).toContain(NO_THERAPIST_REPORT_PDF);
    expect(bareMoshe.text).toContain(NO_THERAPIST_REPORT_PDF);
    expect(bareBillu.text).not.toMatch(/\/file\?t=/);
    expect(bareMoshe.text).not.toMatch(/\/file\?t=/);
  });

  it('decline keeps the upload blocked and shows Billu’s note', () => {
    const declined = declineBlockReport(pendingReport(), {
      note: 'The PDF school really is different.',
      actorId: 'admin-1',
      actorName: 'Billu Markowitz',
      actorEmail: BILLU_TICKET_EMAIL,
      at: '2026-10-28T01:00:00.000Z',
    });
    expect(declined.status).toBe('declined');
    expect(declined.billuNote).toMatch(/really is different/);
    expect(declined.importedAt).toBe('');
  });
});

describe('support ticket recipient', () => {
  it('sends tickets to Billu, not the old inbox', async () => {
    const previous = process.env.LUNA_SUPPORT_EMAIL;
    process.env.LUNA_SUPPORT_EMAIL = 'moshe@advancedautomations.net';
    expect(lunaSupportEmail()).toBe(BILLU_TICKET_EMAIL);
    process.env.LUNA_SUPPORT_EMAIL = 'miris@whiteglovecare.net';
    expect(lunaSupportEmail()).toBe(BILLU_TICKET_EMAIL);
    const mail = new MemoryMailer();
    const sent = await sendLunaHandoff({
      mail,
      user: {
        id: 'u1',
        cognitoSub: 'sub',
        email: 'therapist@example.com',
        role: 'therapist',
        displayName: 'Pat Lee',
        providerId: 'p1',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      messages: [{ role: 'user', content: 'The upload is blocked.' }],
      summary: 'Upload block',
      pageUrl: 'https://tms.whiteglovecare.net/',
      contactName: 'Pat Lee',
      contactEmail: 'pat@example.com',
    });
    expect(sent.to).toBe(BILLU_TICKET_EMAIL);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toEqual([BILLU_TICKET_EMAIL]);
    expect(mail.sent[0]?.to.join(',')).not.toMatch(/moshe@advancedautomations\.net|miris@whiteglovecare\.net/);
    process.env.LUNA_SUPPORT_EMAIL = previous;
  });
});

describe('luna block explanations', () => {
  it('explains school, CPT, mandate, signature, and HHA blocks', () => {
    expect(explainBlockError("School 'PS 1' does not match child's school 'PS 2'.").why).toMatch(/school/i);
    expect(explainBlockError('CPT units (97110x1) cover 15 min but session is 30 min.').blocked).toMatch(/CPT/i);
    expect(explainBlockError('This exceeds the mandate for Maya.').title).toMatch(/mandate/i);
    expect(explainBlockError('Session is not signed — each attended session needs a signature.').why).toMatch(
      /signature/i,
    );
    expect(explainBlockError('CreateSchedule overlap (ErrorID=-310).').title).toMatch(/HHA/i);
  });

  it('explains a missing notes PDF without the generic catalog fallback', () => {
    for (const error of ['Select a notes PDF first.', 'select a notes pdf first', 'SELECT A NOTES PDF FIRST']) {
      const explained = explainBlockError(error);
      const text = [explained.title, explained.blocked, explained.why, explained.next].join(' ');
      expect(explained.matched).toBe(true);
      expect(text).toMatch(/no notes PDF was selected, so nothing was read/i);
      expect(text).toMatch(/choose the PDF, then upload again/i);
      expect(text).not.toMatch(/does not have a more specific catalog entry/i);
      expect(text).not.toMatch(/upload block|week block/i);
      expect(text).not.toMatch(/report the incorrect error|report an incorrect error/i);
    }
    const unknown = explainBlockError('Some brand new locker text the catalog has never seen.');
    expect(unknown.matched).toBe(false);
    expect(unknown.why).toMatch(/does not have a more specific catalog entry/i);
  });
});

function memoryFiles(): BlockReportFileStore & { saved: Map<string, Buffer> } {
  const saved = new Map<string, Buffer>();
  return {
    saved,
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
  const admin = store.upsertUser({
    id: newId(),
    cognitoSub: 'a',
    email: 'bmarkowitz@whiteglovecare.net',
    role: 'admin',
    displayName: 'Billu Markowitz',
    providerId: '',
    active: true,
    createdAt: nowIso(),
  });
  return { store, provider, admin };
}

describe('block report HTTP', () => {
  it('rejects an empty message and does not email Billu', async () => {
    const { store, provider } = therapistStore();
    const mail = new MemoryMailer();
    const res = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/block-reports',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body: {
          providerId: provider.id,
          message: '   ',
          errors: sampleErrors,
          pdfText: 'Student Name: Maya',
        },
      },
      { mail, explainBlockReport: async () => 'should not run' },
    );
    expect(res.status).toBe(400);
    expect(store.data.blockReports).toEqual([]);
    expect(mail.sent).toEqual([]);
  });

  it('stores the explanation when Bedrock fails and still emails the raw errors', async () => {
    const { store, provider } = therapistStore();
    const mail = new MemoryMailer();
    const res = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/block-reports',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body: {
          providerId: provider.id,
          message: 'The school on the PDF is correct.',
          errors: sampleErrors,
          pdfText: 'Student Name: Maya Lopez',
          fileName: 'notes.pdf',
        },
      },
      {
        mail,
        explainBlockReport: async () => {
          throw new Error('bedrock down');
        },
      },
    );
    expect(res.status).toBe(200);
    const body = res.body as { report: { aiExplanation: string; therapistMessage: string; status: string } };
    expect(body.report.status).toBe('pending');
    expect(body.report.therapistMessage).toBe('The school on the PDF is correct.');
    expect(body.report.aiExplanation).toMatch(/could not be generated/i);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toEqual([BILLU_TICKET_EMAIL]);
    expect(mail.sent[0]?.text).toContain(sampleErrors[0]);
    expect(mail.sent[0]?.text).toContain('The school on the PDF is correct.');
    expect(mail.sent[0]?.text).toMatch(/could not be generated/i);
    expect(store.data.sessions).toEqual([]);
  });

  it('bases Billu’s explanation on the notes PDF and still accepts the report if reading fails', async () => {
    const noteOnly = 'Westbrook Academy gym';
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const { store, provider } = therapistStore();
    const mail = new MemoryMailer();
    const ok = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/block-reports',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body: {
          providerId: provider.id,
          message: 'The school on the PDF is correct.',
          errors: sampleErrors,
          pdfText: `Student Name: Maya Lopez\nSchool: ${noteOnly}\nDate: 10/20/2026`,
          pdfBase64: pdf.toString('base64'),
          fileName: 'notes.pdf',
        },
      },
      {
        mail,
        blockReportFiles: memoryFiles(),
        explainBlockReport: async (prompt) => {
          if (!prompt.includes(noteOnly)) throw new Error('prompt missing note');
          return `The note names ${noteOnly} on 10/20/2026. The school line is what the rule compared.`;
        },
      },
    );
    expect(ok.status).toBe(200);
    const okBody = ok.body as { report: { aiExplanation: string; therapistMessage: string } };
    expect(okBody.report.therapistMessage).toBe('The school on the PDF is correct.');
    expect(okBody.report.aiExplanation).toContain(noteOnly);
    expect(mail.sent[0]?.text).toContain(noteOnly);
    expect(mail.sent[0]?.text).toContain('The school on the PDF is correct.');
    expect(mail.sent[0]?.text).not.toContain('%PDF');
    expect(store.data.sessions).toEqual([]);

    const failedMail = new MemoryMailer();
    const failed = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/block-reports',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body: {
          providerId: provider.id,
          message: 'Please look at the note.',
          errors: sampleErrors,
          pdfBase64: pdf.toString('base64'),
          fileName: 'notes.pdf',
        },
      },
      {
        mail: failedMail,
        blockReportFiles: memoryFiles(),
        explainBlockReport: async () => {
          throw new Error('bedrock down');
        },
      },
    );
    expect(failed.status).toBe(200);
    const failedBody = failed.body as { report: { aiExplanation: string; therapistMessage: string; status: string } };
    expect(failedBody.report.status).toBe('pending');
    expect(failedBody.report.therapistMessage).toBe('Please look at the note.');
    expect(failedBody.report.aiExplanation).toMatch(/could not be read/i);
    expect(failedMail.sent).toHaveLength(1);
    expect(failedMail.sent[0]?.to).toEqual([BILLU_TICKET_EMAIL]);
    expect(failedMail.sent[0]?.text).toContain(sampleErrors[0]);
    expect(failedMail.sent[0]?.text).toContain('Please look at the note.');
    expect(failedMail.sent[0]?.text).toMatch(/could not be read/i);
    expect(store.data.sessions).toEqual([]);
    expect(store.data.hhaTransfers).toEqual([]);
  });

  it('refuses an override with an empty note and does not email Moshe', async () => {
    const { store, provider, admin } = therapistStore();
    const report = pendingReport();
    report.providerId = provider.id;
    store.upsertBlockReport(report);
    const mail = new MemoryMailer();
    const res = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: `/block-reports/${report.id}/decision`,
        headers: { 'x-tms-role': 'admin', 'x-tms-email': admin.email },
        query: {},
        body: { action: 'allow', note: '   ' },
      },
      { mail },
    );
    expect(res.status).toBe(400);
    expect(store.data.blockReports[0]?.status).toBe('pending');
    expect(store.data.blockReports[0]?.billuNote).toBe('');
    expect(mail.sent).toEqual([]);
  });

  it('does not send a second owner email for an allowed report', async () => {
    const { store, provider, admin } = therapistStore();
    const report = pendingReport();
    report.providerId = provider.id;
    report.status = 'allowed';
    report.billuNote = 'Already allowed.';
    report.importedAt = '2026-10-28T01:00:00.000Z';
    report.overrideNotifiedAt = '2026-10-28T01:01:00.000Z';
    report.decidedByEmail = admin.email;
    store.upsertBlockReport(report);
    const mail = new MemoryMailer();
    const res = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: `/block-reports/${report.id}/decision`,
        headers: { 'x-tms-role': 'admin', 'x-tms-email': admin.email },
        query: {},
        body: { action: 'allow', note: 'Again' },
      },
      { mail },
    );
    expect(res.status).toBe(200);
    expect((res.body as { duplicate?: boolean }).duplicate).toBe(true);
    expect(mail.sent).toEqual([]);
    expect(store.data.blockReports[0]?.billuNote).toBe('Already allowed.');
  });

  it('stores a notes PDF reference and puts that link in the approval email', async () => {
    const { store, provider, admin } = therapistStore();
    const files = memoryFiles();
    const mail = new MemoryMailer();
    const pdf = Buffer.from('%PDF-1.4\ntherapist notes\n%%EOF');
    const filed = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/block-reports',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body: {
          providerId: provider.id,
          message: 'The school on the PDF is correct.',
          errors: sampleErrors,
          pdfText: 'Student Name: Maya Lopez',
          fileName: 'notes.pdf',
          pdfBase64: pdf.toString('base64'),
        },
      },
      { mail, blockReportFiles: files, explainBlockReport: async () => 'Maya was blocked on the school line.' },
    );
    expect(filed.status).toBe(200);
    const filedBody = filed.body as { report: { id: string; pdfKey: string; pdfToken?: string } };
    expect(filedBody.report.pdfKey).toMatch(/^tms\/block-reports\/.+\.pdf$/);
    expect(filedBody.report.pdfToken).toBeUndefined();
    expect(JSON.stringify(filed.body)).not.toContain('%PDF');
    expect(files.saved.get(filedBody.report.pdfKey)?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toEqual([BILLU_TICKET_EMAIL]);
    expect(mail.sent[0]?.text).toContain("Therapist's report PDF (notes.pdf)");
    expect(mail.sent[0]?.text).toContain(`/api/block-reports/${filedBody.report.id}/file?t=`);
    expect(mail.sent[0]?.text).not.toContain(pdf.toString('base64'));
    expect(store.data.sessions).toEqual([]);

    const stored = store.data.blockReports[0];
    expect(stored?.pdfKey).toBe(filedBody.report.pdfKey);
    expect(stored?.pdfToken).toBeTruthy();
    stored!.importedAt = '2026-10-28T01:00:00.000Z';
    store.upsertBlockReport(stored!);
    const note = 'The PDF district header is the child’s school, so the mismatch rule was wrong.';
    const approved = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: `/block-reports/${stored!.id}/decision`,
        headers: { 'x-tms-role': 'admin', 'x-tms-email': admin.email },
        query: {},
        body: { action: 'allow', note },
      },
      { mail, blockReportFiles: files },
    );
    expect(approved.status).toBe(200);
    const approvedBody = approved.body as { report: { pdfKey: string; status: string; pdfToken?: string } };
    expect(approvedBody.report.status).toBe('allowed');
    expect(approvedBody.report.pdfKey).toBe(stored!.pdfKey);
    expect(approvedBody.report.pdfToken).toBeUndefined();
    expect(JSON.stringify(approved.body)).not.toContain(stored!.pdfToken);
    const owner = mail.sent.find((letter) => letter.to.includes(MOSHE_OWNER_EMAIL));
    expect(owner?.text).toContain(blockReportPdfUrl(stored!));
    expect(owner?.text).toContain('The school on the PDF is correct.');
    expect(owner?.text).toContain(note);
    expect(owner?.text).toContain(sampleErrors[0]);
    expect(owner?.text).not.toContain('%PDF');
    expect(store.data.sessions).toEqual([]);

    const fromAdmin = await handleTmsRequest(
      store,
      {
        method: 'GET',
        path: `/block-reports/${stored!.id}/file`,
        headers: { 'x-tms-role': 'admin', 'x-tms-email': admin.email },
        query: {},
        body: {},
      },
      { blockReportFiles: files },
    );
    expect(fromAdmin.status).toBe(200);
    expect(Buffer.isBuffer(fromAdmin.body)).toBe(true);
    expect((fromAdmin.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const fromEmail = await handleTmsRequest(
      store,
      {
        method: 'GET',
        path: `/block-reports/${stored!.id}/file`,
        headers: {},
        query: { t: stored!.pdfToken },
        body: {},
      },
      { blockReportFiles: files },
    );
    expect(fromEmail.status).toBe(200);
    expect((fromEmail.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('says there is no PDF when the block had no file, and a decline does not email Moshe', async () => {
    const { store, provider, admin } = therapistStore();
    const files = memoryFiles();
    const mail = new MemoryMailer();
    const missing = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/block-reports',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body: {
          providerId: provider.id,
          message: 'This message is not about a file.',
          errors: ['Select a notes PDF first.'],
          pdfText: 'Select a notes PDF first.',
          pdfBase64: Buffer.from('Select a notes PDF first.').toString('base64'),
        },
      },
      { mail, blockReportFiles: files, explainBlockReport: async () => 'No notes PDF was selected.' },
    );
    expect(missing.status).toBe(200);
    const missingBody = missing.body as { report: { pdfKey: string } };
    expect(missingBody.report.pdfKey).toBe('');
    expect(files.saved.size).toBe(0);
    expect(mail.sent[0]?.text).toContain(NO_THERAPIST_REPORT_PDF);
    expect(mail.sent[0]?.text).not.toMatch(/\/file\?t=/);
    expect(mail.sent[0]?.to).toEqual([BILLU_TICKET_EMAIL]);

    const pdf = Buffer.from('%PDF-1.4\ndecline me\n%%EOF');
    const filed = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/block-reports',
        headers: { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' },
        query: {},
        body: {
          providerId: provider.id,
          message: 'Please look at the PDF before declining.',
          errors: sampleErrors,
          pdfText: 'Student Name: Maya Lopez',
          fileName: 'notes.pdf',
          pdfBase64: pdf.toString('base64'),
        },
      },
      { mail, blockReportFiles: files, explainBlockReport: async () => 'School mismatch.' },
    );
    expect(filed.status).toBe(200);
    const report = store.data.blockReports.find((row) => row.pdfKey);
    expect(report?.pdfKey).toBeTruthy();
    const declined = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: `/block-reports/${report!.id}/decision`,
        headers: { 'x-tms-role': 'admin', 'x-tms-email': admin.email },
        query: {},
        body: { action: 'decline', note: 'The PDF school really is different.' },
      },
      { mail, blockReportFiles: files },
    );
    expect(declined.status).toBe(200);
    expect((declined.body as { report: { status: string; pdfKey: string } }).report.status).toBe('declined');
    expect((declined.body as { report: { pdfKey: string } }).report.pdfKey).toBe(report!.pdfKey);
    expect(mail.sent.some((letter) => letter.to.includes(MOSHE_OWNER_EMAIL))).toBe(false);
    const stillThere = await handleTmsRequest(
      store,
      {
        method: 'GET',
        path: `/block-reports/${report!.id}/file`,
        headers: { 'x-tms-role': 'admin', 'x-tms-email': admin.email },
        query: {},
        body: {},
      },
      { blockReportFiles: files },
    );
    expect(stillThere.status).toBe(200);
    expect((stillThere.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
