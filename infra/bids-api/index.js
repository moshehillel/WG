/**
 * Bids API. Providers, preferences, cases, one bid per child, awards, and the
 * day 1–5 unfilled follow-up, and an append-only offer ledger. Does not read
 * SESIS credentials, does not place a SESIS bid, and does not send SMS.
 * Offer rows are inserted once and never updated or deleted.
 */
import { createPublicKey, createVerify, randomBytes } from 'node:crypto';
import {
  AUDIENCES,
  CSE_REASON,
  CHECKLIST,
  buildSchedule,
  cseDraft,
  draftMessages,
  handoffState,
  matchesProfile,
  nearbyTherapists,
  parseDoeLines,
  placementDue,
  profileComplete,
  readProfile,
  startReminder,
} from './staffing.js';
import {
  QUESTIONS,
  activeAlertOffers,
  advanceInterest,
  advanceOutreach,
  afterStart,
  blankAnswers,
  districtMatch,
  markInterest,
  markReply,
  questionsEmail,
  scheduleConnection,
  startOutreach,
  virtualNow,
} from './districts.js';
import { buildPaGroups, matchKind as importMatchKind } from './import-cases.js';
import { runAwardedImport, runCaseImport } from './import-runner.js';
import {
  AWARD_STATUSES,
  STATUS_LABELS,
  boeClockDecision,
  canTransition,
  normalizeAwardStatus,
} from './boe-status.js';
import { collectQueuedMessages, deliverQueuedMessage, mailConfigFromEnv, smsConfigFromEnv } from './outbound.js';
import { placeBidEnabled, placeBidForCase } from './sesis-place-bid.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const lambdaClient = new LambdaClient({});
const secretsClient = new SecretsManagerClient({});
const SESIS_SECRET_NAME = process.env.SESIS_SECRET_NAME || '';

const PROVIDERS = process.env.TABLE_PROVIDERS;
const PREFERENCES = process.env.TABLE_PREFERENCES;
const CASES = process.env.TABLE_CASES;
const BIDS = process.env.TABLE_BIDS;
const AWARDS = process.env.TABLE_AWARDS;
const UNFILLED = process.env.TABLE_UNFILLED;
const OFFERS = process.env.TABLE_OFFERS;
const DISTRICTS = process.env.TABLE_DISTRICTS;
const DOWNLOADS_BUCKET = process.env.DOWNLOADS_BUCKET || '';
const IMPORT_FUNCTION = process.env.IMPORT_FUNCTION_NAME || '';
const LIVE_CASE_SOURCES = new Set(['sesis', 'DOE email', 'district email']);

const SCHOOLS = {
  '31R192': { name: 'PS 192', address: '500 18th Ave, Brooklyn', area: 'Borough Park', building: 'Main' },
  '31R152': { name: 'PS 152', address: '1800 49th St, Brooklyn', area: 'Midwood', building: 'Main' },
  '31R205': { name: 'PS 205', address: '6701 20th Ave, Brooklyn', area: 'Flatbush', building: 'Annex' },
  '31R180': { name: 'PS 180', address: '5601 16th Ave, Brooklyn', area: 'Midwood', building: 'Main' },
  PRE441: { name: 'Bnos Square Preschool', address: '1234 50th St, Brooklyn', area: 'Borough Park', building: 'Building A' },
  PRE220: { name: 'Yaldei Playgroup', address: '88 Avenue L, Brooklyn', area: 'Flatbush', building: 'Building 1' },
  PRE088: { name: 'Little Steps', address: '410 Bedford Ave, Brooklyn', area: 'Williamsburg', building: 'Site 2' },
};

const AREAS = ['Borough Park', 'Midwood', 'Flatbush', 'Williamsburg'];
let currentActor = null;
const DISCIPLINES = ['OT', 'PT', 'SLP'];
const PROGRAMS = ['preschool', 'school-age'];

const SEED_PROVIDERS = [
  { id: 'rivka', name: 'Rivka Klein', email: 'rivka.klein@example.test', discipline: 'OT', activity: 'active', sampleMiles: 1.2 },
  { id: 'chana', name: 'Chana Weiss', email: 'chana.weiss@example.test', discipline: 'OT', activity: 'active', sampleMiles: 4 },
  { id: 'miriam', name: 'Miriam Adler', email: 'miriam.adler@example.test', discipline: 'SLP', activity: 'active' },
  { id: 'yocheved', name: 'Yocheved Stein', email: 'yocheved.stein@example.test', discipline: 'OT', activity: 'active' },
  { id: 'leah', name: 'Leah Gross', email: 'leah.gross@example.test', discipline: 'OT', activity: 'inactive', sampleMiles: 0.6 },
  { id: 'sara', name: 'Sara Friedman', email: 'sara.friedman@example.test', discipline: 'SLP', activity: 'inactive', sampleMiles: 2.4 },
  { id: 'dina', name: 'Dina Goldberg', email: 'dina.goldberg@example.test', discipline: 'OT', activity: 'inactive', sampleMiles: 3.1 },
  {
    id: 'standin',
    name: 'Demo Stand-in',
    discipline: '',
    activity: 'stand-in',
    note: 'Not a real staff member and not in the portal. No HHAeXchange id. Moshe attaches a bid here after a call, until the real person is known.',
  },
];

const SEED_PREFERENCES = [
  { providerId: 'rivka', location: 'Borough Park', desiredHours: 2, programs: ['preschool', 'school-age'] },
  { providerId: 'chana', location: 'Flatbush', desiredHours: 2, programs: ['preschool', 'school-age'] },
  { providerId: 'miriam', location: 'Midwood', desiredHours: 2, programs: ['school-age'] },
  { providerId: 'yocheved', location: 'Borough Park', desiredHours: 2, programs: ['school-age'] },
  { providerId: 'leah', location: 'Midwood', desiredHours: 2, programs: ['preschool', 'school-age'] },
  { providerId: 'sara', location: 'Midwood', desiredHours: 2, programs: ['school-age'] },
  { providerId: 'dina', location: 'Borough Park', desiredHours: 1, programs: ['preschool'] },
];

const SEED_CASES = [
  { id: 'C-2201', child: 'M. K.', schoolCode: '31R192', program: 'school-age', discipline: 'OT', hoursPerWeek: 2, service: 'OT, 30 min, 2x week', onAwardedReport: true },
  { id: 'C-8801', child: 'A. L.', schoolCode: '31R192', program: 'school-age', discipline: 'OT', hoursPerWeek: 2, service: 'OT, 30 min, 2x week' },
  { id: 'C-3301', child: 'R. S.', schoolCode: '31R192', program: 'school-age', discipline: 'OT', hoursPerWeek: 2, service: 'OT, 30 min, 2x week', race: true },
  { id: 'C-4402', child: 'T. B.', schoolCode: 'PRE441', program: 'preschool', discipline: 'OT', hoursPerWeek: 2, service: 'OT, 30 min, 2x week' },
  { id: 'C-4408', child: 'N. F.', schoolCode: 'PRE441', program: 'preschool', discipline: 'OT', hoursPerWeek: 1, service: 'OT, 30 min, 1x week' },
  { id: 'C-1520', child: 'H. D.', schoolCode: '31R152', program: 'school-age', discipline: 'OT', hoursPerWeek: 2, service: 'OT, 30 min, 2x week' },
  { id: 'C-2055', child: 'S. P.', schoolCode: 'PRE220', program: 'preschool', discipline: 'OT', hoursPerWeek: 2, service: 'OT, 30 min, 2x week', onAwardedReport: true },
  { id: 'C-5100', child: 'E. G.', schoolCode: '31R180', program: 'school-age', discipline: 'SLP', hoursPerWeek: 2, service: 'SLP, 30 min, 2x week' },
  { id: 'C-5108', child: 'L. W.', schoolCode: '31R180', program: 'school-age', discipline: 'SLP', hoursPerWeek: 2, service: 'SLP, 30 min, 2x week', expiringSample: true },
];

const SEED_BIDS = [
  { caseId: 'C-8801', personId: 'yocheved', fillsAvailability: false, remainingHours: 2, enteredBy: 'provider', note: 'Selected in the portal' },
  { caseId: 'C-5100', personId: 'miriam', fillsAvailability: false, remainingHours: 2, enteredBy: 'provider', note: 'Selected in the portal' },
];

const SEED_AWARDS = [
  { caseId: 'C-5100', personId: 'miriam', source: 'awarded-report' },
];

const SEED_UNFILLED = [
  {
    id: 'UA-17',
    child: 'J. C.',
    schoolCode: '31R205',
    program: 'school-age',
    discipline: 'OT',
    service: 'OT, 30 min, 2x week',
    hoursPerWeek: 2,
    day: 1,
    screening: [],
    followNote: '',
  },
  {
    id: 'UA-22',
    child: 'P. N.',
    schoolCode: 'PRE088',
    program: 'preschool',
    discipline: 'OT',
    service: 'OT, 30 min, 2x week',
    hoursPerWeek: 2,
    day: 2,
    screening: [],
    followNote: '',
  },
];

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function fail(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function readBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (raw.length > 400000) throw fail(400, 'Request is too large.');
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Request body must be an object.');
    return data;
  } catch (err) {
    if (err.statusCode) throw err;
    throw fail(400, 'Request body is not valid JSON.');
  }
}

function asId(value, label) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw fail(400, `${label} is not valid.`);
  return id;
}

async function scanAll(table) {
  const items = [];
  let startKey;
  do {
    const out = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: startKey }));
    items.push(...(out.Items || []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function queryCases(program) {
  const items = [];
  let startKey;
  do {
    const out = await ddb.send(new QueryCommand({
      TableName: CASES,
      KeyConditionExpression: '#program = :program',
      ExpressionAttributeNames: { '#program': 'program' },
      ExpressionAttributeValues: { ':program': program },
      ExclusiveStartKey: startKey,
    }));
    items.push(...(out.Items || []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function getItem(table, key) {
  const out = await ddb.send(new GetCommand({ TableName: table, Key: key }));
  return out.Item || null;
}

async function putIfAbsent(table, keyName, item) {
  try {
    await ddb.send(new PutCommand({
      TableName: table,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#k)',
      ExpressionAttributeNames: { '#k': keyName },
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

async function ensureSeed() {
  const ready = await getItem(PROVIDERS, { id: '_ready' });
  if (ready) return;
  for (const row of SEED_CASES) {
    await putIfAbsent(CASES, 'caseId', { ...row, caseId: row.id, source: 'seed' });
  }
  for (const row of SEED_PREFERENCES) await putIfAbsent(PREFERENCES, 'providerId', row);
  for (const row of SEED_BIDS) await putIfAbsent(BIDS, 'caseId', row);
  for (const row of SEED_AWARDS) await putIfAbsent(AWARDS, 'caseId', row);
  for (const row of SEED_UNFILLED) await putIfAbsent(UNFILLED, 'id', row);
  for (const row of SEED_PROVIDERS) await putIfAbsent(PROVIDERS, 'id', row);
  await putIfAbsent(PROVIDERS, 'id', { id: '_ready', activity: 'system' });
}

function programLabel(value) {
  return value === 'preschool' ? 'Preschool' : 'School age';
}

function hoursLabel(hours) {
  return `${hours} hr${hours === 1 ? '' : 's'}/week`;
}

function opportunityText(row) {
  const place = SCHOOLS[row.schoolCode] || { name: row.schoolCode };
  return `White Glove: ${place.name}, ${programLabel(row.program)}, ${row.service}, ${hoursLabel(row.hoursPerWeek)}. Open the portal to respond. Reply STOP to opt out.`;
}

function publicBid(bid) {
  return {
    caseId: bid.caseId,
    personId: bid.personId,
    fillsAvailability: bid.fillsAvailability ?? null,
    remainingHours: bid.remainingHours ?? null,
    enteredBy: bid.enteredBy || 'provider',
    note: bid.note || '',
  };
}

function decorateOpportunity(row, bid, award) {
  const copy = { ...row };
  delete copy.caseId;
  const reopened = Boolean(award?.schoolRejected) || award?.providerResponse === 'declined' || Boolean(bid?.released);
  if (bid && !reopened) {
    copy.takenBy = bid.personId;
    delete copy.race;
  } else if (bid?.priorPersonId || bid?.personId) {
    copy.priorPersonId = bid.priorPersonId || bid.personId;
  }
  if (award) {
    copy.tracker = publicTracker(award);
    if (reopened) {
      copy.reopened = true;
      copy.awarded = false;
    } else {
      copy.awarded = true;
    }
  }
  if (copy.decision == null) copy.decision = null;
  delete copy.interests;
  delete copy.recruiterQueue;
  delete copy.interestEscalation;
  return copy;
}

function buildPreview(row, providers) {
  const recipients = providers
    .filter((who) => who.activity === 'active')
    .map((who) => ({
      id: who.id,
      name: who.name,
      discipline: who.discipline || '',
      activity: who.activity,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: row.id,
    sent: false,
    message: opportunityText(row),
    recipients,
    recipientCount: recipients.length,
  };
}

async function snapshot() {
  await ensureSeed();
  const [providerItems, preferenceItems, preschool, schoolAge, bidItems, awardItems, unfilledItems] = await Promise.all([
    scanAll(PROVIDERS),
    scanAll(PREFERENCES),
    queryCases('preschool'),
    queryCases('school-age'),
    scanAll(BIDS),
    scanAll(AWARDS),
    scanAll(UNFILLED),
  ]);
  const providers = providerItems.filter((row) => row.id && !String(row.id).startsWith('_'));
  const prefs = new Map(preferenceItems.map((row) => [row.providerId, row]));
  const people = {};
  for (const row of providers) {
    const pref = prefs.get(row.id);
    people[row.id] = {
      id: row.id,
      name: row.name,
      email: row.email || '',
      discipline: row.discipline || '',
      activity: row.activity,
      note: row.note || undefined,
      sampleMiles: row.sampleMiles,
      location: pref?.location || '',
      address: pref?.address || '',
      desiredHours: pref?.desiredHours ?? null,
      programs: Array.isArray(pref?.programs) ? pref.programs : [],
      languages: Array.isArray(pref?.languages) ? pref.languages : [],
      gender: pref?.gender || '',
      availability: pref?.availability || '',
      role: row.role || '',
    };
    people[row.id].profileComplete = profileComplete({ ...people[row.id], discipline: row.discipline || '' });
    if (people[row.id].note == null) delete people[row.id].note;
    if (people[row.id].sampleMiles == null) delete people[row.id].sampleMiles;
    if (!people[row.id].email) delete people[row.id].email;
  }
  const bidByCase = new Map(bidItems.map((row) => [row.caseId, row]));
  const awardByCase = new Map(awardItems.map((row) => [row.caseId, row]));
  await applyPlacementClock(unfilledItems, bidByCase);
  await applyAwardClocks(awardItems, bidByCase);
  await syncAwardHandoffs(awardItems, people);
  const districtFlow = await syncDistrictFlow(people, [...preschool, ...schoolAge], awardItems);
  const importMeta = await getItem(PROVIDERS, { id: '_import' });
  const awardedImportMeta = await getItem(PROVIDERS, { id: '_awarded_import' });
  const useLiveCases = Boolean(importMeta?.lastAt);
  const cases = [...preschool, ...schoolAge]
    .map((row) => decorateOpportunity(row, bidByCase.get(row.id), awardByCase.get(row.id)))
    .filter((row) => {
      if (!useLiveCases) return true;
      if (LIVE_CASE_SOURCES.has(row.source)) return true;
      return false;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const groups = buildPaGroups(cases);
  const unfilledRows = unfilledItems
    .map((row) => {
      const bid = bidByCase.get(row.id);
      const copy = decorateOpportunity(row, bid, awardByCase.get(row.id));
      if (bid && !bid.released) copy.responder = bid.personId;
      else copy.responder = '';
      copy.screening = Array.isArray(row.screening) ? row.screening : [];
      copy.followNote = row.followNote || '';
      copy.day = Number(row.day) || 1;
      return copy;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const primary = unfilledRows.find((row) => row.id === 'UA-17') || unfilledRows[0] || null;
  const notices = [];
  for (const award of awardItems) {
    if (award.source === 'district') continue;
    const row = cases.find((item) => item.id === award.caseId) || unfilledRows.find((item) => item.id === award.caseId);
    const who = people[award.personId];
    const bid = bidByCase.get(award.caseId);
    if (!row || !who) continue;
    const place = SCHOOLS[row.schoolCode] || { name: row.schoolCode };
    if (award.source === 'awarded-report') {
      const program = row.program === 'preschool' ? 'preschool' : 'school age';
      notices.push({
        audience: 'coordinator',
        text: `Awarded-report match: ${who.name} was awarded ${row.id} at ${place.name} (${program}, ${row.discipline}). Proceed with the next steps.`,
      });
    } else {
      const full = bid && bid.remainingHours === 0;
      const left = bid && bid.remainingHours != null ? bid.remainingHours : null;
      notices.push({
        audience: 'coordinator',
        text: `Awarded: ${who.name} was awarded ${row.id} at ${place.name} (${programLabel(row.program)}). Proceed with the next steps.${full ? ' Hours left are 0, so other opportunities are hidden.' : left != null ? ` Hours left: ${left}. Cases that fit stay visible.` : ''}`,
      });
    }
    notices.push({
      audience: award.personId,
      text: `Your selection ${row.id} is awarded. You and Moshe can proceed with the next steps.`,
    });
  }
  const activeProviders = providers.filter((who) => who.activity === 'active' && who.role !== 'admin' && people[who.id]?.profileComplete);
  const trackers = awardItems.filter((award) => award.source !== 'district').map((award) => {
    const row = cases.find((item) => item.id === award.caseId) || unfilledItems.find((item) => item.id === award.caseId) || {};
    const place = SCHOOLS[row.schoolCode] || {};
    const tracker = publicTracker(award, people[award.personId], { ...row, area: row.area || place.area || '' });
    if (award.providerResponse === 'declined' || award.schoolRejected) {
      tracker.nearby = nearbyTherapists(Object.values(people), {
        ...row,
        area: row.area || place.area || '',
        audience: row.audience || 'either',
      });
    }
    return tracker;
  });
  const reminders = trackers.filter((item) => item.startReminder?.remind).map((item) => ({
    caseId: item.caseId,
    providerName: item.providerName,
    text: item.startReminder.text,
    reject: false,
  }));
  const openBoeAwards = trackers.filter((item) => {
    const status = normalizeAwardStatus(item.status);
    return status !== 'active-on-gila' && status !== 'cancelled-bids-rejected';
  });
  const districtEscalations = (districtFlow.districts || []).filter((d) => d.outreach?.status === 'escalated');
  const recruiterQueue = (districtFlow.needs || []).flatMap((need) => (need.recruiterQueue || []).map((row) => ({
    ...row,
    caseId: need.id,
    schoolName: need.schoolName,
  })));
  const queuedMessages = currentActor?.role === 'admin'
    ? collectQueuedMessages({
      districts: districtFlow.districts || [],
      trackers,
      districtAwards: districtFlow.awards || [],
      unfilledCases: unfilledRows,
    })
    : [];
  const body = {
    ok: true,
    people,
    cases,
    bids: bidItems.map(publicBid),
    unfilled: primary,
    unfilledCases: unfilledRows,
    notices,
    preview: primary && primary.status !== 'rejected'
      ? buildPreview(primary, activeProviders.filter((who) => matchesProfile(people[who.id], primary)))
      : { sent: false, message: '', recipients: [], recipientCount: 0 },
    trackers,
    reminders,
    groups,
    importMeta: importMeta ? {
      lastAt: importMeta.lastAt || '',
      source: importMeta.source || '',
      caseCount: importMeta.caseCount ?? null,
      written: importMeta.written ?? null,
      updated: importMeta.updated ?? null,
      withAddress: importMeta.withAddress ?? null,
      blankAddress: importMeta.blankAddress ?? null,
      preschoolRows: importMeta.preschoolRows ?? null,
      schoolAgeRows: importMeta.schoolAgeRows ?? null,
    } : null,
    awardedImportMeta: awardedImportMeta ? {
      lastAt: awardedImportMeta.lastAt || '',
      source: awardedImportMeta.source || '',
      awardedRows: awardedImportMeta.awardedRows ?? null,
      awardsWritten: awardedImportMeta.awardsWritten ?? null,
      confirmed: awardedImportMeta.confirmed ?? null,
      pending: awardedImportMeta.pending ?? null,
    } : null,
    openBoeAwards: currentActor?.role === 'admin' ? openBoeAwards : [],
    districtEscalations: currentActor?.role === 'admin' ? districtEscalations : [],
    recruiterQueue: currentActor?.role === 'admin' ? recruiterQueue : [],
    queuedMessages,
    queuedCount: queuedMessages.length,
    smsConfigured: smsConfigFromEnv().configured,
    placeBidLive: placeBidEnabled(process.env),
    mailFrom: mailConfigFromEnv().from,
    districts: currentActor?.role === 'admin' ? districtFlow.districts : [],
    districtNeeds: currentActor?.role === 'admin' ? districtFlow.needs : [],
    districtAwards: currentActor?.role === 'admin' ? districtFlow.awards : [],
    districtClockDays: currentActor?.role === 'admin' ? districtFlow.clockOffsetDays : 0,
    downloadsConfigured: Boolean(process.env.DOWNLOADS_BUCKET),
    me: currentActor
      ? {
          id: currentActor.id,
          email: currentActor.email,
          role: currentActor.role,
          name: currentActor.name,
          discipline: currentActor.discipline || '',
        }
      : null,
  };
  await recordLedger(body);
  return body;
}

function offerSnapshot(row) {
  const place = SCHOOLS[row.schoolCode] || { name: '', address: '', building: '' };
  return {
    school: row.schoolName || place.name || row.schoolCode || '',
    building: row.building || place.building || '',
    program: row.program === 'preschool' ? 'preschool' : 'school-age',
    service: String(row.service || ''),
    hours: Number(row.hoursPerWeek) || 0,
    address: row.address || place.address || '',
  };
}

function publicOffer(row) {
  return {
    providerId: row.providerId,
    offerId: row.offerId,
    opportunityId: row.opportunityId,
    sentAt: row.sentAt,
    channel: row.channel,
    sent: row.sent === true,
    snapshot: row.snapshot || {},
    triggeredBy: row.triggeredBy === 'admin' ? 'admin' : 'system',
  };
}

async function putOfferOnce(item) {
  if (!OFFERS) return;
  try {
    await ddb.send(new PutCommand({
      TableName: OFFERS,
      Item: item,
      ConditionExpression: 'attribute_not_exists(providerId) AND attribute_not_exists(offerId)',
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

async function queryOffers(providerId) {
  if (!OFFERS) return [];
  const items = [];
  let startKey;
  do {
    const out = await ddb.send(new QueryCommand({
      TableName: OFFERS,
      KeyConditionExpression: 'providerId = :providerId',
      ExpressionAttributeValues: { ':providerId': providerId },
      ExclusiveStartKey: startKey,
    }));
    items.push(...(out.Items || []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items
    .map(publicOffer)
    .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
}

function hoursLeftFor(who, state) {
  const awarded = (state.bids || []).filter((bid) => bid.personId === who.id && bid.remainingHours != null);
  const held = awarded.filter((bid) => {
    const row = (state.cases || []).find((item) => item.id === bid.caseId);
    return row && row.awarded && row.takenBy === who.id;
  });
  if (!held.length) return null;
  return Math.min(...held.map((bid) => bid.remainingHours));
}

function casesShownTo(who, state) {
  if (!profileComplete(who)) return [];
  const left = hoursLeftFor(who, state);
  if (left === 0) return [];
  return (state.cases || []).filter((row) => {
    if (row.source === 'district email') {
      if (who.activity === 'inactive' && !row.inactivePreviewAt) return false;
      if (who.activity !== 'active' && who.activity !== 'inactive') return false;
      if (!districtMatch(who, row)) return false;
    } else if (!matchesProfile(who, row)) return false;
    if (row.awarded && row.takenBy === who.id) return false;
    if (left != null && row.hoursPerWeek > left) return false;
    // Distance uses area derived from her street address and the school address.
    importMatchKind(row, who);
    return true;
  });
}

async function recordLedger(state) {
  const people = Object.values(state.people || {}).filter((who) => who.id && who.id !== 'standin' && who.role !== 'admin' && who.activity !== 'admin' && who.activity !== 'stand-in');
  const writes = [];
  const now = new Date().toISOString();
  for (const row of state.unfilledCases || []) {
    const day = Number(row.day) || 1;
    let audience = [];
    if (day === 1) audience = people.filter((who) => who.activity === 'active');
    else if (day === 2 || day === 3) audience = people.filter((who) => who.activity === 'inactive');
    else continue;
    for (const who of audience) {
      if (!who.profileComplete || !matchesProfile(who, row)) continue;
      writes.push(putOfferOnce({
        providerId: who.id,
        offerId: `sms#day${day}#${row.id}`,
        opportunityId: row.id,
        sentAt: now,
        channel: 'sms',
        sent: false,
        snapshot: offerSnapshot(row),
        triggeredBy: 'system',
      }));
    }
  }
  if (currentActor && currentActor.role === 'therapist' && state.people[currentActor.id]) {
    const who = state.people[currentActor.id];
    for (const row of casesShownTo(who, state)) {
      writes.push(putOfferOnce({
        providerId: who.id,
        offerId: `portal#shown#${row.id}`,
        opportunityId: row.id,
        sentAt: now,
        channel: 'portal',
        sent: false,
        snapshot: offerSnapshot(row),
        triggeredBy: 'system',
      }));
    }
  }
  await Promise.all(writes);
}

async function listOffers(event) {
  requireAdmin();
  const providerId = asId(event.queryStringParameters?.providerId, 'Provider');
  const provider = await getItem(PROVIDERS, { id: providerId });
  if (!provider || String(provider.id).startsWith('_')) throw fail(404, 'That provider is not in the Bids database.');
  return { status: 200, body: { ok: true, offers: await queryOffers(providerId) } };
}

async function recordOutreach(event) {
  requireAdmin();
  const body = readBody(event);
  const providerId = asId(body.providerId, 'Provider');
  const opportunityId = asId(body.opportunityId, 'Opportunity');
  const channel = body.channel === 'email' ? 'email' : body.channel === 'sms' ? 'sms' : body.channel === 'portal' ? 'portal' : '';
  if (!channel) throw fail(400, 'Channel must be portal, sms, or email.');
  const provider = await getItem(PROVIDERS, { id: providerId });
  if (!provider || String(provider.id).startsWith('_')) throw fail(404, 'That provider is not in the Bids database.');
  const state = await snapshot();
  const row = (state.cases || []).find((item) => item.id === opportunityId)
    || (state.unfilledCases || []).find((item) => item.id === opportunityId);
  if (!row) throw fail(404, 'That opportunity is not in the Bids database.');
  const person = state.people[providerId];
  if (!person?.profileComplete) throw fail(403, 'She finishes her profile before an opportunity is offered.');
  if (!matchesProfile(person, row)) throw fail(403, 'This opportunity does not match the profile she saved.');
  const sentAt = new Date().toISOString();
  const offerId = `outreach#${sentAt}#${randomBytes(3).toString('hex')}`;
  await putOfferOnce({
    providerId,
    offerId,
    opportunityId,
    sentAt,
    channel,
    sent: body.sent === true || body.sent === 'yes',
    snapshot: offerSnapshot(row),
    triggeredBy: 'admin',
  });
  return {
    status: 201,
    body: {
      ok: true,
      offers: await queryOffers(providerId),
      message: 'The outreach is saved on her offer history.',
    },
  };
}

function personName(people, id) {
  return people[id]?.name || 'Another therapist';
}

async function lockedBid(personId, bidItems, awardByCase) {
  for (const bid of bidItems) {
    if (bid.personId !== personId || bid.remainingHours !== 0) continue;
    if (awardByCase.has(bid.caseId)) return bid;
  }
  return null;
}

async function createBid(event) {
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const personId = asId(body.personId, 'Provider');
  if (currentActor && currentActor.role !== 'admin' && personId !== currentActor.id) {
    throw fail(403, 'You can only save a bid for your own login.');
  }
  const enteredBy = body.enteredBy === 'coordinator' ? 'coordinator' : 'provider';
  const note = String(body.note || '').trim().slice(0, 160);
  const state = await snapshot();
  if (!state.people[personId]) throw fail(404, 'That provider is not in the Bids database.');
  if (!state.people[personId].profileComplete) {
    throw fail(403, 'Finish your profile before a case can be offered.');
  }
  const opportunity = state.cases.find((row) => row.id === caseId)
    || (state.unfilledCases || []).find((row) => row.id === caseId);
  if (!opportunity) throw fail(404, 'That case is not in the Bids database.');
  if (!matchesProfile(state.people[personId], opportunity)) {
    throw fail(403, 'This case does not match the saved profile.');
  }
  if (opportunity.awarded) {
    return conflict(state, `${personName(state.people, opportunity.takenBy)} was awarded this case from the awarded-case report. Another bid cannot be saved.`);
  }
  if (opportunity.takenBy) {
    return conflict(state, `${personName(state.people, opportunity.takenBy)} already selected this case. Two therapists cannot select the same child. Your bid will not be saved.`);
  }
  const awardItems = await scanAll(AWARDS);
  const awardByCase = new Map(awardItems.map((row) => [row.caseId, row]));
  const bidItems = await scanAll(BIDS);
  if (await lockedBid(personId, bidItems, awardByCase)) {
    return conflict(state, 'You are fully booked, so this case is closed for a new bid.');
  }
  const existingBid = bidItems.find((bid) => bid.caseId === caseId);
  if (existingBid && (existingBid.released || opportunity.reopened)) {
    await ddb.send(new PutCommand({
      TableName: BIDS,
      Item: {
        caseId,
        personId,
        enteredBy,
        note,
        createdAt: new Date().toISOString(),
        released: false,
        priorPersonId: existingBid.priorPersonId || existingBid.personId || '',
      },
    }));
    return { status: 200, body: await snapshot() };
  }
  try {
    await ddb.send(new PutCommand({
      TableName: BIDS,
      Item: { caseId, personId, enteredBy, note, createdAt: new Date().toISOString() },
      ConditionExpression: 'attribute_not_exists(caseId)',
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
    const latest = await snapshot();
    const holder = latest.cases.find((row) => row.id === caseId)?.takenBy
      || latest.unfilledCases.find((row) => row.id === caseId)?.takenBy;
    return conflict(latest, `${personName(latest.people, holder)} already selected this case. Two therapists cannot select the same child. Your bid will not be saved.`);
  }
  return { status: 200, body: await snapshot() };
}

function conflict(state, error) {
  return { status: 409, body: { ...state, ok: false, error } };
}

async function saveAvailability(event) {
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const personId = asId(body.personId, 'Provider');
  if (currentActor && currentActor.role !== 'admin' && personId !== currentActor.id) {
    throw fail(403, 'You can only answer for your own bid.');
  }
  const fills = body.fills === true || body.fills === 'yes';
  const hoursLeft = Number(body.hoursLeft);
  if (!fills && (!Number.isFinite(hoursLeft) || hoursLeft <= 0 || hoursLeft > 40)) {
    throw fail(400, 'Enter the hours she still has.');
  }
  const bid = await getItem(BIDS, { caseId });
  if (!bid || bid.personId !== personId) throw fail(404, 'That bid is not in the Bids database.');
  const award = await getItem(AWARDS, { caseId });
  if (award) throw fail(409, 'This bid is already awarded.');
  const remainingHours = fills ? 0 : Math.round(hoursLeft);
  await ddb.send(new UpdateCommand({
    TableName: BIDS,
    Key: { caseId },
    UpdateExpression: 'SET remainingHours = :hours, fillsAvailability = :fills',
    ExpressionAttributeValues: { ':hours': remainingHours, ':fills': fills },
  }));
  return { status: 200, body: await snapshot() };
}

async function awardBid(event) {
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const bid = await getItem(BIDS, { caseId });
  if (!bid) throw fail(404, 'A bid has to be saved before it can be awarded.');
  const now = new Date().toISOString();
  await putIfAbsent(AWARDS, 'caseId', {
    caseId,
    personId: bid.personId,
    source: 'portal',
    awardedAt: now,
    awardDate: now.slice(0, 10),
    status: 'awarded-confirmed-provider',
    remainingHours: bid.remainingHours ?? null,
  });
  return { status: 200, body: await snapshot() };
}

async function createProvider(event) {
  const body = readBody(event);
  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  const discipline = String(body.discipline || '');
  const activity = body.activity === 'inactive' ? 'inactive' : 'active';
  if (!name || !email || !email.includes('@')) throw fail(400, 'Name and login email are required.');
  const state = await snapshot();
  if (Object.values(state.people).some((who) => (who.email || '').toLowerCase() === email)) {
    return conflict(state, 'That login is already on a provider.');
  }
  const id = providerIdFromEmail(email, Object.keys(state.people));
  await putIfAbsent(PROVIDERS, 'id', { id, name, email, discipline: '', activity });
  await putIfAbsent(PREFERENCES, 'providerId', {
    providerId: id,
    location: '',
    address: '',
    desiredHours: null,
    programs: [],
    languages: [],
    gender: '',
    availability: '',
  });
  const next = await snapshot();
  return { status: 200, body: { ...next, providerId: id } };
}

function providerIdFromEmail(email, existingIds) {
  const stem = email.split('@')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';
  let id = stem;
  let n = 2;
  const ids = new Set(existingIds);
  while (ids.has(id) || id.startsWith('_')) {
    id = `${stem}-${n}`;
    n += 1;
  }
  return id;
}

function areaInAddress(address) {
  const text = String(address || '').toLowerCase();
  return AREAS.find((area) => text.includes(area.toLowerCase())) || '';
}

async function savePreferences(event) {
  const body = readBody(event);
  const providerId = asId(body.providerId, 'Provider');
  if (!currentActor || currentActor.role === 'admin' || providerId !== currentActor.id) {
    throw fail(403, 'The therapist saves her own profile. An admin does not enter it for her.');
  }
  const provider = await getItem(PROVIDERS, { id: providerId });
  if (!provider || String(provider.id).startsWith('_')) throw fail(404, 'That provider is not in the Bids database.');
  const { profile, gaps } = readProfile(body);
  if (gaps.length) throw fail(400, `Save the full profile first: ${gaps.join(', ')}.`);
  const namedArea = areaInAddress(profile.address);
  const requestedLocation = String(body.location || '').trim();
  const location = namedArea || (AREAS.includes(requestedLocation) ? requestedLocation : '');
  if (!location) throw fail(400, 'Include Borough Park, Midwood, Flatbush, or Williamsburg in the street address.');
  await ddb.send(new PutCommand({
    TableName: PREFERENCES,
    Item: {
      providerId,
      location,
      address: profile.address,
      desiredHours: profile.desiredHours,
      programs: profile.programs,
      languages: profile.languages,
      gender: profile.gender,
      availability: profile.availability,
    },
  }));
  await ddb.send(new UpdateCommand({
    TableName: PROVIDERS,
    Key: { id: providerId },
    UpdateExpression: 'SET discipline = :discipline',
    ExpressionAttributeValues: { ':discipline': profile.discipline },
  }));
  return { status: 200, body: await snapshot() };
}

async function createCase(event) {
  const body = readBody(event);
  const id = asId(body.id, 'Case');
  const program = body.program === 'preschool' ? 'preschool' : body.program === 'school-age' ? 'school-age' : '';
  const discipline = String(body.discipline || '');
  const schoolCode = String(body.schoolCode || '').trim();
  const child = String(body.child || '').trim().slice(0, 40);
  const service = String(body.service || '').trim().slice(0, 80);
  const hoursPerWeek = Number(body.hoursPerWeek);
  if (!program) throw fail(400, 'Program must be preschool or school-age.');
  if (!DISCIPLINES.includes(discipline)) throw fail(400, 'Discipline must be OT, PT, or SLP.');
  if (!SCHOOLS[schoolCode]) throw fail(400, 'That school code is not on file.');
  if (!child || !service) throw fail(400, 'Child and service are required.');
  if (!Number.isFinite(hoursPerWeek) || hoursPerWeek < 1 || hoursPerWeek > 40) {
    throw fail(400, 'Hours per week are not valid.');
  }
  await putIfAbsent(CASES, 'caseId', {
    id,
    caseId: id,
    child,
    schoolCode,
    program,
    discipline,
    hoursPerWeek: Math.round(hoursPerWeek),
    service,
  });
  return { status: 200, body: await snapshot() };
}

async function saveUnfilled(event) {
  const body = readBody(event);
  const id = asId(body.id, 'Opportunity');
  const existing = await getItem(UNFILLED, { id });
  if (!existing) throw fail(404, 'That unfilled award is not in the Bids database.');
  if (existing.status === 'rejected') return { status: 200, body: await snapshot() };
  const day = Number(body.day);
  if (!Number.isInteger(day) || day < 1 || day > 5) throw fail(400, 'Day must be 1 through 5.');
  const screening = Array.isArray(body.screening) ? body.screening.map((value) => asId(value, 'Provider')) : [];
  if (screening.length > 50) throw fail(400, 'Screening list is too long.');
  const followNote = String(body.followNote || '').trim().slice(0, 2000);
  let decision = null;
  if (body.decision) {
    const action = body.decision.action === 'reject' ? 'reject' : body.decision.action === 'keep' ? 'keep' : '';
    const reason = String(body.decision.reason || '').trim().slice(0, 180);
    if (!action || !reason) throw fail(400, 'Day 5 needs a reason and a choice to keep or reject.');
    decision = { action, reason };
  }
  if (decision) {
    await ddb.send(new UpdateCommand({
      TableName: UNFILLED,
      Key: { id },
      UpdateExpression: 'SET #day = :day, screening = :screening, followNote = :note, #decision = :decision',
      ExpressionAttributeNames: { '#day': 'day', '#decision': 'decision' },
      ExpressionAttributeValues: { ':day': day, ':screening': screening, ':note': followNote, ':decision': decision },
    }));
  } else {
    await ddb.send(new UpdateCommand({
      TableName: UNFILLED,
      Key: { id },
      UpdateExpression: 'SET #day = :day, screening = :screening, followNote = :note REMOVE #decision',
      ExpressionAttributeNames: { '#day': 'day', '#decision': 'decision' },
      ExpressionAttributeValues: { ':day': day, ':screening': screening, ':note': followNote },
    }));
  }
  return { status: 200, body: await snapshot() };
}

function b64url(value) {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

let jwksCache = { at: 0, keys: [] };

async function cognitoJwks() {
  const pool = process.env.USER_POOL_ID || '';
  const region = process.env.AWS_REGION || 'us-east-1';
  if (jwksCache.keys.length && Date.now() - jwksCache.at < 60 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/${pool}/.well-known/jwks.json`);
  if (!res.ok) throw fail(401, 'Sign in is not set up on the server.');
  const data = await res.json();
  jwksCache = { at: Date.now(), keys: data.keys || [] };
  return jwksCache.keys;
}

async function verifyIdToken(token) {
  const pool = process.env.USER_POOL_ID || '';
  const clientId = process.env.USER_POOL_CLIENT_ID || '';
  const region = process.env.AWS_REGION || 'us-east-1';
  if (!pool || !clientId) throw fail(401, 'Sign in is not set up on the server.');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw fail(401, 'Sign in required.');
  let header;
  let payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch {
    throw fail(401, 'Your sign in expired or is not valid. Please sign in again.');
  }
  const keys = await cognitoJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw fail(401, 'Your sign in expired or is not valid. Please sign in again.');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(key, b64url(parts[2]))) {
    throw fail(401, 'Your sign in expired or is not valid. Please sign in again.');
  }
  const iss = `https://cognito-idp.${region}.amazonaws.com/${pool}`;
  if (payload.iss !== iss || payload.token_use !== 'id' || payload.aud !== clientId) {
    throw fail(401, 'Your sign in expired or is not valid. Please sign in again.');
  }
  if (!payload.exp || payload.exp * 1000 < Date.now()) {
    throw fail(401, 'Your sign in expired or is not valid. Please sign in again.');
  }
  return payload;
}

async function actorFromToken(payload) {
  const email = String(payload.email || payload['cognito:username'] || '').trim().toLowerCase();
  const groups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'].map(String) : [];
  const role = groups.includes('Admin') || groups.includes('admin') ? 'admin' : 'therapist';
  const sub = String(payload.sub || '');
  const name = String(payload.name || email);
  if (!email) throw fail(401, 'Token missing email.');
  await ensureSeed();
  const providers = (await scanAll(PROVIDERS)).filter((row) => row.id && !String(row.id).startsWith('_'));
  let row = providers.find((item) => (item.email || '').toLowerCase() === email) || providers.find((item) => item.cognitoSub === sub);
  if (!row) {
    const id = providerIdFromEmail(email, providers.map((item) => item.id));
    row = {
      id,
      email,
      name,
      discipline: '',
      activity: role === 'admin' ? 'admin' : 'active',
      role,
      cognitoSub: sub,
    };
    await putIfAbsent(PROVIDERS, 'id', row);
    if (role === 'therapist') {
      await putIfAbsent(PREFERENCES, 'providerId', {
        providerId: id,
        location: '',
        address: '',
        desiredHours: null,
        programs: [],
        languages: [],
        gender: '',
        availability: '',
      });
    }
  } else if (row.cognitoSub !== sub || row.role !== role) {
    await ddb.send(new UpdateCommand({
      TableName: PROVIDERS,
      Key: { id: row.id },
      UpdateExpression: 'SET cognitoSub = :sub, #role = :role, email = :email',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':sub': sub, ':role': role, ':email': email },
    }));
    row = { ...row, cognitoSub: sub, role, email };
  }
  if (row.active === false) throw fail(403, 'This account is deactivated. Ask another admin to restore access.');
  return {
    id: row.id,
    email,
    role,
    name: row.name || name,
    discipline: row.discipline || '',
    sub,
  };
}

async function authenticate(event) {
  const headers = event.headers || {};
  const raw = headers.authorization || headers.Authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token || token === 'admin' || token === 'therapist') {
    return { error: 'Sign in required.', status: 401 };
  }
  try {
    const payload = await verifyIdToken(token);
    return { actor: await actorFromToken(payload) };
  } catch (err) {
    if (err.statusCode) return { error: err.message, status: err.statusCode };
    console.error('bids-api', err.name || 'AuthError');
    return { error: 'Your sign in expired or is not valid. Please sign in again.', status: 401 };
  }
}

function requireAdmin() {
  if (!currentActor || currentActor.role !== 'admin') throw fail(403, 'Admin only.');
}

async function inviteTherapist(event) {
  requireAdmin();
  const body = readBody(event);
  const name = String(body.name || body.displayName || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  if (!name || !email.includes('@')) throw fail(400, 'Name and login email are required.');
  const pool = process.env.USER_POOL_ID || '';
  if (!pool) throw fail(401, 'Sign in is not set up on the server.');
  const {
    CognitoIdentityProviderClient,
    AdminCreateUserCommand,
    AdminAddUserToGroupCommand,
    AdminRemoveUserFromGroupCommand,
  } = await import('@aws-sdk/client-cognito-identity-provider');
  const cognito = new CognitoIdentityProviderClient({});
  let username = email;
  try {
    const created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: pool,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: name },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    }));
    username = created.User?.Username || email;
  } catch (err) {
    if (err.name !== 'UsernameExistsException') {
      console.error('bids-api', err.name || 'InviteError');
      throw fail(400, 'The invitation email could not be sent.');
    }
  }
  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: pool,
    Username: username,
    GroupName: 'Therapist',
  }));
  try {
    await cognito.send(new AdminRemoveUserFromGroupCommand({
      UserPoolId: pool,
      Username: username,
      GroupName: 'Admin',
    }));
  } catch {
    /* already absent from Admin */
  }
  const providers = (await scanAll(PROVIDERS)).filter((row) => row.id && !String(row.id).startsWith('_'));
  if (providers.some((row) => (row.email || '').toLowerCase() === email)) {
    const state = await snapshot();
    return { status: 200, body: { ...state, message: 'Existing login linked. They can use Forgot password if they need a new one.' } };
  }
  const id = providerIdFromEmail(email, providers.map((row) => row.id));
  await putIfAbsent(PROVIDERS, 'id', {
    id,
    name,
    email,
    discipline: '',
    activity: 'active',
    role: 'therapist',
    cognitoSub: username,
  });
  await putIfAbsent(PREFERENCES, 'providerId', {
    providerId: id,
    location: '',
    address: '',
    desiredHours: null,
    programs: [],
    languages: [],
    gender: '',
    availability: '',
  });
  const state = await snapshot();
  return {
    status: 201,
    body: {
      ...state,
      providerId: id,
      message: 'Therapist invite created. Cognito emailed a temporary password. She completes her own profile before any case is offered.',
    },
  };
}

async function previewOnly(event) {
  const state = await snapshot();
  const id = event.queryStringParameters?.id || 'UA-17';
  const row = (state.unfilledCases || []).find((item) => item.id === id) || (id === state.unfilled?.id ? state.unfilled : null);
  if (!row) throw fail(404, 'That opportunity is not in the Bids database.');
  const providers = Object.values(state.people);
  return { status: 200, body: { ok: true, ...buildPreview(row, providers), sent: false } };
}

function publicTracker(award, person, row) {
  const provider = person || null;
  const handoff = handoffState(award, provider);
  const steps = CHECKLIST.map((step) => {
    if (step.owner === 'system') {
      const record = step.id === 'sesisAccess' ? handoff.sesis
        : step.id === 'photoRequest' ? handoff.badge
          : step.id === 'ewebFiles' ? handoff.eweb
            : handoff.payroll;
      const done = record.status === 'queued' || record.status === 'recorded';
      return { ...step, done, by: done ? 'system' : '', missing: record.missing || '', detail: record.note || '' };
    }
    const mark = award.steps?.[step.id];
    return { ...step, done: Boolean(mark?.done), by: mark?.by || '', at: mark?.at || '', missing: '', detail: '' };
  });
  return {
    caseId: award.caseId,
    schoolName: award.schoolName || row?.schoolName || '',
    caseload: award.caseload || '',
    discipline: award.discipline || row?.discipline || provider?.discipline || '',
    providerName: award.providerName || provider?.name || '',
    providerId: award.personId || '',
    transmittals: award.transmittals ?? null,
    awardDate: award.awardDate || '',
    status: normalizeAwardStatus(award.status),
    statusLabel: STATUS_LABELS[normalizeAwardStatus(award.status)] || award.status || '',
    providerResponse: award.providerResponse || '',
    schoolRejected: Boolean(award.schoolRejected),
    startedAt: award.startedAt || '',
    sesisPlaceBid: award.sesisPlaceBid || null,
    students: Array.isArray(award.students) ? award.students : [],
    lsRate: award.lsRate || '',
    mandates: award.mandates || '',
    studentSchedules: award.studentSchedules || '',
    schoolHours: award.schoolHours || '',
    photo: award.photo?.fileName ? { fileName: award.photo.fileName, stored: true } : null,
    sesisAccountRequest: award.sesisAccountRequest || null,
    badgeRequest: award.badgeRequest || null,
    ewebRecord: award.ewebRecord || null,
    payrollRecord: award.payrollRecord || null,
    steps,
    drafts: {
      heather: award.heatherDraft || null,
      james: award.jamesDraft || null,
      cse: award.cseNotice || null,
      gila: award.gilaDraft || null,
    },
    schedule: buildSchedule({
      mandates: award.mandates,
      studentSchedules: award.studentSchedules,
      schoolHours: award.schoolHours,
      availability: provider?.availability || '',
    }),
    startReminder: startReminder(award, Date.now()),
  };
}

async function applyAwardClocks(awards, bidByCase) {
  const now = Date.now();
  for (const award of awards) {
    if (award.source === 'district') continue;
    const status = normalizeAwardStatus(award.status);
    if (status === 'cancelled-bids-rejected' || status === 'active-on-gila') continue;
    const bid = bidByCase.get(award.caseId);
    const hasProvider = Boolean(award.personId && !(bid && bid.released));
    const decision = boeClockDecision({
      awardDate: award.awardDate || award.awardedAt || award.importedAt,
      hasProvider,
      startedAt: award.startedAt,
      status,
      now,
    });
    award.day = decision.day;
    if (decision.remind) {
      award.startReminder = { remind: true, reject: false, text: decision.text };
    }
    if (!decision.reject) continue;
    const notice = cseDraft({
      schoolName: award.schoolName,
      schoolCode: award.caseId,
      program: award.program,
      service: award.discipline,
      discipline: award.discipline,
    }, decision.reason);
    award.status = 'cancelled-bids-rejected';
    award.cseNotice = notice;
    award.decision = { action: 'reject', reason: decision.reason, automatic: true };
    await ddb.send(new UpdateCommand({
      TableName: AWARDS,
      Key: { caseId: award.caseId },
      UpdateExpression: 'SET #status = :status, cseNotice = :notice, #decision = :decision',
      ExpressionAttributeNames: { '#status': 'status', '#decision': 'decision' },
      ExpressionAttributeValues: {
        ':status': 'cancelled-bids-rejected',
        ':notice': notice,
        ':decision': award.decision,
      },
    }));
  }
}

async function applyPlacementClock(rows, bidByCase) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  for (const row of rows) {
    if (row.status === 'rejected') continue;
    const bid = bidByCase.get(row.id);
    const hasProvider = Boolean(bid && !bid.released);
    if (!row.clockStartedAt && (Number(row.day) || 1) < 5) {
      row.clockStartedAt = nowIso;
      await ddb.send(new UpdateCommand({
        TableName: UNFILLED,
        Key: { id: row.id },
        UpdateExpression: 'SET clockStartedAt = :at',
        ExpressionAttributeValues: { ':at': nowIso },
      }));
    }
    const decision = placementDue({ clockStartedAt: row.clockStartedAt, day: row.day, hasProvider, now });
    row.day = decision.day;
    if (!decision.reject) {
      if (Number(row.day) !== decision.day) {
        await ddb.send(new UpdateCommand({
          TableName: UNFILLED,
          Key: { id: row.id },
          UpdateExpression: 'SET #day = :day',
          ExpressionAttributeNames: { '#day': 'day' },
          ExpressionAttributeValues: { ':day': decision.day },
        }));
      }
      continue;
    }
    const notice = cseDraft(row, CSE_REASON);
    row.status = 'rejected';
    row.day = 5;
    row.cseNotice = notice;
    row.decision = { action: 'reject', reason: CSE_REASON, automatic: true };
    await ddb.send(new UpdateCommand({
      TableName: UNFILLED,
      Key: { id: row.id },
      UpdateExpression: 'SET #day = :day, #status = :status, cseNotice = :notice, #decision = :decision',
      ExpressionAttributeNames: { '#day': 'day', '#status': 'status', '#decision': 'decision' },
      ExpressionAttributeValues: {
        ':day': 5,
        ':status': 'rejected',
        ':notice': notice,
        ':decision': row.decision,
      },
    }));
  }
}

async function syncAwardHandoffs(awards, people) {
  for (const award of awards) {
    if (award.source === 'district') continue;
    const provider = people[award.personId];
    const handoff = handoffState(award, provider);
    const drafts = draftMessages({ provider, award, row: award });
    const names = {};
    const values = {};
    const sets = [];
    const add = (key, value) => {
      names[`#${key}`] = key;
      values[`:${key}`] = value;
      sets.push(`#${key} = :${key}`);
      award[key] = value;
    };
    if (handoff.sesis.status === 'queued' && !award.sesisAccountRequest) {
      add('sesisAccountRequest', { ...handoff.sesis, queuedAt: new Date().toISOString() });
      add('heatherDraft', drafts.heather);
    }
    if (handoff.badge.status === 'queued' && !award.badgeRequest) {
      add('badgeRequest', { ...handoff.badge, queuedAt: new Date().toISOString() });
      add('jamesDraft', drafts.james);
    }
    if (handoff.eweb.status === 'recorded' && !award.ewebRecord) add('ewebRecord', handoff.eweb);
    if (handoff.payroll.status === 'recorded' && !award.payrollRecord) add('payrollRecord', handoff.payroll);
    if (!award.gilaDraft) add('gilaDraft', drafts.gila);
    if (!sets.length) continue;
    await ddb.send(new UpdateCommand({
      TableName: AWARDS,
      Key: { caseId: award.caseId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  }
}

async function releaseBid(caseId, reason) {
  const bid = await getItem(BIDS, { caseId });
  if (!bid || bid.released) return;
  await ddb.send(new UpdateCommand({
    TableName: BIDS,
    Key: { caseId },
    UpdateExpression: 'SET released = :released, priorPersonId = :prior, releaseReason = :reason',
    ExpressionAttributeValues: {
      ':released': true,
      ':prior': bid.personId || bid.priorPersonId || '',
      ':reason': reason,
    },
  }));
}

async function loadAward(caseId) {
  const award = await getItem(AWARDS, { caseId });
  if (!award) throw fail(404, 'That award is not in the Bids database.');
  return award;
}

async function addDoeOpportunities(event) {
  requireAdmin();
  const body = readBody(event);
  const parsed = parseDoeLines(body.text || '');
  if (!parsed.rows.length) throw fail(400, parsed.errors[0] || 'Paste at least one DOE row.');
  const existing = [...await queryCases('preschool'), ...await queryCases('school-age')].map((row) => row.caseId);
  const ids = new Set(existing);
  for (const row of parsed.rows) {
    let id = `DOE${randomBytes(3).toString('hex')}`;
    while (ids.has(id)) id = `DOE${randomBytes(3).toString('hex')}`;
    ids.add(id);
    const known = SCHOOLS[row.place] || null;
    const schoolCode = known ? row.place : id;
    await putIfAbsent(CASES, 'caseId', {
      id,
      caseId: id,
      child: 'DOE email',
      schoolCode,
      schoolName: known ? known.name : row.school.slice(0, 80),
      address: known ? known.address : row.place.slice(0, 160),
      area: known ? known.area : areaInAddress(row.place),
      building: known ? known.building : '',
      program: row.program,
      discipline: row.discipline,
      hoursPerWeek: row.hours,
      service: `${row.discipline}, ${row.hours} hrs/week`,
      source: 'DOE email',
      audience: row.audience,
      language: row.language || '',
    });
  }
  const state = await snapshot();
  return { status: 201, body: { ...state, message: `Saved ${parsed.rows.length} DOE email opportunities.`, doeErrors: parsed.errors } };
}

async function importAwarded(event) {
  requireAdmin();
  const body = readBody(event);
  const mode = body.mode === 'live' || body.mode === 's3' || body.mode === 'bytes' ? body.mode : 'fixture';
  if (mode === 'live') {
    if (!IMPORT_FUNCTION) throw fail(503, 'The SESIS import job is not deployed yet.');
    const invoked = await lambdaClient.send(new InvokeCommand({
      FunctionName: IMPORT_FUNCTION,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ mode: 'live', only: 'awarded' })),
    }));
    const payload = JSON.parse(Buffer.from(invoked.Payload || []).toString('utf8') || '{}');
    if (!payload.ok) throw fail(502, payload.error || 'Awarded import failed.');
    return {
      status: 200,
      body: {
        ...(await snapshot()),
        message: `Awarded import finished. ${payload.awarded?.awardsWritten || 0} tracker rows.`,
        importResult: payload,
      },
    };
  }
  const awarded = await runAwardedImport({
    ddb,
    s3,
    casesTable: CASES,
    bidsTable: BIDS,
    awardsTable: AWARDS,
    providersTable: PROVIDERS,
    unfilledTable: UNFILLED,
    bucket: DOWNLOADS_BUCKET,
    mode,
    preschoolBytes: decodeMaybeBase64(body.preschoolBytes || body.awardedPreschoolBytes),
    schoolAgeBytes: decodeMaybeBase64(body.schoolAgeBytes || body.awardedSchoolAgeBytes),
  });
  return {
    status: 200,
    body: {
      ...(await snapshot()),
      message: `Awarded import saved ${awarded.awardsWritten || 0} tracker rows from ${awarded.source}.`,
      importResult: { ok: true, awarded },
    },
  };
}

async function reopenAwardNearby(caseId, reason) {
  const state = await snapshot();
  const row = (state.cases || []).find((item) => item.id === caseId)
    || (state.unfilledCases || []).find((item) => item.id === caseId);
  if (!row) return;
  const nearby = nearbyTherapists(Object.values(state.people), row);
  const sentAt = new Date().toISOString();
  for (const who of nearby) {
    await putOfferOnce({
      providerId: who.id,
      offerId: `reopen#${reason}#${sentAt}#${who.id}#${randomBytes(2).toString('hex')}`,
      opportunityId: caseId,
      sentAt,
      channel: 'sms',
      sent: false,
      snapshot: offerSnapshot(row),
      triggeredBy: 'admin',
      preview: `Nearby match after ${reason}: ${row.schoolName || caseId} (${row.discipline || ''}).`,
      reason,
    });
  }
}

async function markSchoolRejected(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  await loadAward(caseId);
  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: AWARDS,
    Key: { caseId },
    UpdateExpression: 'SET schoolRejected = :yes, reopenedAt = :now, #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':yes': true,
      ':now': now,
      ':status': 'awarded-pending-provider',
    },
  }));
  await releaseBid(caseId, 'school-rejected');
  await reopenAwardNearby(caseId, 'school-rejected');
  return { status: 200, body: { ...(await snapshot()), message: 'School rejected. Child reopened with nearby matches queued (SMS not sent until configured).' } };
}

async function declineAward(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  await loadAward(caseId);
  await ddb.send(new UpdateCommand({
    TableName: AWARDS,
    Key: { caseId },
    UpdateExpression: 'SET providerResponse = :response, reopenedAt = :now, #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':response': 'declined',
      ':now': new Date().toISOString(),
      ':status': 'awarded-pending-provider',
    },
  }));
  await releaseBid(caseId, 'provider-declined');
  await reopenAwardNearby(caseId, 'provider-declined');
  return { status: 200, body: { ...(await snapshot()), message: 'Provider declined. Child reopened with nearby matches queued (SMS not sent until configured).' } };
}

async function widerOutreach(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const state = await snapshot();
  const tracker = (state.trackers || []).find((item) => item.caseId === caseId);
  const row = (state.cases || []).find((item) => item.id === caseId) || (state.unfilledCases || []).find((item) => item.id === caseId);
  if (!row) throw fail(404, 'That opportunity is not in the Bids database.');
  const nearby = tracker?.nearby || nearbyTherapists(Object.values(state.people), row);
  const sentAt = new Date().toISOString();
  for (const who of nearby) {
    await putOfferOnce({
      providerId: who.id,
      offerId: `outreach#${sentAt}#${who.id}#${randomBytes(2).toString('hex')}`,
      opportunityId: caseId,
      sentAt,
      channel: 'sms',
      sent: false,
      snapshot: offerSnapshot(row),
      triggeredBy: 'admin',
    });
  }
  return { status: 201, body: { ...(await snapshot()), message: `Recorded a text preview for ${nearby.length} matching therapists. Nothing was sent.` } };
}

async function saveChecklist(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const step = CHECKLIST.find((item) => item.id === body.step && item.owner === 'coordinator');
  if (!step) throw fail(400, 'That checklist step is not marked by the coordinator.');
  const award = await loadAward(caseId);
  const steps = { ...(award.steps || {}) };
  steps[step.id] = { done: body.done !== false, by: 'coordinator', at: new Date().toISOString() };
  await ddb.send(new UpdateCommand({
    TableName: AWARDS,
    Key: { caseId },
    UpdateExpression: 'SET steps = :steps',
    ExpressionAttributeValues: { ':steps': steps },
  }));
  return { status: 200, body: await snapshot() };
}

async function saveSchedule(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  await loadAward(caseId);
  const students = String(body.students || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 40);
  await ddb.send(new UpdateCommand({
    TableName: AWARDS,
    Key: { caseId },
    UpdateExpression: 'SET mandates = :mandates, studentSchedules = :students, schoolHours = :hours, students = :list, lsRate = :rate',
    ExpressionAttributeValues: {
      ':mandates': String(body.mandates || '').slice(0, 500),
      ':students': String(body.studentSchedules || '').slice(0, 500),
      ':hours': String(body.schoolHours || '').slice(0, 240),
      ':list': students,
      ':rate': String(body.lsRate || '').slice(0, 20),
    },
  }));
  return { status: 200, body: await snapshot() };
}

async function savePhoto(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  await loadAward(caseId);
  const fileName = String(body.fileName || '').trim().slice(0, 80);
  const data = String(body.data || '');
  if (!fileName || data.length < 20) throw fail(400, 'Choose a photo file.');
  if (data.length > 180000) throw fail(400, 'Use a photo under about 120 KB.');
  await ddb.send(new UpdateCommand({
    TableName: AWARDS,
    Key: { caseId },
    UpdateExpression: 'SET photo = :photo',
    ExpressionAttributeValues: { ':photo': { fileName, contentType: String(body.contentType || '').slice(0, 40), data } },
  }));
  return { status: 200, body: await snapshot() };
}

async function markStarted(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  await loadAward(caseId);
  await ddb.send(new UpdateCommand({
    TableName: AWARDS,
    Key: { caseId },
    UpdateExpression: 'SET startedAt = :at, #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':at': new Date().toISOString(),
      ':status': 'active-on-gila',
    },
  }));
  return { status: 200, body: { ...(await snapshot()), message: 'Marked active on Gila.' } };
}

async function saveCaseRule(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const program = body.program === 'preschool' ? 'preschool' : body.program === 'school-age' ? 'school-age' : '';
  if (!program) throw fail(400, 'Program must be preschool or school-age.');
  const audience = AUDIENCES.includes(body.audience) ? body.audience : 'either';
  const language = String(body.language || '').trim().slice(0, 40);
  await ddb.send(new UpdateCommand({
    TableName: CASES,
    Key: { program, caseId },
    UpdateExpression: 'SET audience = :audience, #language = :language',
    ExpressionAttributeNames: { '#language': 'language' },
    ExpressionAttributeValues: { ':audience': audience, ':language': language },
  }));
  return { status: 200, body: await snapshot() };
}

function decodeMaybeBase64(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  const text = String(value);
  if (text.startsWith('data:')) {
    const idx = text.indexOf('base64,');
    if (idx >= 0) return Buffer.from(text.slice(idx + 7), 'base64');
  }
  try {
    return Buffer.from(text, 'base64');
  } catch {
    return null;
  }
}

async function loadSesisSecret() {
  if (!SESIS_SECRET_NAME) return null;
  try {
    const out = await secretsClient.send(new GetSecretValueCommand({ SecretId: SESIS_SECRET_NAME }));
    return JSON.parse(out.SecretString || '{}');
  } catch {
    return null;
  }
}

async function runSesisImport(event) {
  requireAdmin();
  const body = readBody(event);
  const mode = body.mode === 'live' || body.mode === 's3' || body.mode === 'bytes' ? body.mode : 'fixture';
  const only = body.only === 'available' || body.only === 'awarded' ? body.only : 'both';
  if (mode === 'live') {
    if (!IMPORT_FUNCTION) throw fail(503, 'The SESIS import job is not deployed yet.');
    const invoked = await lambdaClient.send(new InvokeCommand({
      FunctionName: IMPORT_FUNCTION,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ mode: 'live', only })),
    }));
    const payload = JSON.parse(Buffer.from(invoked.Payload || []).toString('utf8') || '{}');
    if (!payload.ok) throw fail(502, payload.error || 'SESIS import failed.');
    const state = await snapshot();
    const caseCount = payload.available?.caseCount ?? 0;
    const awards = payload.awarded?.awardsWritten ?? 0;
    return {
      status: 200,
      body: {
        ...state,
        message: `SESIS import finished. ${caseCount} available cases, ${awards} awarded tracker rows. Nothing was bid in SESIS.`,
        importResult: payload,
      },
    };
  }
  let available = null;
  let awarded = null;
  if (only === 'available' || only === 'both') {
    available = await runCaseImport({
      ddb,
      s3,
      casesTable: CASES,
      providersTable: PROVIDERS,
      bucket: DOWNLOADS_BUCKET,
      mode,
      preschoolBytes: decodeMaybeBase64(body.preschoolBytes || body.preschool),
      schoolAgeBytes: decodeMaybeBase64(body.schoolAgeBytes || body.schoolAge),
      addressBytes: decodeMaybeBase64(body.addressBytes || body.addresses),
    });
  }
  if (only === 'awarded' || only === 'both') {
    awarded = await runAwardedImport({
      ddb,
      s3,
      casesTable: CASES,
      bidsTable: BIDS,
      awardsTable: AWARDS,
      providersTable: PROVIDERS,
      unfilledTable: UNFILLED,
      bucket: DOWNLOADS_BUCKET,
      mode,
      preschoolBytes: decodeMaybeBase64(body.awardedPreschoolBytes),
      schoolAgeBytes: decodeMaybeBase64(body.awardedSchoolAgeBytes),
    });
  }
  const state = await snapshot();
  return {
    status: 200,
    body: {
      ...state,
      message: `Import saved ${available?.caseCount || 0} available cases and ${awarded?.awardsWritten || 0} awarded rows.`,
      importResult: { ok: true, available, awarded },
    },
  };
}

async function setAwardStatus(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const award = await loadAward(caseId);
  const next = normalizeAwardStatus(body.status);
  if (!AWARD_STATUSES.includes(next)) throw fail(400, 'Unknown award status.');
  if (!canTransition(award.status, next) && next !== 'cancelled-bids-rejected') {
    throw fail(400, `Cannot move from ${award.status || 'pending'} to ${next}.`);
  }
  await ddb.send(new UpdateCommand({
    TableName: AWARDS,
    Key: { caseId },
    UpdateExpression: 'SET #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': next },
  }));
  return { status: 200, body: { ...(await snapshot()), message: `Status set to ${STATUS_LABELS[next]}.` } };
}

async function sendQueuedMessages(event) {
  requireAdmin();
  const body = readBody(event);
  const state = await snapshot();
  const all = state.queuedMessages || [];
  const wanted = Array.isArray(body.ids) && body.ids.length
    ? all.filter((item) => body.ids.includes(item.id))
    : all;
  const results = [];
  for (const message of wanted.slice(0, 40)) {
    const delivery = await deliverQueuedMessage(message);
    results.push({ id: message.id, ...delivery });
    if (!delivery.ok) continue;
    const sentAt = new Date().toISOString();
    if (message.scope === 'district' && message.districtId) {
      const district = await getItem(DISTRICTS, { id: message.districtId });
      if (!district) continue;
      if (message.kind === 'new-district-questions' || message.id.endsWith(':questions')) {
        await ddb.send(new PutCommand({
          TableName: DISTRICTS,
          Item: { ...district, questionsEmail: { ...district.questionsEmail, sent: true, sentAt, messageId: delivery.id } },
        }));
      } else if (district.outreach?.messages) {
        const messages = district.outreach.messages.map((row) => (
          row.kind === message.kind ? { ...row, sent: true, sentAt, messageId: delivery.id } : row
        ));
        await ddb.send(new PutCommand({
          TableName: DISTRICTS,
          Item: { ...district, outreach: { ...district.outreach, messages } },
        }));
      }
    } else if (message.scope === 'award' && message.caseId) {
      const award = await getItem(AWARDS, { caseId: message.caseId });
      if (!award) continue;
      const key = message.kind === 'heather' ? 'heatherDraft'
        : message.kind === 'james' ? 'jamesDraft'
          : message.kind === 'gila' ? 'gilaDraft'
            : 'cseNotice';
      await ddb.send(new UpdateCommand({
        TableName: AWARDS,
        Key: { caseId: message.caseId },
        UpdateExpression: `SET ${key} = :draft`,
        ExpressionAttributeValues: { ':draft': { ...(award[key] || {}), sent: true, sentAt, messageId: delivery.id } },
      }));
    } else if (message.scope === 'district-award' && message.caseId) {
      const key = message.kind === 'billu' ? 'billuDraft' : 'payrollDraft';
      const award = await getItem(AWARDS, { caseId: message.caseId });
      if (!award) continue;
      await ddb.send(new UpdateCommand({
        TableName: AWARDS,
        Key: { caseId: message.caseId },
        UpdateExpression: `SET ${key} = :draft`,
        ExpressionAttributeValues: { ':draft': { ...(award[key] || {}), sent: true, sentAt, messageId: delivery.id } },
      }));
    } else if (message.scope === 'unfilled' && message.caseId) {
      const row = await getItem(UNFILLED, { id: message.caseId });
      if (!row?.cseNotice) continue;
      await ddb.send(new UpdateCommand({
        TableName: UNFILLED,
        Key: { id: message.caseId },
        UpdateExpression: 'SET cseNotice = :notice',
        ExpressionAttributeValues: { ':notice': { ...row.cseNotice, sent: true, sentAt, messageId: delivery.id } },
      }));
    }
  }
  const sent = results.filter((row) => row.ok).length;
  const failed = results.filter((row) => !row.ok && !row.skipped).length;
  const skipped = results.filter((row) => row.skipped).length;
  return {
    status: 200,
    body: {
      ...(await snapshot()),
      message: `Sent ${sent}. Failed ${failed}. Skipped ${skipped} (SMS not configured or missing address).`,
      sendResults: results,
    },
  };
}

async function placeSesisBid(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const bid = await getItem(BIDS, { caseId });
  if (!bid || bid.released) throw fail(404, 'Confirm a portal bid before placing in SESIS.');
  const state = await snapshot();
  const caseRow = state.cases.find((row) => row.id === caseId);
  if (!caseRow) throw fail(404, 'That case is not in the Bids database.');
  const secret = await loadSesisSecret();
  const live = placeBidEnabled(process.env, secret);
  const credentials = secret ? {
    baseUrl: secret.baseUrl || 'https://sesis.nycenet.edu',
    workspace: secret.workspace || 'NYCONFIG',
    username: secret.username || secret.user,
    password: secret.password,
  } : null;
  const result = await placeBidForCase({
    credentials,
    caseRow,
    bid,
    person: state.people[bid.personId],
    live,
    onStep: (step, detail) => console.log('place-bid', step, detail),
  });
  await ddb.send(new UpdateCommand({
    TableName: BIDS,
    Key: { caseId },
    UpdateExpression: 'SET sesisPlaceBid = :place',
    ExpressionAttributeValues: {
      ':place': {
        status: result.status,
        dryRun: Boolean(result.dryRun),
        at: new Date().toISOString(),
        plan: result.plan || null,
        message: result.message || result.error || '',
      },
    },
  }));
  await ddb.send(new UpdateCommand({
    TableName: AWARDS,
    Key: { caseId },
    UpdateExpression: 'SET sesisPlaceBid = :place',
    ExpressionAttributeValues: {
      ':place': {
        status: result.status,
        dryRun: Boolean(result.dryRun),
        at: new Date().toISOString(),
        message: result.message || result.error || '',
      },
    },
  })).catch(() => null);
  if (!result.ok && !result.dryRun) throw fail(502, result.error || 'SESIS place-bid failed.');
  return {
    status: 200,
    body: {
      ...(await snapshot()),
      message: result.message,
      placeBid: result,
    },
  };
}

function publicDistrict(district) {
  return {
    id: district.id,
    name: district.name,
    contactEmail: district.contactEmail || '',
    servicedBefore: Boolean(district.servicedBefore),
    outreach: district.outreach || null,
    questions: district.questions || blankAnswers(),
    questionsEmail: district.questionsEmail || null,
    buildingContact: district.buildingContact || '',
    studentList: district.studentList || '',
  };
}

function publicNeed(row) {
  return {
    id: row.id,
    districtId: row.districtId || '',
    schoolName: row.schoolName || '',
    discipline: row.discipline || '',
    program: row.program || '',
    hoursPerWeek: Number(row.hoursPerWeek) || 0,
    address: row.address || '',
    area: row.area || '',
    language: row.language || '',
    audience: row.audience || 'either',
    interestClockStartedAt: row.interestClockStartedAt || '',
    inactivePreviewAt: row.inactivePreviewAt || '',
    interestEscalatedAt: row.interestEscalatedAt || '',
    interestEscalation: row.interestEscalation || null,
    interests: Array.isArray(row.interests) ? row.interests : [],
    recruiterQueue: Array.isArray(row.recruiterQueue) ? row.recruiterQueue : [],
  };
}

function publicDistrictAward(award, person, district) {
  const students = Array.isArray(award.students) ? award.students : [];
  const connection = scheduleConnection({
    buildingContact: award.buildingContact || district?.buildingContact || '',
    studentList: students.join('\n') || district?.studentList || '',
    mandates: award.mandates,
    studentSchedules: award.studentSchedules,
    schoolHours: award.schoolHours,
    availability: person?.availability || '',
  });
  return {
    caseId: award.caseId,
    districtId: award.districtId || district?.id || '',
    providerId: award.personId || '',
    providerName: award.providerName || person?.name || '',
    startDate: award.startDate || '',
    lsRate: award.lsRate || '',
    buildingContact: award.buildingContact || district?.buildingContact || '',
    students,
    mandates: award.mandates || '',
    studentSchedules: award.studentSchedules || '',
    schoolHours: award.schoolHours || '',
    connection,
    tmsFileOpenRequest: award.tmsFileOpenRequest || null,
    tmsMirror: award.tmsMirror || null,
    payroll: award.payrollDraft || null,
    billu: award.billuDraft || null,
  };
}

async function writeQueuedOffer(message, ownerId, opportunityId, school) {
  if (!message) return;
  await putOfferOnce({
    providerId: ownerId,
    offerId: `email#${message.kind || message.id || 'queued'}`,
    opportunityId,
    sentAt: message.queuedAt || new Date().toISOString(),
    channel: 'email',
    sent: false,
    snapshot: { school: school || '', building: '', program: '', service: message.subject || '', hours: 0, address: '' },
    triggeredBy: 'system',
  });
}

async function syncDistrictFlow(people, caseRows, awardItems) {
  if (!DISTRICTS) return { districts: [], needs: [], awards: [], clockOffsetDays: 0 };
  const items = await scanAll(DISTRICTS);
  const clock = items.find((row) => row.id === '_clock') || { id: '_clock', offsetDays: 0 };
  const now = virtualNow(clock.offsetDays);
  const peopleList = Object.values(people);
  const districts = [];
  const byId = new Map();
  for (const district of items) {
    if (!district.id || String(district.id).startsWith('_')) continue;
    let current = district;
    const stepped = advanceOutreach(current, now);
    if (stepped.changed) {
      current = stepped.district;
      await ddb.send(new PutCommand({ TableName: DISTRICTS, Item: current }));
    }
    for (const message of current.outreach?.messages || []) {
      await writeQueuedOffer(message, `district#${current.id}`, current.id, current.name);
    }
    if (current.questionsEmail) {
      await writeQueuedOffer(current.questionsEmail, `district#${current.id}`, current.id, current.name);
    }
    byId.set(current.id, current);
    districts.push(publicDistrict(current));
  }
  const needs = [];
  for (const row of caseRows) {
    if (row.source !== 'district email') continue;
    for (const offer of activeAlertOffers(row, peopleList, new Date(now).toISOString())) {
      await putOfferOnce(offer);
    }
    const stepped = advanceInterest(row, peopleList, now);
    if (stepped.changed) {
      Object.assign(row, stepped.need);
      await ddb.send(new UpdateCommand({
        TableName: CASES,
        Key: { program: row.program, caseId: row.caseId || row.id },
        UpdateExpression: 'SET inactivePreviewAt = :preview, interestEscalatedAt = :escalated, interestEscalation = :notice',
        ExpressionAttributeValues: {
          ':preview': row.inactivePreviewAt || '',
          ':escalated': row.interestEscalatedAt || '',
          ':notice': row.interestEscalation || null,
        },
      }));
    }
    for (const offer of stepped.offers) await putOfferOnce(offer);
    needs.push(publicNeed(row));
  }
  const awards = awardItems
    .filter((award) => award.source === 'district')
    .map((award) => publicDistrictAward(award, people[award.personId], byId.get(award.districtId)));
  return { districts, needs, awards, clockOffsetDays: Number(clock.offsetDays) || 0 };
}

async function loadDistrict(id) {
  const district = await getItem(DISTRICTS, { id });
  if (!district || String(district.id).startsWith('_')) throw fail(404, 'That district is not in the Bids database.');
  return district;
}

async function districtClockNow() {
  const clock = await getItem(DISTRICTS, { id: '_clock' });
  return virtualNow(clock?.offsetDays);
}

function districtIdFromName(name, existing) {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'district';
  let id = stem;
  let n = 2;
  const ids = new Set(existing);
  while (ids.has(id)) {
    id = `${stem}-${n}`;
    n += 1;
  }
  return id;
}

async function saveDistrict(event) {
  requireAdmin();
  const body = readBody(event);
  const name = String(body.name || '').trim().slice(0, 80);
  const contactEmail = String(body.contactEmail || '').trim().toLowerCase().slice(0, 120);
  if (!name || !contactEmail.includes('@')) throw fail(400, 'District name and contact email are required.');
  const items = await scanAll(DISTRICTS);
  const id = districtIdFromName(name, items.map((row) => row.id));
  await putIfAbsent(DISTRICTS, 'id', {
    id,
    name,
    contactEmail,
    servicedBefore: body.servicedBefore === true || body.servicedBefore === 'yes',
    createdAt: new Date().toISOString(),
    questions: blankAnswers(),
    buildingContact: '',
    studentList: '',
  });
  return { status: 201, body: { ...(await snapshot()), message: `${name} is on the contract list.` } };
}

async function askDistrict(event) {
  requireAdmin();
  const body = readBody(event);
  const district = await loadDistrict(asId(body.districtId, 'District'));
  const stepped = startOutreach(district, await districtClockNow());
  if (stepped.changed) await ddb.send(new PutCommand({ TableName: DISTRICTS, Item: stepped.district }));
  return { status: 200, body: { ...(await snapshot()), message: 'The needs email is queued. It was not sent.' } };
}

async function replyDistrict(event) {
  requireAdmin();
  const body = readBody(event);
  const district = await loadDistrict(asId(body.districtId, 'District'));
  const stepped = markReply(district, await districtClockNow());
  if (stepped.changed) await ddb.send(new PutCommand({ TableName: DISTRICTS, Item: stepped.district }));
  return { status: 200, body: { ...(await snapshot()), message: 'Reply recorded. Later follow-ups stay queued only if they were already stored.' } };
}

async function saveDistrictAnswers(event) {
  requireAdmin();
  const body = readBody(event);
  const district = await loadDistrict(asId(body.districtId, 'District'));
  const answers = { ...(district.questions || blankAnswers()) };
  for (const [key] of QUESTIONS) {
    const raw = body.answers && body.answers[key] != null ? body.answers[key] : body[key];
    if (raw != null) answers[key] = String(raw).trim().slice(0, 500);
  }
  const buildingContact = String(body.buildingContact || answers.F || district.buildingContact || '').slice(0, 200);
  const studentList = String(body.studentList || answers.G || district.studentList || '').slice(0, 2000);
  await ddb.send(new PutCommand({
    TableName: DISTRICTS,
    Item: { ...district, questions: answers, buildingContact, studentList },
  }));
  return { status: 200, body: { ...(await snapshot()), message: 'District answers saved.' } };
}

async function addDistrictNeed(event) {
  requireAdmin();
  const body = readBody(event);
  const district = await loadDistrict(asId(body.districtId, 'District'));
  const discipline = String(body.discipline || '').toUpperCase();
  const program = /pre/i.test(String(body.program || '')) ? 'preschool' : 'school-age';
  const hours = Number(body.hours);
  const school = String(body.school || '').trim().slice(0, 80);
  const address = String(body.address || district.name).trim().slice(0, 160);
  const language = String(body.language || '').trim().slice(0, 40);
  const audience = AUDIENCES.includes(body.audience) ? body.audience : 'either';
  if (!DISCIPLINES.includes(discipline)) throw fail(400, 'Discipline must be OT, PT, or SLP.');
  if (!school) throw fail(400, 'School is required.');
  if (!Number.isFinite(hours) || hours < 1 || hours > 40) throw fail(400, 'Hours must be between 1 and 40.');
  const now = await districtClockNow();
  let id = `DIST${randomBytes(3).toString('hex')}`;
  const existing = [...await queryCases('preschool'), ...await queryCases('school-age')].map((row) => row.caseId);
  while (existing.includes(id)) id = `DIST${randomBytes(3).toString('hex')}`;
  await putIfAbsent(CASES, 'caseId', {
    id,
    caseId: id,
    program,
    child: 'District email',
    schoolCode: id,
    schoolName: school,
    address,
    area: areaInAddress(address),
    building: '',
    discipline,
    hoursPerWeek: Math.round(hours),
    service: `${discipline}, ${Math.round(hours)} hrs/week`,
    source: 'district email',
    districtId: district.id,
    audience,
    language,
    interestClockStartedAt: new Date(now).toISOString(),
    interests: [],
    recruiterQueue: [],
  });
  const questions = questionsEmail(district, now);
  if (questions) {
    await ddb.send(new PutCommand({ TableName: DISTRICTS, Item: { ...district, questionsEmail: questions } }));
  }
  return { status: 201, body: { ...(await snapshot()), message: 'District need saved. Matching profiles were queued an email. Nothing was sent.' } };
}

async function advanceDistrictDay() {
  requireAdmin();
  const clock = await getItem(DISTRICTS, { id: '_clock' }) || { id: '_clock', offsetDays: 0 };
  await ddb.send(new PutCommand({
    TableName: DISTRICTS,
    Item: { id: '_clock', offsetDays: (Number(clock.offsetDays) || 0) + 1 },
  }));
  return { status: 200, body: { ...(await snapshot()), message: 'Advanced one day for district deadlines. Nothing was sent.' } };
}

async function findDistrictCase(caseId) {
  const schoolAge = await getItem(CASES, { program: 'school-age', caseId });
  if (schoolAge) return schoolAge;
  const preschool = await getItem(CASES, { program: 'preschool', caseId });
  if (preschool) return preschool;
  throw fail(404, 'That district need is not in the Bids database.');
}

async function recordDistrictInterest(event) {
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const personId = currentActor?.role === 'admin' ? asId(body.providerId, 'Provider') : currentActor.id;
  if (currentActor?.role !== 'admin' && personId !== currentActor.id) {
    throw fail(403, 'You can only mark your own interest.');
  }
  const row = await findDistrictCase(caseId);
  if (row.source !== 'district email') throw fail(400, 'Interest on this screen is for a district need.');
  const state = await snapshot();
  const person = state.people[personId];
  if (!person) throw fail(404, 'That provider is not in the Bids database.');
  const stepped = markInterest(row, person, await districtClockNow());
  if (stepped.error) throw fail(403, stepped.error);
  if (stepped.changed) {
    await ddb.send(new UpdateCommand({
      TableName: CASES,
      Key: { program: row.program, caseId: row.caseId || row.id },
      UpdateExpression: 'SET interests = :interests, recruiterQueue = :queue',
      ExpressionAttributeValues: {
        ':interests': stepped.need.interests,
        ':queue': stepped.need.recruiterQueue,
      },
    }));
  }
  return { status: 200, body: { ...(await snapshot()), message: `${person.name} is on the recruiter queue for a follow-up call.` } };
}

async function awardDistrictNeed(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const personId = asId(body.providerId, 'Provider');
  const row = await findDistrictCase(caseId);
  const state = await snapshot();
  const person = state.people[personId];
  if (!person) throw fail(404, 'That provider is not in the Bids database.');
  const queued = (row.recruiterQueue || []).some((item) => item.providerId === personId);
  if (!queued && !districtMatch(person, row)) throw fail(403, 'She is not on the recruiter queue for this need.');
  await ddb.send(new PutCommand({
    TableName: BIDS,
    Item: {
      caseId,
      personId,
      enteredBy: 'coordinator',
      note: 'Awarded from the district recruiter queue',
      createdAt: new Date().toISOString(),
      released: false,
    },
  }));
  const district = await loadDistrict(row.districtId);
  await putIfAbsent(AWARDS, 'caseId', {
    caseId,
    personId,
    providerName: person.name,
    districtId: district.id,
    schoolName: row.schoolName || district.name,
    discipline: row.discipline,
    source: 'district',
    status: 'Awarded - Pending Provider',
    buildingContact: district.buildingContact || '',
    students: String(district.studentList || '').split(/\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 40),
  });
  return { status: 200, body: { ...(await snapshot()), message: `${person.name} is awarded this district need. The district and the offer history stay.` } };
}

async function startDistrictNeed(event) {
  requireAdmin();
  const body = readBody(event);
  const caseId = asId(body.caseId, 'Case');
  const award = await getItem(AWARDS, { caseId });
  if (!award || award.source !== 'district') throw fail(404, 'Award this district need before setting a start date.');
  const startDate = String(body.startDate || '').trim().slice(0, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw fail(400, 'Enter a start date.');
  const district = award.districtId ? await loadDistrict(award.districtId) : null;
  const students = String(body.students || (award.students || []).join('\n')).split(/\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 40);
  const buildingContact = String(body.buildingContact || award.buildingContact || district?.buildingContact || '').slice(0, 200);
  const studentList = students.join('\n') || district?.studentList || '';
  if (district) {
    await ddb.send(new PutCommand({
      TableName: DISTRICTS,
      Item: { ...district, buildingContact, studentList },
    }));
  }
  const person = (await snapshot()).people[award.personId];
  const handoff = award.payrollDraft ? null : afterStart({
    district,
    provider: person,
    students,
    startDate,
    lsRate: String(body.lsRate || award.lsRate || ''),
  });
  const next = {
    ...award,
    startDate,
    lsRate: String(body.lsRate || award.lsRate || '').slice(0, 20),
    buildingContact,
    students,
    mandates: String(body.mandates || award.mandates || '').slice(0, 500),
    studentSchedules: String(body.studentSchedules || award.studentSchedules || '').slice(0, 500),
    schoolHours: String(body.schoolHours || award.schoolHours || '').slice(0, 240),
  };
  if (handoff) {
    next.tmsFileOpenRequest = handoff.tmsFileOpenRequest;
    next.tmsMirror = handoff.tmsMirror;
    next.payrollDraft = handoff.payroll;
    next.billuDraft = handoff.billu;
  }
  await ddb.send(new PutCommand({ TableName: AWARDS, Item: next }));
  if (handoff) {
    await writeQueuedOffer({ ...handoff.payroll, kind: `payroll#${caseId}`, queuedAt: new Date().toISOString() }, 'queue#payroll', caseId, district?.name || '');
    await writeQueuedOffer({ ...handoff.billu, kind: `billu#${caseId}`, queuedAt: new Date().toISOString() }, 'queue#billu', caseId, district?.name || '');
  }
  return { status: 200, body: { ...(await snapshot()), message: 'Start date saved. TMS, payroll, and Billu records are queued. Nothing was sent and HHA was not called.' } };
}

async function loadDistrictFixture() {
  requireAdmin();
  const id = 'sample-district';
  await putIfAbsent(DISTRICTS, 'id', {
    id,
    name: 'Sample District',
    contactEmail: 'sample.district@example.test',
    servicedBefore: false,
    createdAt: new Date().toISOString(),
    questions: blankAnswers(),
    buildingContact: '',
    studentList: '',
  });
  let district = await loadDistrict(id);
  const now = await districtClockNow();
  const asked = startOutreach(district, now);
  if (asked.changed) {
    district = asked.district;
    await ddb.send(new PutCommand({ TableName: DISTRICTS, Item: district }));
  }
  const questions = questionsEmail(district, now);
  if (questions) {
    district = { ...district, questionsEmail: questions };
    await ddb.send(new PutCommand({ TableName: DISTRICTS, Item: district }));
  }
  await putIfAbsent(CASES, 'caseId', {
    id: 'DIST-SAMPLE',
    caseId: 'DIST-SAMPLE',
    program: 'school-age',
    child: 'District email',
    schoolCode: 'DIST-SAMPLE',
    schoolName: 'Sample School',
    address: '12 50th St, Borough Park',
    area: 'Borough Park',
    building: '',
    discipline: 'OT',
    hoursPerWeek: 2,
    service: 'OT, 2 hrs/week',
    source: 'district email',
    districtId: id,
    audience: 'either',
    language: 'Yiddish',
    interestClockStartedAt: new Date(now).toISOString(),
    interests: [],
    recruiterQueue: [],
  });
  if ((await loadDistrict(id)).outreach?.status === 'asked') {
    const clock = await getItem(DISTRICTS, { id: '_clock' }) || { id: '_clock', offsetDays: 0 };
    await ddb.send(new PutCommand({
      TableName: DISTRICTS,
      Item: { id: '_clock', offsetDays: (Number(clock.offsetDays) || 0) + 1 },
    }));
  }
  return { status: 201, body: { ...(await snapshot()), message: 'Sample district saved. The needs email, a one-day follow-up, the need, and the new-district questions are queued. Nothing was sent.' } };
}

export async function handler(event) {
  currentActor = null;
  try {
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const path = event.rawPath || event.path || '/';
    if (method === 'GET' && (path === '/' || path === '/health')) {
      return json(200, { ok: true, service: 'bids', downloadsConfigured: Boolean(process.env.DOWNLOADS_BUCKET) });
    }
    const auth = await authenticate(event);
    if (auth.error) return json(auth.status || 401, { ok: false, error: auth.error });
    currentActor = auth.actor;
    let result;
    if (method === 'GET' && path === '/me') {
      const state = await snapshot();
      result = { status: 200, body: { ok: true, me: state.me, user: state.me } };
    } else if (method === 'GET' && path === '/state') result = { status: 200, body: await snapshot() };
    else if (method === 'GET' && path === '/preview') result = await previewOnly(event);
    else if (method === 'POST' && path === '/invites') result = await inviteTherapist(event);
    else if (method === 'POST' && path === '/providers') {
      requireAdmin();
      result = await createProvider(event);
    } else if (method === 'PUT' && path === '/preferences') result = await savePreferences(event);
    else if (method === 'POST' && path === '/bids') result = await createBid(event);
    else if (method === 'POST' && path === '/bids/availability') result = await saveAvailability(event);
    else if (method === 'POST' && path === '/awards') {
      requireAdmin();
      result = await awardBid(event);
    } else if (method === 'POST' && path === '/cases') {
      requireAdmin();
      result = await createCase(event);
    }     else if (method === 'PUT' && path === '/unfilled') {
      requireAdmin();
      result = await saveUnfilled(event);
    }     else if (method === 'GET' && path === '/offers') result = await listOffers(event);
    else if (method === 'POST' && path === '/offers') result = await recordOutreach(event);
    else if (method === 'POST' && path === '/doe') result = await addDoeOpportunities(event);
    else if (method === 'POST' && path === '/awarded-import') result = await importAwarded(event);
    else if (method === 'POST' && path === '/awards/school-reject') result = await markSchoolRejected(event);
    else if (method === 'POST' && path === '/awards/decline') result = await declineAward(event);
    else if (method === 'POST' && path === '/awards/outreach') result = await widerOutreach(event);
    else if (method === 'POST' && path === '/awards/checklist') result = await saveChecklist(event);
    else if (method === 'POST' && path === '/awards/schedule') result = await saveSchedule(event);
    else if (method === 'POST' && path === '/awards/photo') result = await savePhoto(event);
    else if (method === 'POST' && path === '/awards/started') result = await markStarted(event);
    else if (method === 'POST' && path === '/cases/rule') result = await saveCaseRule(event);
    else if (method === 'POST' && path === '/import/sesis') result = await runSesisImport(event);
    else if (method === 'POST' && path === '/import/awarded') result = await importAwarded(event);
    else if (method === 'POST' && path === '/awards/status') result = await setAwardStatus(event);
    else if (method === 'POST' && path === '/messages/send') result = await sendQueuedMessages(event);
    else if (method === 'POST' && path === '/bids/place-sesis') result = await placeSesisBid(event);
    else if (method === 'POST' && path === '/districts') result = await saveDistrict(event);
    else if (method === 'POST' && path === '/districts/ask') result = await askDistrict(event);
    else if (method === 'POST' && path === '/districts/reply') result = await replyDistrict(event);
    else if (method === 'POST' && path === '/districts/answers') result = await saveDistrictAnswers(event);
    else if (method === 'POST' && path === '/districts/needs') result = await addDistrictNeed(event);
    else if (method === 'POST' && path === '/districts/advance-day') result = await advanceDistrictDay();
    else if (method === 'POST' && path === '/districts/interest') result = await recordDistrictInterest(event);
    else if (method === 'POST' && path === '/districts/award') result = await awardDistrictNeed(event);
    else if (method === 'POST' && path === '/districts/start') result = await startDistrictNeed(event);
    else if (method === 'POST' && path === '/districts/fixture') result = await loadDistrictFixture();
    else return json(404, { ok: false, error: 'Not found' });
    return json(result.status || 200, result.body);
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('bids-api', err.name || 'Error');
    return json(status, { ok: false, error: status >= 500 ? 'Bids API error' : err.message });
  }
}
