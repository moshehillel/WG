import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPORT_FILENAMES } from './types/reports.js';

const REFERENCE_FILENAMES = {
  discharge_service: 'discharge-service',
  new_services: 'new-services',
  caregiver_codes: 'caregiver-codes',
} as const;

export type SandboxFixtureFiles = Partial<
  Record<
    keyof typeof REPORT_FILENAMES | keyof typeof REFERENCE_FILENAMES,
    string
  >
>;

/**
 * Sandbox-only fixture CSVs that exercise every email summary section.
 * Rows are fake — prefixed SANDBOX-FIX — never used in production schedules.
 */
export async function writeSandboxEmailFixtures(downloadDir: string): Promise<{
  files: SandboxFixtureFiles;
}> {
  await mkdir(downloadDir, { recursive: true });

  const opened = [
    "Child's Name,Program Id,Date of Birth,Date of Intake,Provider Name,Child's Address,Child's City,Child's State,Primary Contact Name,Primary Contact Phone,Child's Zip Code,Service Type,Authorization Number,Program Type,Gender",
    'SANDBOX-FIX EI Child,9000001,01/01/2024,,FIX THERAPIST,1 Demo St,Brooklyn,NY,Parent Demo,(555) 000-0001,11201,SI,A9000001,Early Intervention,',
    'SANDBOX-FIX Open Child,9000002,05/14/2020,,FIX THERAPIST,2 Demo Ave,Queens,NY,Parent Demo,(555) 000-0002,11375,OT CHHA,approved,Extended Home Care Therapy,F',
  ].join('\n');

  const newServices = [
    "Child's Name,Program Id,Date of Birth,Provider Name,Child's Address,Child's City,Child's State,Child's Zip Code,Service Type,Service Begin Date,Authorization Number,Program Type,Gender",
    'SANDBOX-FIX New Svc Child,9000003,03/03/2021,,FIX THERAPIST,3 Demo Blvd,Staten Island,NY,10301,PT HIP,07/01/2026,approved,HIP Therapy,M',
  ].join('\n');

  const closed = [
    "Child's Name,Program Id,Date of Birth,Child's Address,Child's City,Child's State,Child's Zip Code,Closure Date,Closure Reason,Program Type",
    'SANDBOX-FIX EI Close,9000004,02/02/2023,4 Demo Rd,Bronx,NY,10451,07/15/2026,case termination,Early Intervention',
    'SANDBOX-FIX Close OK,9000005,06/06/2019,5 Demo Ln,New York,NY,10001,07/20/2026,discharged,Extended Home Care Therapy',
  ].join('\n');

  const discharge = [
    "Child's Name,Program Id,Date of Birth,Provider Name,Service Type,Service Begin Date,Service End Date,Service Discharge Date,Program Type",
    'SANDBOX-FIX Discharge Bad,9000006,04/04/2018,FIX THERAPIST,,07/01/2026,08/01/2026,07/25/2026,Extended Home Care Therapy',
    'SANDBOX-FIX Discharge OK,9000007,08/08/2017,FIX THERAPIST,OT CHHA,06/01/2026,08/31/2026,07/28/2026,Extended Home Care Therapy',
  ].join('\n');

  const sessions = [
    "Program ID,Program Type,Child's Name,Session Date,Begin Time,End Time,Service Type,Provider Name,Pay Rate,Verified Date",
    '9000101,Early Intervention,SANDBOX-FIX EI Session,07/15/2026,10:00 AM,11:00 AM,SI,FIX PROVIDER,50.00,07/16/2026',
    '9000102,Extended Home Care Therapy,SANDBOX-FIX OK Session,07/15/2026,2:00 PM,2:30 PM,OT CHHA,FORTUNE JOHANA,70.00,07/16/2026',
    '9000103,Extended Home Care Therapy,SANDBOX-FIX Bad Code,07/16/2026,3:00 PM,3:30 PM,PT School Makeup,FIX PROVIDER,70.00,07/17/2026',
    '9000104,Extended Home Care Therapy,SANDBOX-FIX Bad Pay,07/16/2026,4:00 PM,4:30 PM,OT CHHA,FIX PROVIDER,OT75,07/17/2026',
    '9000105,Extended Home Care Therapy,SANDBOX-FIX Bad Caregiver,07/17/2026,5:00 PM,5:30 PM,OT CHHA,CAGLIUSO ADAM,70.00,07/18/2026',
    '9000106,Extended Home Care Therapy,SANDBOX-FIX OK Session 2,07/17/2026,6:00 PM,6:30 PM,OT CHHA,FORTUNE JOHANA,70.00,07/18/2026',
  ].join('\n');

  const caregiverCodes = [
    'Provider Name,Caregiver Code',
    'FORTUNE JOHANA,WGC-35595',
    'FIX THERAPIST,WGC-99999',
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

  return { files };
}
