import {
  isTherapistActivityText,
  newId,
  nowIso,
  type ArchiveKind,
  type ArchiveRecord,
  type ArchiveSourceType,
  type MemoryStore,
} from '@white-glove/tms-db';
import { putLockerPdf } from './s3-state.js';

export type ArchiveListFilter = {
  kind?: ArchiveKind | '';
  providerId?: string;
  from?: string;
  to?: string;
};

export function detectUploadSourceType(text: string): ArchiveSourceType {
  return isTherapistActivityText(text) ? 'therapist_activity' : 'frontline';
}

export function filterArchives(
  rows: ArchiveRecord[],
  filter: ArchiveListFilter = {},
): ArchiveRecord[] {
  const kind = String(filter.kind || '').trim() as ArchiveKind | '';
  const providerId = String(filter.providerId || '').trim();
  const from = String(filter.from || '').trim().slice(0, 10);
  const to = String(filter.to || '').trim().slice(0, 10);
  const inRange = (day: string) => {
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };
  return rows
    .filter((row) => {
      if (kind && row.kind !== kind) return false;
      if (providerId && row.providerId !== providerId) return false;
      if (!from && !to) return true;
      // Match archive created day OR timesheet week-start so signed PDFs archived
      // after the service week (and mid-week defaults) still show up.
      const created = String(row.createdAt || '').slice(0, 10);
      const weekStart = String(row.weekStart || '').slice(0, 10);
      return inRange(created) || inRange(weekStart);
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function archiveListItem(row: ArchiveRecord, store: MemoryStore) {
  const provider = store.data.providers.find((p) => p.id === row.providerId);
  const school = row.schoolId
    ? store.data.schools.find((s) => s.id === row.schoolId)
    : undefined;
  return {
    id: row.id,
    kind: row.kind,
    sourceType: row.sourceType,
    userId: row.userId,
    providerId: row.providerId,
    providerName: provider
      ? `${provider.firstName} ${provider.lastName}`.trim()
      : row.providerId || '',
    schoolId: row.schoolId || '',
    schoolName: school?.name || '',
    weekId: row.weekId || '',
    weekStart: row.weekStart || '',
    filename: row.filename || '',
    status: row.status || '',
    createdAt: row.createdAt,
    hasFile: Boolean(row.s3Key),
  };
}

/** Persist PDF + metadata; never throws into the caller flow. */
export async function persistArchivePdf(opts: {
  store: MemoryStore;
  kind: ArchiveKind;
  sourceType: ArchiveSourceType;
  userId: string;
  providerId: string;
  schoolId?: string;
  weekId?: string;
  weekStart?: string;
  filename: string;
  s3Key: string;
  status?: string;
  pdf?: Buffer | null;
  /** When set, update this existing timesheet archive instead of inserting. */
  replaceId?: string;
}): Promise<ArchiveRecord | null> {
  try {
    if (opts.pdf && opts.pdf.length && opts.s3Key) {
      await putLockerPdf(opts.s3Key, opts.pdf);
    }
    const id = opts.replaceId || newId();
    const existing = opts.replaceId ? opts.store.archiveById(opts.replaceId) : undefined;
    const row: ArchiveRecord = {
      id,
      kind: opts.kind,
      sourceType: opts.sourceType,
      userId: opts.userId || existing?.userId || '',
      providerId: opts.providerId || existing?.providerId || '',
      schoolId: opts.schoolId ?? existing?.schoolId ?? '',
      weekId: opts.weekId ?? existing?.weekId ?? '',
      weekStart: opts.weekStart ?? existing?.weekStart ?? '',
      filename: opts.filename || existing?.filename || 'document.pdf',
      s3Key: opts.s3Key || existing?.s3Key || '',
      status: opts.status ?? existing?.status ?? '',
      createdAt: existing?.createdAt || nowIso(),
    };
    return opts.store.upsertArchive(row);
  } catch (err) {
    console.warn(
      'archive persist failed',
      err instanceof Error ? err.message : err,
      { kind: opts.kind, s3Key: opts.s3Key },
    );
    return null;
  }
}

/** Prefer an existing timesheet archive for this week when re-saving PDF. */
export function findTimesheetArchive(store: MemoryStore, weekId: string): ArchiveRecord | undefined {
  return store.data.archives
    .filter((a) => a.kind === 'timesheet' && a.weekId === weekId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}

export function markTimesheetArchivesStatus(
  store: MemoryStore,
  weekId: string,
  status: string,
): void {
  for (const row of store.data.archives) {
    if (row.kind === 'timesheet' && row.weekId === weekId) {
      store.upsertArchive({ ...row, status });
    }
  }
}

export function canAccessArchive(
  row: ArchiveRecord,
  opts: {
    role: string;
    userId: string;
    providerId?: string;
    /** Same-name / orphan twin provider ids (therapist login may differ from archive row). */
    providerIds?: string[];
  },
): boolean {
  if (opts.role === 'admin') return true;
  if (row.userId && row.userId === opts.userId) return true;
  const ids = new Set(
    [...(opts.providerIds || []), opts.providerId || ''].map((x) => String(x || '').trim()).filter(Boolean),
  );
  if (ids.size && ids.has(String(row.providerId || '').trim())) return true;
  return false;
}

/** Archives for this provider id plus any alias twin ids. */
export function archivesForProviderIds(
  rows: ArchiveRecord[],
  providerIds: string[],
): ArchiveRecord[] {
  const ids = new Set(providerIds.map((x) => String(x || '').trim()).filter(Boolean));
  if (!ids.size) return [];
  return rows.filter((a) => ids.has(String(a.providerId || '').trim()));
}
