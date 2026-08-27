import type { ExceptionCode, PipelineException, ProcessorResult } from './types/pipeline.js';

/** Known AWS stub fixture row IDs — not real ProviderSoft Program Ids. */
const STUB_ROW_IDS = new Set([
  'HH-1',
  'EI-1',
  'HH-0',
  'HH-2',
  'S-1',
  'S-2',
  'S-3',
  'p1',
  'p2',
]);

const REPORT_LABELS: Record<string, string> = {
  opened_cases: 'Gluck open (new cases)',
  closed_cases: 'Gluck closure',
  verified_sessions: 'API Report (verified sessions)',
  caregiver_codes: 'Caregiver codes',
  discharge_service: 'Discharge service',
  new_services: 'New service (existing child)',
};

const CODE_LABELS: Record<ExceptionCode, string> = {
  missing_service_code: 'Missing service type',
  unknown_service_code: 'Invalid service code (not on HHA contract billing codes)',
  unmatched_patient: 'Patient not found or ambiguous in HHA',
  missing_authorization: 'Missing authorization number',
  clocking_mismatch: 'Time off',
  incomplete_unscheduled_clock: 'Missing clock',
  hha_api_error: 'HHA API error',
  missing_field: 'Missing required field',
  parse_error: 'ProviderSoft export parse failure',
  skipped_by_rule: 'Skipped by business rule',
  download_error: 'ProviderSoft download failed',
  pipeline_step_error: 'Pipeline infrastructure error',
  /** Never surface this alone in CSV/email — use formatActionableReason. */
  other: 'Unresolved row failure',
};

/** Category-only labels that must not be used as the sole ops-facing reason. */
const VAGUE_REASON_LABELS = new Set<string>(Object.values(CODE_LABELS));

export function isPreviewException(ex: PipelineException): boolean {
  return ex.details?.preview === true || ex.message.includes('[preview/');
}

export function looksLikeStubFixtureData(exceptions: PipelineException[]): boolean {
  const previewRows = exceptions
    .filter(isPreviewException)
    .map((e) => e.rowId)
    .filter((id): id is string => Boolean(id));
  if (previewRows.length === 0) return false;
  return previewRows.every((id) => STUB_ROW_IDS.has(id));
}

export function reportLabel(reportKind: string | undefined): string {
  if (!reportKind) return 'Unknown report';
  return REPORT_LABELS[reportKind] ?? reportKind;
}

export function codeLabel(code: ExceptionCode): string {
  return CODE_LABELS[code] ?? code;
}

export interface ExplainedException {
  title: string;
  problem: string;
  impact: string;
  action: string;
  rowRef: string;
  reportLabel: string;
  isPreview: boolean;
}

function missingFieldLabels(details: PipelineException['details']): string[] {
  const raw = details?.missing;
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  if (Array.isArray(raw)) {
    return raw
      .filter((v): v is string => typeof v === 'string' && Boolean(v.trim()))
      .map((v) => v.trim());
  }
  return [];
}

function humanizeMissingFieldKey(key: string): string {
  const fieldLabels: Record<string, string> = {
    dateOfBirth: 'Date of Birth',
    address1: 'Address',
    city: 'City',
    state: 'State',
    zipCode: 'Zip Code',
    firstName: 'First Name',
    lastName: 'Last Name',
    gender: 'Gender',
    caseId: 'Program Id / Case Id',
    officeId: 'Office',
    coordinatorId: 'Coordinator',
    authorizationNumber: 'Authorization Number',
    serviceType: 'Service Type',
  };
  if (fieldLabels[key]) return fieldLabels[key]!;
  // Long diagnostic strings from billing guards / older runs → short field label.
  if (/gender/i.test(key)) return 'Gender';
  if (/\bcity\b/i.test(key)) return 'City';
  if (/\bstate\b/i.test(key)) return 'State';
  if (/zip/i.test(key)) return 'Zip Code';
  if (/address/i.test(key)) return 'Address';
  if (/date of birth|dateOfBirth|\bdob\b/i.test(key)) return 'Date of Birth';
  if (/case\s*id|program\s*id/i.test(key)) return 'Program Id / Case Id';
  if (/authorization/i.test(key)) return 'Authorization Number';
  return fieldLabels[key] ?? key;
}

/** Demographics we try to fill from an HHA patient match (new_services). */
function formatMissingFieldList(fields: string[]): string {
  const labels = fields.map(humanizeMissingFieldKey);
  if (labels.length === 0) return 'required field(s)';
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/**
 * Legacy missing[] labels that mentioned "not matched" / "not on HHA".
 * Prefer unmatched_patient (lookup-first) for not-found; this only keeps old phrases.
 */
function isNotMatchedToHhaMissing(
  _ex: PipelineException,
  missingFields: string[],
): boolean {
  return missingFields.some((f) =>
    /not matched to HHA|not on ProviderSoft row and patient not found|missing on ProviderSoft and not on HHA/i.test(
      f,
    ),
  );
}

/** Strip preview / report-kind prefixes so the concrete failure text is readable in CSV. */
export function cleanExceptionMessage(message: string): string {
  return message
    .replace(/^\[preview\/[^\]]+\]\s*/i, '')
    .replace(
      /^\[(opened_cases|closed_cases|verified_sessions|discharge_service|new_services|caregiver_codes)\]\s*/i,
      '',
    )
    // Never surface remediation / name-order coaching in CSV/email reasons.
    .replace(/\s*[—\-–]\s*Fix\s*:.*$/i, '')
    .replace(/\s*Fix\s*:.*$/i, '')
    .replace(/\s*[—\-–]?\s*check spelling or name order\s*\([^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Known HHA SOAP/API fault patterns → ops-facing title + group key.
 * `buildHhaRowException` always uses code `hha_api_error`; this is how sheet/email/CSV
 * show the real problem instead of a catch-all "HHA API error".
 */
export type HhaApiFaultKind =
  | 'invalid_service_code'
  | 'service_code_missing'
  | 'invalid_schedule_date'
  | 'invalid_patient_id'
  | 'no_active_placements'
  | 'provider_not_found'
  | 'ambiguous_discharge'
  | 'unknown';

export interface ParsedHhaApiFault {
  kind: HhaApiFaultKind;
  /** Ops title for CSV / email Reason (prefer "Failed — …"). */
  title: string;
  /** Short problem line (no SOAP dump). */
  problem: string;
}

/** Collapse SOAP fault envelopes embedded in exception messages. */
function stripSoapFaultDump(message: string): string {
  if (!/<\?xml|<soap:Envelope|<soap:Fault/i.test(message)) return message;
  const faultstring =
    message.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1] ??
    message.match(/faultstring[^>]*>([\s\S]*?)(?:<\/faultstring>|$)/i)?.[1];
  const prefix = message.replace(/\s*<\?xml[\s\S]*$/i, '').replace(/\s*<soap:[\s\S]*$/i, '').trim();
  const decoded = (faultstring ?? '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/---&gt;/g, '→')
    .replace(/\s+/g, ' ')
    .trim();
  if (prefix && decoded) return `${prefix} ${decoded}`.trim();
  if (decoded) return decoded;
  return prefix || message.slice(0, 180);
}

/**
 * Map raw HHA API exception text to a readable fault when the pattern is known.
 * Fallback keeps a generic title; callers still attach the cleaned message as problem.
 */
export function parseHhaApiFault(message: string): ParsedHhaApiFault {
  const cleaned = cleanExceptionMessage(stripSoapFaultDump(message));

  if (/Ambiguous HHA discharge/i.test(message)) {
    return {
      kind: 'ambiguous_discharge',
      title: 'Cannot identify which service to discharge',
      problem:
        'The child has multiple active services in HHA, and the discharge report Service Type / Service Begin Date did not match exactly one placement.',
    };
  }

  if (
    /ErrorID\s*=\s*-74/i.test(message) ||
    /Invalid\s+"?ServiceCodeID"?/i.test(message)
  ) {
    return {
      kind: 'invalid_service_code',
      title: 'Failed — invalid service code',
      problem:
        cleaned ||
        'HHA rejected CreatePatientAuthorization: Invalid ServiceCodeID (ErrorID=-74).',
    };
  }

  if (
    /requires ServiceCodeID/i.test(message) ||
    /service type not found in HHA billing codes/i.test(message)
  ) {
    return {
      kind: 'service_code_missing',
      title: 'Failed — service type not found in HHA billing codes',
      problem:
        cleaned ||
        'CreatePatientAuthorization needs a ServiceCodeID, but this Service Type is not in HHA billing codes for the contract.',
    };
  }

  if (/AllXsd/i.test(message) || /is not a valid AllXsd value/i.test(message)) {
    const badDate = message.match(/The string '([^']+)' is not a valid AllXsd/i)?.[1];
    const dateBit = badDate ? ` ("${badDate}")` : '';
    return {
      kind: 'invalid_schedule_date',
      title: `Failed — invalid date format for HHA schedule${dateBit}`,
      problem:
        cleaned ||
        `HHA CreateSchedule rejected a date value${dateBit} (expected HHA AllXsd / ISO date, not MM/DD/YYYY).`,
    };
  }

  if (
    /ErrorID\s*=\s*-56/i.test(message) ||
    /Patient ID is an invalid for current Agency/i.test(message)
  ) {
    return {
      kind: 'invalid_patient_id',
      title: 'Failed — patient ID invalid for current agency',
      problem:
        cleaned ||
        'HHA rejected the patient ID for this agency (ErrorID=-56).',
    };
  }

  if (/No active HHA placements found/i.test(message)) {
    return {
      kind: 'no_active_placements',
      title: 'Failed — no active HHA placements',
      problem: cleaned || 'No active HHA placements found for this patient.',
    };
  }

  if (
    /provider name not found|Provider ".+" not found|Provider .+ not found/i.test(message) ||
    (/Provider/i.test(message) && /not found in HHA/i.test(message))
  ) {
    return {
      kind: 'provider_not_found',
      title: 'Failed — Provider name not found in HHA',
      problem: cleaned || 'Provider / caregiver was not found in HHA.',
    };
  }

  return {
    kind: 'unknown',
    title: 'HHA API error',
    problem: cleaned || 'HHA SOAP/API rejected the call.',
  };
}

function detailString(
  details: PipelineException['details'],
  key: string,
): string | undefined {
  const raw = details?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

/**
 * Ops-facing failure reason for CSV / email headers.
 * Prefers concrete exception text + key details over vague category labels
 * like "mapping" / "configuration" / bare CODE_LABEL titles.
 * Never appends "Fix:" remediation — description of what went wrong only.
 */
export function formatActionableReason(
  ex: PipelineException,
  options?: { includeFix?: boolean; includeParties?: boolean },
): string {
  // includeFix kept for call-site compat; always false (no Fix: boilerplate).
  void options?.includeFix;
  const includeParties = options?.includeParties ?? true;
  const explained = explainException(ex);
  const cleaned = cleanExceptionMessage(ex.message);

  let whatWentWrong: string;
  if (/^Failed —/i.test(explained.title)) {
    // Already specific (e.g. missing Gender / Authorization Number).
    whatWentWrong = explained.title;
  } else if (VAGUE_REASON_LABELS.has(explained.title)) {
    // Category label only — use problem (often includes field/code) or cleaned message.
    whatWentWrong = explained.problem?.trim() || cleaned || explained.title;
  } else {
    whatWentWrong = explained.problem?.trim() || cleaned || explained.title;
  }

  // Prefer cleaned message when problem is still just the vague category restated.
  if (VAGUE_REASON_LABELS.has(whatWentWrong) && cleaned) {
    whatWentWrong = cleaned;
  }
  if (cleaned && whatWentWrong === explained.title && VAGUE_REASON_LABELS.has(explained.title)) {
    whatWentWrong = cleaned;
  }

  const contextParts: string[] = [];
  const pushCtx = (label: string, value: string | undefined) => {
    if (!value) return;
    if (whatWentWrong.toLowerCase().includes(value.toLowerCase())) return;
    if (contextParts.some((p) => p.includes(value))) return;
    contextParts.push(`${label} ${value}`);
  };

  if (includeParties) {
    pushCtx('patient', patientNameFromDetails(ex.details));
    pushCtx('caregiver', caregiverNameFromDetails(ex.details));
    pushCtx('visit', detailString(ex.details, 'visitDate'));
    pushCtx('maintenanceId', detailString(ex.details, 'maintenanceId'));
  }
  // Error-type context only (safe for email grouping keys / group titles).
  pushCtx('pay code', detailString(ex.details, 'payCodeName'));
  pushCtx('service type', detailString(ex.details, 'serviceCode'));
  pushCtx('program type', detailString(ex.details, 'programType'));
  pushCtx('source', detailString(ex.details, 'source'));
  const missingSide = detailString(ex.details, 'missingSide');
  const clockSource = detailString(ex.details, 'source');
  if (ex.code === 'clocking_mismatch') {
    pushCtx('issue', 'time off');
  } else if (missingSide === 'in') pushCtx('issue', 'missing clock-in');
  else if (missingSide === 'out') pushCtx('issue', 'missing clock-out');
  else if (missingSide === 'both' || clockSource === 'hha_unscheduled_missing') {
    pushCtx('issue', 'missing clock');
  }

  if (contextParts.length > 0) {
    whatWentWrong = `${whatWentWrong} (${contextParts.join('; ')})`;
  }

  return cleanExceptionMessage(whatWentWrong);
}

export function explainException(ex: PipelineException): ExplainedException {
  const isPreview = isPreviewException(ex);
  const report = reportLabel(ex.reportKind);
  const rowRef = ex.rowId ? `row ${ex.rowId}` : 'this row';
  const programType =
    typeof ex.details?.programType === 'string' ? ex.details.programType : undefined;
  const serviceCode =
    typeof ex.details?.serviceCode === 'string' ? ex.details.serviceCode : undefined;
  const missingFields = missingFieldLabels(ex.details);
  const step = typeof ex.details?.step === 'string' ? ex.details.step : undefined;

  switch (ex.code) {
    case 'unknown_service_code':
      return {
        title: serviceCode
          ? `Failed — invalid service code "${serviceCode}"`
          : 'Failed — invalid service code',
        problem: serviceCode
          ? `Service Type "${serviceCode}" from ProviderSoft is not a valid HHA billing ServiceCodeID for this Program Type/contract.`
          : 'Service Type from ProviderSoft does not match any HHA billing code for this contract.',
        impact: isPreview
          ? 'Sandbox/dry-run only: on a live run HHA would reject CreatePatientAuthorization (Invalid ServiceCodeID / ErrorID=-74).'
          : 'The row was not sent to HHA.',
        action:
          'Confirm Service Type maps to a billing code on this HHA contract (Excel alias → GetBillingServiceCodes name/ID). If you added a new code in HHA admin, Monday preview will detect it on the next dry-run.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'missing_service_code':
      return {
        title: codeLabel(ex.code),
        problem: `The ProviderSoft export has no Service Type for ${rowRef}.`,
        impact: 'HHA requires a service/billing code to open a case or post a session.',
        action: 'Add Service Type to the ProviderSoft saved report columns, re-export, and re-run.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'missing_field':
    case 'parse_error':
      if (ex.reportKind === 'closed_cases' && ex.message.includes('discharge_service')) {
        return {
          title: 'Discharge row missing required fields',
          problem:
            ex.message.includes('Service Type') || ex.message.includes('Service Begin Date')
              ? 'The discharge service export row is missing Service Type and/or Service Begin Date.'
              : ex.message.replace(/^\[discharge_service\]\s*/i, ''),
          impact:
            'HHA will not discharge any service for this row — avoids closing the wrong placement when a child has multiple active services.',
          action:
            'Coordinator: open the case in ProviderSoft, confirm which service ended, and ensure the discharge service report row includes both Service Type (e.g. SI, OT HC Eval) and Service Begin Date exactly as shown on the active service line. Re-run the nightly sync.',
          rowRef,
          reportLabel: 'Discharge service',
          isPreview,
        };
      }
      if (missingFields.length > 0) {
        const labelList = formatMissingFieldList(missingFields);
        const notMatched = isNotMatchedToHhaMissing(ex, missingFields);
        const title = notMatched
          ? `Failed — missing ${labelList} — not matched to HHA`
          : `Failed — missing ${labelList}`;
        const problem = notMatched
          ? `${labelList} missing on the report and not matched to HHA (${rowRef}).`
          : `This row failed because ${labelList} ${missingFields.length === 1 ? 'is' : 'are'} blank or incomplete on the ProviderSoft export (${rowRef}).`;
        const action = notMatched
          ? `Confirm the patient matches in HHA (or fill ${labelList} on the ProviderSoft row), then re-run.`
          : `Fill ${labelList} on the ProviderSoft report row, re-export, and re-run.`;
        return {
          title,
          problem,
          impact: isPreview
            ? 'Sandbox/dry-run only: on a live run this row would be blocked — no HHA write would be attempted.'
            : 'No HHA write was attempted. Required demographics/auth fields must be present before patient create, authorization, or discharge.',
          action,
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (/invalid auth mandate|Basic Mandate Frequency|Times per Basic Mandate/i.test(ex.message)) {
        return {
          title: 'Failed — invalid or missing auth mandate',
          problem: ex.message.replace(/^\[preview\/[^\]]+\]\s*/i, ''),
          impact: isPreview
            ? 'Sandbox/dry-run only: on a live run this row would be blocked — authorization cannot be created without Period/Maximum.'
            : 'No HHA authorization write was attempted. Mandate frequency and times must map to HHA Period/Maximum.',
          action:
            'Set Basic Mandate Frequency and Times per Basic Mandate on the ProviderSoft row (e.g. Weekly / 2), re-export, and re-run.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      {
        const cleaned = cleanExceptionMessage(ex.message);
        return {
          title: cleaned || 'Failed — invalid or incomplete ProviderSoft export field',
          problem: cleaned || 'ProviderSoft export row is missing or has invalid required data.',
          impact: 'The row cannot be processed until the export contains valid data.',
          action:
            'Fix the named field on the ProviderSoft report row (or add the column to the saved report), re-export, and re-run.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }

    case 'missing_authorization':
      return {
        title: 'Failed — missing Authorization Number',
        problem: `This row failed because Authorization Number is blank on ${rowRef}.`,
        impact: 'No HHA write was attempted. CreatePatientAuthorization cannot run without an auth number.',
        action:
          'Add Authorization Number to the Gluck open report columns in ProviderSoft, re-export, and re-run.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'unmatched_patient':
      return {
        title: 'Failed — patient not found in HHA',
        problem: cleanExceptionMessage(ex.message) || `Patient was not found or was ambiguous in HHA for ${rowRef}.`,
        impact: isPreview
          ? 'Sandbox/dry-run only: on a live run this row would be blocked — no HHA write would be attempted.'
          : 'No HHA write was attempted until the patient can be uniquely matched.',
        action:
          'Confirm patient demographics (name, DOB, Medicaid ID) match HHA. If the child already exists, fix the ProviderSoft identifiers; if new, ensure create-patient prerequisites are present and re-run.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'hha_api_error': {
      const fault = parseHhaApiFault(ex.message);
      if (fault.kind === 'ambiguous_discharge') {
        return {
          title: fault.title,
          problem: fault.problem,
          impact:
            'No placement was discharged — the wrong service was not closed by accident.',
          action:
            'Coordinator: verify Service Type and Service Begin Date on the discharge row match the ending service in HHA. If the child has two lines with the same type and start date, resolve manually in HHA and note for automation mapping.',
          rowRef,
          reportLabel: 'Discharge service',
          isPreview,
        };
      }
      if (fault.kind === 'invalid_service_code') {
        const sc = serviceCode ? ` "${serviceCode}"` : '';
        return {
          title: serviceCode
            ? `Failed — invalid service code${sc}`
            : fault.title,
          problem: fault.problem,
          impact: isPreview
            ? 'Sandbox/dry-run only: on a live run HHA would reject authorization for this service code.'
            : 'HHA rejected the authorization — ServiceCodeID is invalid for this contract/agency.',
          action:
            'Confirm Service Type maps to a valid HHA billing ServiceCodeID for this Program Type/contract, then re-run.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (fault.kind === 'service_code_missing') {
        const sc = serviceCode ? ` "${serviceCode}"` : '';
        return {
          title: `Failed — service type${sc} not found in HHA billing codes`,
          problem: fault.problem,
          impact: 'Authorization was not created — HHA needs a ServiceCodeID from GetBillingServiceCodes.',
          action:
            'Add or correct the Service Type in HHA billing codes for this contract (or fix the ProviderSoft Service Type text), then re-run.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (fault.kind === 'invalid_schedule_date') {
        return {
          title: fault.title,
          problem: fault.problem,
          impact: 'EVV placeholder / schedule was not created — HHA rejected the visit date format.',
          action:
            'Confirm visit/service dates are sent in the HHA-required date format (not MM/DD/YYYY in SOAP AllXsd fields), then re-run.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (fault.kind === 'invalid_patient_id') {
        return {
          title: fault.title,
          problem: fault.problem,
          impact: 'HHA could not load contracts/placements for this patient ID under the current agency.',
          action:
            'Confirm the HHA patient ID belongs to this agency and matches the child, then re-run.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (fault.kind === 'no_active_placements') {
        return {
          title: fault.title,
          problem: fault.problem,
          impact: 'Nothing to discharge — patient has no active HHA placements.',
          action: 'Confirm the child still has an active placement in HHA, or close out manually if already ended.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (fault.kind === 'provider_not_found') {
        return {
          title: fault.title,
          problem: fault.problem,
          impact: 'EVV placeholder visit / session cannot be scheduled without a matching HHA caregiver.',
          action:
            'Confirm Provider Name on the ProviderSoft row matches an Active caregiver in HHA, then re-run.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      return {
        title: fault.title,
        problem: fault.problem,
        impact: 'This row failed during an HHA SOAP/API call.',
        action: step
          ? `Review HHA response for step "${step}". Check sandbox vs production credentials and patient/contract IDs.`
          : 'Review CloudWatch logs for the processor Lambda and the HHA error text above.',
        rowRef,
        reportLabel: report,
        isPreview,
      };
    }

    case 'clocking_mismatch': {
      const expectedStart = detailString(ex.details, 'expectedStart');
      const expectedEnd = detailString(ex.details, 'expectedEnd');
      const clockIn = detailString(ex.details, 'clockIn');
      const clockOut = detailString(ex.details, 'clockOut');
      const expectedRange =
        expectedStart || expectedEnd
          ? `${expectedStart ?? '?'}–${expectedEnd ?? '?'}`
          : undefined;
      const actualRange =
        clockIn || clockOut ? `${clockIn ?? '?'}–${clockOut ?? '?'}` : undefined;
      const timeBits =
        expectedRange && actualRange
          ? `API Report ${expectedRange} vs HHA clock ${actualRange}`
          : expectedRange
            ? `API Report ${expectedRange}`
            : actualRange
              ? `HHA clock ${actualRange}`
              : undefined;
      return {
        title: timeBits ? `Failed — time off (${timeBits})` : 'Failed — time off',
        problem:
          cleanExceptionMessage(ex.message) ||
          (timeBits
            ? `ProviderSoft Begin/End times do not match HHA EVV clock times (${timeBits}).`
            : 'ProviderSoft Begin/End times do not match HHA EVV clock-in/out.'),
        impact:
          'Session was not approved — time off: HHA EVV clock times differ from the API Report Begin/End Time (not a missing clock).',
        action:
          'Coordinator: compare API Report Begin/End Time to the caregiver mobile clock in HHA. Correct the wrong side (PS times or HHA clock), then re-run session sync.',
        rowRef,
        reportLabel: report,
        isPreview,
      };
    }

    case 'incomplete_unscheduled_clock': {
      const source = detailString(ex.details, 'source');
      const visitDate = detailString(ex.details, 'visitDate');
      const missingSide = detailString(ex.details, 'missingSide');
      const entirelyMissing =
        source === 'hha_unscheduled_missing' ||
        missingSide === 'both' ||
        /missing clock\b/i.test(ex.message);
      let clockIssue: string;
      let impact: string;
      let action: string;
      if (entirelyMissing && missingSide !== 'in' && missingSide !== 'out') {
        clockIssue = 'missing clock';
        impact =
          'Session was not approved — there is no matching HHA unscheduled mobile clock (no clock-in and no clock-out). CreateVisitFromUnscheduled cannot run.';
        action =
          'Coordinator: confirm the caregiver completed mobile clock-in and clock-out in HHA for this visit date, then re-run session sync. If clocks exist under a different patient/caregiver, fix IDs in ProviderSoft.';
      } else if (missingSide === 'in' || /missing clock-in/i.test(ex.message)) {
        clockIssue = 'missing clock-in';
        impact =
          'Session was not approved — HHA unscheduled row has clock-out but no clock-in. CreateVisitFromUnscheduled requires both CallInMID and CallOutMID.';
        action =
          'Coordinator: open HHA Visit Maintenance → Unscheduled Services, link or capture the missing clock-in, then re-run session sync.';
      } else if (missingSide === 'out' || /missing clock-out/i.test(ex.message)) {
        clockIssue = 'missing clock-out';
        impact =
          'Session was not approved — HHA unscheduled row has clock-in but no clock-out. CreateVisitFromUnscheduled requires both CallInMID and CallOutMID.';
        action =
          'Coordinator: open HHA Visit Maintenance → Unscheduled Services, link or capture the missing clock-out (or have caregiver clock out), then re-run session sync.';
      } else if (source === 'providersoft_report') {
        clockIssue = /End Time|clock-out/i.test(ex.message)
          ? 'missing clock-out (API Report End Time)'
          : /Begin Time|clock-in/i.test(ex.message)
            ? 'missing clock-in (API Report Begin Time)'
            : 'missing Begin or End Time on API Report';
        impact = 'Session was not approved — ProviderSoft API Report must include both Begin Time and End Time.';
        action =
          'Fix Begin/End Time on the API Report row in ProviderSoft, re-export, and re-run session sync.';
      } else {
        clockIssue = 'missing clock-in or clock-out';
        impact =
          'Session was not approved — EVV requires both clock-in and clock-out before HHA approve.';
        action =
          'Coordinator: open HHA Visit Maintenance → Unscheduled Services, locate the row, link the missing side, then re-run session sync.';
      }
      const titleBits = [clockIssue];
      if (source) titleBits.push(`source ${source}`);
      if (visitDate) titleBits.push(`visit ${visitDate}`);
      return {
        title: `Failed — ${titleBits.join('; ')}`,
        problem: cleanExceptionMessage(ex.message) || ex.message,
        impact,
        action,
        rowRef,
        reportLabel: report,
        isPreview,
      };
    }

    case 'skipped_by_rule':
      return {
        title: codeLabel(ex.code),
        problem: ex.message,
        impact: 'Row intentionally skipped (e.g. Early Intervention).',
        action: 'No action unless this skip is unexpected — then review program-type rules.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'other':
      if (
        ex.message.includes('ContractID') ||
        ex.message.includes('Contract ID') ||
        programType !== undefined
      ) {
        return {
          title: 'Program Type not mapped to HHA contract',
          problem: `Program Type "${programType ?? '(missing)'}" on ${rowRef} is not linked to an HHA ContractID.`,
          impact: isPreview
            ? 'Dry-run flagged this before any HHA write.'
            : 'Case/session cannot be synced until the contract is resolved.',
          action:
            'Verify Program Type text in ProviderSoft exactly matches HHA GetContracts. Add mapping if this is a new payer/program.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (
        /provider name not found|Provider ".+" not found|Provider .+ not found/i.test(ex.message) ||
        (ex.message.toLowerCase().includes('provider') &&
          ex.message.toLowerCase().includes('not found'))
      ) {
        const providerName = detailString(ex.details, 'providerName');
        const named = providerName ? ` ("${providerName}")` : '';
        return {
          // Keep provider name out of the shared title so identical failures group in email.
          title: 'Failed — Provider name not found in HHA',
          problem: cleanExceptionMessage(ex.message) || `Provider${named} not found in HHA.`,
          impact: 'EVV placeholder visit / session cannot be scheduled without a matching HHA caregiver.',
          action:
            'Confirm Provider Name on the ProviderSoft row matches an Active caregiver in HHA, then re-run.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (ex.message.includes('provider name') || ex.message.includes('caregiver')) {
        return {
          title: 'Failed — caregiver / Provider Name not found',
          problem: `Provider Name is missing or not listed in HHA for ${rowRef}.`,
          impact: 'HHA needs a caregiver ID to schedule or verify the session.',
          action:
            'Ensure Provider Name is filled and matches an Active caregiver in HHA.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (ex.message.includes('pay code')) {
        const payCodeName = detailString(ex.details, 'payCodeName');
        return {
          title: payCodeName
            ? `Failed — pay code "${payCodeName}" not found in HHA`
            : 'Failed — pay code not found in HHA',
          problem: cleanExceptionMessage(ex.message),
          impact: 'Session cannot be scheduled with the expected pay rate.',
          action:
            'Confirm Pay Rate + Service Type in API Report produce a valid HHA pay code (e.g. OT72). Check GetCaregiverPayCodes.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      return {
        title: cleanExceptionMessage(ex.message) || 'Failed — unresolved row error',
        problem: cleanExceptionMessage(ex.message),
        impact: 'Row needs manual review before HHA sync.',
        action: '',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'pipeline_step_error':
      if (ex.details?.timedOut) {
        if (ex.details?.retriesExhausted) {
          return {
            title: 'HHA sync incomplete after max auto-retries',
            problem: ex.message,
            impact:
              'Remaining rows in this branch were not entered. Rows already written to HHA were kept. Other branches may have completed.',
            action:
              'Do not expect another automatic sync pass for this run. Investigate Lambda duration / batch size, then start a new run — already-synced rows are skipped via idempotency.',
            rowRef,
            reportLabel: report,
            isPreview,
          };
        }
        return {
          title: 'HHA sync stopped to avoid a Lambda timeout',
          problem: ex.message,
          impact:
            'Some rows in this branch were not finished. Rows already written to HHA were kept. Other branches may have completed.',
          action:
            'Pipeline auto-retries remaining rows (up to 2 more sync passes). Idempotency skips rows already written. If still incomplete after retries, the alert flags a terminal error.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      return {
        title: codeLabel(ex.code),
        problem: ex.message,
        impact:
          'One HHA sync branch crashed. Other branches may still have processed rows — check the validate summary counts.',
        action:
          'Review CloudWatch logs for the Opened, Closed, or Sessions Lambda for this runId. Fix the root cause (S3 artifact, JSON parse, credentials) and re-run. Row-level failures from other branches are still listed separately in this email.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    default:
      return {
        title: codeLabel(ex.code),
        problem: ex.message,
        impact: 'Row was not processed successfully.',
        action: 'Review details and CloudWatch logs for this runId.',
        rowRef,
        reportLabel: report,
        isPreview,
      };
  }
}

export function formatExplainedException(ex: PipelineException, index: number): string {
  const e = explainException(ex);
  const lines = [
    `${index}. ${e.reportLabel} — ${e.rowRef}`,
    `   Issue: ${e.title}`,
    `   Problem: ${e.problem}`,
    `   Impact: ${e.impact}`,
    `   What to do: ${e.action}`,
  ];
  if (e.isPreview) {
    lines.push(`   Mode: ${e.isPreview ? 'Dry-run preview only (HHA was NOT updated)' : 'Live'}`);
  }
  return lines.join('\n');
}

export interface ExceptionRowRef {
  rowId?: string;
  patientName?: string;
  caregiverName?: string;
  reportLabel: string;
}

/** One group of row failures that share the same reason (for alert emails). */
export interface ExceptionReasonGroup {
  reasonKey: string;
  title: string;
  reportLabel: string;
  impact: string;
  action: string;
  isPreview: boolean;
  /** Distinguishing detail (service code, program type, etc.) when relevant. */
  detail?: string;
  rows: ExceptionRowRef[];
}

/** Prefer explicit patientName; fall back to firstName + lastName on exception details. */
export function patientNameFromDetails(
  details: PipelineException['details'],
): string | undefined {
  const raw = details?.patientName;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const first = typeof details?.firstName === 'string' ? details.firstName.trim() : '';
  const last = typeof details?.lastName === 'string' ? details.lastName.trim() : '';
  const joined = [first, last].filter(Boolean).join(' ');
  return joined || undefined;
}

export function caregiverNameFromDetails(
  details: PipelineException['details'],
): string | undefined {
  const caregiver =
    typeof details?.caregiverName === 'string' ? details.caregiverName.trim() : '';
  if (caregiver) return caregiver;
  const provider =
    typeof details?.providerName === 'string' ? details.providerName.trim() : '';
  return provider || undefined;
}

/** Build details snippet with patient/caregiver names for alert emails and CSV. */
export function partyDetailsFromRow(row: {
  firstName?: string;
  lastName?: string;
  patientName?: string;
  providerName?: string;
  caregiverName?: string;
  programType?: string;
}): Record<string, string> {
  const patientName =
    row.patientName?.trim() ||
    [row.firstName, row.lastName].filter(Boolean).join(' ').trim() ||
    '';
  const caregiverName = row.caregiverName?.trim() || row.providerName?.trim() || '';
  const out: Record<string, string> = {};
  if (patientName) out.patientName = patientName;
  if (caregiverName) out.caregiverName = caregiverName;
  if (row.providerName?.trim()) out.providerName = row.providerName.trim();
  if (row.firstName?.trim()) out.firstName = row.firstName.trim();
  if (row.lastName?.trim()) out.lastName = row.lastName.trim();
  if (row.programType?.trim()) out.programType = row.programType.trim();
  return out;
}

/** Stable key so identical failure reasons collapse into one email block. */
export function exceptionReasonKey(ex: PipelineException): string {
  const report = ex.reportKind ?? '';
  const code = ex.code;

  const missing = missingFieldLabels(ex.details)
    .map(humanizeMissingFieldKey)
    .sort((a, b) => a.localeCompare(b));
  if (missing.length > 0) {
    return `missing:${missing.join('|')}|${report}|${code}`;
  }

  // Provider / caregiver not found — one card for the pattern (names listed under Who).
  if (
    /provider name not found|Provider ".+" not found|Provider .+ not found/i.test(ex.message) ||
    (ex.message.toLowerCase().includes('provider') &&
      ex.message.toLowerCase().includes('not found')) ||
    (ex.message.toLowerCase().includes('caregiver') &&
      ex.message.toLowerCase().includes('not found'))
  ) {
    return `provider_not_found|${report}|${code}`;
  }

  const payCodeName =
    typeof ex.details?.payCodeName === 'string' ? ex.details.payCodeName.trim() : '';
  if (/pay code/i.test(ex.message) || payCodeName) {
    // Same missing/unknown pay code collapses; different codes stay separate.
    return `pay_code:${payCodeName || '_unknown'}|${report}|${code}`;
  }

  if (ex.code === 'clocking_mismatch') {
    return `time_off|${report}|${code}`;
  }

  if (ex.code === 'incomplete_unscheduled_clock') {
    const missingSide =
      typeof ex.details?.missingSide === 'string' ? ex.details.missingSide.trim() : '';
    const source = typeof ex.details?.source === 'string' ? ex.details.source.trim() : '';
    const side =
      missingSide ||
      (source === 'hha_unscheduled_missing' ? 'both' : '') ||
      (/missing clock-in/i.test(ex.message)
        ? 'in'
        : /missing clock-out/i.test(ex.message)
          ? 'out'
          : 'missing');
    return `clock:${side}|${report}|${code}`;
  }

  if (ex.code === 'unknown_service_code' || ex.code === 'missing_service_code') {
    const serviceCode =
      typeof ex.details?.serviceCode === 'string' ? ex.details.serviceCode.trim() : '';
    return `service:${serviceCode || '_blank'}|${report}|${code}`;
  }

  if (ex.code === 'unmatched_patient') {
    return `unmatched_patient|${report}|${code}`;
  }

  if (ex.code === 'hha_api_error') {
    const fault = parseHhaApiFault(ex.message);
    if (fault.kind === 'invalid_service_code' || fault.kind === 'service_code_missing') {
      const serviceCode =
        typeof ex.details?.serviceCode === 'string' ? ex.details.serviceCode.trim() : '';
      return `hha:${fault.kind}:${serviceCode || '_blank'}|${report}|${code}`;
    }
    if (fault.kind !== 'unknown') {
      return `hha:${fault.kind}|${report}|${code}`;
    }
  }

  const programType =
    typeof ex.details?.programType === 'string' ? ex.details.programType.trim() : '';
  if (
    ex.message.includes('ContractID') ||
    ex.message.includes('Contract ID') ||
    /Program Type/i.test(ex.message)
  ) {
    return `contract:${programType || '_blank'}|${report}|${code}`;
  }

  // Default: code + report + short party-free title (no visit/patient/row ids).
  const title = explainException(ex).title;
  return `${code}|${report}|${title}`;
}

function reasonDetailSuffix(ex: PipelineException): string | undefined {
  const serviceCode =
    typeof ex.details?.serviceCode === 'string' ? ex.details.serviceCode.trim() : '';
  if (serviceCode && (ex.code === 'unknown_service_code' || ex.code === 'missing_service_code')) {
    return `Service Type "${serviceCode}"`;
  }
  if (serviceCode && ex.code === 'hha_api_error') {
    const fault = parseHhaApiFault(ex.message);
    if (fault.kind === 'invalid_service_code' || fault.kind === 'service_code_missing') {
      return `Service Type "${serviceCode}"`;
    }
  }
  const programType =
    typeof ex.details?.programType === 'string' ? ex.details.programType.trim() : '';
  if (programType && (/contract|Program Type/i.test(ex.message) || ex.details?.programType)) {
    if (ex.message.includes('ContractID') || ex.message.includes('Contract ID')) {
      return `Program Type "${programType}"`;
    }
  }
  const payCodeName =
    typeof ex.details?.payCodeName === 'string' ? ex.details.payCodeName.trim() : '';
  if (payCodeName) return `Pay code "${payCodeName}"`;
  // Do not attach a single provider name — Who lists each caregiver.
  return undefined;
}

/** Group actionable exceptions by failure reason for compact alert emails. */
export function groupExceptionsByReason(exceptions: PipelineException[]): ExceptionReasonGroup[] {
  const groups = new Map<string, ExceptionReasonGroup>();
  for (const ex of exceptions) {
    const explained = explainException(ex);
    const key = exceptionReasonKey(ex);
    const row: ExceptionRowRef = {
      rowId: ex.rowId,
      patientName: patientNameFromDetails(ex.details),
      caregiverName: caregiverNameFromDetails(ex.details),
      reportLabel: explained.reportLabel,
    };
    const existing = groups.get(key);
    if (existing) {
      // Prefer a row with an id; avoid duplicate same rowId in one group.
      if (row.rowId && existing.rows.some((r) => r.rowId === row.rowId)) continue;
      existing.rows.push(row);
      continue;
    }
    groups.set(key, {
      reasonKey: key,
      // Short shared reason (no per-row names — those appear under Who).
      title: explained.title,
      reportLabel: explained.reportLabel,
      impact: explained.impact,
      action: explained.action,
      isPreview: explained.isPreview,
      detail: reasonDetailSuffix(ex),
      rows: [row],
    });
  }
  return [...groups.values()].sort((a, b) => {
    if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
    return a.title.localeCompare(b.title) || a.reportLabel.localeCompare(b.reportLabel);
  });
}

/** Format "Name (#id)" — names first, IDs secondary (ops-friendly). */
export function formatGroupedRowList(
  rows: ExceptionRowRef[],
  options?: { maxNames?: number },
): string {
  const maxNames = options?.maxNames;
  const shown = maxNames && rows.length > maxNames ? rows.slice(0, maxNames) : rows;
  const parts = shown.map((r) => {
    const id = r.rowId ? `#${r.rowId}` : undefined;
    if (r.patientName && id) {
      const cg = r.caregiverName ? ` · CG ${r.caregiverName}` : '';
      return `${r.patientName} (${id}${cg})`;
    }
    if (r.patientName) return r.patientName;
    if (id && r.caregiverName) return `${id} · CG ${r.caregiverName}`;
    return id ?? 'unknown row';
  });
  if (parts.length === 0) return '(no row ids)';
  const more =
    maxNames && rows.length > maxNames ? ` … and ${rows.length - maxNames} more` : '';
  if (parts.length === 1) return `${parts[0]!}${more}`;
  if (parts.length === 2 && !more) return `${parts[0]} and ${parts[1]}`;
  if (!more) return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `${parts.join(', ')}${more}`;
}

const SUCCESS_LIST_CAP = 40;

/** Named succeeded rows for alert body (capped; full list in results.csv). */
export function formatSucceededSection(options: {
  opened?: ProcessorResult;
  newServices?: ProcessorResult;
  closed?: ProcessorResult;
  discharge?: ProcessorResult;
  sessions?: ProcessorResult;
}): string[] {
  const branches: Array<{ label: string; result?: ProcessorResult }> = [
    { label: reportLabel('opened_cases'), result: options.opened },
    { label: reportLabel('new_services'), result: options.newServices },
    { label: reportLabel('closed_cases'), result: options.closed },
    { label: reportLabel('discharge_service'), result: options.discharge },
    { label: reportLabel('verified_sessions'), result: options.sessions },
  ];

  const lines: string[] = ['--- Succeeded ---'];
  let any = false;
  for (const { label, result } of branches) {
    if (!result || result.succeeded <= 0) continue;
    any = true;
    const named = result.successes ?? [];
    if (named.length === 0) {
      lines.push(`  ${label}: ${result.succeeded} row(s) — see results.csv attachment when available`);
      continue;
    }
    const shown = named.slice(0, SUCCESS_LIST_CAP);
    const list = shown
      .map((s) => {
        const id = s.rowId ? `#${s.rowId}` : '';
        if (s.patientName && id) return `${s.patientName} (${id})`;
        return s.patientName || id || 'unknown';
      })
      .join(', ');
    const more =
      named.length > SUCCESS_LIST_CAP
        ? ` … and ${named.length - SUCCESS_LIST_CAP} more`
        : named.length < result.succeeded
          ? ` (${result.succeeded} total)`
          : '';
    lines.push(`  ${label}: ${list}${more}`);
  }
  if (!any) {
    lines.push('  (none in this run)');
  }
  return lines;
}

/** Plain-text block for one reason group (used by SNS / email text body). */
export function formatExceptionReasonGroup(group: ExceptionReasonGroup, index: number): string {
  const rowList = formatGroupedRowList(group.rows, { maxNames: 40 });
  const dueTo =
    group.detail && !group.title.includes(group.detail)
      ? `${group.title} (${group.detail})`
      : group.title;
  const lines = [
    `${index}. ${group.reportLabel} — ${dueTo} (${group.rows.length} row${group.rows.length === 1 ? '' : 's'})`,
    `   Who: ${rowList}`,
  ];
  if (group.isPreview) {
    lines.push('   Mode: Dry-run preview only (HHA was NOT updated)');
  }
  return lines.join('\n');
}

/** Format all reason groups for the Failed section (no truncation). */
export function formatGroupedExceptionsSection(exceptions: PipelineException[]): string[] {
  const groups = groupExceptionsByReason(exceptions);
  if (groups.length === 0) return [];
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  const lines: string[] = [
    `--- Failed (${totalRows} issue${totalRows === 1 ? '' : 's'} in ${groups.length} reason group${groups.length === 1 ? '' : 's'}) ---`,
    '',
  ];
  groups.forEach((group, i) => {
    lines.push(formatExceptionReasonGroup(group, i + 1));
    lines.push('');
  });
  return lines;
}

export interface SkipRuleSummary {
  reportKind: string;
  reason: string;
  label: string;
  count: number;
}

export function inferSkipRuleReason(ex: PipelineException): string {
  if (typeof ex.details?.triageReason === 'string') return ex.details.triageReason;
  if (/Early Intervention/i.test(ex.message)) return 'early_intervention';
  return 'other';
}

export function skipRuleReasonLabel(reason: string): string {
  if (reason === 'early_intervention') {
    return 'Early Intervention — not sent to HHA (by design)';
  }
  if (reason === 'missed_session') {
    return 'Missed session (Pay Rate 0) — not sent to HHA';
  }
  if (reason.startsWith('status:')) {
    const status = reason.slice('status:'.length).replace(/_/g, ' ');
    return `Session status "${status}" — skipped`;
  }
  return reason.replace(/_/g, ' ');
}

/** Group skipped_by_rule rows for email — one line per report + rule, not one line per row. */
export function summarizeSkippedByRule(exceptions: PipelineException[]): SkipRuleSummary[] {
  const map = new Map<string, SkipRuleSummary>();
  for (const ex of exceptions) {
    if (ex.code !== 'skipped_by_rule') continue;
    const reason = inferSkipRuleReason(ex);
    const reportKind = ex.reportKind ?? 'unknown';
    const key = `${reportKind}|${reason}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        reportKind,
        reason,
        label: skipRuleReasonLabel(reason),
        count: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function partitionExceptionsForAlert(exceptions: PipelineException[]): {
  actionable: PipelineException[];
  skipSummaries: SkipRuleSummary[];
  skippedCount: number;
} {
  const skipSummaries = summarizeSkippedByRule(exceptions);
  const skippedCount = skipSummaries.reduce((n, s) => n + s.count, 0);
  const actionable = exceptions.filter((ex) => ex.code !== 'skipped_by_rule');
  return { actionable, skipSummaries, skippedCount };
}

export type SessionFailureCategory =
  | 'unscheduled_clock'
  | 'time_off'
  | 'service_code'
  | 'pay_code'
  | 'caregiver'
  | 'other';

/** Classify verified_sessions failures for compact alert email rows. */
export function classifySessionFailure(ex: PipelineException): SessionFailureCategory | null {
  if (ex.reportKind !== 'verified_sessions') return null;

  if (ex.code === 'clocking_mismatch' || /\btime off\b|clock time not matching/i.test(ex.message)) {
    return 'time_off';
  }
  if (ex.code === 'incomplete_unscheduled_clock') {
    return 'unscheduled_clock';
  }
  if (
    /pending mobile clock|unscheduled|missing clock|EVV clock|clock-in|clock-out|Begin Time|End Time/i.test(
      ex.message,
    )
  ) {
    return 'unscheduled_clock';
  }
  if (ex.code === 'missing_service_code' || ex.code === 'unknown_service_code') {
    return 'service_code';
  }
  if (/pay code/i.test(ex.message) || ex.details?.payCodeName) {
    return 'pay_code';
  }
  if (/caregiver|Provider .* not found/i.test(ex.message) || ex.details?.providerName) {
    return 'caregiver';
  }
  return 'other';
}

function uniqueSessionCount(exceptions: PipelineException[]): number {
  const ids = new Set(exceptions.map((e) => e.rowId).filter(Boolean));
  return ids.size || exceptions.length;
}

function countLabelValues(
  exceptions: PipelineException[],
  labelKey: 'serviceCode' | 'payCodeName' | 'providerName',
  blank = '(blank)',
): string {
  const counts = new Map<string, number>();
  for (const ex of exceptions) {
    const raw = ex.details?.[labelKey];
    const label = typeof raw === 'string' && raw.trim() ? raw.trim() : blank;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, n]) => `${label} (${n})`)
    .join(', ');
}

/** Compact API Report rows for sandbox/dry-run email — no per-session listing. */
export function formatSessionOutcomeSummary(
  sessions: ProcessorResult | undefined,
  exceptions: PipelineException[],
): string[] {
  if (!sessions) return [];

  const sessionExceptions = exceptions.filter(
    (ex) => ex.reportKind === 'verified_sessions' && ex.code !== 'skipped_by_rule',
  );
  const byCategory = new Map<SessionFailureCategory, PipelineException[]>();
  for (const ex of sessionExceptions) {
    const cat = classifySessionFailure(ex);
    if (!cat) continue;
    const list = byCategory.get(cat) ?? [];
    list.push(ex);
    byCategory.set(cat, list);
  }

  const lines: string[] = ['--- API Report (sessions) outcome ---'];
  lines.push(`Would succeed: ${sessions.succeeded} session(s)`);

  const clock = byCategory.get('unscheduled_clock') ?? [];
  if (clock.length) {
    lines.push(
      `Would fail — missing clock (entirely, clock-in, or clock-out): ${uniqueSessionCount(clock)} session(s)`,
    );
  }

  const timeOff = byCategory.get('time_off') ?? [];
  if (timeOff.length) {
    lines.push(
      `Would fail — time off (API Report Begin/End ≠ HHA EVV clock): ${uniqueSessionCount(timeOff)} session(s)`,
    );
  }

  const service = byCategory.get('service_code') ?? [];
  if (service.length) {
    lines.push(
      `Would fail — service code missing or not in HHA: ${uniqueSessionCount(service)} session(s) — ${countLabelValues(service, 'serviceCode')}`,
    );
  }

  const pay = byCategory.get('pay_code') ?? [];
  if (pay.length) {
    lines.push(
      `Would fail — pay code not in HHA: ${uniqueSessionCount(pay)} session(s) — ${countLabelValues(pay, 'payCodeName', '(unknown pay code)')}`,
    );
  }

  const caregiver = byCategory.get('caregiver') ?? [];
  if (caregiver.length) {
    lines.push(
      `Would fail — caregiver not found in HHA: ${uniqueSessionCount(caregiver)} session(s) — ${countLabelValues(caregiver, 'providerName', '(missing provider name)')}`,
    );
  }

  const other = byCategory.get('other') ?? [];
  if (other.length) {
    lines.push(
      `Would fail — other (contract, patient, HHA API, etc.): ${uniqueSessionCount(other)} session(s) — see S3 exceptions.json`,
    );
  }

  return lines;
}

export function summarizeProcessorResult(name: string, result?: ProcessorResult): string {
  if (!result) return `  ${name}: not executed in this run`;

  if (result.failed > 0) {
    return `  ${name}: ${result.failed} row(s) blocked (${result.succeeded} ok, ${result.processed} total)`;
  }
  if (result.exceptions.length > 0) {
    return `  ${name}: completed with ${result.exceptions.length} note(s) (${result.succeeded} ok)`;
  }
  return `  ${name}: OK (${result.succeeded} ok, ${result.processed} total)`;
}

export type ParseReportCounts = {
  opened_cases?: number;
  gluck_opened_cases?: number;
  new_services?: number;
  gluck_opened_after_ei_filter?: number;
  new_services_after_ei_filter?: number;
  closed_cases?: number;
  verified_sessions?: number;
  opened_cases_after_ei_filter?: number;
  discharge_service?: number;
  caregiver_codes?: number;
};

function processorOutcomeSuffix(result: ProcessorResult): string {
  if (result.failed > 0) {
    return `${result.failed} blocked, ${result.succeeded} ok, ${result.processed} total`;
  }
  if (result.exceptions.length > 0) {
    return `${result.exceptions.length} note(s), ${result.succeeded} ok`;
  }
  return `${result.succeeded} ok, ${result.processed} total`;
}

/** One summary line per ProviderSoft report (5 sync reports + optional reference download). */
export function formatReportsSummary(options: {
  parse?: ParseReportCounts;
  opened?: ProcessorResult;
  /** Separate new-service processor result (not merged into Gluck open). */
  newServices?: ProcessorResult;
  closed?: ProcessorResult;
  discharge?: ProcessorResult;
  sessions?: ProcessorResult;
}): string[] {
  const lines: string[] = [];
  const { parse } = options;
  const gluckDownloaded = parse?.gluck_opened_cases;
  const newServicesDownloaded = parse?.new_services;
  const newServicesResult = options.newServices;

  if (gluckDownloaded !== undefined) {
    if (gluckDownloaded === 0) {
      lines.push(`  ${REPORT_LABELS.opened_cases}: 0 downloaded — no rows in Gluck open report`);
    } else {
      const afterEi = parse?.gluck_opened_after_ei_filter ?? parse?.opened_cases_after_ei_filter;
      const afterPart =
        afterEi !== undefined ? ` → ${afterEi} to process` : '';
      if (options.opened) {
        lines.push(
          `  ${REPORT_LABELS.opened_cases}: ${gluckDownloaded} downloaded${afterPart} — ${processorOutcomeSuffix(options.opened)}`,
        );
      } else {
        lines.push(
          `  ${REPORT_LABELS.opened_cases}: ${gluckDownloaded} downloaded${afterPart} — not synced in this run`,
        );
      }
    }
  } else if (parse?.opened_cases !== undefined) {
    const afterEi = parse.opened_cases_after_ei_filter;
    lines.push(
      `  ${REPORT_LABELS.opened_cases}: ${parse.opened_cases} downloaded${afterEi !== undefined ? ` → ${afterEi} to process` : ''} — not synced in this run`,
    );
  } else {
    lines.push(`  ${REPORT_LABELS.opened_cases}: not required to download`);
  }

  if (newServicesDownloaded !== undefined) {
    if (newServicesDownloaded === 0) {
      lines.push(`  ${REPORT_LABELS.new_services}: 0 downloaded — no rows in new service report`);
    } else {
      const afterEi =
        parse?.new_services_after_ei_filter ?? parse?.opened_cases_after_ei_filter ?? 0;
      if (newServicesResult) {
        lines.push(
          `  ${REPORT_LABELS.new_services}: ${newServicesDownloaded} downloaded → ${afterEi} to process — ${processorOutcomeSuffix(newServicesResult)}`,
        );
      } else if (options.opened && (gluckDownloaded ?? 0) === 0) {
        // Legacy merged opened branch (pre-split) when only new-service rows existed.
        lines.push(
          `  ${REPORT_LABELS.new_services}: ${newServicesDownloaded} downloaded → ${afterEi} to process — ${processorOutcomeSuffix(options.opened)}`,
        );
      } else {
        lines.push(
          `  ${REPORT_LABELS.new_services}: ${newServicesDownloaded} downloaded → ${afterEi} to process — not synced in this run`,
        );
      }
    }
  } else {
    lines.push(`  ${REPORT_LABELS.new_services}: not required to download`);
  }

  if (options.closed) {
    const dl = parse?.closed_cases !== undefined ? `${parse.closed_cases} downloaded — ` : '';
    lines.push(`  ${REPORT_LABELS.closed_cases}: ${dl}${processorOutcomeSuffix(options.closed)}`);
  } else if (parse?.closed_cases !== undefined) {
    lines.push(
      `  ${REPORT_LABELS.closed_cases}: ${parse.closed_cases} downloaded — not synced in this run`,
    );
  } else {
    lines.push(`  ${REPORT_LABELS.closed_cases}: not required to download`);
  }

  if (parse?.discharge_service !== undefined) {
    if (parse.discharge_service === 0) {
      lines.push(`  ${REPORT_LABELS.discharge_service}: 0 rows in report — nothing to sync`);
    } else if (options.discharge) {
      lines.push(
        `  ${REPORT_LABELS.discharge_service}: ${parse.discharge_service} downloaded — ${processorOutcomeSuffix(options.discharge)}`,
      );
    } else {
      lines.push(
        `  ${REPORT_LABELS.discharge_service}: ${parse.discharge_service} downloaded — not synced in this run`,
      );
    }
  } else {
    lines.push(`  ${REPORT_LABELS.discharge_service}: not required to download`);
  }

  if (options.sessions) {
    if (parse?.verified_sessions === undefined) {
      // Case-only nights still invoke SessionsBranch — never show "0 downloaded".
      lines.push(`  ${REPORT_LABELS.verified_sessions}: not required to download`);
    } else {
      const dl = `${parse.verified_sessions} downloaded — `;
      lines.push(
        `  ${REPORT_LABELS.verified_sessions}: ${dl}${processorOutcomeSuffix(options.sessions)}`,
      );
    }
  } else if (parse?.verified_sessions !== undefined) {
    lines.push(
      `  ${REPORT_LABELS.verified_sessions}: ${parse.verified_sessions} downloaded — not synced in this run`,
    );
  } else {
    lines.push(`  ${REPORT_LABELS.verified_sessions}: not required to download`);
  }

  return lines;
}

export function formatAlertSubject(options: {
  runId: string;
  ok: boolean;
  dryRun?: boolean;
  sandbox?: boolean;
  hardFailures: number;
  /** Actionable exceptions only (excludes skipped_by_rule bulk skips). */
  exceptionCount: number;
  skippedCount?: number;
  pipelineStep?: string;
  allPreview?: boolean;
  stubFixtures?: boolean;
}): string {
  if (options.pipelineStep) {
    return `White-glove ${options.runId}: PIPELINE STOPPED at ${options.pipelineStep}`;
  }
  if (options.sandbox) {
    if (!options.ok) {
      return `White-glove SANDBOX ${options.runId}: ${options.hardFailures} row(s) would fail live`;
    }
    return `White-glove SANDBOX ${options.runId}: all checks passed — ready for live`;
  }
  if (options.dryRun && options.allPreview) {
    const label = options.stubFixtures ? 'DRY-RUN (test data)' : 'DRY-RUN preview';
    return `White-glove ${options.runId}: ${label} — ${options.exceptionCount} mapping issue(s) found`;
  }
  if (!options.ok) {
    return `White-glove ${options.runId}: LIVE FAILED — ${options.hardFailures} row(s) blocked`;
  }
  const notes = options.exceptionCount > 0 ? `${options.exceptionCount} note(s)` : 'completed';
  return `White-glove ${options.runId}: ${notes}`;
}

export function explainPipelineError(raw: string): { summary: string; likelyCause: string; action: string } {
  if (/Sandbox\.Timedout|Task timed out after|timed out after/i.test(raw)) {
    return {
      summary: 'A pipeline Lambda hit its time limit before finishing all rows.',
      likelyCause:
        'HHA took too long on a call, or there were more rows than one invocation could finish.',
      action:
        'Pipeline auto-retries remaining rows up to 2 more times. If alerts continue, check Opened/Closed/Sessions CloudWatch logs for this runId.',
    };
  }
  if (raw.includes('ENOENT') && raw.includes('closed-cases.csv')) {
    return {
      summary: 'Download step could not find a report file before uploading to S3.',
      likelyCause:
        'Temporary CSV files were deleted before upload finished (fixed in latest deploy), or the wrong report kinds were requested.',
      action: 'Re-run the pipeline. If it persists, check Download Lambda CloudWatch logs.',
    };
  }
  if (raw.includes('REPORTS_BUCKET')) {
    return {
      summary: 'A Lambda function is missing the REPORTS_BUCKET environment variable.',
      likelyCause: 'Infrastructure misconfiguration or local run without AWS env.',
      action: 'Redeploy the CDK stack or set REPORTS_BUCKET on the failing Lambda.',
    };
  }
  if (raw.includes('reportKinds')) {
    return {
      summary: 'Step Functions input is missing the reportKinds field.',
      likelyCause: 'Manual execution JSON was incomplete.',
      action:
        'Start the pipeline with: {"runId":"manual-YYYY-MM-DD","dryRun":true,"reportKinds":["opened_cases","closed_cases","verified_sessions","caregiver_codes"]}',
    };
  }
  return {
    summary: raw,
    likelyCause: 'See CloudWatch logs for the failing Lambda step.',
    action: 'Open Step Functions execution history for this runId and inspect the failed state.',
  };
}
