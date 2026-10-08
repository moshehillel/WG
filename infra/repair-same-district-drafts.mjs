/**
 * Merge open drafts that are the same provider + Monday + district.
 * Leaves signed/locked sheets alone.
 * "Elmont UFSD" and "Elmont UFSD Therapy" count as one district.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TABLE = 'WhiteGloveStack-TmsStateTable10F38FC9-1OCJ1211NQLHU';
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }), {
  marshallOptions: { removeUndefinedValues: true },
});
const outDir = path.join(__dirname, '..', 'tmp');
mkdirSync(outDir, { recursive: true });

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
function canon(s) {
  return norm(s).replace(/\s+therapy$/, '');
}

async function queryPk(pk) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey,
      }),
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const [providerItems, weekItems, sessionItems, studentItems, transferItems] = await Promise.all([
  queryPk('ENTITY#providers'),
  queryPk('ENTITY#weeks'),
  queryPk('ENTITY#sessions'),
  queryPk('ENTITY#students'),
  queryPk('ENTITY#hhaTransfers'),
]);

const providers = providerItems.map((it) => it.entity).filter(Boolean);
const provById = new Map(providers.map((p) => [p.id, p]));
const students = studentItems.map((it) => it.entity).filter(Boolean);
const studentById = new Map(students.map((s) => [s.id, s]));
const sessionsByWeek = new Map();
for (const item of sessionItems) {
  const s = item.entity;
  if (!s?.weekId) continue;
  const list = sessionsByWeek.get(s.weekId) || [];
  list.push(item);
  sessionsByWeek.set(s.weekId, list);
}

function dominantPt(weekId) {
  const counts = new Map();
  for (const item of sessionsByWeek.get(weekId) || []) {
    const st = studentById.get(item.entity.studentId);
    const pt = String(st?.programType || '').trim();
    if (!pt) continue;
    counts.set(pt, (counts.get(pt) || 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [pt, c] of counts) {
    if (c > n) {
      best = pt;
      n = c;
    }
  }
  return best;
}

function resolvedLabel(week) {
  const stamped = String(week.programType || '').trim();
  const kids = dominantPt(week.id);
  if (!stamped) return kids;
  if (!kids) return stamped;
  if (canon(stamped) === canon(kids)) return kids.length >= stamped.length ? kids : stamped;
  return stamped;
}

const weekItemById = new Map(weekItems.filter((it) => it.entity?.id).map((it) => [it.entity.id, it]));
const groups = new Map();
for (const item of weekItems) {
  const w = item.entity;
  if (!w || (w.status !== 'draft' && w.status !== 'reopened')) continue;
  const label = resolvedLabel(w);
  const key = `${w.providerId}::${w.weekStart}::${canon(label) || '(blank)'}`;
  const list = groups.get(key) || [];
  list.push(w);
  groups.set(key, list);
}

const plan = [];
for (const [key, drafts] of groups) {
  if (drafts.length < 2) continue;
  drafts.sort((a, b) => {
    const as = (sessionsByWeek.get(a.id) || []).length;
    const bs = (sessionsByWeek.get(b.id) || []).length;
    if (bs !== as) return bs - as;
    return String(b.programType || '').length - String(a.programType || '').length;
  });
  const keep = drafts[0];
  const drop = drafts.slice(1);
  const label = resolvedLabel(keep) || drop.map(resolvedLabel).find(Boolean) || '';
  plan.push({ key, keep, drop, label });
}

const summary = {
  groups: plan.map((p) => {
    const prov = provById.get(p.keep.providerId);
    return {
      provider: prov ? `${prov.firstName} ${prov.lastName}` : p.keep.providerId,
      weekStart: p.keep.weekStart,
      keep: p.keep.id,
      keepSessions: (sessionsByWeek.get(p.keep.id) || []).length,
      label: p.label,
      drop: p.drop.map((w) => ({
        id: w.id,
        sessions: (sessionsByWeek.get(w.id) || []).length,
        stamp: w.programType || '',
      })),
    };
  }),
};

if (!plan.length) {
  console.log(JSON.stringify({ ...summary, wrote: false, reason: 'nothing to merge' }, null, 2));
  process.exit(0);
}

let movedSessions = 0;
let deletedWeeks = 0;
let updatedTransfers = 0;
for (const step of plan) {
  const keepItem = weekItemById.get(step.keep.id);
  if (!keepItem) throw new Error(`keep week missing ${step.keep.id}`);
  if (step.keep.status !== 'draft' && step.keep.status !== 'reopened') {
    throw new Error(`refusing to merge into ${step.keep.status} ${step.keep.id}`);
  }
  for (const extra of step.drop) {
    if (extra.status !== 'draft' && extra.status !== 'reopened') {
      throw new Error(`refusing to remove ${extra.status} ${extra.id}`);
    }
    for (const item of sessionsByWeek.get(extra.id) || []) {
      const next = { ...item.entity, weekId: step.keep.id };
      await doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: { ...item, entity: next },
        }),
      );
      movedSessions += 1;
    }
    for (const item of transferItems) {
      const t = item.entity;
      if (!t || t.weekId !== extra.id) continue;
      const next = { ...t, weekId: step.keep.id };
      await doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: { ...item, entity: next },
        }),
      );
      updatedTransfers += 1;
    }
    await doc.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: 'ENTITY#weeks', sk: `ID#${extra.id}` },
      }),
    );
    deletedWeeks += 1;
  }
  if (step.label && step.label !== String(step.keep.programType || '').trim()) {
    const next = { ...keepItem.entity, programType: step.label };
    await doc.send(
      new PutCommand({
        TableName: TABLE,
        Item: { ...keepItem, entity: next },
      }),
    );
  }
}

const out = { ...summary, movedSessions, deletedWeeks, updatedTransfers, wrote: true };
writeFileSync(path.join(outDir, 'same-district-draft-merge.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
