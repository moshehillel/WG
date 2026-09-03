import { describe, expect, it } from 'vitest';
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
    payRate: 72,
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
    const deleteTherapist = await handleTmsRequest(store, {
      method: 'DELETE',
      path: `/admin/users/${therapist.id}`,
      headers: adminH,
      query: {},
      body: {},
    });
    expect(deleteTherapist.status).toBe(400);

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
      payRate: null,
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

  it('caseload CSV import is admin-only; dry-run vs confirm', async () => {
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
      body: { csvText: csv, dryRun: true },
    });
    expect(denied.status).toBe(403);

    const preview = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/caseloads/import',
      headers: adminH,
      query: {},
      body: { csvText: csv },
    });
    expect(preview.status).toBe(200);
    const previewBody = preview.body as {
      dryRun: boolean;
      rows: unknown[];
      createdMandates: number;
    };
    expect(previewBody.dryRun).toBe(true);
    expect(previewBody.rows).toHaveLength(3);
    expect(store.data.students).toHaveLength(0);
    expect(store.data.mandates).toHaveLength(0);

    const commit = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/caseloads/import',
      headers: adminH,
      query: {},
      body: { csvText: csv, confirm: true },
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

    const xls = await handleTmsRequest(store, {
      method: 'POST',
      path: '/admin/caseloads/import',
      headers: adminH,
      query: {},
      body: { csvText: 'a,b', fileName: 'caseload.xlsx' },
    });
    expect(xls.status).toBe(400);
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
});
