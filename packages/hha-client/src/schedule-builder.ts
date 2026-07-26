import type { HhaVisit } from '@white-glove/shared';
import { psTimeToHhmm } from './hha-time.js';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build CreateSchedule SOAP inner body (v3.38 HHMM times, Daily Fixed). */
export function buildCreateScheduleBody(visit: HhaVisit): string {
  if (!visit.patientId || !visit.visitDate || !visit.contractId || !visit.serviceCodeId) {
    throw new Error('CreateSchedule requires patientId, visitDate, contractId, serviceCodeId');
  }
  if (!visit.caregiverId) {
    throw new Error('CreateSchedule requires caregiverId');
  }
  const start = psTimeToHhmm(visit.startTime);
  const end = psTimeToHhmm(visit.endTime);
  if (!start || !end) {
    throw new Error('CreateSchedule requires startTime/endTime');
  }

  const scheduleType = visit.scheduleType ?? 'Non-Skilled';
  const minutes = visit.durationMinutes ?? 30;
  const payCodeXml = visit.payCodeId
    ? `\n  <PayCodeID>${esc(visit.payCodeId)}</PayCodeID>`
    : '';

  return `<ScheduleInfo>
  <PatientID>${esc(visit.patientId)}</PatientID>
  <ScheduleType>${esc(scheduleType)}</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <VisitDate>${esc(visit.visitDate)}</VisitDate>
  <ScheduleStartTime>${esc(start)}</ScheduleStartTime>
  <ScheduleEndTime>${esc(end)}</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <CaregiverID>${esc(visit.caregiverId)}</CaregiverID>${payCodeXml}
  <IsCaregiverTemporary>No</IsCaregiverTemporary>
  <PrimaryBillTo>
    <ContractID>${esc(visit.contractId)}</ContractID>
    <ServiceCodeID>${esc(visit.serviceCodeId)}</ServiceCodeID>
    <Hours>0</Hours>
    <Minutes>${minutes}</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`;
}
