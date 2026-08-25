import { z } from 'zod';
import { ReportKindSchema, SessionTriageSchema } from './reports.js';

export const PipelineReportKindSchema = z.union([
  ReportKindSchema,
  z.enum(['caregiver_codes', 'discharge_service', 'new_services']),
]);

export const PipelineRunInputSchema = z.object({
  runId: z.string().min(1),
  dryRun: z.boolean().default(false),
  /** Manual sandbox link — real PS download + prod HHA read-only + always email summary. */
  sandbox: z.boolean().default(false),
  /** Sandbox only: use fake fixture CSVs to preview email layout (never production). */
  sandboxEmailFixtures: z.boolean().default(false),
  /** Sandbox only: cohesive fixture CSVs + HHA sandbox1 writes (never production schedules). */
  sandboxLiveFixtures: z.boolean().default(false),
  /** ISO date (YYYY-MM-DD) for which reports are pulled. Defaults to today UTC. */
  reportDate: z.string().optional(),
  /** Subset of reports for this run; defaults to all pipeline kinds in download Lambda. */
  reportKinds: z.array(PipelineReportKindSchema).optional(),
  /**
   * Optional per-report ProviderSoft date windows (ISO YYYY-MM-DD or M/D/YYYY).
   * Omitted kinds use defaultDateRange in the download bot.
   */
  dateRanges: z
    .record(
      z.string(),
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
      }),
    )
    .optional(),
});

export type PipelineRunInput = z.infer<typeof PipelineRunInputSchema>;

export const DownloadResultSchema = z.object({
  runId: z.string(),
  bucket: z.string(),
  keys: z.object({
    opened_cases: z.string().optional(),
    closed_cases: z.string().optional(),
    verified_sessions: z.string().optional(),
    caregiver_codes: z.string().optional(),
    discharge_service: z.string().optional(),
    new_services: z.string().optional(),
  }),
  downloadedAt: z.string(),
});

export type DownloadResult = z.infer<typeof DownloadResultSchema>;

export const ParseResultSchema = z.object({
  runId: z.string(),
  counts: z.object({
    opened_cases: z.number(),
    closed_cases: z.number(),
    /**
     * Present only when the API Report CSV was downloaded for this run.
     * Omitted (not `0`) when verified_sessions was not in reportKinds — avoids
     * "0 downloaded" emails on case-only nightly runs.
     */
    verified_sessions: z.number().optional(),
    opened_cases_after_ei_filter: z.number(),
    new_services: z.number().optional(),
    gluck_opened_cases: z.number().optional(),
    gluck_opened_after_ei_filter: z.number().optional(),
    new_services_after_ei_filter: z.number().optional(),
    discharge_service: z.number().optional(),
    caregiver_codes: z.number().optional(),
  }),
  artifactKeys: z.object({
    opened_cases: z.string(),
    closed_cases: z.string(),
    /** Set only when verified_sessions CSV was downloaded. */
    verified_sessions: z.string().optional(),
    caregiver_codes: z.string().optional(),
    discharge_service: z.string().optional(),
    new_services: z.string().optional(),
  }),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;

export const ExceptionCodeSchema = z.enum([
  'missing_service_code',
  'unknown_service_code',
  'unmatched_patient',
  'missing_authorization',
  'clocking_mismatch',
  'incomplete_unscheduled_clock',
  'hha_api_error',
  /** Missing/invalid required field or billing-guard stop (not a CSV parse failure). */
  'missing_field',
  /** True ProviderSoft/CSV parse failure only — not missing-field validation. */
  'parse_error',
  'skipped_by_rule',
  'download_error',
  'pipeline_step_error',
  'other',
]);

export type ExceptionCode = z.infer<typeof ExceptionCodeSchema>;

export const PipelineExceptionSchema = z.object({
  code: ExceptionCodeSchema,
  message: z.string(),
  /** Prefer PipelineReportKind so Gluck open vs new service exceptions label correctly. */
  reportKind: PipelineReportKindSchema.optional(),
  rowId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type PipelineException = z.infer<typeof PipelineExceptionSchema>;

/** Named row that synced successfully — used in alert emails + results.csv. */
export const ProcessorSuccessRowSchema = z.object({
  rowId: z.string(),
  patientName: z.string().optional(),
  caregiverName: z.string().optional(),
  programType: z.string().optional(),
});

export type ProcessorSuccessRow = z.infer<typeof ProcessorSuccessRowSchema>;

export const ProcessorResultSchema = z.object({
  runId: z.string(),
  reportKind: PipelineReportKindSchema,
  processed: z.number(),
  succeeded: z.number(),
  skipped: z.number(),
  failed: z.number(),
  exceptions: z.array(PipelineExceptionSchema),
  /** Optional named successes for clearer alert emails / CSV. */
  successes: z.array(ProcessorSuccessRowSchema).optional(),
  /** Soft-stop or branch crash from Lambda time limit — Step Functions may auto-retry. */
  timedOut: z.boolean().optional(),
});

export type ProcessorResult = z.infer<typeof ProcessorResultSchema>;

export const ValidateResultSchema = z.object({
  runId: z.string(),
  ok: z.boolean(),
  /** Present on newer validate-summary.json artifacts for dashboard aggregation. */
  dryRun: z.boolean().optional(),
  sandbox: z.boolean().optional(),
  summary: z.object({
    opened: ProcessorResultSchema.optional(),
    closed: ProcessorResultSchema.optional(),
    sessions: ProcessorResultSchema.optional(),
    newServices: ProcessorResultSchema.optional(),
    discharge: ProcessorResultSchema.optional(),
  }),
  exceptions: z.array(PipelineExceptionSchema),
  exceptionCount: z.number(),
});

export type ValidateResult = z.infer<typeof ValidateResultSchema>;

export const SessionDecisionSchema = z.object({
  sessionId: z.string(),
  triage: SessionTriageSchema,
  reason: z.string().optional(),
});

export type SessionDecision = z.infer<typeof SessionDecisionSchema>;
