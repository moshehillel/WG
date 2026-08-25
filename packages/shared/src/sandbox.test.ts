import { describe, expect, it } from 'vitest';
import {
  buildLivePipelineInput,
  buildSandboxLiveFixturePipelineInput,
  buildSandboxPipelineInput,
  LIVE_SESSIONS_REPORT_KINDS,
  SANDBOX_REPORT_KINDS,
} from './sandbox.js';

describe('pipeline trigger inputs', () => {
  it('sandbox is dry-run + sandbox flags', () => {
    const input = buildSandboxPipelineInput(new Date('2026-08-24T15:00:00.000Z'));
    expect(input.dryRun).toBe(true);
    expect(input.sandbox).toBe(true);
    expect(input.sandboxLiveFixtures).toBe(false);
    expect(input.reportKinds).toEqual([...SANDBOX_REPORT_KINDS]);
  });

  it('sandbox live fixtures write to HHA sandbox1 only', () => {
    const input = buildSandboxLiveFixturePipelineInput(new Date('2026-08-24T15:00:00.000Z'));
    expect(input.dryRun).toBe(false);
    expect(input.sandbox).toBe(true);
    expect(input.sandboxLiveFixtures).toBe(true);
  });

  it('live manual run is sessions + caregiver codes only', () => {
    const input = buildLivePipelineInput(new Date('2026-08-24T15:00:00.000Z'));
    expect(input.runId).toBe('manual-live-sessions-2026-08-24T15-00-00-000Z');
    expect(input.dryRun).toBe(false);
    expect(input.sandbox).toBe(false);
    expect(input.sandboxEmailFixtures).toBe(false);
    expect(input.sandboxLiveFixtures).toBe(false);
    expect(input.reportKinds).toEqual([...LIVE_SESSIONS_REPORT_KINDS]);
    expect(input.reportKinds).not.toContain('opened_cases');
    expect(input.reportKinds).not.toContain('new_services');
  });
});