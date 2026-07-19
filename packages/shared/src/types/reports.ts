import { z } from 'zod';

/** Placeholder fields until sample ProviderSoft exports arrive. */
export const OpenedCaseRowSchema = z.object({
  caseId: z.string().min(1),
  patientExternalId: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().optional(),
  programType: z.string().optional(),
  serviceCode: z.string().optional(),
  authorizationNumber: z.string().optional(),
  contractId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isEarlyIntervention: z.boolean().optional(),
  raw: z.record(z.string(), z.string()).optional(),
});

export type OpenedCaseRow = z.infer<typeof OpenedCaseRowSchema>;

export const ClosedCaseRowSchema = z.object({
  caseId: z.string().min(1),
  patientExternalId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  programType: z.string().optional(),
  isEarlyIntervention: z.boolean().optional(),
  closedDate: z.string().optional(),
  closedReason: z.string().optional(),
  status: z.string().optional(),
  raw: z.record(z.string(), z.string()).optional(),
});

export type ClosedCaseRow = z.infer<typeof ClosedCaseRowSchema>;

export const SessionTriageSchema = z.enum(['auto_approve', 'verify_clocking', 'skip']);
export type SessionTriage = z.infer<typeof SessionTriageSchema>;

export const VerifiedSessionRowSchema = z.object({
  sessionId: z.string().min(1),
  caseId: z.string().optional(),
  patientExternalId: z.string().optional(),
  programType: z.string().optional(),
  isEarlyIntervention: z.boolean().optional(),
  serviceCode: z.string().optional(),
  visitDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  caregiverId: z.string().optional(),
  verifiedAt: z.string().optional(),
  status: z.string().optional(),
  raw: z.record(z.string(), z.string()).optional(),
});

export type VerifiedSessionRow = z.infer<typeof VerifiedSessionRowSchema>;

export const ReportKindSchema = z.enum([
  'opened_cases',
  'closed_cases',
  'verified_sessions',
]);
export type ReportKind = z.infer<typeof ReportKindSchema>;

export const REPORT_FILENAMES: Record<ReportKind, string> = {
  opened_cases: 'new-opened-cases',
  closed_cases: 'closed-cases',
  verified_sessions: 'verified-sessions',
};
