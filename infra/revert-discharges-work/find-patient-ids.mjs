import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

function awsJson(args) {
  const out = execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 20_000_000 });
  return JSON.parse(out || 'null');
}

const tables = awsJson([
  'dynamodb',
  'list-tables',
  '--region',
  'us-east-1',
  '--query',
  "TableNames[?contains(@,'dempotency') || contains(@,'Idempot') || contains(@,'WhiteGlove')]",
  '--output',
  'json',
]);
console.log('tables', tables);

const needles = ['258272446', '06771684', 'PICCIUTO', 'SOLOMON', 'discharge'];
for (const table of tables || []) {
  for (const needle of needles.slice(0, 3)) {
    try {
      const exprValues = JSON.stringify({ ':c': { S: needle } });
      // write to temp file to avoid shell escaping
      const tmp = path.join(repoRoot, 'infra/revert-discharges-work/expr.json');
      writeFileSync(tmp, exprValues);
      const res = awsJson([
        'dynamodb',
        'scan',
        '--table-name',
        table,
        '--filter-expression',
        'contains(pk, :c) OR contains(sk, :c)',
        '--expression-attribute-values',
        `file://${tmp}`,
        '--region',
        'us-east-1',
        '--max-items',
        '10',
      ]);
      if (res?.Items?.length) {
        console.log(table, needle, JSON.stringify(res.Items, null, 2).slice(0, 1500));
      } else {
        console.log(table, needle, 'no items');
      }
    } catch (e) {
      console.log(table, needle, 'err', e.message.slice(0, 300));
    }
  }
}

// Also try CloudWatch ClosedFn for "dischargeService" or placement ids
const start = Date.parse('2026-09-15T20:55:00Z');
const end = Date.parse('2026-09-15T21:10:00Z');
for (const pattern of ['8522217', '8519959', 'dischargeService', 'PICCIUTO', 'SOLOMON']) {
  try {
    const res = awsJson([
      'logs',
      'filter-log-events',
      '--log-group-name',
      '/aws/lambda/WhiteGloveStack-ClosedFn618EFC8C-A4srMirJOT3k',
      '--start-time',
      String(start),
      '--end-time',
      String(end),
      '--filter-pattern',
      pattern,
      '--limit',
      '20',
      '--region',
      'us-east-1',
    ]);
    console.log(
      'CW',
      pattern,
      'events',
      res?.events?.length || 0,
      (res?.events || [])
        .slice(0, 3)
        .map((e) => e.message.slice(0, 250))
        .join(' || '),
    );
  } catch (e) {
    console.log('CW', pattern, e.message.slice(0, 200));
  }
}
