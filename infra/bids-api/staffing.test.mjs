import assert from 'node:assert/strict';
import {
  CSE_REASON,
  buildSchedule,
  genderAllows,
  handoffState,
  languageAllows,
  matchesProfile,
  parseDoeLines,
  placementDue,
  profileComplete,
  startReminder,
} from './staffing.js';

const complete = {
  address: '10 18th Ave, Borough Park',
  languages: ['Yiddish', 'English'],
  gender: 'female',
  discipline: 'OT',
  desiredHours: 2,
  programs: ['preschool', 'school-age'],
};

assert.equal(profileComplete(complete), true);
assert.equal(profileComplete({ ...complete, gender: '' }), false);
assert.equal(profileComplete({ ...complete, languages: [] }), false);
assert.equal(genderAllows('female', 'cheder'), false);
assert.equal(genderAllows('male', 'cheder'), true);
assert.equal(genderAllows('female', 'girls'), true);
assert.equal(genderAllows('female', 'either'), true);
assert.equal(languageAllows(['English'], ''), true);
assert.equal(languageAllows(['English'], 'Yiddish'), false);
assert.equal(matchesProfile(complete, { discipline: 'OT', program: 'preschool', audience: 'girls', language: 'Yiddish' }), true);
assert.equal(matchesProfile(complete, { discipline: 'OT', program: 'preschool', audience: 'cheder', language: '' }), false);
assert.equal(matchesProfile({ ...complete, address: '' }, { discipline: 'OT', program: 'preschool', audience: 'either' }), false);

const now = Date.parse('2026-10-29T12:00:00Z');
assert.equal(placementDue({ clockStartedAt: '2026-10-25T12:00:00Z', day: 1, hasProvider: false, now }).reject, true);
assert.equal(placementDue({ clockStartedAt: '2026-10-25T12:00:00Z', day: 1, hasProvider: true, now }).reject, false);
assert.equal(placementDue({ day: 5, hasProvider: false, now }).reason, CSE_REASON);
assert.equal(placementDue({ clockStartedAt: '2026-10-28T12:00:00Z', day: 1, hasProvider: false, now }).reject, false);

const reminder = startReminder({ personId: 'miriam', awardDate: '2026-10-20', startedAt: '' }, now);
assert.equal(reminder.reject, false);
assert.equal(reminder.remind, true);
assert.equal(startReminder({ personId: 'miriam', awardDate: '2026-10-28', startedAt: '' }, now), null);

const missingSchedule = buildSchedule({ mandates: '', studentSchedules: 'Mon 9:00-9:30', schoolHours: 'Mon-Fri 8:00-15:00', availability: 'Mon 8:00-12:00' });
assert.equal(missingSchedule.ready, false);
assert.ok(missingSchedule.missing.includes('Mandates'));
const readySchedule = buildSchedule({
  mandates: 'Mon 9:00-9:30',
  studentSchedules: 'Mon 9:00-9:30',
  schoolHours: 'Mon-Fri 8:00-15:00',
  availability: 'Mon 8:00-12:00',
});
assert.equal(readySchedule.ready, true);
assert.deepEqual(readySchedule.proposal, ['Mon 9:00-9:30']);
const conflict = buildSchedule({
  mandates: 'Mon 9:00-9:30',
  studentSchedules: 'Mon 16:00-16:30',
  schoolHours: 'Mon-Fri 8:00-15:00',
  availability: 'Mon 8:00-12:00',
});
assert.ok(conflict.conflicts.length > 0);

const doe = parseDoeLines('Bnos Yakov | OT | preschool | 2 | 12 50th St, Borough Park | girls | Yiddish');
assert.equal(doe.rows[0].audience, 'girls');
assert.equal(doe.rows[0].language, 'Yiddish');
assert.equal(doe.errors.length, 0);

const waiting = handoffState({ students: [], lsRate: '' }, { name: 'Ada', email: '', discipline: '' });
assert.equal(waiting.sesis.status, 'waiting');
assert.equal(waiting.eweb.written, undefined);
const queued = handoffState(
  { photo: { fileName: 'ada.jpg' }, students: ['A. B.'], lsRate: '45' },
  { name: 'Ada Berg', email: 'ada@example.test', discipline: 'OT' },
);
assert.equal(queued.sesis.opened, false);
assert.equal(queued.badge.printed, false);
assert.equal(queued.eweb.written, false);
assert.equal(queued.payroll.hhaCalled, false);

console.log('staffing checks passed');
