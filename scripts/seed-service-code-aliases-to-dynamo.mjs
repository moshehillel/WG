/**
 * One-time: write every SERVICE_CODE_ALIAS_MAP row into IdempotencyTable as
 * ref#program-service (same shape as runtime discoveries).
 *
 *   node scripts/seed-service-code-aliases-to-dynamo.mjs
 *   node scripts/seed-service-code-aliases-to-dynamo.mjs --dry-run
 *
 * Preserves an existing hhaCodeId. Always sets hhaServiceName from the sheet.
 * Name-only sheet rows (no ID yet) are still written — first live resolve fills ID.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

const TABLE =
  process.env.IDEMPOTENCY_TABLE?.trim() ||
  'WhiteGloveStack-IdempotencyTable22A5A209-RQ9QSY4WK01Z';

function normalizeMappingKey(value) {
  return (value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function parseAliasMap(ts) {
  const start = ts.indexOf('export const SERVICE_CODE_ALIAS_MAP');
  if (start < 0) throw new Error('SERVICE_CODE_ALIAS_MAP not found');
  const assign = ts.indexOf('= [', start);
  if (assign < 0) throw new Error('SERVICE_CODE_ALIAS_MAP array assign not found');
  const bracket = assign + 2; // points at '['
  let depth = 0;
  let end = -1;
  for (let i = bracket; i < ts.length; i++) {
    if (ts[i] === '[') depth++;
    else if (ts[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Could not parse alias array');
  const body = ts.slice(bracket + 1, end);
  const aliases = [];
  for (const m of body.matchAll(/\{([\s\S]*?)\}/g)) {
    const block = m[1];
    const field = (name) => block.match(new RegExp(`${name}:\\s*"([^"]*)"`))?.[1];
    const programType = field('programType');
    const providerSoftCode = field('providerSoftCode');
    const hhaServiceCodeName = field('hhaServiceCodeName');
    const hhaCode = field('hhaCode');
    if (!programType || !providerSoftCode || !hhaServiceCodeName) continue;
    aliases.push({
      programType,
      providerSoftCode,
      hhaServiceCodeName,
      ...(hhaCode ? { hhaCode } : {}),
    });
  }
  return aliases;
}

const aliasPath = path.join(
  repoRoot,
  'packages/shared/src/config/service-code-aliases.ts',
);
const aliases = parseAliasMap(readFileSync(aliasPath, 'utf8'));
console.log(`Parsed ${aliases.length} sheet aliases → table ${TABLE}${dryRun ? ' (dry-run)' : ''}`);

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const now = new Date().toISOString();

/** program+service → existing item */
const existingByKey = new Map();
/** normalized HHA service name → id (when unique in current table) */
const idByHhaName = new Map();
const ambiguousNames = new Set();

if (!dryRun) {
  let startKey;
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'ref#program-service' },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const it of page.Items ?? []) {
      existingByKey.set(it.sk, it);
      const nameKey = normalizeMappingKey(it.hhaServiceName);
      const id = it.hhaCodeId != null ? String(it.hhaCodeId).trim() : '';
      if (!nameKey || !id) continue;
      if (ambiguousNames.has(nameKey)) continue;
      const prev = idByHhaName.get(nameKey);
      if (prev && prev !== id) {
        idByHhaName.delete(nameKey);
        ambiguousNames.add(nameKey);
      } else {
        idByHhaName.set(nameKey, id);
      }
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  console.log(
    `Loaded ${existingByKey.size} existing ref#program-service; ${idByHhaName.size} unique HHA name→id hints`,
  );
}

let written = 0;
let updated = 0;
let unchanged = 0;
let nameOnly = 0;
let errors = 0;

for (const a of aliases) {
  const pk = 'ref#program-service';
  const sk = `${normalizeMappingKey(a.programType)}\0${normalizeMappingKey(a.providerSoftCode)}`;
  try {
    const existing = existingByKey.get(sk);
    const fromExisting =
      existing?.hhaCodeId != null && String(existing.hhaCodeId).trim()
        ? String(existing.hhaCodeId).trim()
        : undefined;
    const fromSheet = a.hhaCode?.trim() || undefined;
    const fromNameHint = idByHhaName.get(normalizeMappingKey(a.hhaServiceCodeName));
    const hhaCodeId = fromExisting ?? fromSheet ?? fromNameHint;

    const item = {
      pk,
      sk,
      programType: a.programType.trim(),
      serviceType: a.providerSoftCode.trim(),
      hhaServiceName: a.hhaServiceCodeName.trim(),
      ...(hhaCodeId ? { hhaCodeId } : {}),
      source: 'sheet-seed',
      updatedAt: now,
    };
    if (!hhaCodeId) nameOnly += 1;

    if (
      existing &&
      String(existing.hhaCodeId ?? '') === String(item.hhaCodeId ?? '') &&
      String(existing.hhaServiceName ?? '') === item.hhaServiceName &&
      existing.source === 'sheet-seed'
    ) {
      unchanged += 1;
      continue;
    }

    if (dryRun) {
      if (written + updated < 15) {
        console.log(
          `DRY ${existing ? 'upd' : 'put'} ${a.programType} / ${a.providerSoftCode} → ${item.hhaServiceName} id=${item.hhaCodeId ?? '(name-only)'}`,
        );
      }
    } else {
      await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
      existingByKey.set(sk, item);
    }
    if (existing) updated += 1;
    else written += 1;
  } catch (err) {
    errors += 1;
    console.error(`FAIL ${a.programType} / ${a.providerSoftCode}:`, err.message ?? err);
  }
}

console.log(
  JSON.stringify(
    {
      written,
      updated,
      unchanged,
      nameOnly,
      errors,
      totalAliases: aliases.length,
    },
    null,
    2,
  ),
);
