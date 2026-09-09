import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterStubFilesByKinds, writeStubReports } from './stub-reports.js';

describe('writeStubReports', () => {
  it('writes all fixture kinds by default (including new_services)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wg-stubs-'));
    const result = await writeStubReports(dir);
    expect(Object.keys(result.files).sort()).toEqual(
      [
        'caregiver_codes',
        'closed_cases',
        'discharge_service',
        'new_services',
        'opened_cases',
        'verified_sessions',
      ].sort(),
    );
    expect(result.files.opened_cases).toBeDefined();
    const opened = await readFile(result.files.opened_cases!, 'utf8');
    expect(opened).toContain('Early Intervention');
    expect(opened).toContain('PCA001');
    const newServices = await readFile(result.files.new_services!, 'utf8');
    expect(newServices).toContain('HH-NS-1');
  });

  it('case-only kinds omit verified_sessions so summary stays "not required"', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wg-stubs-cases-'));
    const kinds = [
      'opened_cases',
      'closed_cases',
      'discharge_service',
      'new_services',
    ] as const;
    const result = await writeStubReports(dir, kinds);
    expect(result.files.verified_sessions).toBeUndefined();
    expect(result.files.caregiver_codes).toBeUndefined();
    expect(result.files.new_services).toBeDefined();
    expect(result.files.opened_cases).toBeDefined();
  });
});

describe('filterStubFilesByKinds', () => {
  it('drops kinds not in reportKinds', () => {
    const filtered = filterStubFilesByKinds(
      {
        opened_cases: '/tmp/open.csv',
        verified_sessions: '/tmp/api.csv',
        new_services: '/tmp/ns.csv',
      },
      ['opened_cases', 'new_services'],
    );
    expect(filtered).toEqual({
      opened_cases: '/tmp/open.csv',
      new_services: '/tmp/ns.csv',
    });
  });
});
