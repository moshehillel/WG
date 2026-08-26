/**
 * HHA "field visits" sandbox probe (White Glove FNS / supervision automation).
 *
 * Read-only by default. Set HHA_PROBE_WRITES=true (or pass --write) to attempt
 * ONE CreateSchedule against the RN Supervision placement discovered at runtime.
 *
 * Loads repo-root .env if present, otherwise uses process.env (Cloud Agent
 * secrets are injected as env vars). Writes docs/field-visit-probe-results.json.
 *
 * Endpoint defaults to the SANDBOX. Writes are refused against production.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

loadEnv(path.join(repoRoot, '.env'));

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const SANDBOX_URL =
  'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const URL = process.env.HHA_BASE_URL || SANDBOX_URL;
const APP = required('HHA_APP_NAME');
const SECRET = required('HHA_APP_SECRET');
const KEY = required('HHA_APP_KEY').replace(/\s+/g, '');
const OFFICE_ID = process.env.HHA_OFFICE_ID || '1025';
const DO_WRITES =
  process.env.HHA_PROBE_WRITES === 'true' || process.argv.includes('--write');

const IS_PROD = /app\.hhaexchange\.com/i.test(URL);
if (DO_WRITES && IS_PROD) {
  console.error(
    'Refusing to run write probe against production endpoint. Point HHA_BASE_URL at the sandbox.',
  );
  process.exit(2);
}

const results = {
  testedAt: new Date().toISOString(),
  endpoint: URL,
  officeId: OFFICE_ID,
  doWrites: DO_WRITES,
  methods: {},
  discoveries: {},
};

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      )
        v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* .env optional — Cloud Agent injects secrets as env vars */
  }
}

function required(name) {
  const v = process.env[name];
  if (!v)
    throw new Error(
      `Missing ${name} — set it as a Cloud Agent secret or in repo-root .env`,
    );
  return v;
}

function escapeXml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function call(method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${escapeXml(APP)}</AppName>
        <AppSecret>${escapeXml(SECRET)}</AppSecret>
        <AppKey>${escapeXml(KEY)}</AppKey>
      </Authentication>
      ${inner}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${NS}/${method}"`,
      },
      body,
    });
    const txt = await res.text();
    const statusAttr = txt.match(/Status="([^"]+)"/i)?.[1];
    const statusTag = txt.match(/<Status>([^<]*)<\/Status>/i)?.[1];
    const eid =
      txt.match(/<ErrorID>([^<]*)<\/ErrorID>/i)?.[1] ??
      txt.match(/ErrorID>([^<]*)</i)?.[1];
    const msg =
      txt.match(/<ErrorMessage>([^<]*)<\/ErrorMessage>/i)?.[1] ??
      txt.match(/<faultstring>([^<]*)<\/faultstring>/i)?.[1] ??
      '';
    const status = statusAttr ?? statusTag ?? '';
    const ok =
      status.toLowerCase() === 'success' ||
      (String(eid) === '0' && !/failure/i.test(status));
    return { http: res.status, ok, status, eid, msg, xml: txt };
  } catch (e) {
    return { http: 0, ok: false, status: '', eid: 'ERR', msg: e.message, xml: '' };
  }
}

/** Try candidate payload shapes; return the first ok result, else the last. */
async function tryShapes(method, shapes) {
  let last;
  for (const inner of shapes) {
    last = await call(method, inner);
    if (last.ok) return last;
  }
  return last;
}

function record(name, r, notes = '') {
  const authFail = ['-5', '-8'].includes(String(r.eid));
  const notAuthorized = String(r.eid) === '-9';
  results.methods[name] = {
    ok: r.ok,
    http: r.http,
    status: r.status,
    errorId: r.eid,
    errorMessage: r.msg,
    authFailure: authFail,
    notAuthorized,
    notes,
    preview: (r.xml || '').replace(/\s+/g, ' ').slice(0, 600),
  };
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(
    `${mark.padEnd(4)} ${name.padEnd(38)} eid=${String(r.eid ?? '-').padEnd(6)} ${
      r.msg || r.status || ''
    }${notes ? ` | ${notes}` : ''}`,
  );
  return r;
}

function ids(xml, tag) {
  return [
    ...new Set(
      [...(xml || '').matchAll(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'gi'))].map(
        (m) => Number(m[1]),
      ),
    ),
  ];
}

/** Extract {id,name} pairs across several common HHA tag conventions. */
function pairs(xml, idTags, nameTags) {
  const out = [];
  const idAlt = idTags.join('|');
  const nameAlt = nameTags.join('|');
  const re = new RegExp(
    `<(?:${idAlt})>(\\d+)</(?:${idAlt})>\\s*<(?:${nameAlt})>([^<]*)</(?:${nameAlt})>`,
    'gi',
  );
  for (const m of (xml || '').matchAll(re))
    out.push({ id: Number(m[1]), name: m[2].trim() });
  // reversed order (Name then ID)
  const re2 = new RegExp(
    `<(?:${nameAlt})>([^<]*)</(?:${nameAlt})>\\s*<(?:${idAlt})>(\\d+)</(?:${idAlt})>`,
    'gi',
  );
  for (const m of (xml || '').matchAll(re2))
    out.push({ id: Number(m[2]), name: m[1].trim() });
  return [...new Map(out.map((x) => [x.id, x])).values()];
}

const norm = (s) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
function findByName(list, needle) {
  const n = norm(needle);
  return (
    list.find((x) => norm(x.name) === n) ??
    list.find((x) => norm(x.name).includes(n)) ??
    list.find((x) => n.split(' ').every((w) => norm(x.name).includes(w)))
  );
}

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const usDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

async function main() {
  console.log(`HHA field-visit probe`);
  console.log(`Endpoint: ${URL}`);
  console.log(`Office:   ${OFFICE_ID}`);
  console.log(`Writes:   ${DO_WRITES}\n`);

  // 1) Auth & basics -------------------------------------------------------
  console.log('--- 1. Auth & basics ---');
  const offices = record('GetOffices', await call('GetOffices', ''));
  const officeId = ids(offices.xml, 'OfficeID')[0] ?? Number(OFFICE_ID);

  // 2) Contracts / RN Supervision -----------------------------------------
  console.log('\n--- 2. Contracts (RN Supervision) ---');
  const contracts = record('GetContracts', await call('GetContracts', ''));
  const contractList = pairs(
    contracts.xml,
    ['ContractID', 'ID'],
    ['ContractName', 'Name'],
  );
  const rnContract =
    findByName(contractList, 'RN Supervision') ??
    findByName(contractList, 'Supervision') ??
    findByName(contractList, 'RN');
  results.discoveries.rnContract = rnContract ?? null;
  results.discoveries.allContracts = contractList;
  console.log(
    `  contracts=${contractList.length} rnSupervision=${
      rnContract ? `${rnContract.id} (${rnContract.name})` : 'NOT FOUND'
    }`,
  );

  // 3) Patients ------------------------------------------------------------
  console.log('\n--- 3. Patients / placement / service codes ---');
  const patients = record(
    'SearchPatients',
    await call(
      'SearchPatients',
      `<SearchFilters><FirstName></FirstName><LastName></LastName><Status>Active</Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN></SearchFilters>`,
    ),
  );
  const patientIds = ids(patients.xml, 'PatientID');
  results.discoveries.samplePatientIds = patientIds.slice(0, 15);

  let goodPatientId;
  for (const pid of patientIds.slice(0, 15)) {
    const demo = await call(
      'GetPatientDemographics',
      `<PatientInfo><ID>${pid}</ID></PatientInfo>`,
    );
    if (demo.ok) {
      goodPatientId = pid;
      record(`GetPatientDemographics(${pid})`, demo);
      // custom due-date fields present in demographics XML?
      const customDate = /Due|Recert|Supervision|Competency/i.test(demo.xml);
      results.discoveries.demographicsHasCustomDueDateFields = customDate;
      break;
    }
  }
  if (!goodPatientId && patientIds[0]) {
    goodPatientId = patientIds[0];
    record(
      `GetPatientDemographics(${goodPatientId})`,
      await call(
        'GetPatientDemographics',
        `<PatientInfo><ID>${goodPatientId}</ID></PatientInfo>`,
      ),
    );
  }
  results.discoveries.goodPatientId = goodPatientId ?? null;

  let placementContractId;
  let serviceCodeId;
  if (goodPatientId) {
    const pc = record(
      `GetPatientContracts(${goodPatientId})`,
      await call(
        'GetPatientContracts',
        `<PatientID>${goodPatientId}</PatientID><VisitDate>${today}</VisitDate>`,
      ),
    );
    const pcContracts = pairs(
      pc.xml,
      ['ContractID', 'ID'],
      ['ContractName', 'Name'],
    );
    results.discoveries.patientPlacements = pcContracts;
    // Prefer an RN Supervision placement if this patient has one; else the first real placement.
    const rnPlacement =
      findByName(pcContracts, 'RN Supervision') ??
      findByName(pcContracts, 'Supervision');
    placementContractId = rnPlacement?.id ?? pcContracts[0]?.id;

    // Patient-scoped service codes for the actual placement (GetContractServiceCode needs a valid patient placement).
    if (placementContractId) {
      const sc = record(
        `GetContractServiceCode(Skilled,c=${placementContractId})`,
        await call(
          'GetContractServiceCode',
          `<PatientID>${goodPatientId}</PatientID><ContractID>${placementContractId}</ContractID><ScheduleType>Skilled</ScheduleType><IsInternalContract>0</IsInternalContract>`,
        ),
      );
      const scList = pairs(sc.xml, ['ServiceCodeID', 'ID'], ['ServiceCodeName', 'Name']);
      results.discoveries.patientPlacementServiceCodes = scList;
      serviceCodeId = scList[0]?.id;
    }
  }

  // Contract-level RN Supervision service codes (no patient placement required).
  if (rnContract) {
    const bsc = record(
      `GetBillingServiceCodes(RN=${rnContract.id})`,
      await tryShapes('GetBillingServiceCodes', [
        `<BillingServiceCodeInfo><ContractID>${rnContract.id}</ContractID></BillingServiceCodeInfo>`,
        `<ContractID>${rnContract.id}</ContractID><ScheduleType>Skilled</ScheduleType>`,
      ]),
    );
    const rnScList = pairs(bsc.xml, ['ServiceCodeID', 'ID'], ['ServiceCodeName', 'Name']);
    results.discoveries.rnSupervisionServiceCodes = rnScList;
    if (!serviceCodeId) serviceCodeId = rnScList[0]?.id;
  }
  results.discoveries.placementContractId = placementContractId ?? null;
  results.discoveries.serviceCodeId = serviceCodeId ?? null;

  // GetPatientClinicalInfo — supervision / recert due dates
  if (goodPatientId) {
    const clinical = record(
      `GetPatientClinicalInfo(${goodPatientId})`,
      await tryShapes('GetPatientClinicalInfo', [
        `<PatientInfo><ID>${goodPatientId}</ID></PatientInfo>`,
        `<PatientID>${goodPatientId}</PatientID>`,
        `<ClinicalInfo><PatientID>${goodPatientId}</PatientID></ClinicalInfo>`,
      ]),
    );
    results.discoveries.clinicalDueDateFields = {
      NursingVisitsDue: /NursingVisitsDue/i.test(clinical.xml),
      MDVisitDue: /MDVisitDue/i.test(clinical.xml),
    };
  }

  // 4) Caregivers + annual competency -------------------------------------
  console.log('\n--- 4. Caregivers / annual competency ---');
  const caregivers = record(
    'SearchCaregivers',
    await call(
      'SearchCaregivers',
      `<SearchFilters><FirstName></FirstName><LastName></LastName><Status>Active</Status></SearchFilters>`,
    ),
  );
  const caregiverIds = ids(caregivers.xml, 'CaregiverID');
  results.discoveries.sampleCaregiverIds = caregiverIds.slice(0, 15);
  const cgId = caregiverIds[0];
  results.discoveries.goodCaregiverId = cgId ?? null;

  if (cgId) {
    record(
      `GetCaregiverDemographics(${cgId})`,
      await tryShapes('GetCaregiverDemographics', [
        `<CaregiverInfo><ID>${cgId}</ID></CaregiverInfo>`,
        `<CaregiverID>${cgId}</CaregiverID>`,
        `<CaregiverInfo><CaregiverID>${cgId}</CaregiverID></CaregiverInfo>`,
      ]),
    );

    const medicals = record(
      `GetCaregiverMedicals(${cgId})`,
      await tryShapes('GetCaregiverMedicals', [
        `<CaregiverID>${cgId}</CaregiverID>`,
        `<CaregiverInfo><ID>${cgId}</ID></CaregiverInfo>`,
        ``,
      ]),
    );
    const medList = pairs(
      medicals.xml,
      ['MedicalID', 'ComplianceID', 'ID'],
      ['MedicalName', 'ComplianceName', 'Name', 'Description'],
    );
    const annualCompetency =
      findByName(medList, 'annual competency') ??
      findByName(medList, 'competency');
    results.discoveries.caregiverMedicalCatalog = medList;
    results.discoveries.annualCompetency = annualCompetency ?? null;
    results.discoveries.medicalCatalogHits = medList.filter((x) =>
      /compet|annual|recert|admission|supervis|skill/i.test(x.name),
    );
    console.log(
      `  medicals=${medList.length} annualCompetency=${
        annualCompetency ? `${annualCompetency.id} (${annualCompetency.name})` : 'NOT FOUND'
      }`,
    );

    record(
      `GetCaregiverMedicalResults(${cgId})`,
      await tryShapes('GetCaregiverMedicalResults', [
        `<CaregiverID>${cgId}</CaregiverID>`,
        `<SearchFilters><CaregiverID>${cgId}</CaregiverID></SearchFilters>`,
      ]),
    );
    const firstMedicalId = medList[0]?.id;
    record(
      `GetCaregiverMedicalDetails(${cgId})`,
      await tryShapes('GetCaregiverMedicalDetails', [
        firstMedicalId
          ? `<CaregiverID>${cgId}</CaregiverID><MedicalID>${firstMedicalId}</MedicalID>`
          : `<CaregiverID>${cgId}</CaregiverID>`,
        `<SearchFilters><CaregiverID>${cgId}</CaregiverID></SearchFilters>`,
        `<CaregiverID>${cgId}</CaregiverID>`,
      ]),
    );
    record(
      `GetCaregiverMedicalDetailChanges`,
      await tryShapes('GetCaregiverMedicalDetailChanges', [
        `<SearchFilters><FromDate>${usDate(daysAgo(30))}</FromDate><ToDate>${usDate(today)}</ToDate></SearchFilters>`,
        `<FromDate>${usDate(daysAgo(30))}</FromDate><ToDate>${usDate(today)}</ToDate>`,
        `<SearchFilters><FromDate>${daysAgo(30)}</FromDate><ToDate>${today}</ToDate></SearchFilters>`,
      ]),
    );

    // 5) BOE school supervision -------------------------------------------
    console.log('\n--- 5. BOE school supervision (custom compliance) ---');
    const other = record(
      `GetCaregiverOtherCompliance(${cgId})`,
      await tryShapes('GetCaregiverOtherCompliance', [
        `<CaregiverID>${cgId}</CaregiverID>`,
        `<CaregiverInfo><ID>${cgId}</ID></CaregiverInfo>`,
        ``,
      ]),
    );
    const otherList = pairs(
      other.xml,
      ['OtherComplianceID', 'ComplianceID', 'ID'],
      ['OtherComplianceName', 'ComplianceName', 'Name', 'Description'],
    );
    const schoolSup =
      findByName(otherList, 'school supervision done') ??
      findByName(otherList, 'school supervision');
    results.discoveries.caregiverOtherComplianceCatalog = otherList;
    results.discoveries.schoolSupervisionDone = schoolSup ?? null;
    results.discoveries.otherComplianceHits = otherList.filter((x) =>
      /school|supervis|compet|annual|recert|boe|fns/i.test(x.name),
    );
    // "Annual Competency" lives under Other Compliance in this sandbox, not Medicals.
    if (!results.discoveries.annualCompetency) {
      const ac =
        findByName(otherList, 'annual competency') ??
        findByName(otherList, 'competency');
      if (ac) results.discoveries.annualCompetency = ac;
    }
    results.discoveries.supervisionComplianceCandidates = otherList.filter((x) =>
      /supervis/i.test(x.name),
    );
    console.log(
      `  otherCompliance=${otherList.length} schoolSupervisionDone=${
        schoolSup ? `${schoolSup.id} (${schoolSup.name})` : 'NOT FOUND'
      }`,
    );
    record(
      `GetCaregiverOtherComplianceResults(${cgId})`,
      await tryShapes('GetCaregiverOtherComplianceResults', [
        `<CaregiverID>${cgId}</CaregiverID>`,
        `<SearchFilters><CaregiverID>${cgId}</CaregiverID></SearchFilters>`,
      ]),
    );
  }

  // 6) Documentation & POC -------------------------------------------------
  console.log('\n--- 6. Documentation & POC ---');
  // SearchVisits requires a single-day range (eid=-497 otherwise); grid over offices/days.
  let visitId;
  let lastSearch;
  const officeList = ids(offices.xml, 'OfficeID').slice(0, 6);
  if (!officeList.length) officeList.push(Number(officeId));
  const visitDays = ['2026-07-10', daysAgo(1), daysAgo(7), daysAgo(30), daysAgo(60)];
  outer: for (const off of officeList) {
    for (const d of visitDays) {
      lastSearch = await call(
        'SearchVisits',
        `<SearchFilters><StartDate>${d}</StartDate><EndDate>${d}</EndDate><OfficeID>${off}</OfficeID></SearchFilters>`,
      );
      const vid = ids(lastSearch.xml, 'VisitID')[0];
      if (vid) {
        visitId = vid;
        results.discoveries.sampleVisit = { visitId: vid, officeId: off, day: d };
        break outer;
      }
    }
  }
  record(
    'SearchVisits(single-day)',
    lastSearch ?? { ok: false, eid: '-', msg: 'no offices', xml: '' },
    visitId ? `found visit ${visitId}` : 'searchable; no visits in sampled offices/days',
  );
  if (visitId) {
    const vi = record(
      `GetVisitInfoV2(${visitId})`,
      await call(
        'GetVisitInfoV2',
        `<VisitInfo><VisitID>${visitId}</VisitID></VisitInfo>`,
      ),
    );
    results.discoveries.visitDocFlags = {
      visitId,
      readOk: vi.ok,
      errorId: vi.eid,
      TimesheetRequired: vi.xml.match(/<TimesheetRequired>([^<]*)/i)?.[1] ?? null,
      TimesheetApproved: vi.xml.match(/<TimesheetApproved>([^<]*)/i)?.[1] ?? null,
      note: vi.ok
        ? 'timesheet flags readable'
        : 'visit found via SearchVisits but GetVisitInfoV2 returns -415 (not owned by this agency key); Timesheet* flags exist in schema but not readable for these sandbox visits',
    };
  }

  record('GetPatientDocumentType', await call('GetPatientDocumentType', ''));
  if (goodPatientId) {
    record(
      `SearchPatientDocument(${goodPatientId})`,
      await tryShapes('SearchPatientDocument', [
        `<SearchFilters><PatientID>${goodPatientId}</PatientID></SearchFilters>`,
        `<PatientID>${goodPatientId}</PatientID>`,
      ]),
    );
    record(
      `SearchPatientPOC(${goodPatientId})`,
      await tryShapes('SearchPatientPOC', [
        `<SearchFilters><PatientID>${goodPatientId}</PatientID></SearchFilters>`,
        `<PatientID>${goodPatientId}</PatientID>`,
      ]),
    );
  }
  record('GetCaregiverDocumentType', await call('GetCaregiverDocumentType', ''));
  if (results.discoveries.goodCaregiverId) {
    record(
      `SearchCaregiverDocument(${results.discoveries.goodCaregiverId})`,
      await tryShapes('SearchCaregiverDocument', [
        `<SearchFilters><CaregiverID>${results.discoveries.goodCaregiverId}</CaregiverID></SearchFilters>`,
        `<CaregiverID>${results.discoveries.goodCaregiverId}</CaregiverID>`,
      ]),
    );
  }

  // (write) CreateSchedule -------------------------------------------------
  if (DO_WRITES && goodPatientId && placementContractId && serviceCodeId) {
    console.log('\n--- CreateSchedule (WRITE) ---');
    record(
      'CreateSchedule[write]',
      await call(
        'CreateSchedule',
        `<ScheduleInfo>
  <PatientID>${goodPatientId}</PatientID>
  <ScheduleType>Skilled</ScheduleType>
  <VisitType>Daily Fixed</VisitType>
  <ScheduleDurationHours>1</ScheduleDurationHours>
  <ScheduleDurationMinutes>0</ScheduleDurationMinutes>
  <VisitDate>${today}</VisitDate>
  <ScheduleStartTime>09:00</ScheduleStartTime>
  <ScheduleEndTime>10:00</ScheduleEndTime>
  <IsScheduleTemporary>No</IsScheduleTemporary>
  <PrimaryBillTo>
    <ContractID>${placementContractId}</ContractID>
    <ServiceCodeID>${serviceCodeId}</ServiceCodeID>
    <Hours>1</Hours>
    <Minutes>0</Minutes>
  </PrimaryBillTo>
</ScheduleInfo>`,
      ),
      'created a real sandbox visit',
    );
  } else if (DO_WRITES) {
    console.log(
      `\nSKIP CreateSchedule — need patient+contract+serviceCode (patient=${goodPatientId}, contract=${placementContractId}, serviceCode=${serviceCodeId})`,
    );
  }

  // Summary ---------------------------------------------------------------
  const entries = Object.entries(results.methods);
  const pass = entries.filter(([, v]) => v.ok).length;
  const fail = entries.filter(([, v]) => !v.ok).length;
  const authFails = entries.filter(([, v]) => v.authFailure);
  const notAuthorized = entries.filter(([, v]) => v.notAuthorized);
  results.summary = {
    total: entries.length,
    pass,
    fail,
    authFailures: authFails.map(([k]) => k),
    notAuthorized_eid_minus9: notAuthorized.map(([k]) => k),
  };

  mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
  const outFile = path.join(repoRoot, 'docs', 'field-visit-probe-results.json');
  writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
  console.log(
    `\nSummary: ${pass} pass / ${fail} fail | authFailures=${authFails.length} | eid=-9=${notAuthorized.length}`,
  );
  console.log('Discoveries:', {
    rnContract: results.discoveries.rnContract,
    placementContractId: results.discoveries.placementContractId,
    serviceCodeId: results.discoveries.serviceCodeId,
    annualCompetency: results.discoveries.annualCompetency,
    schoolSupervisionDone: results.discoveries.schoolSupervisionDone,
    clinicalDueDateFields: results.discoveries.clinicalDueDateFields,
    visitDocFlags: results.discoveries.visitDocFlags,
  });
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
