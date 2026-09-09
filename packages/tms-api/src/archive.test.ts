import { describe, expect, it } from 'vitest';
import {
  canAccessArchive,
  detectUploadSourceType,
  filterArchives,
} from './archive.js';
import type { ArchiveRecord } from '@white-glove/tms-db';

function row(partial: Partial<ArchiveRecord>): ArchiveRecord {
  return {
    id: 'a1',
    kind: 'upload',
    sourceType: 'frontline',
    userId: 'u1',
    providerId: 'p1',
    schoolId: '',
    weekId: '',
    weekStart: '',
    filename: 'x.pdf',
    s3Key: 'tms/archive/uploads/p1/a1.pdf',
    status: 'imported',
    createdAt: '2026-09-01T12:00:00.000Z',
    ...partial,
  };
}

describe('archive helpers', () => {
  it('detects therapist activity vs frontline', () => {
    expect(detectUploadSourceType('Therapist Activity Printed\nStudent Name: A')).toBe(
      'therapist_activity',
    );
    expect(detectUploadSourceType('Related Service Session Notes\nStudent: A')).toBe('frontline');
  });

  it('filters by kind, provider, and date', () => {
    const rows = [
      row({ id: '1', kind: 'upload', providerId: 'p1', createdAt: '2026-09-01T00:00:00Z' }),
      row({
        id: '2',
        kind: 'timesheet',
        sourceType: 'timesheet',
        providerId: 'p1',
        createdAt: '2026-09-05T00:00:00Z',
      }),
      row({ id: '3', kind: 'upload', providerId: 'p2', createdAt: '2026-09-08T00:00:00Z' }),
    ];
    expect(filterArchives(rows, { kind: 'upload' }).map((r) => r.id)).toEqual(['3', '1']);
    expect(filterArchives(rows, { providerId: 'p1' }).map((r) => r.id)).toEqual(['2', '1']);
    expect(filterArchives(rows, { from: '2026-09-04', to: '2026-09-06' }).map((r) => r.id)).toEqual([
      '2',
    ]);
  });

  it('authz allows admin or matching provider/user', () => {
    const a = row({ userId: 'u1', providerId: 'p1' });
    expect(canAccessArchive(a, { role: 'admin', userId: 'other' })).toBe(true);
    expect(canAccessArchive(a, { role: 'therapist', userId: 'u1' })).toBe(true);
    expect(canAccessArchive(a, { role: 'therapist', userId: 'x', providerId: 'p1' })).toBe(true);
    expect(canAccessArchive(a, { role: 'therapist', userId: 'x', providerId: 'p2' })).toBe(false);
    expect(
      canAccessArchive(a, { role: 'therapist', userId: 'x', providerId: 'p2', providerIds: ['p2', 'p1'] }),
    ).toBe(true);
  });
});
