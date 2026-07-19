import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeStubReports } from './stub-reports.js';

describe('writeStubReports', () => {
  it('writes three CSV fixtures', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wg-stubs-'));
    const result = await writeStubReports(dir);
    expect(Object.keys(result.files)).toHaveLength(3);
    expect(result.files.opened_cases).toBeDefined();
    const opened = await readFile(result.files.opened_cases!, 'utf8');
    expect(opened).toContain('Early Intervention');
    expect(opened).toContain('PCA001');
  });
});
