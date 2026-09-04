import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MockHhaClient } from '@white-glove/hha-client';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import { handleTmsRequest } from './router.js';

process.env.TMS_ALLOW_DEV_HEADERS = '1';

function storeWithTherapist() {
  const store = new MemoryStore();
  store.upsertUser({
    id: newId(),
    cognitoSub: 'a',
    email: 'admin@whiteglove.local',
    role: 'admin',
    displayName: 'Admin',
    providerId: '',
    active: true,
    createdAt: nowIso(),
  });
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
  store.upsertSchool({
    id: newId(),
    name: 'Westbury',
    district: 'Westbury',
    signerName: 'Principal Smith',
    signerEmail: 'principal@school.test',
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
    payRateAdditionalHourly: null,
    hhaCaregiverCode: 'WGC-1',
    active: true,
    createdAt: nowIso(),
  });
  store.upsertUser({ ...therapist, providerId: provider.id });
  return { store, provider };
}

const adminH = { 'x-tms-role': 'admin', 'x-tms-email': 'admin@whiteglove.local' };
const thH = { 'x-tms-role': 'therapist', 'x-tms-email': 'therapist@whiteglove.local' };

describe('TMS API weekly loop', () => {
  it('parses mandate PDF once, blocks over-mandate, makeup, lock, HHA', async () => {
    const { store, provider } = storeWithTherapist();
    const hha = new MockHhaClient();

    const parsed = await handleTmsRequest(
      store,
      {
        method: 'POST',
        path: '/admin/mandates/parse',
        headers: adminH,
        query: {},
        body: {
          pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 1x/week\nDOB: 07/12/2019`,
        },
      },
      { hha },
    );
    expect(parsed.status).toBe(200);
    const studentId = (parsed.body as { student: { id: string } }).student.id;

    const weekStart = '2026-08-31';
    const ensured = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/ensure',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart },
    });
    const weekId = (ensured.body as { week: { id: string } }).week.id;

    const missed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '08/31/2026',
        attendance: 'missed',
        cancelReason: 'Student Absent',
        notes: 'Student Absence',
        serviceType: 'PT School',
      },
    });
    expect(missed.status).toBe(200);

    const over = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/01/2026',
        attendance: 'attended',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Service Provided: balance work in gym',
        serviceType: 'PT School',
      },
    });
    expect(over.status).toBe(200);

    const over2 = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/02/2026',
        attendance: 'attended',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Service Provided: second visit',
        serviceType: 'PT School',
      },
    });
    expect(over2.status).toBe(400);

    const badMakeup = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/03/2026',
        attendance: 'makeup',
        notes: 'Make up session',
        serviceType: 'PT School',
      },
    });
    expect(badMakeup.status).toBe(400);

    const submit = await handleTmsRequest(store, {
      method: 'POST',
      path: `/weeks/${weekId}/submit`,
      headers: thH,
      query: {},
      body: {},
    });
    expect(submit.status).toBe(200);

    const sign = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/weeks/${weekId}/sign`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(sign.status).toBe(200);
    expect((sign.body as { week: { status: string }; therapistMessage: string }).week.status).toBe(
      'locked',
    );
    expect((sign.body as { therapistMessage: string }).therapistMessage).toMatch(/will be paid/i);

    const lockedEdit = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/04/2026',
        attendance: 'attended',
        notes: 'too late',
        serviceType: 'PT School',
      },
    });
    expect(lockedEdit.status).toBe(409);

    const hhaOut = await handleTmsRequest(
      store,
      { method: 'POST', path: `/weeks/${weekId}/hha`, headers: adminH, query: {}, body: {} },
      { hha },
    );
    expect(hhaOut.status).toBe(200);
    expect((hhaOut.body as { transferred: number }).transferred).toBeGreaterThan(0);
    expect(hha.calls.includes('locateOrScheduleVisit')).toBe(true);
    expect(hha.calls.includes('approveVisit')).toBe(true);
  });

  it('persists additionalServiceType and skips mandate for eval/consult', async () => {
    const { store, provider } = storeWithTherapist();
    const parsed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates/parse',
      headers: adminH,
      query: {},
      body: {
        pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 1x/week\nDOB: 07/12/2019`,
      },
    });
    const studentId = (parsed.body as { student: { id: string } }).student.id;
    const ensured = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/ensure',
      headers: thH,
      query: {},
      body: { weekStart: '2026-08-31', providerId: provider.id },
    });
    const weekId = (ensured.body as { week: { id: string } }).week.id;

    const caseload = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '08/31/2026',
        attendance: 'attended',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Service Provided: balance work in gym',
        serviceType: 'PT School',
      },
    });
    expect(caseload.status).toBe(200);

    const evalSession = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/01/2026',
        attendance: 'attended',
        beginTime: '10:00 am',
        endTime: '10:30 am',
        notes: 'Initial evaluation completed with caregiver present.',
        additionalServiceType: 'eval',
      },
    });
    expect(evalSession.status).toBe(200);
    const saved = (evalSession.body as { session: { additionalServiceType: string; serviceType: string } })
      .session;
    expect(saved.additionalServiceType).toBe('eval');
    expect(saved.serviceType).toBe('Eval');
  });

  it('lets admin create a therapist login', async () => {
    const { store } = storeWithTherapist();
    const res = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/users',
      headers: adminH,
      query: {},
      body: { email: 'newpt@whiteglove.local', role: 'therapist', displayName: 'New PT' },
    });
    expect(res.status).toBe(201);
  });

  it('creates therapist as provider in one call and links existing login by email', async () => {
    const { store } = storeWithTherapist();
    const created = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/therapists',
      headers: adminH,
      query: {},
      body: {
        email: 'one@whiteglove.local',
        firstName: 'One',
        lastName: 'Shot',
        discipline: 'OT',
        payRate: 75,
        hhaCaregiverCode: 'HHA1',
      },
    });
    expect(created.status).toBe(201);
    const body = created.body as {
      user: { id: string; email: string; providerId: string };
      provider: { id: string; userId: string; discipline: string; hhaCaregiverCode: string };
    };
    expect(body.user.email).toBe('one@whiteglove.local');
    expect(body.user.providerId).toBe(body.provider.id);
    expect(body.provider.userId).toBe(body.user.id);
    expect(body.provider.discipline).toBe('OT');
    expect(body.provider.hhaCaregiverCode).toBe('HHA1');

    const me = await handleTmsRequest(store, {
      method: 'GET',
      path: '/me',
      headers: {
        'x-tms-role': 'therapist',
        'x-tms-email': 'one@whiteglove.local',
        authorization: 'Bearer therapist',
      },
      query: {},
      body: {},
    });
    expect(me.status).toBe(200);
    expect((me.body as { provider: { id: string } }).provider.id).toBe(body.provider.id);

    store.upsertUser({
      id: 'orphan-u',
      cognitoSub: 'sub-orphan',
      email: 'orphan@whiteglove.local',
      role: 'therapist',
      displayName: 'Orphan',
      providerId: '',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const linked = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/therapists',
      headers: adminH,
      query: {},
      body: { email: 'orphan@whiteglove.local', firstName: 'Or', lastName: 'Phan', discipline: 'SLP' },
    });
    expect(linked.status).toBe(200);
    const linkedBody = linked.body as {
      user: { id: string; providerId: string };
      provider: { id: string; userId: string; discipline: string };
    };
    expect(linkedBody.user.id).toBe('orphan-u');
    expect(linkedBody.user.providerId).toBe(linkedBody.provider.id);
    expect(linkedBody.provider.userId).toBe('orphan-u');
    expect(linkedBody.provider.discipline).toBe('SLP');
  });

  it('lists admin weeks and links provider email to a login', async () => {
    const { store, provider } = storeWithTherapist();
    const weekStart = '2026-08-31';
    const ensured = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/ensure',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart },
    });
    const weekId = (ensured.body as { week: { id: string } }).week.id;
    const listed = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/weeks',
      headers: adminH,
      query: {},
      body: {},
    });
    expect(listed.status).toBe(200);
    const weeks = (listed.body as { weeks: Array<{ id: string; providerName: string; sessionCount: number; signerName: string; hhaStatus: string }> }).weeks;
    expect(weeks.some((w) => w.id === weekId && w.providerName === 'Pat Lee')).toBe(true);

    const created = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/providers',
      headers: adminH,
      query: {},
      body: { firstName: 'Sam', lastName: 'Ortiz', discipline: 'OT', email: 'sam@whiteglove.local', payRate: 80 },
    });
    expect(created.status).toBe(201);
    const linked = created.body as { provider: { id: string; userId: string }; user: { email: string; providerId: string } };
    expect(linked.user.email).toBe('sam@whiteglove.local');
    expect(linked.user.providerId).toBe(linked.provider.id);

    const invited = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/users',
      headers: adminH,
      query: {},
      body: { email: 'linked@whiteglove.local', displayName: 'Linked', providerId: provider.id },
    });
    expect(invited.status).toBe(201);
    expect((invited.body as { user: { providerId: string } }).user.providerId).toBe(provider.id);

    const adminInvite = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/users',
      headers: adminH,
      query: {},
      body: { email: 'second-admin@whiteglove.local', displayName: 'Second Admin', role: 'admin' },
    });
    expect(adminInvite.status).toBe(201);
    expect((adminInvite.body as { user: { role: string; email: string } }).user.role).toBe('admin');
    expect((adminInvite.body as { message: string }).message).toMatch(/Admin invite/i);

    const secondId = (adminInvite.body as { user: { id: string } }).user.id;
    const removed = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/users/${secondId}`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(removed.status).toBe(200);
    expect((removed.body as { deleted: boolean }).deleted).toBe(true);
    expect(store.userById(secondId)).toBeUndefined();

    const selfBlocked = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/users/${store.userByEmail('admin@whiteglove.local')!.id}`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(selfBlocked.status).toBe(400);
    expect((selfBlocked.body as { error: string }).error).toMatch(/own admin/i);
  });

  it('hard-deletes leftover deactivated admins and keeps therapist deactivate', async () => {
    const { store } = storeWithTherapist();
    const leftover = store.upsertUser({
      id: newId(),
      cognitoSub: 'dead-admin',
      email: 'old-admin@whiteglove.local',
      role: 'admin',
      displayName: 'Old Admin',
      providerId: '',
      active: false,
      createdAt: nowIso(),
    });
    const purged = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/users/${leftover.id}`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(purged.status).toBe(200);
    expect(store.userById(leftover.id)).toBeUndefined();

    const therapist = store.userByEmail('therapist@whiteglove.local')!;
    const deactivateAdmin = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/users/${store.userByEmail('admin@whiteglove.local')!.id}/deactivate`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(deactivateAdmin.status).toBe(400);

    const deactivated = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/users/${therapist.id}/deactivate`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(deactivated.status).toBe(200);
    expect((deactivated.body as { user: { active: boolean } }).user.active).toBe(false);

    const deleteTherapist = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/users/${therapist.id}`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(deleteTherapist.status).toBe(200);
    expect(store.userByEmail('therapist@whiteglove.local')).toBeUndefined();
  });

  it('lets admin correct mandate and student after parse', async () => {
    const { store, provider } = storeWithTherapist();
    const parsed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates/parse',
      headers: adminH,
      query: {},
      body: {
        pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 1x/week\nDOB: 07/12/2019`,
        providerId: provider.id,
      },
    });
    const studentId = (parsed.body as { student: { id: string } }).student.id;
    const mandateId = (parsed.body as { mandate: { id: string } }).mandate.id;
    const studentFix = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/students/${studentId}`,
      headers: adminH,
      query: {},
      body: { firstName: 'Aiden', lastName: 'Odne', dob: '2019-07-12', hhaPatientId: 'HHA-9' },
    });
    expect(studentFix.status).toBe(200);
    expect((studentFix.body as { student: { hhaPatientId: string } }).student.hhaPatientId).toBe('HHA-9');
    const mandateFix = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/mandates/${mandateId}`,
      headers: adminH,
      query: {},
      body: { frequencyPerWeek: 2, serviceType: 'PT School Group', discipline: 'PT', providerId: provider.id, startOn: '2026-09-01' },
    });
    expect(mandateFix.status).toBe(200);
    expect((mandateFix.body as { mandate: { frequencyPerWeek: number } }).mandate.frequencyPerWeek).toBe(2);
  });

  it('hides other therapists students and stores locker files', async () => {
    const { store, provider } = storeWithTherapist();
    const other = store.upsertProvider({
      id: newId(),
      userId: '',
      firstName: 'Other',
      lastName: 'PT',
      discipline: 'PT',
      payRatePerHour: null,
      payRate30Min: null,
      payRate42Min: null,
      payRate45Min: null,
      payRateGroup30Min: null,
      payRateGroup42Min: null,
      payRateGroup45Min: null,
      payRateAdditionalHourly: null,
      hhaCaregiverCode: '',
      active: true,
      createdAt: nowIso(),
    });
    const mine = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Mine',
      lastName: 'Kid',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const theirs = store.upsertStudent({
      id: newId(),
      schoolId: '',
      firstName: 'Theirs',
      lastName: 'Kid',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    store.upsertMandate({
      id: newId(),
      studentId: mine.id,
      providerId: provider.id,
      serviceType: 'PT',
      discipline: 'PT',
      frequencyPerWeek: 1,
      ratioGroup: false,
      sourcePdfKey: '',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
    });
    store.upsertMandate({
      id: newId(),
      studentId: theirs.id,
      providerId: other.id,
      serviceType: 'PT',
      discipline: 'PT',
      frequencyPerWeek: 1,
      ratioGroup: false,
      sourcePdfKey: '',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
    });
    const list = await handleTmsRequest(store, {
      method: 'GET',
      path: '/students',
      headers: thH,
      query: {},
      body: {},
    });
    const names = (list.body as { students: Array<{ firstName: string }> }).students.map((s) => s.firstName);
    expect(names).toContain('Mine');
    expect(names).not.toContain('Theirs');

    const file = await handleTmsRequest(store, {
      method: 'POST',
      path: '/files',
      headers: adminH,
      query: {},
      body: { studentId: mine.id, label: 'IEP', pdfBase64: Buffer.from('%PDF-1.4 test').toString('base64') },
    });
    expect(file.status).toBe(201);
    expect((file.body as { file: { s3Key: string; label: string } }).file.s3Key).toMatch(/^tms\/locker\//);
    expect((file.body as { file: { label: string } }).file.label).toBe('IEP');
  });

  it('returns week warnings and lets notes be patched by id', async () => {
    const { store, provider } = storeWithTherapist();
    const parsed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates/parse',
      headers: adminH,
      query: {},
      body: {
        pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 2x/week`,
        providerId: provider.id,
      },
    });
    const studentId = (parsed.body as { student: { id: string } }).student.id;
    const weekStart = '2026-08-31';
    const ensured = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/ensure',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart },
    });
    const weekId = (ensured.body as { week: { id: string } }).week.id;
    const added = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '08/31/2026',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        attendance: 'attended',
        notes: 'short',
        serviceType: 'PT School',
      },
    });
    expect(added.status).toBe(200);
    const week = await handleTmsRequest(store, {
      method: 'GET',
      path: '/week',
      headers: thH,
      query: { weekStart },
      body: {},
    });
    expect((week.body as { warnings: string[] }).warnings.length).toBeGreaterThan(0);
    expect((week.body as { errors: string[] }).errors.some((e) => /incomplete/i.test(e))).toBe(true);
    const blockedSubmit = await handleTmsRequest(store, {
      method: 'POST',
      path: `/weeks/${weekId}/submit`,
      headers: thH,
      query: {},
      body: {},
    });
    expect(blockedSubmit.status).toBe(400);
    expect((blockedSubmit.body as { errors: string[] }).errors.some((e) => /incomplete/i.test(e))).toBe(true);
    expect(store.data.weeks.find((w) => w.id === weekId)?.status).toBe('draft');
    const missing = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/reports/missing-notes',
      headers: adminH,
      query: {},
      body: {},
    });
    const missingRows = (missing.body as { rows: Array<{ studentName: string; weekId: string; date: string }> }).rows;
    expect(missingRows[0]?.studentName).toMatch(/Aiden/);
    expect(missingRows[0]?.weekId).toBe(weekId);
    expect(missingRows[0]?.date).toBe('08/31/2026');
    const sessionId = (added.body as { session: { id: string } }).session.id;
    const patched = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: { id: sessionId, weekId, notes: 'Service Provided: longer gait notes in gym' },
    });
    expect(patched.status).toBe(200);
    expect((patched.body as { session: { dateOfService: string; notes: string } }).session.dateOfService).toBe('08/31/2026');
    expect((patched.body as { session: { notes: string } }).session.notes).toMatch(/gait/);

    // Still under-mandate (1 of 2) — warning only; AI block cleared after longer notes.
    const weekAfter = await handleTmsRequest(store, {
      method: 'GET',
      path: '/week',
      headers: thH,
      query: { weekStart },
      body: {},
    });
    expect((weekAfter.body as { errors: string[] }).errors.some((e) => /incomplete/i.test(e))).toBe(false);
    expect((weekAfter.body as { warnings: string[] }).warnings.length).toBeGreaterThan(0);
  });

  it('rejects unauthenticated requests when dev headers are disabled', async () => {
    const saved = process.env.TMS_ALLOW_DEV_HEADERS;
    delete process.env.TMS_ALLOW_DEV_HEADERS;
    try {
      const { store } = storeWithTherapist();
      const noAuth = await handleTmsRequest(store, {
        method: 'GET',
        path: '/me',
        headers: {},
        query: {},
        body: {},
      });
      expect(noAuth.status).toBe(401);
      const devHeaders = await handleTmsRequest(store, {
        method: 'GET',
        path: '/me',
        headers: adminH,
        query: {},
        body: {},
      });
      expect(devHeaders.status).toBe(401);
      const devToken = await handleTmsRequest(store, {
        method: 'GET',
        path: '/me',
        headers: { authorization: 'Bearer admin' },
        query: {},
        body: {},
      });
      expect(devToken.status).toBe(401);
    } finally {
      if (saved === undefined) delete process.env.TMS_ALLOW_DEV_HEADERS;
      else process.env.TMS_ALLOW_DEV_HEADERS = saved;
    }
  });

  it('tracks manual due dates', async () => {
    const { store } = storeWithTherapist();
    const school = store.upsertSchool({
      id: newId(),
      name: 'Forest Road',
      district: '',
      signerName: '',
      signerEmail: '',
      createdAt: nowIso(),
    });
    const created = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/due-dates',
      headers: adminH,
      query: {},
      body: { schoolId: school.id, kind: 'progress', dueOn: '2001-01-01' },
    });
    expect(created.status).toBe(201);
    const report = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/reports/due-dates',
      headers: adminH,
      query: {},
      body: {},
    });
    const row = (report.body as { rows: Array<{ status: string; schoolName: string }> }).rows[0];
    expect(row?.status).toBe('overdue');
    expect(row?.schoolName).toBe('Forest Road');
  });

  it('week progress report filters by week range', async () => {
    const { store, provider } = storeWithTherapist();
    const school = store.upsertSchool({
      id: newId(),
      name: 'Forest Road',
      district: '',
      signerName: '',
      signerEmail: '',
      createdAt: nowIso(),
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: school.id,
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
    const week = store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart: '2026-08-31',
      status: 'draft',
      signerName: '',
      signerEmail: '',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
    store.upsertSession({
      id: newId(),
      weekId: week.id,
      studentId: student.id,
      dateOfService: '08/31/2026',
      beginTime: '9:00 am',
      endTime: '9:30 am',
      attendance: 'attended',
      cancelReason: '',
      makeupOfSessionId: '',
      serviceType: 'PT School',
      location: '',
      notes: 'Service Provided: gait work',
      aiFlags: [],
    });
    const report = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/reports/week-progress',
      headers: adminH,
      query: { from: '2026-08-31', to: '2026-08-31' },
      body: {},
    });
    expect(report.status).toBe(200);
    const rows = (report.body as { rows: Array<{ childName: string; progressPct: number; sessionsProvided: number }> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.childName).toMatch(/Aiden/);
    expect(rows[0]?.sessionsProvided).toBe(1);
    expect(rows[0]?.progressPct).toBe(100);
  });

  it('caseload CSV/Excel import commits immediately; dryRun stays unused unless set', async () => {
    const { store } = storeWithTherapist();
    const csv = `Recommended School,Last Name,First Name,Grade,Decision,RS Start,RS End,Related Service,Ratio,Freq,Period,Location,RS Provider
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Small Group,1,Weekly,Push-In,Pat Lee
Shaw Avenue,Haris,Ahmad,3,Approved,09/01/2025,06/30/2026,PT,Individual,1,Weekly,Pull-Out,Pat Lee
Shaw Avenue,Diaz,Elmer,4,Approved,09/01/2025,06/30/2026,OT,Small Group,2,6 day cycle,Push-In,Pat Lee
`;

    const denied = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/caseloads/import',
      headers: thH,
      query: {},
      body: { csvText: csv },
    });
    expect(denied.status).toBe(403);

    const unusedPreview = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/caseloads/import',
      headers: adminH,
      query: {},
      body: { csvText: csv, dryRun: true },
    });
    expect(unusedPreview.status).toBe(200);
    expect((unusedPreview.body as { dryRun: boolean }).dryRun).toBe(true);
    expect(store.data.students).toHaveLength(0);

    const commit = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/caseloads/import',
      headers: adminH,
      query: {},
      body: { csvText: csv },
    });
    expect(commit.status).toBe(200);
    const commitBody = commit.body as { dryRun: boolean; createdMandates: number };
    expect(commitBody.dryRun).toBe(false);
    expect(store.data.students.length).toBe(2);
    const ahmad = store.findStudentByName('Ahmad', 'Haris');
    expect(store.mandatesForStudent(ahmad!.id)).toHaveLength(2);
    const elmer = store.findStudentByName('Elmer', 'Diaz');
    const cycle = store.mandatesForStudent(elmer!.id)[0];
    expect(cycle.frequencyKind).toBe('school_day_cycle');
    expect(cycle.frequencyPerWeek).toBe(0);
    expect(cycle.sessionsPerPeriod).toBe(2);
    expect(cycle.periodSchoolDays).toBe(6);

    const ws = XLSX.utils.aoa_to_sheet([
      ['Recommended School', 'Last Name', 'First Name', 'Grade', 'Decision', 'RS Start', 'RS End', 'Related Service', 'Ratio', 'Freq', 'Period', 'Location', 'RS Provider'],
      ['Shaw Avenue', 'Newkid', 'Sam', 3, 'Approved', '09/01/2025', '06/30/2026', 'PT', 'Individual', 1, 'Weekly', 'Push-In', 'Pat Lee'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Details');
    const xlsxBuf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);

    const xlsxOk = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/caseloads/import',
      headers: adminH,
      query: {},
      body: {
        fileName: 'caseload.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileBase64: xlsxBuf.toString('base64'),
      },
    });
    expect(xlsxOk.status).toBe(200);
    const xlsxOkBody = xlsxOk.body as { dryRun: boolean; rows: unknown[] };
    expect(xlsxOkBody.dryRun).toBe(false);
    expect(xlsxOkBody.rows).toHaveLength(1);
    expect(store.findStudentByName('Sam', 'Newkid')).toBeTruthy();

    const xlsxBad = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/caseloads/import',
      headers: adminH,
      query: {},
      body: { csvText: 'a,b', fileName: 'caseload.xlsx' },
    });
    expect(xlsxBad.status).toBe(200);
    const xlsxBadBody = xlsxBad.body as { errors?: Array<{ problem?: string }> };
    expect(xlsxBadBody.errors?.some((e) => /bytes were not sent/i.test(e.problem || ''))).toBe(true);
  });

  it('saves and lists internal provider notes', async () => {
    const { store, provider } = storeWithTherapist();
    const adminH = {
      'x-tms-role': 'admin',
      'x-tms-email': 'admin@whiteglove.local',
    };

    // Simulate an older S3 snapshot that omitted adminNotes.
    const partial = store.snapshot() as unknown as Record<string, unknown>;
    delete partial.adminNotes;
    store.load(partial as never);

    const empty = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/providers/${provider.id}/notes`,
      headers: adminH,
      query: {},
      body: { body: '   ' },
    });
    expect(empty.status).toBe(400);

    const missing = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/providers/no-such/notes',
      headers: adminH,
      query: {},
      body: { body: 'hello' },
    });
    expect(missing.status).toBe(404);

    const created = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/providers/${provider.id}/notes`,
      headers: adminH,
      query: {},
      body: { body: 'Call school about makeup window' },
    });
    expect(created.status).toBe(201);
    const createdBody = created.body as { note: { body: string; providerId: string }; notes: Array<{ body: string }> };
    expect(createdBody.note.body).toBe('Call school about makeup window');
    expect(createdBody.note.providerId).toBe(provider.id);
    expect(createdBody.notes).toHaveLength(1);

    const listed = await handleTmsRequest(store, {
      method: 'GET',
      path: `/admin/providers/${provider.id}/notes`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(listed.status).toBe(200);
    expect((listed.body as { notes: Array<{ body: string }> }).notes[0].body).toMatch(/makeup/);
  });

  it('blocks signing draft weeks; allows remove session and remove draft week', async () => {
    const { store, provider } = storeWithTherapist();
    const weekStart = '2026-09-01';
    const ensured = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/ensure',
      headers: thH,
      query: {},
      body: { weekStart, providerId: provider.id },
    });
    expect(ensured.status).toBe(200);
    const weekId = (ensured.body as { week: { id: string } }).week.id;

    const student = store.upsertStudent({
      id: newId(),
      schoolId: store.data.schools[0].id,
      firstName: 'Ada',
      lastName: 'Lee',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      createdAt: nowIso(),
    });

    const added = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId: student.id,
        dateOfService: '09/02/2026',
        attendance: 'attended',
        notes: 'worked on gait',
        serviceType: 'PT School',
      },
    });
    expect(added.status).toBe(200);
    const sessionId = (added.body as { session: { id: string } }).session.id;

    const signDraft = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/weeks/${weekId}/sign`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(signDraft.status).toBe(409);

    const removedSession = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/sessions/${sessionId}`,
      headers: thH,
      query: {},
      body: undefined,
    });
    expect(removedSession.status).toBe(200);
    expect(store.sessionsForWeek(weekId)).toHaveLength(0);

    const removedWeek = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/weeks/${weekId}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(removedWeek.status).toBe(200);
    expect(store.data.weeks.find((w) => w.id === weekId)).toBeUndefined();
  });

  it('returns child/provider detail and supports delete/edit of notes, mandates, children, providers', async () => {
    const { store, provider } = storeWithTherapist();
    const school = store.data.schools[0];
    const student = store.upsertStudent({
      id: newId(),
      schoolId: school.id,
      firstName: 'Sam',
      lastName: 'Kid',
      dob: '2018-01-01',
      programId: 'P1',
      programType: 'RS',
      hhaPatientId: '',
      grade: '1',
      createdAt: nowIso(),
    });
    const mandate = store.upsertMandate({
      id: newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: 'PT School',
      discipline: 'PT',
      frequencyPerWeek: 1,
      frequencyKind: 'weekly',
      sessionsPerPeriod: 1,
      ratioGroup: false,
      sourcePdfKey: 'csv',
      parsedAt: nowIso(),
      startOn: '',
      endOn: '',
      createdAt: nowIso(),
    });
    const note = store.addAdminNote({
      id: newId(),
      providerId: provider.id,
      authorId: store.data.users[0].id,
      body: 'Call school',
      tags: [],
      createdAt: nowIso(),
    });

    const children = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/students',
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(children.status).toBe(200);
    expect((children.body as { students: Array<{ id: string }> }).students.some((s) => s.id === student.id)).toBe(true);

    const child = await handleTmsRequest(store, {
      method: 'GET',
      path: `/admin/students/${student.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(child.status).toBe(200);
    const childBody = child.body as {
      schoolName: string;
      assignedProviders: Array<{ id: string; name: string }>;
      mandates: Array<{ providerName: string; freqDisplay: string; ratioLabel: string }>;
    };
    expect(childBody.mandates).toHaveLength(1);
    expect(childBody.mandates[0].providerName).toBe('Pat Lee');
    expect(childBody.mandates[0].freqDisplay).toBe('1 / week');
    expect(childBody.mandates[0].ratioLabel).toBe('Individual');
    expect(childBody.schoolName).toBeTruthy();
    expect(childBody.assignedProviders).toEqual([{ id: provider.id, name: 'Pat Lee' }]);

    const prov = await handleTmsRequest(store, {
      method: 'GET',
      path: `/admin/providers/${provider.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(prov.status).toBe(200);
    expect((prov.body as { caseloadCount: number }).caseloadCount).toBe(1);

    const patched = await handleTmsRequest(store, {
      method: 'PATCH',
      path: `/admin/providers/${provider.id}`,
      headers: adminH,
      query: {},
      body: {
        payRatePerHour: 88,
        payRate30Min: 45,
        payRate42Min: 60,
        payRate45Min: 66,
        payRateGroup30Min: 30,
        payRateGroup42Min: 40,
        payRateGroup45Min: 44,
        payRateAdditionalHourly: 55,
        firstName: 'Pat',
        lastName: 'Updated',
      },
    });
    expect(patched.status).toBe(200);
    const patchedProvider = (patched.body as {
      provider: {
        payRatePerHour: number;
        payRate30Min: number;
        payRateAdditionalHourly: number;
      };
    }).provider;
    expect(patchedProvider.payRatePerHour).toBe(88);
    expect(patchedProvider.payRate30Min).toBe(45);
    expect(patchedProvider.payRateAdditionalHourly).toBe(55);

    const noteEdit = await handleTmsRequest(store, {
      method: 'PATCH',
      path: `/admin/providers/${provider.id}/notes/${note.id}`,
      headers: adminH,
      query: {},
      body: { body: 'Updated note' },
    });
    expect(noteEdit.status).toBe(200);
    expect((noteEdit.body as { note: { body: string } }).note.body).toBe('Updated note');

    const noteDel = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/providers/${provider.id}/notes/${note.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(noteDel.status).toBe(200);
    expect(store.notesForProvider(provider.id)).toHaveLength(0);

    const mandDel = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/mandates/${mandate.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(mandDel.status).toBe(200);
    expect(store.data.mandates.find((m) => m.id === mandate.id)).toBeUndefined();

    const childDel = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/students/${student.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(childDel.status).toBe(200);
    expect(store.data.students.find((s) => s.id === student.id)).toBeUndefined();

    const provDel = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/providers/${provider.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(provDel.status).toBe(200);
    expect(store.data.providers.find((p) => p.id === provider.id)).toBeUndefined();
  });

  it('deletes schools and due dates', async () => {
    const { store } = storeWithTherapist();
    const school = store.upsertSchool({
      id: newId(),
      name: 'Delete Me School',
      district: '',
      signerName: 'Signer',
      signerEmail: 'signer@example.com',
      createdAt: nowIso(),
    });
    const due = store.upsertDueDate({
      id: newId(),
      schoolId: school.id,
      kind: 'progress',
      dueOn: '2026-11-01',
      completedAt: '',
      lastNagOn: '',
    });
    const student = store.upsertStudent({
      id: newId(),
      schoolId: school.id,
      firstName: 'A',
      lastName: 'B',
      dob: '',
      programId: '',
      programType: '',
      hhaPatientId: '',
      grade: '',
      createdAt: nowIso(),
    });

    const dueDel = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/due-dates/${due.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(dueDel.status).toBe(200);
    expect(store.data.dueDates.find((d) => d.id === due.id)).toBeUndefined();

    const due2 = store.upsertDueDate({
      id: newId(),
      schoolId: school.id,
      kind: 'annual',
      dueOn: '2026-12-01',
      completedAt: '',
      lastNagOn: '',
    });
    const schoolDel = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/schools/${school.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(schoolDel.status).toBe(200);
    expect(store.data.schools.find((s) => s.id === school.id)).toBeUndefined();
    expect(store.data.dueDates.find((d) => d.id === due2.id)).toBeUndefined();
    expect(store.data.students.find((s) => s.id === student.id)?.schoolId).toBe('');
  });

  it('gets and saves school calendar', async () => {
    const { store } = storeWithTherapist();
    const school = store.data.schools[0]!;

    const detail = await handleTmsRequest(store, {
      method: 'GET',
      path: `/admin/schools/${school.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(detail.status).toBe(200);
    expect((detail.body as { school: { id: string } }).school.id).toBe(school.id);

    const empty = await handleTmsRequest(store, {
      method: 'GET',
      path: `/admin/schools/${school.id}/calendar`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(empty.status).toBe(200);
    expect((empty.body as { calendar: { yearStart: string } }).calendar.yearStart).toBe('');

    const saved = await handleTmsRequest(store, {
      method: 'POST',
      path: `/admin/schools/${school.id}/calendar`,
      headers: adminH,
      query: {},
      body: {
        yearStart: '2025-09-02',
        yearEnd: '2026-06-25',
        offDays: ['2025-11-27', '2025-12-25'],
      },
    });
    expect(saved.status).toBe(200);
    const calendar = (saved.body as { calendar: { offDays: string[] } }).calendar;
    expect(calendar.offDays).toEqual(['2025-11-27', '2025-12-25']);

    const list = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/schools',
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(list.status).toBe(200);
    const byId = (list.body as { calendarsBySchoolId: Record<string, { yearStart: string }> })
      .calendarsBySchoolId;
    expect(byId[school.id]?.yearStart).toBe('2025-09-02');
  });
});

describe('TMS upload-sessions errors', () => {
  it('returns all over-mandate errors and does not keep blocked PDF rows', async () => {
    const { store, provider } = storeWithTherapist();
    const parsed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates/parse',
      headers: adminH,
      query: {},
      body: {
        pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 1x/week\nDOB: 07/12/2019`,
        providerId: provider.id,
      },
    });
    expect(parsed.status).toBe(200);

    const pdfText = [
      'Student Name: Odne, Aiden',
      'Service Provider: Pat Lee',
      'Service: PT School',
      '09/01/2026 9:00 am 9:30 am',
      'Service Provided: balance work in gym',
      '09/02/2026 10:00 am 10:30 am',
      'Service Provided: second visit gait training',
    ].join('\n');
    const blocked = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/upload-sessions',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart: '2026-08-31', pdfText },
    });
    expect(blocked.status).toBe(400);
    const body = blocked.body as { error: string; errors: string[]; warnings?: string[] };
    expect(body.error).toMatch(/over mandate/i);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThanOrEqual(1);
    expect(body.errors.some((e) => /over mandate/i.test(e))).toBe(true);
    expect(store.data.sessions).toHaveLength(0);
  });

  it('rejects unknown child from weekly PDF without auto-creating', async () => {
    const { store, provider } = storeWithTherapist();
    const beforeStudents = store.data.students.length;
    const pdfText = [
      'Student Name: Missing, Kid',
      'Service Provider: Pat Lee',
      'Service: PT School',
      'Westbury School',
      '09/01/2026 9:00 am 9:30 am',
      'Service Provided: balance work',
    ].join('\n');
    const res = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/upload-sessions',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart: '2026-08-31', pdfText },
    });
    expect(res.status).toBe(400);
    const body = res.body as { error: string; errors: string[] };
    expect(body.errors.some((e) => /Child 'Missing, Kid' not found/i.test(e))).toBe(true);
    expect(store.data.students).toHaveLength(beforeStudents);
    expect(store.data.sessions).toHaveLength(0);
  });

  it('rejects PDF when Service Provider does not match logged-in therapist', async () => {
    const { store, provider } = storeWithTherapist();
    await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates/parse',
      headers: adminH,
      query: {},
      body: {
        pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 1x/week\nDOB: 07/12/2019`,
        providerId: provider.id,
      },
    });
    const pdfText = [
      'Student Name: Odne, Aiden',
      'Service Provider: Other Person',
      'Service: PT School',
      '09/01/2026 9:00 am 9:30 am',
      'Service Provided: balance work',
    ].join('\n');
    const res = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/upload-sessions',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart: '2026-08-31', pdfText },
    });
    expect(res.status).toBe(400);
    const body = res.body as { errors: string[] };
    expect(body.errors.some((e) => /Provider in PDF does not match your account/i.test(e))).toBe(
      true,
    );
    expect(store.data.sessions).toHaveLength(0);
  });

  it('allows paid absence and makeup over weekly mandate when linked to a missed session', async () => {
    const { store, provider } = storeWithTherapist();
    const parsed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates/parse',
      headers: adminH,
      query: {},
      body: {
        pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 1x/week\nDOB: 07/12/2019`,
      },
    });
    const studentId = (parsed.body as { student: { id: string } }).student.id;
    const weekStart = '2026-08-31';
    const ensured = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/ensure',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart },
    });
    const weekId = (ensured.body as { week: { id: string } }).week.id;

    const missed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '08/31/2026',
        attendance: 'missed',
        notes: 'Student Absence',
        serviceType: 'PT School',
      },
    });
    expect(missed.status).toBe(200);
    const missedId = (missed.body as { session: { id: string } }).session.id;

    const full = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/01/2026',
        attendance: 'attended',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Service Provided: weekly visit',
        serviceType: 'PT School',
      },
    });
    expect(full.status).toBe(200);

    const overAttended = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/02/2026',
        attendance: 'attended',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Service Provided: extra visit',
        serviceType: 'PT School',
      },
    });
    expect(overAttended.status).toBe(400);

    const makeup = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/03/2026',
        attendance: 'makeup',
        makeupOfSessionId: missedId,
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Makeup for missed session on 08/31/2026',
        serviceType: 'PT School',
      },
    });
    expect(makeup.status).toBe(200);

    const paid = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/04/2026',
        attendance: 'attended',
        additionalServiceType: 'paid_absence',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Paid absence — school closed',
      },
    });
    expect(paid.status).toBe(200);
    expect((paid.body as { session: { additionalServiceType: string } }).session.additionalServiceType).toBe(
      'paid_absence',
    );

    const auth = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates',
      headers: adminH,
      query: {},
      body: {
        studentId,
        providerId: provider.id,
        mandateKind: 'makeup_auth',
        serviceType: 'PT Makeup authorization',
        discipline: 'PT',
        sessionsPerPeriod: 12,
      },
    });
    expect(auth.status).toBe(201);
    expect((auth.body as { mandate: { mandateKind: string } }).mandate.mandateKind).toBe('makeup_auth');
  });

  it('PDF makeup upload links to unused miss on note date and rejects when none exists', async () => {
    const { store, provider } = storeWithTherapist();
    const parsed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates/parse',
      headers: adminH,
      query: {},
      body: {
        pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 2x/week\nDOB: 07/12/2019`,
        providerId: provider.id,
      },
    });
    expect(parsed.status).toBe(200);
    const studentId = (parsed.body as { student: { id: string } }).student.id;

    const weekStart = '2026-08-31';
    const ensured = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/ensure',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart },
    });
    const weekId = (ensured.body as { week: { id: string } }).week.id;

    const missed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/03/2026',
        attendance: 'missed',
        notes: 'Student Absence',
        serviceType: 'PT School',
      },
    });
    expect(missed.status).toBe(200);
    const missedId = (missed.body as { session: { id: string } }).session.id;

    const badPdf = [
      'Student Name: Odne, Aiden',
      'Service Provider: Pat Lee',
      'Service: PT School',
      '09/04/2026 9:00 am 9:30 am',
      'Make up for missed session on 09/01/2026 balance work',
    ].join('\n');
    const rejected = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/upload-sessions',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart: '2026-09-07', pdfText: badPdf },
    });
    expect(rejected.status).toBe(400);
    expect((rejected.body as { error: string }).error).toMatch(
      /No unused missed session on 09\/01|no makeup authorization/i,
    );

    const goodPdf = [
      'Student Name: Odne, Aiden',
      'Service Provider: Pat Lee',
      'Service: PT School',
      '09/08/2026 9:00 am 9:30 am',
      'Make up for missed session on 09/03/2026 balance work',
    ].join('\n');
    const ok = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/upload-sessions',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart: '2026-09-07', pdfText: goodPdf },
    });
    expect(ok.status).toBe(200);
    const sessions = (ok.body as { sessions: Array<{ attendance: string; makeupOfSessionId: string }> })
      .sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.attendance).toBe('makeup');
    expect(sessions[0]?.makeupOfSessionId).toBe(missedId);
  });

  it('allows makeup via makeup-auth when no miss on date; weekly alone cannot', async () => {
    const { store, provider } = storeWithTherapist();
    const parsed = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates/parse',
      headers: adminH,
      query: {},
      body: {
        pdfText: `Child's Name: Odne Aiden\nService Type: PT School\nMandate frequency: 1x/week\nDOB: 07/12/2019`,
        providerId: provider.id,
      },
    });
    const studentId = (parsed.body as { student: { id: string } }).student.id;

    const ensured = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/ensure',
      headers: thH,
      query: {},
      body: { providerId: provider.id, weekStart: '2026-08-31' },
    });
    const weekId = (ensured.body as { week: { id: string } }).week.id;

    const noAuth = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/03/2026',
        attendance: 'makeup',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Makeup for missed session on 09/01/2026 balance work in gym',
        serviceType: 'PT School',
      },
    });
    expect(noAuth.status).toBe(400);
    expect((noAuth.body as { error: string }).error).toMatch(
      /No unused missed session|no makeup authorization|Makeup requires/i,
    );

    const auth = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates',
      headers: adminH,
      query: {},
      body: {
        studentId,
        providerId: provider.id,
        mandateKind: 'makeup_auth',
        serviceType: 'Makeup authorization',
        discipline: 'PT',
        sessionsPerPeriod: 12,
        frequencyPerWeek: 0,
      },
    });
    expect(auth.status).toBe(201);
    expect((auth.body as { mandate: { mandateKind: string } }).mandate.mandateKind).toBe(
      'makeup_auth',
    );

    const viaAuth = await handleTmsRequest(store, {
      method: 'POST',
      path: '/week/sessions',
      headers: thH,
      query: {},
      body: {
        weekId,
        studentId,
        dateOfService: '09/03/2026',
        attendance: 'makeup',
        beginTime: '9:00 am',
        endTime: '9:30 am',
        notes: 'Makeup for missed session on 09/01/2026 balance work in gym',
        serviceType: 'PT School',
      },
    });
    expect(viaAuth.status).toBe(200);
    expect(
      (viaAuth.body as { session: { makeupOfSessionId: string } }).session.makeupOfSessionId,
    ).toBe('');

    const weeklyKind = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/mandates',
      headers: adminH,
      query: {},
      body: {
        studentId,
        providerId: provider.id,
        mandateKind: 'regular',
        serviceType: 'PT School',
        discipline: 'PT',
        frequencyPerWeek: 2,
        sessionsPerPeriod: 2,
      },
    });
    expect(weeklyKind.status).toBe(201);
    expect((weeklyKind.body as { mandate: { mandateKind: string } }).mandate.mandateKind).toBe(
      'regular',
    );
  });
});
