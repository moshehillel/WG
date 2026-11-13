import { describe, expect, it } from 'vitest';
import { handler as openedHandler } from './handlers/opened.js';
import { handler as closedHandler } from './handlers/closed.js';
import type { ParseResult } from '@white-glove/shared';

const parse = {
  runId: 'monday-dry',
  counts: { verified_sessions: 10 },
  artifactKeys: {
    opened_cases: 'runs/monday-dry/normalized/new-opened-cases.json',
    closed_cases: 'runs/monday-dry/normalized/closed-cases.json',
    verified_sessions: 'runs/monday-dry/normalized/verified-sessions.json',
  },
} as ParseResult;

describe('dry run sessions only', () => {
  it('opened branch returns empty without reading HHA', async () => {
    const result = await openedHandler({ dryRun: true, parse }, {} as never, () => undefined);
    expect(result).toEqual({
      runId: 'monday-dry',
      reportKind: 'opened_cases',
      processed: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      exceptions: [],
    });
  });

  it('closed branch returns empty without reading HHA', async () => {
    const result = await closedHandler({ dryRun: true, parse }, {} as never, () => undefined);
    expect(result).toEqual({
      runId: 'monday-dry',
      reportKind: 'closed_cases',
      processed: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      exceptions: [],
    });
  });
});
