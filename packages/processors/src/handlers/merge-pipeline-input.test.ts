import { describe, expect, it } from 'vitest';
import { handler } from './merge-pipeline-input.js';

describe('merge-pipeline-input', () => {
  it('injects sandbox false when EventBridge omits the flag', async () => {
    const result = await handler(
      {
        runId: '28b5e15f-57e3-0665-a9ad-db496ca607e6',
        dryRun: false,
        reportKinds: ['opened_cases', 'closed_cases', 'discharge_service', 'new_services'],
      },
      {} as never,
      () => undefined,
    );
    expect(result).toEqual({
      runId: '28b5e15f-57e3-0665-a9ad-db496ca607e6',
      dryRun: false,
      sandbox: false,
      sandboxEmailFixtures: false,
      sandboxLiveFixtures: false,
      dateRanges: {},
      reportKinds: ['opened_cases', 'closed_cases', 'discharge_service', 'new_services'],
      syncRetryCount: 0,
    });
  });

  it('preserves sandbox true from the sandbox trigger', async () => {
    const result = await handler(
      {
        runId: 'sandbox-test',
        dryRun: true,
        sandbox: true,
        sandboxEmailFixtures: false,
        sandboxLiveFixtures: true,
        reportKinds: ['opened_cases'],
      },
      {} as never,
      () => undefined,
    );
    expect(result?.sandbox).toBe(true);
    expect(result?.sandboxLiveFixtures).toBe(true);
    expect(result?.sandboxEmailFixtures).toBe(false);
  });

  it('preserves dateRanges from manual live start', async () => {
    const result = await handler(
      {
        runId: 'manual-live',
        dryRun: false,
        reportKinds: ['verified_sessions', 'caregiver_codes'],
        dateRanges: {
          verified_sessions: { from: '2026-08-18', to: '2026-08-24' },
        },
      },
      {} as never,
      () => undefined,
    );
    expect(result?.dateRanges).toEqual({
      verified_sessions: { from: '2026-08-18', to: '2026-08-24' },
    });
  });
});