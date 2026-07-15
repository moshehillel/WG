import { z } from 'zod';
import { ReportKindSchema, SessionTriageSchema } from './reports.js';

export const PipelineRunInputSchema = z.object({
  runId: z.string().min(1),
  dryRun: z.boolean().default(false),
  /** ISO date (YYYY-MM-DD) for which reports are pulled. Defaults to today UTC. */
  reportDate: z.string().optional(),
});

export type PipelineRunInput = z.infer<typeof PipelineRunInputSchema>;

export const DownloadResultSchema = z.object({
  runId: z.string(),
  bucket: z.string(),
  keys: z.object({
    opened_cases: z.string(),
    closed_cases: z.string(),
    verified_sessions: z.string(),
  }),
  downloadedAt: z.string(),
});

export type DownloadResult = z.infer<typeof DownloadResultSchema>;

export const ParseResultSchema = z.object({
  runId: z.string(),
  counts: z.object({
    opened_cases: z.number(),
    closed_cases: z.number(),
    verified_sessions: z.number(),
    opened_cases_after_ei_filter: z.number(),
  }),
  artifactKeys: z.object({
    opened_cases: z.string(),
    closed_cases: z.string(),
    verified_sessions: z.string(),
  }),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;

export const ExceptionCodeSchema = z.enum([
  'missing_service_code',
  'unknown_service_code',
  'unmatched_patient',
  'missing_authorization',
  'clocking_mismatch',
  'hha_api_error',
  'parse_error',
  'skipped_by_rule',
  'other',
]);

export type ExceptionCode = z.infer<typeof ExceptionCodeSchema>;

export const PipelineExceptionSchema = z.object({
  code: ExceptionCodeSchema,
  message: z.string(),
  reportKind: ReportKindSchema.optional(),
  rowId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type PipelineException = z.infer<typeof PipelineExceptionSchema>;

export const ProcessorResultSchema = z.object({
  runId: z.string(),
  reportKind: ReportKindSchema,
  processed: z.number(),
  succeeded: z.number(),
  skipped: z.number(),
  failed: z.number(),
  exceptions: z.array(PipelineExceptionSchema),
});

export type ProcessorResult = z.infer<typeof ProcessorResultSchema>;

export const ValidateResultSchema = z.object({
  runId: z.string(),
  ok: z.boolean(),
  summary: z.object({
    opened: ProcessorResultSchema.optional(),
    closed: ProcessorResultSchema.optional(),
    sessions: ProcessorResultSchema.optional(),
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
