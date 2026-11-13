import assert from 'node:assert/strict';
import { awardDayFromDate, boeClockDecision, canTransition, normalizeAwardStatus } from './boe-status.js';
import { matchAwardedToState, parseAwardedRows, rowToAwarded } from './import-awarded.js';
import { collectQueuedMessages, mailConfigFromEnv, smsConfigFromEnv } from './outbound.js';
import { buildPlaceBidPlan, placeBidEnabled, placeBidForCase } from './sesis-place-bid.js';

assert.equal(normalizeAwardStatus('Awarded - Pending Provider'), 'awarded-pending-provider');
assert.equal(canTransition('awarded-pending-provider', 'awarded-confirmed-provider'), true);
assert.equal(canTransition('awarded-pending-provider', 'active-on-gila'), false);
assert.equal(canTransition('coordinating-start', 'cancelled-bids-rejected'), true);

const now = Date.parse('2026-11-06T12:00:00.000Z');
assert.equal(awardDayFromDate('2026-11-02', now), 5);
const reject = boeClockDecision({ awardDate: '2026-11-01', hasProvider: false, now });
assert.equal(reject.reject, true);
assert.equal(reject.nextStatus, 'cancelled-bids-rejected');
const remind = boeClockDecision({
  awardDate: '2026-11-01',
  hasProvider: true,
  startedAt: '',
  status: 'awarded-confirmed-provider',
  now,
});
assert.equal(remind.remind, true);
assert.equal(remind.reject, false);

const awarded = rowToAwarded({
  'Student ID': '230046667',
  'First Name': 'SARA',
  'Last Name': 'KLINGER',
  'Admin DBN': '20KCIE',
  'Phys Site Bldg Code': '20 KCIE',
  'School Name': 'Sample Pre-K',
  'Service Type': 'Occupational Therapy',
  Lang: 'YIDDISH',
  Freq: '1x Weekly',
  Dur: '30 Minutes',
  Provider: 'Ada Berg',
  'Service Start Date': '2026-11-01',
}, 'preschool');
assert.ok(awarded.caseId.startsWith('S230046667-'));
assert.equal(awarded.discipline, 'OT');

const matched = matchAwardedToState([awarded], {
  cases: [{ id: awarded.caseId, caseId: awarded.caseId, nycId: '230046667', discipline: 'OT' }],
  bids: [{ caseId: awarded.caseId, personId: 'ada' }],
  people: { ada: { id: 'ada', name: 'Ada Berg' } },
});
assert.equal(matched.matched[0].personId, 'ada');
assert.equal(matched.matched[0].status, 'awarded-confirmed-provider');

const pending = matchAwardedToState(parseAwardedRows([{
  'Student ID': '250136984',
  'First Name': 'DAMIEN',
  'Last Name': 'DUNN',
  'Admin DBN': '23K184',
  'Phys Site Bldg Code': '23 K184',
  'School Name': 'PS 184',
  'Service Type': 'Occupational Therapy',
  Freq: '1x Weekly',
  Dur: '30 Minutes',
  Provider: 'Nobody Here',
  'Service Start Date': '2026-10-28',
}], []), { cases: [], bids: [], people: {} });
assert.equal(pending.matched[0].status, 'awarded-pending-provider');
assert.equal(pending.matched[0].personId, '');

assert.equal(placeBidEnabled({ BIDS_SESIS_PLACE_BID: '0' }), false);
assert.equal(placeBidEnabled({ BIDS_SESIS_PLACE_BID: '1' }), true);
const plan = buildPlaceBidPlan({
  caseRow: { id: 'S1', nycId: '1', mandateId: 'M', assignmentId: 'A', program: 'preschool', discipline: 'OT' },
  bid: { personId: 'ada' },
  person: { name: 'Ada Berg' },
});
assert.equal(plan.button, 'ctl00$MainPlaceholder$PlaceBidButton');
const dry = await placeBidForCase({
  caseRow: { id: 'S1', nycId: '1' },
  bid: { personId: 'ada' },
  person: { name: 'Ada' },
  live: false,
});
assert.equal(dry.dryRun, true);
assert.equal(dry.status, 'pending-sesis');

assert.equal(smsConfigFromEnv({}).configured, false);
assert.equal(mailConfigFromEnv({}).from.includes('@'), true);
const queued = collectQueuedMessages({
  districts: [{
    id: 'd1',
    outreach: { messages: [{ kind: 'needs-ask', to: 'a@example.test', subject: 'Needs', body: 'Hi', status: 'ready', sent: false }] },
  }],
  trackers: [{ caseId: 'C1', drafts: { heather: { to: 'Heather Dustas', body: 'draft', sent: false } } }],
  districtAwards: [{ caseId: 'D1', billu: { to: 'bmarkowitz@whiteglovecare.net', subject: 'Training', body: 'start', sent: false } }],
  unfilledCases: [{ id: 'U1', cseNotice: { to: 'CSE', body: 'No provider', sent: false } }],
});
assert.equal(queued.length, 4);

console.log('workflow checks passed');
