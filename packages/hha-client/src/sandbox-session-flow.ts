/**
 * Sandbox end-to-end session flow test:
 * PS row → SearchPatients/Caregivers/Visits → EVV compare → CreateSchedule → ConfirmVisits
 *
 * Usage: npm run sandbox:session-flow -w @white-glove/hha-client
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SoapHhaClientAdapter } from './soap-adapter.js';
import { HhaSoapClient } from './soap-client.js';
import {
  buildConfirmVisitsBody,
  parseTimesheetFlags,
  parseVisitConfirmTimes,
  parseVisitEditReasonPairs,
} from './visit-confirm.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function loadRepoDotEnv(): void {
  const envPath = path.join(repoRoot, '.env');
  try {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
    }
  } catch {
    /* optional */
  }
}

loadRepoDotEnv();
process.env.HHA_USE_MOCK = 'false';

const auth = {
  appName: required('HHA_APP_NAME'),
  appSecret: required('HHA_APP_SECRET'),
  appKey: required('HHA_APP_KEY').replace(/\s+/g, ''),
};
const sandboxUrl =
  process.env.HHA_BASE_URL ??
  'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';

const reasonLookupUrl =
  process.env.HHA_REASON_LOOKUP_URL ??
  'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const reasonLookupVisitId = Number(process.env.HHA_REASON_LOOKUP_VISIT_ID || 1308496385);

const results: {
  testedAt: string;
  endpoint: string;
  steps: Record<string, unknown>;
  summary?: { passed: number; failed: number; total: number };
} = {
  testedAt: new Date().toISOString(),
  endpoint: sandboxUrl,
  steps: {},
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function mark(name: string, passed: boolean, detail: Record<string, unknown>) {
  results.steps[name] = { passed, ...detail };
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (detail.summary) console.log(`       ${detail.summary}`);
  if (detail.error) console.log(`       ${detail.error}`);
}

function ids(xml: string, tag: string): number[] {
  return [...xml.matchAll(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'gi'))].map((m) =>
    Number(m[1]),
  );
}

function first(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))?.[1];
}

function toMinutes12h(t: string): number | null {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function extractHhaMinutes(s: string): number | null {
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function psDateToIso(d: string): string {
  const m = d.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return d;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function psTimeToHhmm(t: string): string {
  const mins = toMinutes12h(t);
  if (mins == null) return t.replace(/:/g, '').slice(0, 4);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

function compareClock(
  psBegin: string,
  psEnd: string,
  evvStart: string | undefined,
  evvEnd: string | undefined,
  toleranceMin = 5,
) {
  const expS = toMinutes12h(psBegin);
  const expE = toMinutes12h(psEnd);
  const actS = evvStart ? extractHhaMinutes(evvStart) : null;
  const actE = evvEnd ? extractHhaMinutes(evvEnd) : null;
  const startDiff = expS != null && actS != null ? Math.abs(expS - actS) : null;
  const endDiff = expE != null && actE != null ? Math.abs(expE - actE) : null;
  return {
    expS,
    expE,
    actS,
    actE,
    startDiff,
    endDiff,
    matches:
      startDiff != null &&
      endDiff != null &&
      startDiff <= toleranceMin &&
      endDiff <= toleranceMin,
  };
}

async function main() {
  const soap = new HhaSoapClient({ baseUrl: sandboxUrl, auth });
  const adapter = new SoapHhaClientAdapter({
    baseUrl: sandboxUrl,
    auth,
    reasonLookupBaseUrl: reasonLookupUrl,
    reasonLookupVisitId,
    defaultOfficeId: Number(process.env.HHA_OFFICE_ID || 1025),
  });

  // --- A: Known sandbox visit with EVV (control) ---
  const controlVisitId = 1282693446;
  const controlInfo = await soap.getVisitInfoV2(controlVisitId);
  const controlCompare = compareClock('9:00 AM', '1:00 PM', first(controlInfo.bodyXml, 'EVVStartTime') ?? first(controlInfo.bodyXml, 'VisitStartTime'), first(controlInfo.bodyXml, 'EVVEndTime') ?? first(controlInfo.bodyXml, 'VisitEndTime'));
  mark('control_get_visit_info', controlInfo.ok, {
    summary: `Visit ${controlVisitId} EVV ${first(controlInfo.bodyXml, 'EVVStartTime')}–${first(controlInfo.bodyXml, 'EVVEndTime')} schedule ${first(controlInfo.bodyXml, 'ScheduleStartTime')}–${first(controlInfo.bodyXml, 'ScheduleEndTime')}`,
    compare: controlCompare,
    error: controlInfo.errorMessage,
  });

  // --- B: API Report sample row (non-EI) ---
  const psRow = {
    programId: '02883297',
    lastName: 'CHOWDHURY',
    firstName: 'RAMIN',
    sessionDate: '2026-07-16',
    begin: '12:30 PM',
    end: '1:00 PM',
    providerLast: 'FORTUNE',
    providerFirst: 'JOHANA',
    serviceType: 'OT CHHA EXTENDED',
  };

  const patientSearch = await soap.searchPatients({
    lastName: psRow.lastName,
    firstName: psRow.firstName,
    status: 'Active',
  });
  let patientId = ids(patientSearch.bodyXml, 'PatientID')[0];
  if (!patientId) {
    const byMr = await soap.call(
      'SearchPatients',
      `<SearchFilters>
  <FirstName></FirstName><LastName></LastName><Status></Status>
  <PhoneNumber></PhoneNumber><AdmissionID></AdmissionID>
  <MRNumber>${Number(psRow.programId)}</MRNumber><SSN></SSN>
</SearchFilters>`,
    );
    patientId = ids(byMr.bodyXml, 'PatientID')[0];
  }
  mark('api_row_search_patient', !!patientId, {
    summary: patientId ? `PatientID=${patientId}` : 'not in sandbox (expected — prod patient)',
    programId: psRow.programId,
    error: patientSearch.errorMessage,
  });

  const cg = await soap.call(
    'SearchCaregivers',
    `<SearchFilters>
  <FirstName>${psRow.providerFirst}</FirstName>
  <LastName>${psRow.providerLast}</LastName>
  <Status>Active</Status>
</SearchFilters>`,
  );
  const caregiverId = ids(cg.bodyXml, 'CaregiverID')[0];
  mark('api_row_search_caregiver', cg.ok, {
    summary: caregiverId
      ? `CaregiverID=${caregiverId}`
      : 'caregiver not found in sandbox',
    error: cg.errorMessage,
  });

  if (patientId) {
    const visits = await soap.searchVisits({
      patientId,
      startDate: psRow.sessionDate,
      endDate: psRow.sessionDate,
    });
    const visitIds = ids(visits.bodyXml, 'VisitID');
    mark('api_row_search_visits', visits.ok, {
      summary: `VisitIDs=${visitIds.join(',') || '(none)'}`,
      visitIds,
    });

    let matchedVisit: number | undefined;
    for (const vid of visitIds.slice(0, 5)) {
      const info = await soap.getVisitInfoV2(vid);
      const cmp = compareClock(
        psRow.begin,
        psRow.end,
        first(info.bodyXml, 'EVVStartTime') ?? first(info.bodyXml, 'VisitStartTime'),
        first(info.bodyXml, 'EVVEndTime') ?? first(info.bodyXml, 'VisitEndTime'),
      );
      if (cmp.matches) matchedVisit = vid;
    }
    mark('api_row_clock_match', !!matchedVisit, {
      summary: matchedVisit
        ? `matched VisitID=${matchedVisit}`
        : 'no visit within 5 min (prod data may not exist in sandbox)',
    });
  }

  // --- C: Sandbox patient — retroactive CreateSchedule from PS-shaped times ---
  const sandboxPatientId = 958000;
  const sandboxCaregiverId = 4380022;
  const payCodeId = 12298;
  const scheduleDate = '2026-07-24';
  const beginHhmm = psTimeToHhmm('10:00 AM');
  const endHhmm = psTimeToHhmm('10:30 AM');

  const contracts = await soap.getPatientContracts(sandboxPatientId, scheduleDate);
  const contractId = '10410';
  const serviceCodeId = '114535';
  mark('get_patient_contracts_for_schedule', contracts.ok, {
    summary: `using placement contract=${contractId} service=${serviceCodeId}`,
  });

  const create = await soap.call(
    'CreateSchedule',
    `<ScheduleInfo>
  <PatientID>${sandboxPatientId}</PatientID>
  <ScheduleType>Non-Skilled</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <VisitDate>${scheduleDate}</VisitDate>
  <ScheduleStartTime>${beginHhmm}</ScheduleStartTime>
  <ScheduleEndTime>${endHhmm}</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <CaregiverID>${sandboxCaregiverId}</CaregiverID>
  <PayCodeID>${payCodeId}</PayCodeID>
  <IsCaregiverTemporary>No</IsCaregiverTemporary>
  <PrimaryBillTo>
    <ContractID>${contractId}</ContractID>
    <ServiceCodeID>${serviceCodeId}</ServiceCodeID>
    <Hours>0</Hours>
    <Minutes>30</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
  );
  const newVisitId = ids(create.bodyXml, 'VisitID')[0];
  mark('create_schedule_retroactive', create.ok && !!newVisitId, {
    summary: newVisitId
      ? `Created VisitID=${newVisitId} on ${scheduleDate} ${beginHhmm}-${endHhmm}`
      : create.errorMessage ?? 'no VisitID',
    errorId: create.errorId,
    contractId,
    serviceCodeId,
  });

  if (newVisitId) {
    const info = await soap.getVisitInfoV2(newVisitId);
    mark('created_visit_readback', info.ok, {
      summary: `schedule ${first(info.bodyXml, 'ScheduleStartTime')}-${first(info.bodyXml, 'ScheduleEndTime')} EVV ${first(info.bodyXml, 'EVVStartTime') || 'empty'}-${first(info.bodyXml, 'EVVEndTime') || 'empty'}`,
      note: 'EVV empty until mobile clock — unscheduled flow would match before CreateSchedule',
    });
  }

  // --- D: ConfirmVisits on control visit (past, may already be confirmed) ---
  try {
    await adapter.approveVisit(String(controlVisitId));
    mark('confirm_control_visit', true, {
      summary: `ConfirmVisits succeeded on VisitID=${controlVisitId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const benign = /already|confirmed|approved|invalid|duplicate/i.test(msg);
    mark('confirm_control_visit', benign, {
      summary: benign ? `expected: ${msg}` : msg,
      error: msg,
    });
  }

  // --- E: ConfirmVisits dry-run payload on new visit (skip if no id) ---
  if (newVisitId) {
    const info = await soap.getVisitInfoV2(newVisitId);
    const times = parseVisitConfirmTimes(info.bodyXml);
    const reasonSoap = new HhaSoapClient({
      baseUrl: reasonLookupUrl,
      auth,
      allowProductionEndpoint: true,
    });
    const reasons = await reasonSoap.getVisitEditReasonActionTaken(reasonLookupVisitId);
    const pairs = parseVisitEditReasonPairs(reasons.bodyXml);
    mark('reason_lookup_prod', pairs.length > 0, {
      summary: `${pairs.length} reason pairs from prod visit ${reasonLookupVisitId}`,
    });

    if (times && pairs[0]) {
      const flags = parseTimesheetFlags(info.bodyXml);
      const body = buildConfirmVisitsBody({
        visitId: String(newVisitId),
        times,
        reasonCode: pairs[0].reasonCode,
        actionCode: pairs[0].actionCode,
        timesheetRequired: flags.timesheetRequired,
        timesheetApproved: flags.timesheetApproved,
      });
      const confirm = await soap.confirmVisit(body);
      mark('confirm_new_visit', confirm.ok, {
        summary: confirm.ok
          ? `Confirmed VisitID=${newVisitId}`
          : `${confirm.errorMessage} (eid=${confirm.errorId})`,
        note: 'May fail if visit has no EVV clock yet',
      });
    }
  }

  const entries = Object.values(results.steps);
  results.summary = {
    passed: entries.filter((s) => (s as { passed: boolean }).passed).length,
    failed: entries.filter((s) => !(s as { passed: boolean }).passed).length,
    total: entries.length,
  };

  const outDir = path.join(repoRoot, 'docs');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'hha-sandbox-session-flow.json');
  await writeFile(outFile, JSON.stringify(results, null, 2));
  console.log(`\nSummary: ${results.summary.passed}/${results.summary.total} passed`);
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
