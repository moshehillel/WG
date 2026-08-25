import { z } from 'zod';

export const UnscheduledCaregiverSchema = z.object({
  AideID: z.union([z.string(), z.number()]).optional(),
  CaregiverAssignmentID: z.string().optional(),
  CaregiverCode: z.string().optional(),
  CaregiverFirstName: z.string().optional(),
  CaregiverLastName: z.string().optional(),
  Phone1: z.string().optional(),
  Phone2: z.string().optional(),
  Phone3: z.string().optional(),
});

export const UnscheduledPatientSchema = z.object({
  PatientID: z.union([z.string(), z.number()]).optional(),
  PatientFirstName: z.string().optional(),
  PatientLastName: z.string().optional(),
  PatientAdmissionID: z.string().optional(),
  Cluster: z.string().optional(),
  IsMutualLinkedPatient: z.boolean().optional(),
  PatientHomePhone: z.string().optional(),
  PatientType: z.string().optional(),
  IsPayerPatient: z.boolean().optional(),
});

/** Row from HHA getUnscheduledServices GraphQL. */
export const UnscheduledServiceRowSchema = z.object({
  CallDateTime: z.string().optional(),
  CallDuration: z.string().optional(),
  CallType: z.string().optional(),
  AideID: z.union([z.string(), z.number()]).optional(),
  EVVDuration: z.string().optional(),
  EVVInID: z.union([z.string(), z.number()]).optional(),
  EVVInTime: z.string().optional(),
  EVVOutID: z.union([z.string(), z.number()]).optional(),
  EVVOutTime: z.string().optional(),
  MultiInCallID: z.union([z.string(), z.number()]).optional(),
  MultiOutCallID: z.union([z.string(), z.number()]).optional(),
  MaintenanceID: z.union([z.string(), z.number()]).optional(),
  PatientId: z.union([z.string(), z.number()]).optional(),
  ACSExceptions: z.string().optional(),
  IsAllowACS: z.boolean().optional(),
  OfficeID: z.union([z.string(), z.number()]).optional(),
  Caregiver: UnscheduledCaregiverSchema.optional(),
  Patient: UnscheduledPatientSchema.optional(),
});

export type UnscheduledServiceRow = z.infer<typeof UnscheduledServiceRowSchema>;
