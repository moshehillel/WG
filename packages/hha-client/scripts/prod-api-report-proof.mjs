/**
 * Read-only production proof for everything needed from API Report matching.
 * Sample: ELSAYED MUNIR / Program ID 02877125 / session 2026-07-08 4:00-4:30 PM
 * No Create/Update/Confirm writes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = process.env.HHA_APP_KEY.replace(/\s+/g, '');

const sample = {
  programId: '02877125',
  lastName: 'ELSAYED',
  firstName: 'MUNIR',
  sessionDate: '2026-07-08',
  begin: '4:00 PM',
  end: '4:30 PM',
  providerLast: 'PERETZ',
  providerFirst: 'DEBRA',
  serviceType: 'OT HC Eval',
  cpt: '97165',
};

const results = {
  testedAt: new Date().toISOString(),
  endpoint: URL,
  mode: 'read-only',
  sample,
  proofs: {},
};

async function call(method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${APP}</AppName>
        <AppSecret>${SECRET}</AppSecret>
        <AppKey>${KEY}</AppKey>
      </Authentication>
      ${inner}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/${method}"`,
    },
    body,
  });
  const xml = await res.text();
  return {
    http: res.status,
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '',
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

function ok(r) {
  return r.status?.toLowerCase() === 'success' || r.eid === '0';
}

function ids(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'gi'))].map((m) => Number(m[1]));
}

function first(xml, tag) {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))?.[1];
}

function mark(name, passed, detail) {
  results.proofs[name] = { passed, ...detail };
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (detail.summary) console.log('  ', detail.summary);
  if (detail.eid || detail.msg) console.log('  ', `eid=${detail.eid ?? '-'} ${detail.msg || ''}`);
}

function toMinutes(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function extractHhaTimeMinutes(s) {
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 1) Patient by MRNumber
const byMr = await call(
  'SearchPatients',
  `<SearchFilters>
  <FirstName></FirstName><LastName></LastName><Status></Status>
  <PhoneNumber></PhoneNumber><AdmissionID></AdmissionID>
  <MRNumber>${Number(sample.programId)}</MRNumber><SSN></SSN>
</SearchFilters>`,
);
const patientIds = ids(byMr.xml, 'PatientID');
const patientId = patientIds[0];
mark('patient_lookup_by_MRNumber', ok(byMr) && !!patientId, {
  summary: patientId ? `PatientID=${patientId}` : 'no patient',
  eid: byMr.eid,
  msg: byMr.msg,
  patientIds,
});

if (!patientId) {
  writeFileSync(path.join(repoRoot, 'docs', 'hha-api-report-prod-proof.json'), JSON.stringify(results, null, 2));
  process.exit(1);
}

// 2) Demographics
const demo = await call('GetPatientDemographics', `<PatientInfo><ID>${patientId}</ID></PatientInfo>`);
mark('get_patient_demographics', ok(demo), {
  summary: `${first(demo.xml, 'FirstName')} ${first(demo.xml, 'LastName')} DOB=${first(demo.xml, 'BirthDate')} AdmissionID=${first(demo.xml, 'AdmissionID')} MR=${first(demo.xml, 'MRNumber')}`,
  eid: demo.eid,
  msg: demo.msg,
});

// 3) Patient contracts
const pc = await call(
  'GetPatientContracts',
  `<PatientID>${patientId}</PatientID><VisitDate>${sample.sessionDate}</VisitDate>`,
);
const placementIds = ids(pc.xml, 'PlacementID');
const contractIds = [...pc.xml.matchAll(/<Contract>\s*<ID>(\d+)/g)].map((m) => Number(m[1]));
const serviceCodeIds = [...pc.xml.matchAll(/<ServiceCode>\s*<ID>(\d+)/g)].map((m) => Number(m[1]));
mark('get_patient_contracts', ok(pc), {
  summary: `placements=${placementIds.join(',')} contracts=${contractIds.join(',')} serviceCodes=${serviceCodeIds.join(',')}`,
  eid: pc.eid,
  msg: pc.msg,
  placementIds,
  contractIds,
  serviceCodeIds,
});

// 4) Authorizations
const auths = await call(
  'SearchPatientAuthorizations',
  `<SearchFilters><PatientID>${patientId}</PatientID></SearchFilters>`,
);
const authIds = ids(auths.xml, 'AuthorizationID').length
  ? ids(auths.xml, 'AuthorizationID')
  : ids(auths.xml, 'ID');
// parse auth numbers / dates if present
const authPreview = [];
const authBlocks = auths.xml.match(/<Authorization>[\s\S]*?<\/Authorization>/gi) ?? [];
for (const block of authBlocks.slice(0, 10)) {
  authPreview.push({
    id: block.match(/<(?:AuthorizationID|ID)>(\d+)/)?.[1],
    number: block.match(/<AuthorizationNumber>([^<]*)/)?.[1],
    from: block.match(/<(?:FromDate|StartDate)>([^<]*)/)?.[1],
    to: block.match(/<(?:ToDate|EndDate)>([^<]*)/)?.[1],
    serviceCodeId: block.match(/<ServiceCodeID>(\d+)/)?.[1],
  });
}
mark('search_patient_authorizations', ok(auths), {
  summary: `authCount=${authBlocks.length} ids=${authIds.slice(0, 10).join(',')}`,
  eid: auths.eid,
  msg: auths.msg,
  authPreview,
});

if (authPreview[0]?.id) {
  const ai = await call(
    'GetPatientAuthorizationInfo',
    `<AuthorizationInfo>
  <PatientID>${patientId}</PatientID>
  <AuthorizationID>${authPreview[0].id}</AuthorizationID>
</AuthorizationInfo>`,
  );
  mark('get_patient_authorization_info', ok(ai), {
    summary: ai.xml.replace(/\s+/g, ' ').slice(0, 300),
    eid: ai.eid,
    msg: ai.msg,
  });
}

// 5) Service codes for a contract
const contractId = contractIds.find((x) => x > 0) ?? contractIds[0];
if (contractId) {
  const sc = await call(
    'GetContractServiceCode',
    `<PatientID>${patientId}</PatientID>
  <ContractID>${contractId}</ContractID>
  <ScheduleType>Non-Skilled</ScheduleType>
  <IsInternalContract>0</IsInternalContract>`,
  );
  const codes = [...sc.xml.matchAll(/<ServiceCodeID>(\d+)<\/ServiceCodeID>\s*<ServiceCodeName>([^<]*)<\/ServiceCodeName>/g)].map(
    (m) => ({ id: m[1], name: m[2] }),
  );
  const otHit = codes.find((c) => /OT|Eval|97165/i.test(c.name));
  mark('get_contract_service_codes', ok(sc) || sc.eid === '0' || codes.length > 0, {
    summary: `codes=${codes.length} otLike=${otHit ? `${otHit.id}:${otHit.name}` : 'none'}`,
    eid: sc.eid,
    msg: sc.msg,
    sampleCodes: codes.slice(0, 15),
  });

  const linked = await call(
    'GetLinkedContractServiceCodes',
    `<PatientID>${patientId}</PatientID><ScheduleType>Non-Skilled</ScheduleType>`,
  );
  mark('get_linked_contract_service_codes', ok(linked), {
    summary: linked.xml.replace(/\s+/g, ' ').slice(0, 250),
    eid: linked.eid,
    msg: linked.msg,
  });
} else {
  mark('get_contract_service_codes', false, { summary: 'no contract id on placement' });
}

// 6) Caregiver search
const cg = await call(
  'SearchCaregivers',
  `<SearchFilters>
  <FirstName>${sample.providerFirst}</FirstName>
  <LastName>${sample.providerLast}</LastName>
  <Status>Active</Status>
</SearchFilters>`,
);
const caregiverIds = ids(cg.xml, 'CaregiverID');
if (!caregiverIds.length) {
  // try swapped / last only
}
mark('search_caregiver_by_name', ok(cg) && caregiverIds.length > 0, {
  summary: caregiverIds.length
    ? `CaregiverIDs=${caregiverIds.slice(0, 5).join(',')}`
    : `no id; preview=${cg.xml.replace(/\s+/g, ' ').slice(0, 250)}`,
  eid: cg.eid,
  msg: cg.msg,
  caregiverIds: caregiverIds.slice(0, 10),
});

// 7) Visits that day + time match + visit detail fields
const visits = await call(
  'SearchVisits',
  `<SearchFilters>
  <StartDate>${sample.sessionDate}</StartDate>
  <EndDate>${sample.sessionDate}</EndDate>
  <PatientID>${patientId}</PatientID>
</SearchFilters>`,
);
const visitIds = ids(visits.xml, 'VisitID');
mark('search_visits_by_patient_date', ok(visits) && visitIds.length > 0, {
  summary: `VisitIDs=${visitIds.join(',')}`,
  eid: visits.eid,
  msg: visits.msg,
  visitIds,
});

const expectedStart = toMinutes(sample.begin);
const expectedEnd = toMinutes(sample.end);
const visitDetails = [];

for (const vid of visitIds.slice(0, 5)) {
  const info = await call('GetVisitInfoV2', `<VisitInfo><ID>${vid}</ID></VisitInfo>`);
  const start =
    first(info.xml, 'VisitStartTime') ||
    first(info.xml, 'ScheduleStartTime') ||
    first(info.xml, 'EVVStartTime') ||
    '';
  const end =
    first(info.xml, 'VisitEndTime') ||
    first(info.xml, 'ScheduleEndTime') ||
    first(info.xml, 'EVVEndTime') ||
    '';
  const sMin = extractHhaTimeMinutes(start);
  const eMin = extractHhaTimeMinutes(end);
  const startDiff =
    sMin != null && expectedStart != null ? Math.abs(sMin - expectedStart) : null;
  const endDiff = eMin != null && expectedEnd != null ? Math.abs(eMin - expectedEnd) : null;
  const within5 =
    startDiff != null && endDiff != null && startDiff <= 5 && endDiff <= 5;

  const detail = {
    visitId: vid,
    ok: ok(info),
    scheduleStart: first(info.xml, 'ScheduleStartTime'),
    scheduleEnd: first(info.xml, 'ScheduleEndTime'),
    visitStart: first(info.xml, 'VisitStartTime'),
    visitEnd: first(info.xml, 'VisitEndTime'),
    evvStart: first(info.xml, 'EVVStartTime'),
    evvEnd: first(info.xml, 'EVVEndTime'),
    timesheetRequired: info.xml.match(/<Timesheet>[\s\S]*?<Required>([^<]*)/)?.[1],
    timesheetApproved: info.xml.match(/<Timesheet>[\s\S]*?<Approved>([^<]*)/)?.[1],
    caregiverFirst: info.xml.match(/<Caregiver>[\s\S]*?<FirstName>([^<]*)/)?.[1],
    caregiverLast: info.xml.match(/<Caregiver>[\s\S]*?<LastName>([^<]*)/)?.[1],
    caregiverId: info.xml.match(/<Caregiver>[\s\S]*?<ID>(\d+)/)?.[1],
    payCodeId: info.xml.match(/<PayCode>[\s\S]*?<ID>(\d+)/)?.[1],
    payCodeName: info.xml.match(/<PayCode>[\s\S]*?<Name>([^<]*)/)?.[1],
    startDiffMin: startDiff,
    endDiffMin: endDiff,
    within5,
  };
  visitDetails.push(detail);
  console.log(
    `  visit ${vid} within5=${within5} timesheet=${detail.timesheetRequired}/${detail.timesheetApproved} cg=${detail.caregiverFirst} ${detail.caregiverLast} pay=${detail.payCodeId}:${detail.payCodeName}`,
  );
}

const matched = visitDetails.find((v) => v.within5);
mark('visit_time_match_within_5_min', !!matched, {
  summary: matched
    ? `VisitID=${matched.visitId} diffs=${matched.startDiffMin}/${matched.endDiffMin} min`
    : 'no visit within 5 minutes',
  visitDetails,
});

mark('read_timesheet_flags_from_visit', !!(matched && matched.timesheetRequired != null), {
  summary: matched
    ? `Required=${matched.timesheetRequired} Approved=${matched.timesheetApproved}`
    : 'no matched visit',
});

mark('read_caregiver_from_visit', !!(matched && matched.caregiverId), {
  summary: matched
    ? `CaregiverID=${matched.caregiverId} ${matched.caregiverFirst} ${matched.caregiverLast}`
    : 'no matched visit',
});

mark('read_paycode_from_visit', !!(matched && matched.payCodeId), {
  summary: matched ? `PayCodeID=${matched.payCodeId} ${matched.payCodeName}` : 'no matched visit',
});

// 8) ConfirmVisits auth/reason lookup (read) — expect may fail -9
const reasons = await call(
  'GetVisitEditReasonActionTaken',
  `<VisitInfo><VisitId>${matched?.visitId ?? visitIds[0] ?? 0}</VisitId></VisitInfo>`,
);
mark('get_visit_edit_reason_action_taken', ok(reasons), {
  summary: 'needed for ConfirmVisits ReasonCode/ActionCode',
  eid: reasons.eid,
  msg: reasons.msg,
});

// Summary
const entries = Object.entries(results.proofs);
const passed = entries.filter(([, v]) => v.passed).length;
const failed = entries.filter(([, v]) => !v.passed).length;
results.summary = { passed, failed, total: entries.length };

const outFile = path.join(repoRoot, 'docs', 'hha-api-report-prod-proof.json');
writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`\nSummary: ${passed} pass / ${failed} fail of ${entries.length}`);
console.log('Wrote', outFile);
