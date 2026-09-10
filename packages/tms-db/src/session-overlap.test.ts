import { describe, expect, it } from 'vitest';
import {
  overlapExceptionAllows,
  sessionOverlapError,
  sessionsHaveInteriorOverlap,
  sameDateOfService,
  childHasGroupMandate,
  childGroupSizeCap,
  presentGroupPeerCount,
  notesMentionNoPeerAvailable,
  soloGroupMandateNoteWarning,
} from './session-overlap.js';
import { sessionPayAmount, sessionUsesGroupPayRate, blankProviderPay } from './provider-pay.js';
import type { Mandate, Provider, SessionRow } from './types.js';

function sess(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    weekId: 'w1',
    studentId: 'st1',
    dateOfService: '09/01/2026',
    beginTime: '2:00 pm',
    endTime: '2:30 pm',
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

function mandate(over: Partial<Mandate> = {}): Mandate {
  return {
    id: 'm1',
    studentId: 'st1',
    providerId: 'p1',
    serviceType: 'PT School Group',
    discipline: 'PT',
    frequencyPerWeek: 1,
    ratioGroup: true,
    groupSize: 2,
    sourcePdfKey: '',
    parsedAt: '',
    startOn: '',
    endOn: '',
    createdAt: '',
    ...over,
  };
}

const names = new Map([
  ['st1', 'Aiden Odne'],
  ['st2', 'Bella Peer'],
  ['st3', 'Cara Third'],
  ['st4', 'Dana Fourth'],
]);

describe('session time overlap', () => {
  it('allows adjacent windows (2:00–2:30 then 2:30–3:00)', () => {
    expect(
      sessionsHaveInteriorOverlap(
        { beginTime: '2:00 pm', endTime: '2:30 pm' },
        { beginTime: '2:30 pm', endTime: '3:00 pm' },
      ),
    ).toBe(false);
    expect(
      sessionOverlapError({
        candidate: sess({ id: 'a', beginTime: '2:00 pm', endTime: '2:30 pm' }),
        peers: [sess({ id: 'b', studentId: 'st2', beginTime: '2:30 pm', endTime: '3:00 pm' })],
        studentNameById: names,
      }),
    ).toBeNull();
  });

  it('blocks interior overlap for individual sessions', () => {
    const err = sessionOverlapError({
      candidate: sess({ id: 'a', beginTime: '2:00 pm', endTime: '2:45 pm' }),
      peers: [sess({ id: 'b', studentId: 'st2', beginTime: '2:30 pm', endTime: '3:00 pm' })],
      studentNameById: names,
    });
    expect(err).toMatch(/overlaps Bella Peer/i);
    expect(err).toMatch(/09\/01\/2026/i);
    expect(err).toMatch(/2:30/i);
  });

  it('allows group↔group overlap and blocks group↔individual', () => {
    expect(
      overlapExceptionAllows(
        { serviceType: 'PT School Group', studentId: 'st1' },
        { serviceType: 'PT School Group 2:1', studentId: 'st2' },
      ),
    ).toBe(true);
    expect(
      overlapExceptionAllows(
        { serviceType: 'PT School Group', studentId: 'st1' },
        { serviceType: 'PT School', studentId: 'st2' },
      ),
    ).toBe(false);

    expect(
      sessionOverlapError({
        candidate: sess({
          id: 'a',
          studentId: 'st1',
          serviceType: 'PT School Group',
          beginTime: '2:00 pm',
          endTime: '2:30 pm',
        }),
        peers: [
          sess({
            id: 'b',
            studentId: 'st2',
            serviceType: 'PT School Group',
            beginTime: '2:00 pm',
            endTime: '2:30 pm',
          }),
        ],
        studentNameById: names,
      }),
    ).toBeNull();

    const mix = sessionOverlapError({
      candidate: sess({
        id: 'a',
        studentId: 'st1',
        serviceType: 'PT School Group',
        beginTime: '2:00 pm',
        endTime: '2:30 pm',
      }),
      peers: [
        sess({
          id: 'b',
          studentId: 'st2',
          serviceType: 'PT School Individual',
          beginTime: '2:00 pm',
          endTime: '2:30 pm',
        }),
      ],
      studentNameById: names,
      mandates: [mandate({ studentId: 'st2', ratioGroup: true })],
    });
    expect(mix).toMatch(/paid at the individual rate/i);
    expect(mix).toMatch(/Bella Peer/i);
  });

  it('blocks overlap when group-mandate kids were seen individually (individual tags)', () => {
    const mandates = [
      mandate({ id: 'm1', studentId: 'st1', ratioGroup: true, groupSize: 3 }),
      mandate({ id: 'm2', studentId: 'st2', ratioGroup: true, groupSize: 3 }),
    ];
    expect(
      overlapExceptionAllows(
        { serviceType: 'PT School', studentId: 'st1' },
        { serviceType: 'PT School', studentId: 'st2' },
        mandates,
      ),
    ).toBe(false);
    expect(childHasGroupMandate('st1', mandates)).toBe(true);

    const err = sessionOverlapError({
      candidate: sess({
        id: 'a',
        studentId: 'st1',
        serviceType: 'PT School',
        beginTime: '2:00 pm',
        endTime: '2:30 pm',
      }),
      peers: [
        sess({
          id: 'b',
          studentId: 'st2',
          serviceType: 'PT School',
          beginTime: '2:00 pm',
          endTime: '2:30 pm',
        }),
      ],
      studentNameById: names,
      mandates,
    });
    expect(err).toMatch(/overlaps Bella Peer/i);
  });

  it('still blocks when only one child has a group mandate and tags look individual', () => {
    const err = sessionOverlapError({
      candidate: sess({
        id: 'a',
        studentId: 'st1',
        serviceType: 'PT School',
        beginTime: '2:00 pm',
        endTime: '2:30 pm',
      }),
      peers: [
        sess({
          id: 'b',
          studentId: 'st2',
          serviceType: 'PT School',
          beginTime: '2:00 pm',
          endTime: '2:30 pm',
        }),
      ],
      studentNameById: names,
      mandates: [mandate({ studentId: 'st1', ratioGroup: true, groupSize: 2 })],
    });
    expect(err).toMatch(/overlaps Bella Peer/i);
  });

  it('validates against an existing peer on the same provider day', () => {
    const existing = sess({
      id: 'saved',
      weekId: 'w-prev',
      studentId: 'st2',
      dateOfService: '09/01/2026',
      beginTime: '10:00 am',
      endTime: '10:30 am',
      serviceType: 'PT School',
    });
    const err = sessionOverlapError({
      candidate: sess({
        id: 'new',
        weekId: 'w-new',
        studentId: 'st1',
        dateOfService: '09/01/2026',
        beginTime: '10:15 am',
        endTime: '10:45 am',
      }),
      peers: [existing],
      studentNameById: names,
    });
    expect(err).toMatch(/overlaps Bella Peer/i);
    expect(sameDateOfService('9/1/2026', '09/01/2026')).toBe(true);
  });

  it('blocks adding a group peer after a group-mandate child was paid individually', () => {
    const paidInd = sess({
      id: 'ind',
      studentId: 'st1',
      serviceType: 'PT School',
      beginTime: '2:00 pm',
      endTime: '2:30 pm',
    });
    const err = sessionOverlapError({
      candidate: sess({
        id: 'group-peer',
        studentId: 'st2',
        serviceType: 'PT School Group',
        beginTime: '2:00 pm',
        endTime: '2:30 pm',
      }),
      peers: [paidInd],
      studentNameById: names,
      mandates: [mandate({ studentId: 'st1', ratioGroup: true })],
    });
    expect(err).toMatch(/Aiden Odne/i);
    expect(err).toMatch(/individual rate/i);
    expect(err).toMatch(/Group peers are not allowed/i);
  });
});

describe('groupSize cluster cap', () => {
  const slot = { beginTime: '2:00 pm', endTime: '2:30 pm' as const };

  it('allows 3 overlapping when mandate groupSize is 3; fewer is OK', () => {
    const mandates = [
      mandate({ id: 'm1', studentId: 'st1', ratioGroup: true, groupSize: 3 }),
      mandate({ id: 'm2', studentId: 'st2', ratioGroup: true, groupSize: 3 }),
      mandate({ id: 'm3', studentId: 'st3', ratioGroup: true, groupSize: 3 }),
    ];
    expect(childGroupSizeCap('st1', mandates)).toBe(3);

    // 2 of 3 OK
    expect(
      sessionOverlapError({
        candidate: sess({ id: 'a', studentId: 'st1', serviceType: 'PT School Group', ...slot }),
        peers: [sess({ id: 'b', studentId: 'st2', serviceType: 'PT School Group', ...slot })],
        studentNameById: names,
        mandates,
      }),
    ).toBeNull();

    // exactly 3 OK
    expect(
      sessionOverlapError({
        candidate: sess({ id: 'c', studentId: 'st3', serviceType: 'PT School Group', ...slot }),
        peers: [
          sess({ id: 'a', studentId: 'st1', serviceType: 'PT School Group', ...slot }),
          sess({ id: 'b', studentId: 'st2', serviceType: 'PT School Group', ...slot }),
        ],
        studentNameById: names,
        mandates,
      }),
    ).toBeNull();
  });

  it('fails when 4 overlapping children exceed mandate groupSize 3', () => {
    const mandates = [
      mandate({ id: 'm1', studentId: 'st1', ratioGroup: true, groupSize: 3 }),
      mandate({ id: 'm2', studentId: 'st2', ratioGroup: true, groupSize: 3 }),
      mandate({ id: 'm3', studentId: 'st3', ratioGroup: true, groupSize: 3 }),
      mandate({ id: 'm4', studentId: 'st4', ratioGroup: true, groupSize: 3 }),
    ];
    const err = sessionOverlapError({
      candidate: sess({ id: 'd', studentId: 'st4', serviceType: 'PT School Group', ...slot }),
      peers: [
        sess({ id: 'a', studentId: 'st1', serviceType: 'PT School Group', ...slot }),
        sess({ id: 'b', studentId: 'st2', serviceType: 'PT School Group', ...slot }),
        sess({ id: 'c', studentId: 'st3', serviceType: 'PT School Group', ...slot }),
      ],
      studentNameById: names,
      mandates,
    });
    expect(err).toMatch(/Group locker: mandate allows 3/i);
    expect(err).toMatch(/this slot has 4/i);
  });

  it('enforces groupSize on group-tagged clusters; individual-tagged group-mandate no longer shares', () => {
    const mandates = [
      mandate({ id: 'm1', studentId: 'st1', ratioGroup: true, groupSize: 2 }),
      mandate({ id: 'm2', studentId: 'st2', ratioGroup: true, groupSize: 2 }),
      mandate({ id: 'm3', studentId: 'st3', ratioGroup: true, groupSize: 2 }),
    ];
    // Individual tags → treated as individual for overlap (later peer blocked)
    expect(
      sessionOverlapError({
        candidate: sess({ id: 'a', studentId: 'st1', serviceType: 'PT School', ...slot }),
        peers: [sess({ id: 'b', studentId: 'st2', serviceType: 'PT School', ...slot })],
        studentNameById: names,
        mandates,
      }),
    ).toMatch(/overlaps/i);

    // Group tags: 2 OK under groupSize 2; 3 fails
    expect(
      sessionOverlapError({
        candidate: sess({ id: 'a', studentId: 'st1', serviceType: 'PT School Group', ...slot }),
        peers: [sess({ id: 'b', studentId: 'st2', serviceType: 'PT School Group', ...slot })],
        studentNameById: names,
        mandates,
      }),
    ).toBeNull();

    const err = sessionOverlapError({
      candidate: sess({ id: 'c', studentId: 'st3', serviceType: 'PT School Group', ...slot }),
      peers: [
        sess({ id: 'a', studentId: 'st1', serviceType: 'PT School Group', ...slot }),
        sess({ id: 'b', studentId: 'st2', serviceType: 'PT School Group', ...slot }),
      ],
      studentNameById: names,
      mandates,
    });
    expect(err).toMatch(/Group locker: mandate allows 2/i);
    expect(err).toMatch(/this slot has 3/i);
  });

  it('Small Group with null size caps at 2 (fewer than 3)', () => {
    const mandates = [
      mandate({ id: 'm1', studentId: 'st1', ratioGroup: true, groupSize: null, serviceType: 'OT Small Group' }),
      mandate({ id: 'm2', studentId: 'st2', ratioGroup: true, groupSize: null, serviceType: 'OT Small Group' }),
      mandate({ id: 'm3', studentId: 'st3', ratioGroup: true, groupSize: null, serviceType: 'OT Small Group' }),
    ];
    expect(childGroupSizeCap('st1', mandates)).toBe(2);
    const err = sessionOverlapError({
      candidate: sess({ id: 'c', studentId: 'st3', serviceType: 'OT School Group', ...slot }),
      peers: [
        sess({ id: 'a', studentId: 'st1', serviceType: 'OT School Group', ...slot }),
        sess({ id: 'b', studentId: 'st2', serviceType: 'OT School Group', ...slot }),
      ],
      studentNameById: names,
      mandates,
    });
    expect(err).toMatch(/Group locker: mandate allows 2/i);
  });
});

describe('group-mandate seen individually → individual pay', () => {
  it('uses individual rates when service type is not group', () => {
    const provider: Provider = {
      id: 'p',
      userId: '',
      firstName: 'A',
      lastName: 'B',
      discipline: 'PT',
      ...blankProviderPay(),
      payRate30Min: 40,
      payRateGroup30Min: 25,
      payRatePerHour: 80,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    };
    const individualVisit = sess({ serviceType: 'PT School' });
    const groupVisit = sess({ serviceType: 'PT School Group' });
    expect(sessionUsesGroupPayRate(individualVisit)).toBe(false);
    expect(sessionUsesGroupPayRate(groupVisit)).toBe(false); // solo / no peers → individual
    expect(sessionUsesGroupPayRate(groupVisit, { presentGroupPeerCount: 1 })).toBe(true);
    expect(sessionPayAmount(provider, individualVisit, { mandateDurationMinutes: 30 })).toBe(40);
    expect(sessionPayAmount(provider, groupVisit, { mandateDurationMinutes: 30 })).toBe(40);
    expect(
      sessionPayAmount(provider, groupVisit, { presentGroupPeerCount: 1, mandateDurationMinutes: 30 }),
    ).toBe(25);
  });
});

describe('solo group → individual pay (absent peers)', () => {
  it('counts only attended/makeup peers in the group cluster', () => {
    const slot = { dateOfService: '09/01/2026', beginTime: '9:00 am', endTime: '9:30 am' };
    const candidate = sess({ id: 'a', studentId: 'st1', serviceType: 'PT School Group', ...slot });
    const presentPeer = sess({
      id: 'b',
      studentId: 'st2',
      serviceType: 'PT School Group',
      attendance: 'attended',
      ...slot,
    });
    const missedPeer = sess({
      id: 'c',
      studentId: 'st3',
      serviceType: 'PT School Group',
      attendance: 'missed',
      ...slot,
    });
    expect(presentGroupPeerCount({ candidate, peers: [missedPeer] })).toBe(0);
    expect(presentGroupPeerCount({ candidate, peers: [presentPeer, missedPeer] })).toBe(1);
  });

  it('bills individual when the only other group member is missed', () => {
    const provider: Provider = {
      id: 'p',
      userId: '',
      firstName: 'A',
      lastName: 'B',
      discipline: 'PT',
      ...blankProviderPay(),
      payRate30Min: 40,
      payRateGroup30Min: 25,
      payRatePerHour: 80,
      hhaCaregiverCode: '',
      active: true,
      createdAt: '',
    };
    const slot = { dateOfService: '09/01/2026', beginTime: '9:00 am', endTime: '9:30 am' };
    const candidate = sess({ id: 'a', studentId: 'st1', serviceType: 'PT School Group', ...slot });
    const missed = sess({
      id: 'b',
      studentId: 'st2',
      serviceType: 'PT School Group',
      attendance: 'missed',
      ...slot,
    });
    const peerCount = presentGroupPeerCount({ candidate, peers: [missed] });
    expect(peerCount).toBe(0);
    expect(sessionUsesGroupPayRate(candidate, { presentGroupPeerCount: peerCount })).toBe(false);
    expect(sessionPayAmount(provider, candidate, { presentGroupPeerCount: peerCount, mandateDurationMinutes: 30 })).toBe(40);
  });

  it('blocks when group-mandate individual visit note omits no-peer language', () => {
    const mandates = [mandate({ studentId: 'st1', ratioGroup: true })];
    expect(
      soloGroupMandateNoteWarning({
        notes: 'Service Provided: fine motor',
        serviceType: 'PT School',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
      }),
    ).toMatch(/no peer was available|no partner available/i);
    expect(
      soloGroupMandateNoteWarning({
        notes: 'No peer available; worked on grasp',
        serviceType: 'PT School',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
      }),
    ).toBeNull();
    expect(
      soloGroupMandateNoteWarning({
        notes: 'Seen alone — no partner available today',
        serviceType: 'PT School',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
      }),
    ).toBeNull();
    expect(
      soloGroupMandateNoteWarning({
        notes: 'Peer not available; 1:1 session',
        serviceType: 'PT School',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
      }),
    ).toBeNull();
    expect(
      soloGroupMandateNoteWarning({
        notes: 'No peer was available for group',
        serviceType: 'PT School',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
      }),
    ).toBeNull();
    expect(
      soloGroupMandateNoteWarning({
        notes: 'Service Provided: group game',
        serviceType: 'PT School Group',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
        presentGroupPeerCount: 1,
      }),
    ).toBeNull();
    expect(
      soloGroupMandateNoteWarning({
        notes: 'Alone today — no peer available',
        serviceType: 'PT School Group',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
        presentGroupPeerCount: 0,
      }),
    ).toBeNull();
    expect(
      soloGroupMandateNoteWarning({
        notes: 'Service Provided: group game',
        serviceType: 'PT School Group',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
        presentGroupPeerCount: 0,
      }),
    ).toMatch(/blocked|no peer was available|no partner available/i);
  });

  it('does not demand no-partner note for true 1:1 when child also has individual mandate', () => {
    const mandates = [
      mandate({ id: 'm-grp', studentId: 'st1', ratioGroup: true, serviceType: 'PT School Group' }),
      mandate({ id: 'm-ind', studentId: 'st1', ratioGroup: false, serviceType: 'PT School' }),
    ];
    expect(
      soloGroupMandateNoteWarning({
        notes: 'Service Provided: fine motor',
        serviceType: 'PT School 1:1',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
      }),
    ).toBeNull();
    // Group-tagged alone still needs the note even with dual mandates.
    expect(
      soloGroupMandateNoteWarning({
        notes: 'Service Provided: group game',
        serviceType: 'PT School Group',
        studentId: 'st1',
        attendance: 'attended',
        mandates,
        presentGroupPeerCount: 0,
      }),
    ).toMatch(/no peer was available|no partner available/i);
  });

  it('accepts common no-peer synonym phrasings', () => {
    const ok = [
      'no partner available',
      'No peer available',
      'no peer was available',
      'peer not available',
      'partners were unavailable',
      'no other child',
      'other peer was absent',
      'classmate not available',
    ];
    for (const phrase of ok) {
      expect(notesMentionNoPeerAvailable(`Service Provided: ${phrase}`)).toBe(true);
    }
    expect(notesMentionNoPeerAvailable('Service Provided: fine motor only')).toBe(false);
  });
});
