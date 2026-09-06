import { describe, expect, it } from 'vitest';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import { MemoryMailer } from './mail.js';
import {
  collectHhaFailuresForDay,
  easternDateYmd,
  formatHhaErrorDigestEmail,
  runHhaErrorDigest,
} from './hha-error-digest.js';

describe('hha-error-digest', () => {
  it('formats eastern YYYY-MM-DD', () => {
    // 2026-09-04 22:00 UTC = still Sep 4 evening Eastern
    expect(easternDateYmd(new Date('2026-09-04T22:00:00Z'))).toBe('2026-09-04');
  });

  it('skips email when no failures that day', async () => {
    const store = new MemoryStore();
    const mail = new MemoryMailer();
    const out = await runHhaErrorDigest(store, mail, new Date('2026-09-04T22:00:00Z'));
    expect(out.emailed).toBe(false);
    expect(out.skippedReason).toBe('no_failures');
    expect(mail.sent).toHaveLength(0);
  });

  it('emails digest with provider/child/week/error and retry link', async () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Pat',
      lastName: 'Lee',
      discipline: 'OT',
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
      firstName: 'Sam',
      lastName: 'Kid',
      dob: '',
      programId: '99',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-08-31',
      status: 'locked',
      signerName: 'P',
      signerEmail: 'p@s.test',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'failed',
      hhaError: 'Missing pay code OT72',
    });
    const session = store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '2026-09-01',
      beginTime: '09:00',
      endTime: '09:30',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'OT',
      location: 'School',
      notes: '',
      aiFlags: [],
    });
    store.upsertTransfer({
      id: newId(),
      sessionId: session.id,
      weekId: week.id,
      status: 'failed',
      hhaVisitId: '',
      lastError: 'Missing pay code: HHA has no pay code named "OT72"',
      payloadHash: 'x',
      updatedAt: '2026-09-04T18:00:00.000Z',
    });

    const mail = new MemoryMailer();
    process.env.TMS_SPA_ORIGIN = 'https://wgfront.netlify.app';
    process.env.TMS_HHA_ERROR_EMAIL = 'mgluck@whiteglovecare.net';
    const out = await runHhaErrorDigest(store, mail, new Date('2026-09-04T22:00:00Z'));
    expect(out.emailed).toBe(true);
    expect(out.failures).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toEqual(['mgluck@whiteglovecare.net']);
    expect(mail.sent[0].subject).toBe('HHA errors for 2026-09-04');
    expect(mail.sent[0].text).toContain('Pat Lee');
    expect(mail.sent[0].text).toContain('Sam Kid');
    expect(mail.sent[0].text).toContain('OT72');
    expect(mail.sent[0].text).toContain(`hhaWeek=${week.id}`);
    expect(mail.sent[0].text).toContain('Send to HHA');
  });

  it('collects CreatePatient-style failures via audit when transfer lacks updatedAt', () => {
    const store = new MemoryStore();
    const provider = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'A',
      lastName: 'B',
      discipline: 'PT',
      payRatePerHour: 70,
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
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-08-31',
      status: 'locked',
      signerName: '',
      signerEmail: '',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'failed',
      hhaError: 'CreatePatient FAILED â€” missing required field(s): DOB',
    });
    store.audit('admin', 'hha_transfer', `week:${week.id}`, null, {
      transferred: 0,
      errors: ['CreatePatient FAILED â€” missing required field(s): DOB'],
    });
    // Force audit timestamp onto the target Eastern day
    const last = store.data.audit[store.data.audit.length - 1]!;
    last.at = '2026-09-04T20:00:00.000Z';

    const failures = collectHhaFailuresForDay(store, '2026-09-04');
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures[0]?.error).toMatch(/CreatePatient/);
    const { subject, text } = formatHhaErrorDigestEmail('2026-09-04', failures);
    expect(subject).toBe('HHA errors for 2026-09-04');
    expect(text).toContain('Retry:');
  });
});
