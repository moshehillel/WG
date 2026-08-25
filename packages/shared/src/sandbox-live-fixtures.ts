import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPORT_FILENAMES } from './types/reports.js';

const REFERENCE_FILENAMES = {
  discharge_service: 'discharge-service',
  new_services: 'new-services',
  caregiver_codes: 'caregiver-codes',
} as const;

/** Shared patient identity — same Program Id and demographics in every sandbox live CSV. */
export const SANDBOX_LIVE_PATIENT = {
  childName: 'FIXTEST Sandbox',
  programId: '9999001',
  dateOfBirth: '03/15/2018',
  intakeDate: '07/01/2026',
  gender: 'M',
  programType: 'Extended Home Care Therapy',
  providerName: 'GARCIA CHELSEA',
  address: '100 Sandbox Test Lane',
  city: 'White Plains',
  state: 'NY',
  zip: '10601-1234',
  contactName: 'Sandbox Parent',
  contactPhone: '(914) 555-0100',
  /** HHA sandbox1 billing labels (see sandbox-full-workflow.ts). */
  services: {
    ot: 'Occupational Therapy',
    pt: 'Physical Therapy',
    slp: 'Speech Therapy',
  },
  dates: {
    serviceStart: '07/01/2026',
    serviceEnd: '12/31/2026',
    otDischarge: '07/28/2026',
    slpStart: '08/01/2026',
    caseClosure: '08/15/2026',
    session1: '07/15/2026',
    session2: '07/16/2026',
  },
  auths: {
    ot: 'A9999001-OT',
    pt: 'A9999001-PT',
    slp: 'A9999001-SLP',
  },
} as const;

export type SandboxFixtureFiles = Partial<
  Record<
    keyof typeof REPORT_FILENAMES | keyof typeof REFERENCE_FILENAMES,
    string
  >
>;

/**
 * Sandbox-only CSVs with one patient across all five sync reports.
 * Full ProviderSoft column order — used for HHA sandbox writes (never production schedules).
 */
export async function writeSandboxLiveFixtures(
  downloadDir: string,
  overrides?: { programId?: string },
): Promise<{
  files: SandboxFixtureFiles;
  patient: Omit<typeof SANDBOX_LIVE_PATIENT, 'programId'> & { programId: string };
}> {
  await mkdir(downloadDir, { recursive: true });
  const p = {
    ...SANDBOX_LIVE_PATIENT,
    programId: overrides?.programId ?? SANDBOX_LIVE_PATIENT.programId,
  };

  const opened = [
    "Child's Name,Program Id,Date of Birth,Date of Intake,Provider Name,Child's Address,Child's City,Child's State,Primary Contact Name,Primary Contact Phone,Primary Contact Email,Child's Phone,Child's Zip Code,Ongoing Care Plan,Service Type,Total Units Remaining,Service Begin Date,Service End Date,Times per Basic Mandate,Basic Mandate Frequency,Authorization Number,Program Type,Gender:",
    `${p.childName},${p.programId},${p.dateOfBirth},${p.intakeDate},${p.providerName},${p.address},${p.city},${p.state},${p.contactName},${p.contactPhone},,${p.contactPhone},${p.zip},12 Months,${p.services.ot},24,${p.dates.serviceStart},${p.dates.serviceEnd},2,Weekly,A${p.programId}-OT,${p.programType},${p.gender}`,
    `${p.childName},${p.programId},${p.dateOfBirth},${p.intakeDate},${p.providerName},${p.address},${p.city},${p.state},${p.contactName},${p.contactPhone},,${p.contactPhone},${p.zip},12 Months,${p.services.pt},24,${p.dates.serviceStart},${p.dates.serviceEnd},2,Weekly,A${p.programId}-PT,${p.programType},${p.gender}`,
  ].join('\n');

  const newServices = [
    "Child's Name,Program Id,Date of Birth,Provider Name,Child's Address,Child's City,Child's State,Child's Zip Code,Service Type,Service Begin Date,Service End Date,Times per Basic Mandate,Basic Mandate Frequency,Authorization Number,Program Type,Gender",
    `${p.childName},${p.programId},${p.dateOfBirth},${p.providerName},${p.address},${p.city},${p.state},${p.zip},${p.services.slp},${p.dates.slpStart},${p.dates.serviceEnd},2,Weekly,A${p.programId}-SLP,${p.programType},${p.gender}`,
  ].join('\n');

  const closed = [
    "Child's Name,Program Id,Date of Birth,Child's Address,Child's City,Child's State,Child's Zip Code,Closure Date,Closure Reason,Program Type",
    `${p.childName},${p.programId},${p.dateOfBirth},${p.address},${p.city},${p.state},${p.zip},${p.dates.caseClosure},case termination,${p.programType}`,
  ].join('\n');

  const discharge = [
    "Child's Name,Program Id,Date of Birth,Provider Name,Service Type,Service Begin Date,Service End Date,Service Discharge Date,Program Type",
    `${p.childName},${p.programId},${p.dateOfBirth},${p.providerName},${p.services.ot},${p.dates.serviceStart},${p.dates.serviceEnd},${p.dates.otDischarge},${p.programType}`,
  ].join('\n');

  const sessions = [
    "Program ID,Program Type,Child's Name,Session Date,Begin Time,End Time,Service Type,Provider Name,Pay Rate,Verified Date",
    `${p.programId},${p.programType},${p.childName},${p.dates.session1},2:00 PM,2:30 PM,${p.services.ot},${p.providerName},70.00,07/17/2026`,
    `${p.programId},${p.programType},${p.childName},${p.dates.session2},3:00 PM,3:30 PM,${p.services.pt},${p.providerName},70.00,07/18/2026`,
  ].join('\n');

  const caregiverCodes = [
    'Provider Name,Caregiver Code',
    `${p.providerName},WGC-SBX-001`,
  ].join('\n');

  const files: SandboxFixtureFiles = {
    opened_cases: path.join(downloadDir, `${REPORT_FILENAMES.opened_cases}.csv`),
    new_services: path.join(downloadDir, `${REFERENCE_FILENAMES.new_services}.csv`),
    closed_cases: path.join(downloadDir, `${REPORT_FILENAMES.closed_cases}.csv`),
    discharge_service: path.join(downloadDir, `${REFERENCE_FILENAMES.discharge_service}.csv`),
    verified_sessions: path.join(downloadDir, `${REPORT_FILENAMES.verified_sessions}.csv`),
    caregiver_codes: path.join(downloadDir, `${REFERENCE_FILENAMES.caregiver_codes}.csv`),
  };

  await Promise.all([
    writeFile(files.opened_cases!, opened, 'utf8'),
    writeFile(files.new_services!, newServices, 'utf8'),
    writeFile(files.closed_cases!, closed, 'utf8'),
    writeFile(files.discharge_service!, discharge, 'utf8'),
    writeFile(files.verified_sessions!, sessions, 'utf8'),
    writeFile(files.caregiver_codes!, caregiverCodes, 'utf8'),
  ]);

  return { files, patient: p };
}
