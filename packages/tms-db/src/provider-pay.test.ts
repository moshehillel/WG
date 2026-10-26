import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory-store.js';
import {
  blankProviderPay,
  closestDurationBucket,
  hhaTransferAttendance,
  isHhaTransferSession,
  isPaidAbsenceSession,
  migrateProvider,
  migrateProviders,
  sessionBillingKind,
  sessionDurationMinutes,
  sessionPayAmount,
  sessionPayCodeRate,
} from './provider-pay.js';
import type { SessionRow } from './types.js';

function sess(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    weekId: 'w1',
    studentId: 'st1',
    dateOfService: '09/01/2026',
    beginTime: '9:00 am',
    endTime: '9:30 am',
    attendance: 'attended',
    cancelReason: '',
    makeupOfSessionId: '',
    serviceType: 'PT School',
    location: '',
    notes: 'Service Provided: gait',
    aiFlags: [],
    ...over,
  };
}

describe('provider pay rates', () => {
  it('migrates legacy payRate to payRatePerHour', () => {
    const p = migrateProvider({
      id: 'p1',
      userId: 'u1',
      firstName: 'A',
      lastName: 'B',
      discipline: 'PT',
      payRate: 72,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '2026-01-01',
    });
    expect(p.payRatePerHour).toBe(72);
    expect(p.payRate30Min).toBeNull();
    expect(p.payRateGroup15Min).toBeNull();
    expect(p.payRateGroup30Min).toBeNull();
    expect(p.payRateEval).toBeNull();
    expect(p.payRateAdditionalHourly).toBeNull();
    expect('payRate' in p).toBe(false);
  });

  it('maps legacy additional services and per-eval into dedicated fields', () => {
    const p = migrateProvider({
      id: 'p1',
      payRatePerHour: 80,
      payRateAdditionalServices: 55,
      payRatePerEval: 95,
    });
    expect(p.payRatePerHour).toBe(80);
    expect(p.payRateAdditionalHourly).toBe(55);
    expect(p.payRateEval).toBe(95);
  });

  it('keeps explicit payRatePerHour over legacy payRate', () => {
    const p = migrateProvider({
      id: 'p1',
      payRate: 50,
      payRatePerHour: 80,
    });
    expect(p.payRatePerHour).toBe(80);
  });

  it('migrates providers on MemoryStore load', () => {
    const store = new MemoryStore();
    store.load({
      users: [],
      schools: [],
      schoolCalendars: [],
      providers: [
        {
          id: 'legacy',
          userId: '',
          firstName: 'Old',
          lastName: 'Rate',
          discipline: 'OT',
          payRate: 65,
          hhaCaregiverCode: '',
          active: true,
          createdAt: '',
        } as never,
      ],
      adminNotes: [],
      students: [],
      mandates: [],
      weeks: [],
      sessions: [],
      files: [],
      dueDates: [],
      alerts: [],
      hhaTransfers: [],
      audit: [],
      settings: [],
    } as never);
    expect(store.data.providers[0].payRatePerHour).toBe(65);
    expect(migrateProviders([{ payRate: 10 }])[0].payRatePerHour).toBe(10);
  });

  it('bills additional services to the minute; eval uses flat eval rate', () => {
    expect(sessionDurationMinutes('9:00 am', '9:42 am')).toBe(42);
    expect(sessionDurationMinutes('9:00 a.m.', '9:42 a.m.')).toBe(42);
    expect(sessionDurationMinutes('9:00 A.M.', '9:30 P.M.')).toBe(12 * 60 + 30);
    const provider = {
      id: 'p',
      userId: '',
      firstName: 'A',
      lastName: 'B',
      discipline: 'PT' as const,
      ...blankProviderPay(),
      payRate30Min: 40,
      payRate42Min: 56,
      payRatePerHour: 80,
      payRateEval: 95,
      payRateAdditionalHourly: 60,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    };
    expect(
      sessionPayAmount(provider, sess({ beginTime: '9:00 am', endTime: '9:30 am' }), {
        mandateDurationMinutes: 30,
      }),
    ).toBe(40);
    expect(
      sessionPayAmount(provider, sess({ beginTime: '9:00 am', endTime: '9:42 am' }), {
        mandateDurationMinutes: 42,
      }),
    ).toBe(56);
    expect(
      sessionPayAmount(
        provider,
        sess({
          additionalServiceType: 'eval',
          beginTime: '9:00 am',
          endTime: '10:00 am',
        }),
      ),
    ).toBe(95);
    expect(
      sessionPayAmount(
        provider,
        sess({
          attendance: 'paid_absence',
          serviceType: 'PT School',
          beginTime: '9:00 am',
          endTime: '9:30 am',
        }),
        { mandateDurationMinutes: 30 },
      ),
    ).toBe(40);
  });

  it('uses mandate duration bucket — not Frontline clock nearest (40 min clock + 30 mandate → 30 rate)', () => {
    const provider = {
      id: 'p',
      userId: '',
      firstName: 'A',
      lastName: 'B',
      discipline: 'PT' as const,
      ...blankProviderPay(),
      payRate30Min: 40,
      payRate42Min: 56,
      payRatePerHour: 80,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    };
    // 40 min clock is nearer to 42 than 30 — old nearest-clock rule would pick 42.
    expect(closestDurationBucket(40)).toBe(42);
    expect(closestDurationBucket(15)).toBe(15);
    expect(closestDurationBucket(12)).toBe(15);
    expect(closestDurationBucket(18)).toBe(15);
    expect(closestDurationBucket(19)).toBe('hour');
    expect(closestDurationBucket(30)).toBe(30);
    const longClock = sess({ beginTime: '9:00 am', endTime: '9:40 am' });
    expect(sessionPayAmount(provider, longClock, { mandateDurationMinutes: 30 })).toBe(40);
    expect(sessionPayCodeRate(provider, longClock, { mandateDurationMinutes: 30 })).toBe(40);
    expect(sessionPayAmount(provider, longClock, { mandateDurationMinutes: 42 })).toBe(56);
  });

  it('sessionPayCodeRate uses flat duration / group / eval / additional catalog rates', () => {
    const provider = {
      id: 'p',
      userId: '',
      firstName: 'A',
      lastName: 'B',
      discipline: 'OT' as const,
      ...blankProviderPay(),
      payRate30Min: 62.5,
      payRateGroup30Min: 34,
      payRatePerHour: 80,
      payRateEval: 95,
      payRateAdditionalHourly: 55,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    };
    expect(
      sessionPayCodeRate(provider, sess({ beginTime: '9:00 am', endTime: '9:30 am' }), {
        mandateDurationMinutes: 30,
      }),
    ).toBe(62.5);
    expect(
      sessionPayCodeRate(
        provider,
        sess({ serviceType: 'OT School Group', beginTime: '9:00 am', endTime: '9:30 am' }),
        { presentGroupPeerCount: 1, mandateDurationMinutes: 30 },
      ),
    ).toBe(34);
    expect(
      sessionPayCodeRate(
        provider,
        sess({ serviceType: 'OT School Group', beginTime: '9:00 am', endTime: '9:30 am' }),
        { presentGroupPeerCount: 0, mandateDurationMinutes: 30 },
      ),
    ).toBe(62.5);
    expect(
      sessionPayCodeRate(provider, sess({ additionalServiceType: 'eval', beginTime: '9:00 am', endTime: '10:00 am' })),
    ).toBe(95);
    expect(
      sessionPayCodeRate(
        provider,
        sess({ additionalServiceType: 'progress_report', beginTime: '9:00 am', endTime: '10:00 am' }),
      ),
    ).toBe(55);
    expect(
      sessionPayCodeRate(
        provider,
        sess({ additionalServiceType: 'documentation', beginTime: '2:00 pm', endTime: '2:30 pm' }),
      ),
    ).toBe(27.5);
    expect(
      sessionPayCodeRate(
        provider,
        sess({ additionalServiceType: 'documentation', beginTime: '8:30 am', endTime: '9:00 am' }),
      ),
    ).toBe(27.5);
  });

  it('solo group-tagged session uses individual catalog rate (no present peers)', () => {
    const provider = {
      id: 'p',
      userId: '',
      firstName: 'A',
      lastName: 'B',
      discipline: 'OT' as const,
      ...blankProviderPay(),
      payRate30Min: 62.5,
      payRateGroup30Min: 34,
      payRatePerHour: 80,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    };
    const soloGroup = sess({ serviceType: 'OT School Group', beginTime: '9:00 am', endTime: '9:30 am' });
    expect(sessionPayAmount(provider, soloGroup, { mandateDurationMinutes: 30 })).toBe(62.5);
    expect(
      sessionPayAmount(provider, soloGroup, { presentGroupPeerCount: 0, mandateDurationMinutes: 30 }),
    ).toBe(62.5);
    expect(
      sessionPayAmount(provider, soloGroup, { presentGroupPeerCount: 1, mandateDurationMinutes: 30 }),
    ).toBe(34);
  });

  it('15-minute group mandate uses the group 15 rate; 30-minute group stays on group 30', () => {
    const provider = {
      id: 'p',
      userId: '',
      firstName: 'Fatimah',
      lastName: 'Dawan',
      discipline: 'PT' as const,
      ...blankProviderPay(),
      payRate30Min: 70,
      payRateGroup15Min: 22,
      payRateGroup30Min: 34,
      payRatePerHour: 80,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    };
    const group15 = sess({
      serviceType: 'PT School Group',
      beginTime: '1:45 pm',
      endTime: '2:00 pm',
    });
    expect(
      sessionPayCodeRate(provider, group15, { presentGroupPeerCount: 1, mandateDurationMinutes: 15 }),
    ).toBe(22);
    expect(
      sessionPayAmount(provider, group15, { presentGroupPeerCount: 1, mandateDurationMinutes: 15 }),
    ).toBe(22);
    expect(
      sessionPayCodeRate(provider, group15, { presentGroupPeerCount: 1, mandateDurationMinutes: 30 }),
    ).toBe(34);
    expect(
      sessionPayAmount(provider, group15, { presentGroupPeerCount: 1, mandateDurationMinutes: 30 }),
    ).toBe(34);
    // No group-15 amount → same hourly fallback as an empty group-30 rate.
    const noGroup15 = { ...provider, payRateGroup15Min: null };
    expect(
      sessionPayCodeRate(noGroup15, group15, { presentGroupPeerCount: 1, mandateDurationMinutes: 15 }),
    ).toBe(80);
    // Solo / individual 15-minute mandate does not use the group 15 rate.
    const individual = sess({ beginTime: '1:45 pm', endTime: '2:00 pm' });
    expect(
      sessionPayCodeRate(provider, individual, { mandateDurationMinutes: 15 }),
    ).toBe(80);
    expect(sessionPayAmount(provider, individual, { mandateDurationMinutes: 15 })).toBe(20);
    expect(
      sessionPayCodeRate(provider, group15, { presentGroupPeerCount: 0, mandateDurationMinutes: 15 }),
    ).toBe(80);
    const migrated = migrateProvider({ id: 'p1', payRateGroup15Min: 22, payRateGroup30Min: 34 });
    expect(migrated.payRateGroup15Min).toBe(22);
    expect(migrated.payRateGroup30Min).toBe(34);
  });

  it('sessionBillingKind maps eval / additional / school', () => {
    expect(sessionBillingKind(sess())).toBe('school');
    expect(sessionBillingKind(sess({ additionalServiceType: 'eval' }))).toBe('eval');
    expect(sessionBillingKind(sess({ additionalServiceType: 'progress_report' }))).toBe('additional');
    expect(sessionBillingKind(sess({ additionalServiceType: 'documentation' }))).toBe('additional');
    expect(sessionBillingKind(sess({ serviceType: 'OT Eval' }))).toBe('eval');
    expect(sessionBillingKind(sess({ serviceType: 'Documentation' }))).toBe('additional');
    const paidMiss = sess({
      attendance: 'missed',
      additionalServiceType: 'paid_absence',
      serviceType: 'Paid absence',
      beginTime: '2:00 PM',
      endTime: '2:30 PM',
    });
    expect(isPaidAbsenceSession(paidMiss)).toBe(true);
    expect(isHhaTransferSession(paidMiss)).toBe(true);
    expect(sessionBillingKind(paidMiss)).toBe('school');
    expect(hhaTransferAttendance(paidMiss)).toBe('attended');
    expect(hhaTransferAttendance(sess({ attendance: 'paid_absence' }))).toBe('attended');
    expect(sessionBillingKind(sess({ attendance: 'paid_absence', serviceType: 'PT School' }))).toBe('school');
    expect(
      sessionPayCodeRate(
        {
          id: 'p',
          userId: '',
          firstName: 'A',
          lastName: 'B',
          discipline: 'SLP',
          ...blankProviderPay(),
          payRate30Min: 52.5,
          payRateAdditionalHourly: 88,
          hhaCaregiverCode: '',
          active: true,
          createdAt: '',
        },
        paidMiss,
      ),
    ).toBe(52.5);
    const unpaidMiss = sess({ attendance: 'missed', notes: 'Student absent', beginTime: '', endTime: '' });
    expect(isHhaTransferSession(unpaidMiss)).toBe(false);
    expect(isHhaTransferSession(sess({ attendance: 'attended' }))).toBe(true);
    expect(
      isHhaTransferSession(
        sess({ attendance: 'missed', serviceType: 'ST Individual', notes: 'Paid absence' }),
      ),
    ).toBe(true);
  });
});
