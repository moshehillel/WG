import { extractDisciplineFromServiceType, type HhaVisit } from '@white-glove/shared';
import { psDateToIso, psTimeToHhmm } from './hha-time.js';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Disciplines that HHA schedules as Skilled (therapy / clinical). */
const SKILLED_DISCIPLINES = new Set([
  'OT',
  'PT',
  'ST',
  'SLP',
  'COTA',
  'PTA',
  'SI',
  'RN',
  'LPN',
  'MSW',
]);

/**
 * Infer CreateSchedule ScheduleType from ProviderSoft / HHA service type.
 * OT/PT/ST with ScheduleType=Non-Skilled yields ErrorID=-310
 * ("cannot be scheduled for OT/PT/ST visit") even when the caregiver is OT-eligible.
 */
export function inferCreateScheduleType(
  serviceCode: string | undefined,
): 'Skilled' | 'Non-Skilled' {
  const discipline = extractDisciplineFromServiceType(serviceCode);
  if (discipline && SKILLED_DISCIPLINES.has(discipline)) return 'Skilled';
  if (discipline === 'PCA' || discipline === 'HHA') return 'Non-Skilled';

  // HHA catalog / long names (e.g. "Physical Therapy") when first token is not OT/PT/ST.
  const s = (serviceCode ?? '').toUpperCase();
  if (
    /\b(PHYSICAL|OCCUPATIONAL|SPEECH)\b/.test(s) ||
    /\b(OT|PT|ST|SLP|COTA|PTA|RN|LPN|MSW|SI)\b/.test(s)
  ) {
    return 'Skilled';
  }
  return 'Non-Skilled';
}

/** Build CreateSchedule SOAP inner body (v3.38 HHMM times, Daily Fixed). */
export function buildCreateScheduleBody(visit: HhaVisit): string {
  if (!visit.patientId || !visit.visitDate || !visit.contractId || !visit.serviceCodeId) {
    throw new Error('CreateSchedule requires patientId, visitDate, contractId, serviceCodeId');
  }
  if (!visit.caregiverId) {
    throw new Error('CreateSchedule requires caregiverId');
  }
  // HHA VisitDate is xs:date (YYYY-MM-DD). TMS sessions often store MM/DD/YYYY.
  const visitDate = psDateToIso(visit.visitDate) ?? visit.visitDate;
  const start = psTimeToHhmm(visit.startTime);
  const end = psTimeToHhmm(visit.endTime);
  if (!start || !end) {
    throw new Error('CreateSchedule requires startTime/endTime');
  }

  const scheduleType =
    visit.scheduleType ?? inferCreateScheduleType(visit.serviceCode);
  const minutes = visit.durationMinutes ?? 30;
  const payCodeXml = visit.payCodeId
    ? `\n  <PayCodeID>${esc(visit.payCodeId)}</PayCodeID>`
    : '';
  const authIdXml = visit.authorizationId?.trim()
    ? `\n    <AuthorizationID>${esc(visit.authorizationId.trim())}</AuthorizationID>`
    : '';

  return `<ScheduleInfo>
  <PatientID>${esc(visit.patientId)}</PatientID>
  <ScheduleType>${esc(scheduleType)}</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <VisitDate>${esc(visitDate)}</VisitDate>
  <ScheduleStartTime>${esc(start)}</ScheduleStartTime>
  <ScheduleEndTime>${esc(end)}</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <CaregiverID>${esc(visit.caregiverId)}</CaregiverID>${payCodeXml}
  <IsCaregiverTemporary>No</IsCaregiverTemporary>
  <PrimaryBillTo>
    <ContractID>${esc(visit.contractId)}</ContractID>
    <ServiceCodeID>${esc(visit.serviceCodeId)}</ServiceCodeID>${authIdXml}
    <Hours>0</Hours>
    <Minutes>${minutes}</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`;
}
