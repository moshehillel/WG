/**
 * Read-only: find Astacio provider + students matching JR/MICHAEL / Astacio names.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'WhiteGloveStack-TmsStateTable10F38FC9-1OCJ1211NQLHU';
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }), {
  marshallOptions: { removeUndefinedValues: true },
});

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
  return items.map((it) => it.entity).filter(Boolean);
}

function n(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const [providers, students, weeks, mandates] = await Promise.all([
  queryPk('ENTITY#providers'),
  queryPk('ENTITY#students'),
  queryPk('ENTITY#weeks'),
  queryPk('ENTITY#mandates'),
]);

const astacio = providers.filter(
  (p) => /astacio/i.test(`${p.firstName || ''} ${p.lastName || ''} ${p.displayName || ''}`),
);
console.log('providers matching Astacio:', astacio.map((p) => ({
  id: p.id,
  firstName: p.firstName,
  lastName: p.lastName,
  displayName: p.displayName,
  email: p.email,
})));

const providerIds = new Set(astacio.map((p) => p.id));
const recentWeeks = weeks
  .filter((w) => providerIds.has(w.providerId))
  .sort((a, b) => String(b.weekStart || '').localeCompare(String(a.weekStart || '')))
  .slice(0, 8);
console.log(
  'recent Astacio weeks:',
  recentWeeks.map((w) => ({ id: w.id, weekStart: w.weekStart, status: w.status, providerId: w.providerId })),
);

const nameHits = students.filter((s) => {
  const f = n(s.firstName);
  const l = n(s.lastName);
  const full = `${f} ${l}`;
  return (
    (l === 'jr' && /michael/.test(f)) ||
    (f === 'jr' && /michael/.test(l)) ||
    (l === 'michael' && /^jr\b/.test(f)) ||
    (/michael/.test(full) && /\bjr\b/.test(full)) ||
    /astacio/.test(full) ||
    (l === 'ms' || f === 'ms' || /^m s$/.test(f) || /^m s$/.test(l))
  );
});

console.log(
  'student name hits (jr/michael/astacio/ms):',
  nameHits.map((s) => ({
    id: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    schoolId: s.schoolId,
    programType: s.programType,
    programId: s.programId,
  })),
);

// Broader Michael last-name / first-name scan for caseload near-matches
const michaels = students.filter((s) => {
  const f = n(s.firstName);
  const l = n(s.lastName);
  return f === 'michael' || l === 'michael' || /^michael\b/.test(f) || /^michael\b/.test(l);
});
console.log(
  'all Michael students (sample up to 40):',
  michaels.slice(0, 40).map((s) => `${s.lastName}, ${s.firstName}`),
);
console.log('michael count:', michaels.length);

// Mandates on Astacio provider
const astacioMandates = mandates.filter((m) => providerIds.has(m.providerId));
const caseloadStudentIds = new Set(astacioMandates.map((m) => m.studentId));
const caseload = students
  .filter((s) => caseloadStudentIds.has(s.id))
  .map((s) => `${s.lastName}, ${s.firstName}`)
  .sort((a, b) => a.localeCompare(b));
console.log('Astacio caseload size:', caseload.length);
console.log(
  'Astacio caseload JR/Michael-ish:',
  caseload.filter((nm) => /michael|\bjr\b/i.test(nm)),
);
console.log('Astacio caseload (all):', caseload);
