import { describe, expect, it } from 'vitest';
import {
  explainException,
  formatActionableReason,
  formatRejectedServiceCodeTitle,
  parseHhaApiFault,
} from './exception-guidance.js';
import type { PipelineException } from './types/pipeline.js';

describe('parseHhaApiFault (ErrorID=-74 overload)', () => {
  it('labels ZipCodeLength as invalid zip, not invalid service code', () => {
    const fault = parseHhaApiFault(
      '[opened_cases] row=258272396 step=upsertPatient: HHA CreatePatient failed: Invalid "ZipCodeLength Zip4" (ErrorID=-74)',
    );
    expect(fault.kind).toBe('invalid_zip');
    expect(fault.title).toBe('Failed — invalid zip code');
  });

  it('labels placement overlap as overlap, not invalid service code', () => {
    const fault = parseHhaApiFault(
      '[opened_cases] row=102661 step=upsertContract: HHA AddPatientContract failed: New placement overlaps with an existing placement. (ErrorID=-74)',
    );
    expect(fault.kind).toBe('placement_overlap');
    expect(fault.title).toMatch(/placement overlaps/i);
  });

  it('labels Invalid ServiceCodeID as invalid service code', () => {
    const fault = parseHhaApiFault(
      'CreatePatientAuthorization failed: Invalid "ServiceCodeID" (ErrorID=-74) (ServiceCodeID=313581; ProviderSoft="OT HC Eval").',
    );
    expect(fault.kind).toBe('invalid_service_code');
  });

  it('does not treat bare ErrorID=-74 as invalid service code', () => {
    const fault = parseHhaApiFault('HHA call failed (ErrorID=-74)');
    expect(fault.kind).not.toBe('invalid_service_code');
    expect(fault.kind).not.toBe('invalid_zip');
    expect(fault.kind).not.toBe('placement_overlap');
  });

  it('labels CreateSchedule ErrorID=-310 as provider not eligible', () => {
    const fault = parseHhaApiFault(
      '[new_services] row=258270035 step=locateOrScheduleVisit: HHA CreateSchedule failed: "Caregiver: [WGC-41710/DELLORUSSO ALESSANDRA ] cannot be scheduled for ST visit." (ErrorID=-310) (patient ABIGAIL MAZZULLO; ServiceCodeID 313583; service type SLP CHHA; program type Americare Certified)',
    );
    expect(fault.kind).toBe('provider_not_eligible');
    expect(fault.title).toBe('Failed — provider not eligible for that service');
    expect(fault.title).not.toMatch(/WGC|ServiceCodeID|CreateSchedule/i);
  });

  it('labels CreateSchedule overlapping shifts as shift_overlap (not provider_not_eligible)', () => {
    const fault = parseHhaApiFault(
      'HHA CreateSchedule failed: "Your shift is overlapping with Patient: [WGC-924445/Cuchillas Viera Nathaly ]  Overlapping shifts are not allowed." (ErrorID=-310)',
    );
    expect(fault.kind).toBe('shift_overlap');
    expect(fault.title).toMatch(/overlaps an existing HHA visit/i);
    expect(fault.title).toMatch(/Cuchillas Viera Nathaly/i);
    expect(fault.kind).not.toBe('provider_not_eligible');
  });

  it('labels only-select-OT service code inconsistency as discipline mismatch', () => {
    const fault = parseHhaApiFault(
      'HHA CreateSchedule failed: "Service code inconsistency: \rYou should only select OT Service Code." (ErrorID=-310)',
    );
    expect(fault.kind).toBe('service_code_discipline_mismatch');
    expect(fault.title).toMatch(/AcceptedServices/i);
    expect(fault.kind).not.toBe('provider_not_eligible');
  });

  it('labels ConfirmVisits timesheet config restriction separately', () => {
    const fault = parseHhaApiFault(
      'ConfirmVisits failed for visit 1331688458: "Restriction for Timesheet Required from Configuration" (-310)',
    );
    expect(fault.kind).toBe('timesheet_config_block');
    expect(fault.title).toMatch(/timesheet configuration/i);
  });
});

describe('formatRejectedServiceCodeTitle', () => {
  it('keeps short invalid-service-code title (no ServiceCodeID / ErrorID dump)', () => {
    expect(
      formatRejectedServiceCodeTitle({
        serviceCode: 'OT HC Eval',
        serviceCodeId: '313581',
        hhaServiceName: 'OT',
      }),
    ).toBe('Failed — invalid service code "OT HC Eval"');
  });

  it('shows service type when code was never resolved', () => {
    expect(
      formatRejectedServiceCodeTitle({
        serviceCode: 'OT HC Eval',
        hhaServiceName: 'OT',
        notFound: true,
      }),
    ).toBe('Failed — service type "OT HC Eval" not found in HHA billing codes');
  });
});

describe('explainException service-code / -74 titles', () => {
  it('email title for HHA Invalid ServiceCodeID is short', () => {
    const ex: PipelineException = {
      code: 'hha_api_error',
      message:
        '[new_services] row=166448 step=upsertAuthorization: CreatePatientAuthorization failed: Invalid "ServiceCodeID" (ErrorID=-74) (ServiceCodeID=313581; ProviderSoft="OT HC Eval").',
      reportKind: 'new_services',
      rowId: '166448',
      details: {
        serviceCode: 'OT HC Eval',
        serviceCodeId: '313581',
        hhaServiceName: 'OT',
        step: 'upsertAuthorization',
      },
    };
    const explained = explainException(ex);
    expect(explained.title).toBe('Failed — invalid service code "OT HC Eval"');
    expect(explained.title).not.toMatch(/ServiceCodeID|ErrorID|313581/i);
  });

  it('email title for zip -74 is invalid zip even when serviceCode is in details', () => {
    const ex: PipelineException = {
      code: 'hha_api_error',
      message:
        '[opened_cases] row=258272396 step=upsertPatient: HHA CreatePatient failed: Invalid "ZipCodeLength Zip4" (ErrorID=-74)',
      reportKind: 'opened_cases',
      rowId: '258272396',
      details: { serviceCode: 'OT HC Eval', step: 'upsertPatient' },
    };
    const explained = explainException(ex);
    expect(explained.title).toBe('Failed — invalid zip code');
    expect(explained.title).not.toMatch(/service code/i);
  });

  it('email title for placement overlap -74 is overlap, not service code', () => {
    const ex: PipelineException = {
      code: 'hha_api_error',
      message:
        '[opened_cases] row=102661 step=upsertContract: HHA AddPatientContract failed: New placement overlaps with an existing placement. (ErrorID=-74)',
      reportKind: 'opened_cases',
      rowId: '102661',
      details: { serviceCode: 'PT CHHA', step: 'upsertContract' },
    };
    const explained = explainException(ex);
    expect(explained.title).toMatch(/placement overlaps/i);
    expect(explained.title).not.toMatch(/invalid service code/i);
  });

  it('unknown_service_code title is short service-type not found', () => {
    const ex: PipelineException = {
      code: 'unknown_service_code',
      message:
        '[opened_cases] row=x service type "OT HC Eval" (mapped HHA "OT") not found in HHA billing codes',
      reportKind: 'opened_cases',
      rowId: 'x',
      details: { serviceCode: 'OT HC Eval', hhaServiceName: 'OT', programType: 'Americare Certified' },
    };
    const explained = explainException(ex);
    expect(explained.title).toBe(
      'Failed — service type "OT HC Eval" not found in HHA billing codes',
    );
  });

  it('email Reason for CreateSchedule -310 is short provider-not-eligible', () => {
    const ex: PipelineException = {
      code: 'hha_api_error',
      message:
        '[new_services] row=06770830 step=locateOrScheduleVisit: HHA CreateSchedule failed: "Caregiver: [WGC-25626/AHMED KAMEL ] cannot be scheduled for PT visit." (ErrorID=-310) (patient Adam Elhayat; ServiceCodeID 785136; HHA service Physical Therapy; service type PT CHHA EXTENDED; program type Extended Home Care Therapy)',
      reportKind: 'new_services',
      rowId: '06770830',
      details: {
        step: 'locateOrScheduleVisit',
        serviceCode: 'PT CHHA EXTENDED',
        serviceCodeId: '785136',
        hhaServiceName: 'Physical Therapy',
        programType: 'Extended Home Care Therapy',
        patientName: 'Adam Elhayat',
        caregiverName: 'AHMED KAMEL',
      },
    };
    const explained = explainException(ex);
    expect(explained.title).toBe('Failed — provider not eligible for that service');
    expect(explained.title).not.toMatch(/WGC|ServiceCodeID|ErrorID|SOAP|CreateSchedule/i);
    expect(explained.problem).not.toMatch(/WGC-|ServiceCodeID/);
    const reason = formatActionableReason(ex, { includeParties: true });
    expect(reason).toMatch(/^Failed — provider not eligible for that service/);
    expect(reason).not.toMatch(/ServiceCodeID|WGC-|Physical Therapy|PT CHHA|program type/i);
  });
});
