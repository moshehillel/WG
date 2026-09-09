import type { SchoolCalendar, TmsSnapshot } from './types.js';
import { emptySnapshot } from './types.js';

/** All arrays on TmsSnapshot — each row becomes one DynamoDB item. */
export const SNAPSHOT_COLLECTIONS = [
  'users',
  'schools',
  'schoolCalendars',
  'providers',
  'adminNotes',
  'students',
  'mandates',
  'weeks',
  'sessions',
  'files',
  'archives',
  'dueDates',
  'alerts',
  'hhaTransfers',
  'audit',
  'settings',
] as const satisfies ReadonlyArray<keyof TmsSnapshot>;

export type SnapshotCollection = (typeof SNAPSHOT_COLLECTIONS)[number];

export function entityId(collection: SnapshotCollection, row: unknown): string {
  if (collection === 'schoolCalendars') {
    return String((row as SchoolCalendar).schoolId || '');
  }
  const id = (row as { id?: unknown })?.id;
  return id == null ? '' : String(id);
}

export function dynamoPk(collection: SnapshotCollection): string {
  return `ENTITY#${collection}`;
}

export function dynamoSk(id: string): string {
  return `ID#${id}`;
}

export type SnapshotPut = {
  collection: SnapshotCollection;
  id: string;
  row: unknown;
};

export type SnapshotDelete = {
  collection: SnapshotCollection;
  id: string;
};

export type SnapshotDiff = {
  puts: SnapshotPut[];
  deletes: SnapshotDelete[];
};

function stableJson(row: unknown): string {
  return JSON.stringify(row ?? null);
}

/** Entity-level diff so concurrent writers of different rows do not clobber each other. */
export function diffSnapshots(before: TmsSnapshot, after: TmsSnapshot): SnapshotDiff {
  const puts: SnapshotPut[] = [];
  const deletes: SnapshotDelete[] = [];
  for (const collection of SNAPSHOT_COLLECTIONS) {
    const beforeMap = new Map<string, string>();
    for (const row of before[collection] || []) {
      const id = entityId(collection, row);
      if (!id) continue;
      beforeMap.set(id, stableJson(row));
    }
    const afterMap = new Map<string, string>();
    for (const row of after[collection] || []) {
      const id = entityId(collection, row);
      if (!id) continue;
      afterMap.set(id, stableJson(row));
    }
    for (const [id, json] of afterMap) {
      if (beforeMap.get(id) !== json) {
        puts.push({ collection, id, row: JSON.parse(json) as unknown });
      }
    }
    for (const id of beforeMap.keys()) {
      if (!afterMap.has(id)) deletes.push({ collection, id });
    }
  }
  return { puts, deletes };
}

export function assembleSnapshot(
  items: Array<{ collection: string; row: unknown }>,
): TmsSnapshot {
  const snap = emptySnapshot();
  for (const item of items) {
    const collection = item.collection as SnapshotCollection;
    if (!SNAPSHOT_COLLECTIONS.includes(collection)) continue;
    if (!item.row || typeof item.row !== 'object') continue;
    (snap[collection] as unknown[]).push(item.row);
  }
  return snap;
}

export function snapshotToEntityPuts(snapshot: TmsSnapshot): SnapshotPut[] {
  const puts: SnapshotPut[] = [];
  for (const collection of SNAPSHOT_COLLECTIONS) {
    for (const row of snapshot[collection] || []) {
      const id = entityId(collection, row);
      if (!id) continue;
      puts.push({ collection, id, row });
    }
  }
  return puts;
}

export const META_PK = 'META';
export const META_MIGRATION_SK = 'MIGRATION';
