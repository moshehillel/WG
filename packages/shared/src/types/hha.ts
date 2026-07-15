import { z } from 'zod';

export const HhaPatientSchema = z.object({
  externalId: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().optional(),
  caseId: z.string().optional(),
});

export type HhaPatient = z.infer<typeof HhaPatientSchema>;

export const HhaContractSchema = z.object({
  patientId: z.string(),
  contractExternalId: z.string().optional(),
  serviceCode: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type HhaContract = z.infer<typeof HhaContractSchema>;

export const HhaAuthorizationSchema = z.object({
  patientId: z.string(),
  authorizationNumber: z.string().optional(),
  serviceCode: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  units: z.number().optional(),
});

export type HhaAuthorization = z.infer<typeof HhaAuthorizationSchema>;

export const HhaVisitSchema = z.object({
  patientId: z.string(),
  visitExternalId: z.string().optional(),
  serviceCode: z.string().optional(),
  visitDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  caregiverId: z.string().optional(),
});

export type HhaVisit = z.infer<typeof HhaVisitSchema>;

export const HhaClockingDetailsSchema = z.object({
  visitId: z.string(),
  clockIn: z.string().optional(),
  clockOut: z.string().optional(),
  matchesExpected: z.boolean(),
  notes: z.string().optional(),
});

export type HhaClockingDetails = z.infer<typeof HhaClockingDetailsSchema>;
