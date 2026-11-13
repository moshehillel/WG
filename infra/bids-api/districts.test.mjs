import assert from 'node:assert/strict';
import {
  BILLU,
  DAY_MS,
  QUESTIONS,
  activeAlertOffers,
  advanceInterest,
  advanceOutreach,
  afterStart,
  districtMatch,
  markInterest,
  questionsEmail,
  scheduleConnection,
  startOutreach,
} from './districts.js';

const now = Date.parse('2026-11-01T15:00:00.000Z');
const district = {
  id: 'sample-district',
  name: 'Sample District',
  contactEmail: 'sample.district@example.test',
  servicedBefore: false,
};

const started = startOutreach(district, now);
assert.equal(started.changed, true);
assert.equal(started.district.outreach.status, 'asked');
assert.equal(started.messages[0].status, 'ready');
assert.equal(started.messages[0].sent, false);
assert.equal(Date.parse(started.district.outreach.deadlineAt) - now, DAY_MS);
assert.equal(advanceOutreach(started.district, now + DAY_MS - 1).changed, false);

const follow1 = advanceOutreach(started.district, now + DAY_MS);
assert.equal(follow1.district.outreach.status, 'followup1');
assert.equal(follow1.messages[0].kind, 'followup-1');
assert.equal(follow1.messages[0].sent, false);
const follow2 = advanceOutreach(follow1.district, now + 2 * DAY_MS);
assert.equal(follow2.district.outreach.status, 'followup2');
const escalated = advanceOutreach(follow2.district, now + 3 * DAY_MS);
assert.equal(escalated.district.outreach.status, 'escalated');
assert.ok(escalated.district.outreach.askedAt);
assert.ok(escalated.district.outreach.followup1At);
assert.ok(escalated.district.outreach.followup2At);
assert.equal(advanceOutreach(escalated.district, now + 4 * DAY_MS).changed, false);

const questions = questionsEmail(district, now);
assert.equal(questions.sent, false);
assert.equal(questions.status, 'ready');
for (const [key, label] of QUESTIONS) assert.ok(questions.body.includes(`${key}. ${label}`));
assert.equal(questionsEmail({ ...district, servicedBefore: true }, now), null);

const match = {
  id: 'ada',
  name: 'Ada Berg',
  activity: 'active',
  role: 'therapist',
  discipline: 'OT',
  address: '10 50th St, Borough Park',
  location: 'Borough Park',
  languages: ['Yiddish', 'English'],
  gender: 'female',
  desiredHours: 2,
  programs: ['school-age'],
  availability: 'Mon-Fri 8:00-15:00',
};
const incomplete = { ...match, id: 'new', languages: [], gender: '' };
const inactive = { ...match, id: 'lea', name: 'Lea Example', activity: 'inactive' };
const far = { ...match, id: 'far', location: 'Midwood' };
const need = {
  id: 'DIST-SAMPLE',
  source: 'district email',
  schoolName: 'Sample School',
  discipline: 'OT',
  program: 'school-age',
  hoursPerWeek: 2,
  address: '12 50th St, Borough Park',
  area: 'Borough Park',
  language: 'Yiddish',
  audience: 'either',
  service: 'OT, 2 hrs/week',
  interestClockStartedAt: new Date(now).toISOString(),
  interests: [],
  recruiterQueue: [],
};

assert.equal(districtMatch(match, need), true);
assert.equal(districtMatch(incomplete, need), false);
assert.equal(districtMatch(far, need), false);
assert.equal(districtMatch({ ...match, desiredHours: 1 }, need), false);
assert.equal(districtMatch({ ...match, languages: ['English'] }, need), false);
assert.equal(districtMatch({ ...match, gender: 'male' }, { ...need, audience: 'girls' }), false);

const alerts = activeAlertOffers(need, [match, incomplete, inactive, far], new Date(now).toISOString());
assert.equal(alerts.length, 1);
assert.equal(alerts[0].providerId, 'ada');
assert.equal(alerts[0].channel, 'email');
assert.equal(alerts[0].sent, false);

const day1 = advanceInterest(need, [match, inactive, incomplete], now + DAY_MS);
assert.ok(day1.need.inactivePreviewAt);
assert.equal(day1.offers.length, 1);
assert.equal(day1.offers[0].channel, 'sms');
assert.equal(day1.offers[0].sent, false);
assert.equal(day1.offers[0].providerId, 'lea');
assert.equal(day1.need.interestEscalatedAt || '', '');

const interested = markInterest(need, match, now);
assert.equal(interested.need.recruiterQueue.length, 1);
assert.equal(interested.need.recruiterQueue[0].queue, 'recruiter');
assert.equal(interested.need.recruiterQueue[0].providerId, 'ada');
const held = advanceInterest(interested.need, [inactive], now + 2 * DAY_MS);
assert.equal(held.offers.length, 0);
assert.equal(held.need.interestEscalatedAt || '', '');

const quiet = advanceInterest(need, [inactive], now + 2 * DAY_MS);
assert.ok(quiet.need.interestEscalatedAt);
assert.equal(quiet.need.interestEscalation.sent, false);
assert.match(quiet.need.interestEscalation.text, /Sample School/);

const open = scheduleConnection({
  buildingContact: '',
  studentList: 'A. Student',
  mandates: 'Mon 9:00-9:30',
  studentSchedules: 'Mon 9:00-9:30',
  schoolHours: 'Mon-Fri 8:00-15:00',
  availability: match.availability,
});
assert.equal(open.connected, false);
assert.equal(open.missingContact, 'building contact');

const ready = scheduleConnection({
  buildingContact: 'Office, 718-555-0100',
  studentList: 'A. Student',
  mandates: 'Mon 9:00-9:30',
  studentSchedules: 'Mon 9:00-9:30',
  schoolHours: 'Mon-Fri 8:00-15:00',
  availability: match.availability,
});
assert.equal(ready.connected, true);
assert.deepEqual(ready.schedule.proposal, ['Mon 9:00-9:30']);

const missingTime = scheduleConnection({
  buildingContact: 'Office',
  studentList: 'A. Student',
  mandates: '',
  studentSchedules: 'Mon 9:00-9:30',
  schoolHours: 'Mon-Fri 8:00-15:00',
  availability: match.availability,
});
assert.ok(missingTime.schedule.missing.includes('Mandates'));

const handoff = afterStart({
  district,
  provider: match,
  students: ['A. Student'],
  startDate: '2026-11-16',
  lsRate: '72',
});
assert.equal(handoff.tmsFileOpenRequest.opened, false);
assert.match(handoff.tmsFileOpenRequest.note, /did not call TMS/);
assert.equal(handoff.tmsMirror.mirrored, false);
assert.equal(handoff.tmsMirror.lsRate, '72');
assert.equal(handoff.payroll.sent, false);
assert.equal(handoff.payroll.status, 'ready');
assert.equal(handoff.billu.sent, false);
assert.equal(handoff.billu.to, BILLU.email);
assert.equal(handoff.billu.toName, BILLU.name);
assert.match(handoff.billu.body, /2026-11-16/);

console.log('district checks passed');
