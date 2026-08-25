import type { PipelineRunInput } from './types/pipeline.js';

/** All reports for a manual sandbox run (same date windows as production via defaultDateRange). */
export const SANDBOX_REPORT_KINDS = [
  'opened_cases',
  'closed_cases',
  'discharge_service',
  'new_services',
  'verified_sessions',
  'caregiver_codes',
] as const;

export function buildSandboxRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `sandbox-${stamp}`;
}

export function buildSandboxPipelineInput(now: Date = new Date()): PipelineRunInput {
  return {
    runId: buildSandboxRunId(now),
    dryRun: true,
    sandbox: true,
    sandboxEmailFixtures: false,
    sandboxLiveFixtures: false,
    reportKinds: [...SANDBOX_REPORT_KINDS],
  };
}

/** Sandbox-only: fake CSVs that exercise every email section (no ProviderSoft download). */
export function buildSandboxEmailFixturePipelineInput(now: Date = new Date()): PipelineRunInput {
  return {
    runId: buildSandboxRunId(now),
    dryRun: true,
    sandbox: true,
    sandboxEmailFixtures: true,
    sandboxLiveFixtures: false,
    reportKinds: [...SANDBOX_REPORT_KINDS],
  };
}

/** Sandbox-only: one patient across all reports, writes to HHA sandbox1 (dryRun=false). */
export function buildSandboxLiveFixturePipelineInput(now: Date = new Date()): PipelineRunInput {
  return {
    runId: `sandbox-live-${now.toISOString().replace(/[:.]/g, '-')}`,
    dryRun: false,
    sandbox: true,
    sandboxEmailFixtures: false,
    sandboxLiveFixtures: true,
    reportKinds: [...SANDBOX_REPORT_KINDS],
  };
}

/**
 * Manual LIVE sessions test — API Report + caregiver codes only
 * (visits / pay codes). Not the full nightly case suite.
 */
export const LIVE_SESSIONS_REPORT_KINDS = [
  'verified_sessions',
  'caregiver_codes',
] as const;

export function buildLiveRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `manual-live-sessions-${stamp}`;
}

export function buildLivePipelineInput(now: Date = new Date()): PipelineRunInput {
  return {
    runId: buildLiveRunId(now),
    dryRun: false,
    sandbox: false,
    sandboxEmailFixtures: false,
    sandboxLiveFixtures: false,
    reportKinds: [...LIVE_SESSIONS_REPORT_KINDS],
  };
}

/** HHA Enterprise SOAP production endpoint (read-only in sandbox / dry-run). */
export const HHA_PRODUCTION_SOAP_URL =
  'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
