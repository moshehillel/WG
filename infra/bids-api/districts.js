/** Private school-district staffing. Messages are queued, never sent. No HHA calls. */

import { buildSchedule, matchesProfile } from './staffing.js';

export const DAY_MS = 86400000;

export const BILLU = {
  name: 'Billu Markowitz',
  email: 'bmarkowitz@whiteglovecare.net',
};

export const QUESTIONS = [
  ['A', 'Documentation system'],
  ['B', 'If Frontline, therapist login'],
  ['C', 'IEP access for the coordinator and the therapist'],
  ['D', 'Copy of the PO'],
  ['E', 'Treatment sessions only, or also additional services, and which ones'],
  ['F', 'Building contact'],
  ['G', 'Student list and a check that no IEP is missing'],
  ['H', 'Progress-report due dates'],
];

export function blankAnswers() {
  return Object.fromEntries(QUESTIONS.map(([key]) => [key, '']));
}

export function virtualNow(offsetDays, realNow = Date.now()) {
  const days = Number(offsetDays) || 0;
  return realNow + days * DAY_MS;
}

function queuedMessage({ kind, to, subject, body, at }) {
  return {
    id: kind,
    kind,
    to,
    subject,
    body,
    status: 'ready',
    sent: false,
    queuedAt: at,
  };
}

export function startOutreach(district, now) {
  const outreach = district.outreach;
  if (outreach && outreach.status && outreach.status !== 'idle') {
    return { district, messages: [], changed: false };
  }
  const askedAt = new Date(now).toISOString();
  const message = queuedMessage({
    kind: 'needs-ask',
    to: district.contactEmail,
    subject: `Current therapy needs — ${district.name}`,
    body: `Ready to send, not sent. Asking ${district.name} (${district.contactEmail}) for current therapy needs.`,
    at: askedAt,
  });
  return {
    changed: true,
    messages: [message],
    district: {
      ...district,
      outreach: {
        status: 'asked',
        askedAt,
        followup1At: '',
        followup2At: '',
        escalatedAt: '',
        repliedAt: '',
        deadlineAt: new Date(now + DAY_MS).toISOString(),
        messages: [message],
      },
    },
  };
}

export function advanceOutreach(district, now) {
  const outreach = district.outreach;
  if (!outreach || outreach.status === 'replied' || outreach.status === 'escalated' || outreach.status === 'idle') {
    return { district, messages: [], changed: false };
  }
  if (Date.parse(outreach.deadlineAt) > now) return { district, messages: [], changed: false };
  const at = new Date(now).toISOString();
  const messages = [...(outreach.messages || [])];
  if (outreach.status === 'asked') {
    const message = queuedMessage({
      kind: 'followup-1',
      to: district.contactEmail,
      subject: `Follow-up 1 — therapy needs for ${district.name}`,
      body: `Ready to send, not sent. Follow-up 1. No reply yet from ${district.name}.`,
      at,
    });
    messages.push(message);
    return {
      changed: true,
      messages: [message],
      district: {
        ...district,
        outreach: { ...outreach, status: 'followup1', followup1At: at, deadlineAt: new Date(now + DAY_MS).toISOString(), messages },
      },
    };
  }
  if (outreach.status === 'followup1') {
    const message = queuedMessage({
      kind: 'followup-2',
      to: district.contactEmail,
      subject: `Follow-up 2 — therapy needs for ${district.name}`,
      body: `Ready to send, not sent. Follow-up 2. No reply yet from ${district.name}.`,
      at,
    });
    messages.push(message);
    return {
      changed: true,
      messages: [message],
      district: {
        ...district,
        outreach: { ...outreach, status: 'followup2', followup2At: at, deadlineAt: new Date(now + DAY_MS).toISOString(), messages },
      },
    };
  }
  return {
    changed: true,
    messages: [],
    district: {
      ...district,
      outreach: { ...outreach, status: 'escalated', escalatedAt: at, messages },
    },
  };
}

export function markReply(district, now) {
  if (!district.outreach || district.outreach.status === 'replied') {
    return { district, changed: false };
  }
  return {
    changed: true,
    district: {
      ...district,
      outreach: { ...district.outreach, status: 'replied', repliedAt: new Date(now).toISOString() },
    },
  };
}

export function questionsEmail(district, now) {
  if (district.servicedBefore) return null;
  if (district.questionsEmail) return null;
  const lines = QUESTIONS.map(([key, label]) => `${key}. ${label}`).join('\n');
  return queuedMessage({
    kind: 'new-district-questions',
    to: district.contactEmail,
    subject: `New district setup — ${district.name}`,
    body: `Ready to send, not sent.\n${lines}`,
    at: new Date(now).toISOString(),
  });
}

export function districtMatch(person, row) {
  if (!matchesProfile(person, row)) return false;
  const wanted = Number(person.desiredHours);
  if (Number(row.hoursPerWeek) > wanted) return false;
  const area = String(row.area || '').trim();
  const home = String(person.location || '').trim();
  if (area && home !== area) return false;
  return true;
}

export function activeAlertOffers(need, people, sentAt) {
  return (Array.isArray(people) ? people : [])
    .filter((who) => who && who.activity === 'active' && who.role !== 'admin' && who.id !== 'standin' && districtMatch(who, need))
    .map((who) => ({
      providerId: who.id,
      offerId: `email#district#${need.id}`,
      opportunityId: need.id,
      sentAt,
      channel: 'email',
      sent: false,
      snapshot: {
        school: need.schoolName || need.schoolCode || '',
        building: need.building || '',
        program: need.program || '',
        service: need.service || '',
        hours: Number(need.hoursPerWeek) || 0,
        address: need.address || '',
      },
      triggeredBy: 'system',
    }));
}

export function advanceInterest(need, people, now) {
  const started = Date.parse(need.interestClockStartedAt || '');
  if (Number.isNaN(started)) return { need, offers: [], changed: false };
  const interests = Array.isArray(need.interests) ? need.interests : [];
  const offers = [];
  const next = { ...need, interests };
  let changed = false;
  if (!interests.length && !need.inactivePreviewAt && now >= started + DAY_MS) {
    const at = new Date(now).toISOString();
    next.inactivePreviewAt = at;
    changed = true;
    for (const who of people) {
      if (!who || who.activity !== 'inactive' || who.role === 'admin' || who.id === 'standin') continue;
      if (!districtMatch(who, need)) continue;
      offers.push({
        providerId: who.id,
        offerId: `sms#inactive#${need.id}`,
        opportunityId: need.id,
        sentAt: at,
        channel: 'sms',
        sent: false,
        snapshot: {
          school: need.schoolName || '',
          building: '',
          program: need.program || '',
          service: need.service || '',
          hours: Number(need.hoursPerWeek) || 0,
          address: need.address || '',
        },
        triggeredBy: 'system',
      });
    }
  }
  if (!interests.length && !need.interestEscalatedAt && now >= started + 2 * DAY_MS) {
    next.interestEscalatedAt = new Date(now).toISOString();
    next.interestEscalation = {
      status: 'ready',
      sent: false,
      audience: 'coordinator',
      text: `${need.schoolName || need.id} still has no interest after the active alert and the inactive text preview.`,
    };
    changed = true;
  }
  return { need: next, offers, changed };
}

export function markInterest(need, person, now) {
  if (!districtMatch(person, need)) {
    return { need, changed: false, error: 'Her saved profile does not match this need.' };
  }
  const interests = Array.isArray(need.interests) ? [...need.interests] : [];
  if (interests.some((item) => item.providerId === person.id)) return { need, changed: false };
  const row = {
    providerId: person.id,
    name: person.name,
    at: new Date(now).toISOString(),
    queue: 'recruiter',
  };
  const recruiterQueue = [...(Array.isArray(need.recruiterQueue) ? need.recruiterQueue : []), row];
  return { need: { ...need, interests: [...interests, row], recruiterQueue }, changed: true };
}

export function scheduleConnection({ buildingContact, studentList, mandates, studentSchedules, schoolHours, availability }) {
  const contact = String(buildingContact || '').trim();
  const students = String(studentList || '').trim();
  const schedule = buildSchedule({ mandates, studentSchedules, schoolHours, availability });
  return {
    connected: Boolean(contact && students),
    contact,
    missingContact: contact ? '' : 'building contact',
    missingStudents: students ? '' : 'student list',
    schedule,
  };
}

export function afterStart({ district, provider, students, startDate, lsRate }) {
  const who = provider?.name || 'the awarded therapist';
  const place = district?.name || 'the district';
  return {
    tmsFileOpenRequest: {
      status: 'queued',
      opened: false,
      providerName: provider?.name || '',
      students: Array.isArray(students) ? students : [],
      note: 'Kept on the award. TMS can update a provider or upload a locker file, and those calls can create a login or a caseload. Neither opens a provider and student file by itself. Bids did not call TMS, and no HHA visit was created.',
    },
    tmsMirror: {
      status: 'queued',
      mirrored: false,
      lsRate: String(lsRate || ''),
      note: 'LS rate is stored on this award. It was not written to TMS.',
    },
    payroll: {
      to: 'Payroll',
      status: 'ready',
      sent: false,
      subject: `Pay rates for ${who}`,
      body: `Ready to send, not sent. Confirm an HHA pay code exists for ${who} at ${place}. LS rate ${lsRate || 'not set'}. Do not create a visit.`,
    },
    billu: {
      to: BILLU.email,
      toName: BILLU.name,
      status: 'ready',
      sent: false,
      subject: `Training setup — start ${startDate}`,
      body: `Ready to send, not sent. ${BILLU.name}, the start date is ${startDate} for ${who} at ${place}. Please set up training.`,
    },
  };
}
