import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  META_MIGRATION_SK,
  META_PK,
  MemoryStore,
  assembleSnapshot,
  diffSnapshots,
  dynamoPk,
  dynamoSk,
  snapshotToEntityPuts,
  type SnapshotDelete,
  type SnapshotPut,
  type TmsSnapshot,
} from '@white-glove/tms-db';

const S3_STATE_KEY = 'tms/state.json';
const S3_MIGRATED_BACKUP_KEY = 'tms/state.pre-dynamo.json';

export type TmsMigrationMeta = {
  status: 'in_progress' | 'complete';
  startedAt?: string;
  completedAt?: string;
  sourceKey?: string;
  entityCount?: number;
  error?: string;
};

/** Minimal document store — real Dynamo or in-memory for tests. */
export interface TmsDocStore {
  get(pk: string, sk: string): Promise<Record<string, unknown> | undefined>;
  put(item: Record<string, unknown>, opts?: { condition?: string }): Promise<'ok' | 'condition_failed'>;
  update(
    pk: string,
    sk: string,
    update: { expression: string; names: Record<string, string>; values: Record<string, unknown> },
  ): Promise<void>;
  scanAll(): Promise<Record<string, unknown>[]>;
  batchWrite(puts: Record<string, unknown>[], deletes: Array<{ pk: string; sk: string }>): Promise<void>;
}

export class InMemoryTmsDocStore implements TmsDocStore {
  private readonly items = new Map<string, Record<string, unknown>>();

  private key(pk: string, sk: string): string {
    return `${pk}\0${sk}`;
  }

  async get(pk: string, sk: string): Promise<Record<string, unknown> | undefined> {
    const row = this.items.get(this.key(pk, sk));
    return row ? structuredClone(row) : undefined;
  }

  async put(
    item: Record<string, unknown>,
    opts?: { condition?: string },
  ): Promise<'ok' | 'condition_failed'> {
    const pk = String(item.pk);
    const sk = String(item.sk);
    const k = this.key(pk, sk);
    if (opts?.condition?.includes('attribute_not_exists') && this.items.has(k)) {
      return 'condition_failed';
    }
    this.items.set(k, structuredClone(item));
    return 'ok';
  }

  async update(
    pk: string,
    sk: string,
    update: { expression: string; names: Record<string, string>; values: Record<string, unknown> },
  ): Promise<void> {
    const k = this.key(pk, sk);
    const cur = { ...(this.items.get(k) || { pk, sk }) };
    for (const [alias, attr] of Object.entries(update.names)) {
      for (const [valueToken, value] of Object.entries(update.values)) {
        if (
          update.expression.includes(`${alias} = ${valueToken}`) ||
          update.expression.includes(`${alias}=${valueToken}`)
        ) {
          cur[attr] = value;
        }
      }
    }
    this.items.set(k, cur);
  }

  async scanAll(): Promise<Record<string, unknown>[]> {
    return [...this.items.values()].map((v) => structuredClone(v));
  }

  async batchWrite(
    puts: Record<string, unknown>[],
    deletes: Array<{ pk: string; sk: string }>,
  ): Promise<void> {
    for (const item of puts) {
      await this.put(item);
    }
    for (const d of deletes) {
      this.items.delete(this.key(d.pk, d.sk));
    }
  }
}

export class DynamoTmsDocStore implements TmsDocStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, client?: DynamoDBClient) {
    this.tableName = tableName;
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async get(pk: string, sk: string): Promise<Record<string, unknown> | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    return res.Item as Record<string, unknown> | undefined;
  }

  async put(
    item: Record<string, unknown>,
    opts?: { condition?: string },
  ): Promise<'ok' | 'condition_failed'> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ...(opts?.condition ? { ConditionExpression: opts.condition } : {}),
        }),
      );
      return 'ok';
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return 'condition_failed';
      }
      throw err;
    }
  }

  async update(
    pk: string,
    sk: string,
    update: { expression: string; names: Record<string, string>; values: Record<string, unknown> },
  ): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: update.expression,
        ExpressionAttributeNames: update.names,
        ExpressionAttributeValues: update.values,
      }),
    );
  }

  async scanAll(): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new ScanCommand({
          TableName: this.tableName,
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items || []) items.push(item as Record<string, unknown>);
      ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ExclusiveStartKey);
    return items;
  }

  async batchWrite(
    puts: Record<string, unknown>[],
    deletes: Array<{ pk: string; sk: string }>,
  ): Promise<void> {
    const requests: Array<
      | { PutRequest: { Item: Record<string, unknown> } }
      | { DeleteRequest: { Key: { pk: string; sk: string } } }
    > = [
      ...puts.map((Item) => ({ PutRequest: { Item } })),
      ...deletes.map((Key) => ({ DeleteRequest: { Key } })),
    ];
    for (let i = 0; i < requests.length; i += 25) {
      let batch = requests.slice(i, i + 25);
      let attempt = 0;
      while (batch.length && attempt < 8) {
        const res = await this.doc.send(
          new BatchWriteCommand({
            RequestItems: { [this.tableName]: batch },
          }),
        );
        const unprocessed = res.UnprocessedItems?.[this.tableName] || [];
        batch = unprocessed as typeof batch;
        if (batch.length) {
          attempt += 1;
          await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        }
      }
      if (batch.length) {
        throw new Error(`DynamoDB BatchWrite left ${batch.length} unprocessed items`);
      }
    }
  }
}

function tableName(): string | undefined {
  const name = (process.env.TMS_STATE_TABLE || '').trim();
  return name || undefined;
}

let cachedDoc: TmsDocStore | undefined;

export function resetTmsDocStoreCache(): void {
  cachedDoc = undefined;
}

export function getTmsDocStore(override?: TmsDocStore): TmsDocStore | undefined {
  if (override) {
    cachedDoc = override;
    return override;
  }
  if (cachedDoc) return cachedDoc;
  const name = tableName();
  if (!name) return undefined;
  cachedDoc = new DynamoTmsDocStore(name);
  return cachedDoc;
}

function putItemFromEntity(p: SnapshotPut): Record<string, unknown> {
  return {
    pk: dynamoPk(p.collection),
    sk: dynamoSk(p.id),
    collection: p.collection,
    entityId: p.id,
    entity: p.row,
  };
}

function deleteKeyFromEntity(d: SnapshotDelete): { pk: string; sk: string } {
  return { pk: dynamoPk(d.collection), sk: dynamoSk(d.id) };
}

export async function loadSnapshotFromDynamo(
  store: MemoryStore,
  docStore?: TmsDocStore,
): Promise<TmsSnapshot> {
  const doc = getTmsDocStore(docStore);
  if (!doc) return store.snapshot();
  const items = await doc.scanAll();
  const entities = items
    .filter((it) => typeof it.pk === 'string' && String(it.pk).startsWith('ENTITY#'))
    .map((it) => ({
      collection: String(it.collection || String(it.pk).slice('ENTITY#'.length)),
      row: it.entity,
    }));
  const snap = assembleSnapshot(entities);
  store.load(snap);
  return store.snapshot();
}

export async function saveSnapshotDiffToDynamo(
  before: TmsSnapshot,
  after: TmsSnapshot,
  docStore?: TmsDocStore,
): Promise<SnapshotDiffResult> {
  const doc = getTmsDocStore(docStore);
  if (!doc) return { puts: 0, deletes: 0, skipped: true };
  const diff = diffSnapshots(before, after);
  if (!diff.puts.length && !diff.deletes.length) {
    return { puts: 0, deletes: 0, skipped: false };
  }
  await doc.batchWrite(
    diff.puts.map(putItemFromEntity),
    diff.deletes.map(deleteKeyFromEntity),
  );
  return { puts: diff.puts.length, deletes: diff.deletes.length, skipped: false };
}

export type SnapshotDiffResult = { puts: number; deletes: number; skipped: boolean };

async function readS3Snapshot(): Promise<TmsSnapshot | null> {
  const bucket = process.env.REPORTS_BUCKET;
  if (!bucket) return null;
  const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: S3_STATE_KEY }));
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as TmsSnapshot;
  } catch {
    return null;
  }
}

async function writeS3Backup(snapshot: TmsSnapshot): Promise<void> {
  const bucket = process.env.REPORTS_BUCKET;
  if (!bucket) return;
  const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: S3_MIGRATED_BACKUP_KEY,
      Body: JSON.stringify(snapshot),
      ContentType: 'application/json',
    }),
  );
}

export async function getMigrationMeta(docStore?: TmsDocStore): Promise<TmsMigrationMeta | null> {
  const doc = getTmsDocStore(docStore);
  if (!doc) return null;
  const item = await doc.get(META_PK, META_MIGRATION_SK);
  if (!item) return null;
  return {
    status: item.status === 'complete' ? 'complete' : 'in_progress',
    startedAt: item.startedAt ? String(item.startedAt) : undefined,
    completedAt: item.completedAt ? String(item.completedAt) : undefined,
    sourceKey: item.sourceKey ? String(item.sourceKey) : undefined,
    entityCount: typeof item.entityCount === 'number' ? item.entityCount : undefined,
    error: item.error ? String(item.error) : undefined,
  };
}

async function waitForMigrationComplete(doc: TmsDocStore, maxMs = 60_000): Promise<TmsMigrationMeta> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const meta = await getMigrationMeta(doc);
    if (meta?.status === 'complete') return meta;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for TMS DynamoDB migration to complete');
}

export type MigrateOptions = {
  docStore?: TmsDocStore;
  /** Injected for tests; defaults to reading S3 tms/state.json. */
  loadSource?: () => Promise<TmsSnapshot | null>;
  writeBackup?: (snapshot: TmsSnapshot) => Promise<void>;
};

/**
 * One-shot idempotent import of tms/state.json into Dynamo entity items.
 * Concurrent Lambdas: only one claims the migration lock; others wait.
 */
export async function ensureMigratedFromS3(
  docStoreOrOpts?: TmsDocStore | MigrateOptions,
): Promise<TmsMigrationMeta | null> {
  const opts: MigrateOptions =
    docStoreOrOpts && 'scanAll' in docStoreOrOpts
      ? { docStore: docStoreOrOpts }
      : (docStoreOrOpts as MigrateOptions | undefined) || {};
  const doc = getTmsDocStore(opts.docStore);
  if (!doc) return null;

  const existing = await getMigrationMeta(doc);
  if (existing?.status === 'complete') return existing;
  if (existing?.status === 'in_progress') {
    return waitForMigrationComplete(doc);
  }

  const startedAt = new Date().toISOString();
  const claimed = await doc.put(
    {
      pk: META_PK,
      sk: META_MIGRATION_SK,
      status: 'in_progress',
      startedAt,
      sourceKey: S3_STATE_KEY,
    },
    { condition: 'attribute_not_exists(pk)' },
  );
  if (claimed === 'condition_failed') {
    return waitForMigrationComplete(doc);
  }

  const loadSource = opts.loadSource || readS3Snapshot;
  const writeBackup = opts.writeBackup || writeS3Backup;

  try {
    // If entities already present (partial prior run), keep them — do not wipe from S3.
    const already = await doc.scanAll();
    const entityItems = already.filter(
      (it) => typeof it.pk === 'string' && String(it.pk).startsWith('ENTITY#'),
    );
    let entityCount = entityItems.length;

    if (entityCount === 0) {
      const source = await loadSource();
      if (source) {
        const tmp = new MemoryStore(source);
        const puts = snapshotToEntityPuts(tmp.snapshot());
        await doc.batchWrite(puts.map(putItemFromEntity), []);
        entityCount = puts.length;
        try {
          await writeBackup(tmp.snapshot());
        } catch (err) {
          console.warn('TMS migration: backup to S3 failed', err);
        }
      }
    }

    const completedAt = new Date().toISOString();
    await doc.update(META_PK, META_MIGRATION_SK, {
      expression: 'SET #status = :status, #completedAt = :completedAt, #entityCount = :entityCount',
      names: {
        '#status': 'status',
        '#completedAt': 'completedAt',
        '#entityCount': 'entityCount',
      },
      values: {
        ':status': 'complete',
        ':completedAt': completedAt,
        ':entityCount': entityCount,
      },
    });
    return {
      status: 'complete',
      startedAt,
      completedAt,
      sourceKey: S3_STATE_KEY,
      entityCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await doc.update(META_PK, META_MIGRATION_SK, {
        expression: 'SET #error = :error',
        names: { '#error': 'error' },
        values: { ':error': message },
      });
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

/** Load path used by Lambda: migrate once, then hydrate MemoryStore from Dynamo. */
export async function loadTmsState(store: MemoryStore, docStore?: TmsDocStore): Promise<TmsSnapshot> {
  const doc = getTmsDocStore(docStore);
  if (!doc) {
    // No table configured — fall back to legacy S3 whole-file snapshot (local / transitional).
    const { loadSnapshotFromS3 } = await import('./s3-state.js');
    await loadSnapshotFromS3(store);
    return store.snapshot();
  }
  await ensureMigratedFromS3(doc);
  return loadSnapshotFromDynamo(store, doc);
}

/** Persist only changed entities (safe under concurrent writers of different rows). */
export async function saveTmsState(
  before: TmsSnapshot,
  store: MemoryStore,
  docStore?: TmsDocStore,
): Promise<SnapshotDiffResult> {
  const doc = getTmsDocStore(docStore);
  if (!doc) {
    const { saveSnapshotToS3 } = await import('./s3-state.js');
    await saveSnapshotToS3(store);
    return { puts: 0, deletes: 0, skipped: true };
  }
  return saveSnapshotDiffToDynamo(before, store.snapshot(), doc);
}
