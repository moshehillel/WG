/**
 * Comprehensive sandbox probe for all pipeline HHA methods.
 * Loads repo-root .env. Writes docs/hha-endpoint-probe-results.json
 *
 * Write methods: validation probe first (proves auth+schema), then
 * optional real create when enough reference IDs are discovered.
 * Set HHA_PROBE_WRITES=true to attempt real Create/Add/Confirm calls.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL =
  process.env.HHA_BASE_URL ??
  'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';

loadEnv(path.join(repoRoot, '.env'));

const APP = required('HHA_APP_NAME');
const SECRET = required('HHA_APP_SECRET');
const KEY = required('HHA_APP_KEY').replace(/\s+/g, '');
const DO_WRITES = process.env.HHA_PROBE_WRITES === 'true';

const results = {
  testedAt: new Date().toISOString(),
  endpoint: URL,
  doWrites: DO_WRITES,
  methods: {},
};

function loadEnv(file) {
  try {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function call(method, innerBody) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${escapeXml(APP)}</AppName>
        <AppSecret>${escapeXml(SECRET)}</AppSecret>
        <AppKey>${escapeXml(KEY)}</AppKey>
      </Authentication>
      ${innerBody}
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
  const txt = await res.text();
  const statusAttr = txt.match(/Status="([^"]+)"/i)?.[1];
  const statusTag = txt.match(/<Status>([^<]*)<\/Status>/i)?.[1];
  const eid =
    txt.match(/<ErrorID>([^<]*)<\/ErrorID>/i)?.[1] ??
    txt.match(/ErrorID>([^<]*)</i)?.[1];
  const msg =
    txt.match(/<ErrorMessage>([^<]*)<\/ErrorMessage>/i)?.[1] ??
    txt.match(/ErrorMessage>([^<]*)</i)?.[1] ??
    '';
  const status = statusAttr ?? statusTag ?? '';
  const ok =
    status.toLowerCase() === 'success' ||
    (String(eid) === '0' && !/failure/i.test(status));

  return {
    http: res.status,
    ok,
    status: status || undefined,
    errorId: eid,
    errorMessage: msg,
    preview: txt.replace(/\s+/g, ' ').slice(0, 400),
    bodyXml: txt,
  };
}

function record(name, need, r, notes) {
  const row = {
    need,
    http: r.http,
    ok: r.ok,
    status: r.status,
    errorId: r.errorId,
    errorMessage: r.errorMessage,
    notes,
    preview: r.preview,
  };
  results.methods[name] = row;
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(
    `${mark.padEnd(4)} ${name.padEnd(36)} eid=${String(r.errorId ?? '-').padEnd(6)} ${r.errorMessage || r.status || ''} ${notes ? `| ${notes}` : ''}`,
  );
  return r;
}

function collectIds(xml, tag) {
  const re = new RegExp(`<${tag}>(\\d+)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(Number(m[1]));
  return [...new Set(out)];
}

function firstId(xml, tags) {
  for (const tag of tags) {
    const ids = collectIds(xml, tag);
    if (ids[0]) return ids[0];
  }
  return undefined;
}

async function main() {
  console.log(`Endpoint: ${URL}`);
  console.log(`Writes enabled: ${DO_WRITES}\n`);

  // --- Reference / lookup ---
  const offices = record(
    'GetOffices',
    'reference',
    await call('GetOffices', ''),
  );
  const officeId = firstId(offices.bodyXml, ['OfficeID']) ?? 1025;

  const contracts = record(
    'GetContracts',
    'reference',
    await call('GetContracts', ''),
  );
  const contractIds = collectIds(contracts.bodyXml, 'ContractID');
  // Prefer a contract tied to office 1025 if present in preview; else first
  const contractId = contractIds.find((id) => id === 69168) ?? contractIds[0];

  const disciplines = record(
    'GetDisciplines',
    'reference',
    await call('GetDisciplines', ''),
  );
  const disciplineId = firstId(disciplines.bodyXml, ['DisciplineID']) ?? 1;

  const coordinators = record(
    'GetCoordinators',
    'reference (CreatePatient)',
    await call('GetCoordinators', '<SearchFilters />'),
  );
  const coordinatorId = firstId(coordinators.bodyXml, ['CoordinatorID', 'ID']);

  record(
    'GetSourceOfAdmissions',
    'reference (CreatePatient)',
    await call('GetSourceOfAdmissions', ''),
  );
  record(
    'GetPatientDischargeTo',
    'reference (close case)',
    await call('GetPatientDischargeTo', ''),
  );
  record(
    'GetContractDischargeReason',
    'reference (close case)',
    await call('GetContractDischargeReason', '<Status>Active</Status>'),
  );

  // --- Patients ---
  const patients = record(
    'SearchPatients(Active)',
    'find patient',
    await call(
      'SearchPatients',
      `<SearchFilters>
  <FirstName></FirstName>
  <LastName></LastName>
  <Status>Active</Status>
  <PhoneNumber></PhoneNumber>
  <AdmissionID></AdmissionID>
  <MRNumber></MRNumber>
  <SSN></SSN>
</SearchFilters>`,
    ),
  );
  const patientIds = collectIds(patients.bodyXml, 'PatientID');
  results.samplePatientIds = patientIds.slice(0, 10);

  // Try several patients until demographics/contracts succeed
  let goodPatientId;
  let goodDemoXml;
  for (const pid of patientIds.slice(0, 15)) {
    const demo = await call(
      'GetPatientDemographics',
      `<PatientInfo><ID>${pid}</ID></PatientInfo>`,
    );
    if (demo.ok) {
      goodPatientId = pid;
      goodDemoXml = demo.bodyXml;
      record(`GetPatientDemographics(${pid})`, 'patient read', demo);
      break;
    }
  }
  if (!goodPatientId && patientIds[0]) {
    record(
      `GetPatientDemographics(${patientIds[0]})`,
      'patient read',
      await call(
        'GetPatientDemographics',
        `<PatientInfo><ID>${patientIds[0]}</ID></PatientInfo>`,
      ),
    );
    goodPatientId = patientIds[0];
  }

  // GetPatientContracts — ASMX shape is flat PatientID + VisitDate (not wrapped)
  if (goodPatientId) {
    const pcFlat = await call(
      'GetPatientContracts',
      `<PatientID>${goodPatientId}</PatientID><VisitDate></VisitDate>`,
    );
    record(
      `GetPatientContracts(flat,${goodPatientId})`,
      'patient contracts',
      pcFlat,
      'ASMX flat shape',
    );

    const pcWrapped = await call(
      'GetPatientContracts',
      `<PatientContracts>
  <PatientID>${goodPatientId}</PatientID>
  <VisitDate></VisitDate>
</PatientContracts>`,
    );
    record(
      `GetPatientContracts(wrapped,${goodPatientId})`,
      'patient contracts',
      pcWrapped,
      'legacy wrapped shape',
    );

    // try other patients if flat failed agency mismatch
    if (!pcFlat.ok) {
      for (const pid of patientIds.slice(0, 20)) {
        if (pid === goodPatientId) continue;
        const r = await call(
          'GetPatientContracts',
          `<PatientID>${pid}</PatientID><VisitDate></VisitDate>`,
        );
        if (r.ok) {
          goodPatientId = pid;
          record(`GetPatientContracts(flat,${pid})`, 'patient contracts', r, 'found agency-valid patient');
          break;
        }
      }
    }
  }

  // Service codes (need PatientID + ContractID per ASMX)
  if (goodPatientId) {
    record(
      `GetContractServiceCode(p=${goodPatientId},c=${contractId})`,
      'service codes',
      await call(
        'GetContractServiceCode',
        `<PatientID>${goodPatientId}</PatientID>
  <ContractID>${contractId}</ContractID>
  <ScheduleType></ScheduleType>
  <IsInternalContract>0</IsInternalContract>`,
      ),
    );
    record(
      `GetBillingServiceCodes(${contractId})`,
      'service codes',
      await call(
        'GetBillingServiceCodes',
        `<BillingServiceCodeInfo><ContractID>${contractId}</ContractID></BillingServiceCodeInfo>`,
      ),
    );
    record(
      `GetLinkedContractServiceCodes(p=${goodPatientId})`,
      'service codes',
      await call(
        'GetLinkedContractServiceCodes',
        `<PatientID>${goodPatientId}</PatientID><ScheduleType></ScheduleType>`,
      ),
    );
  }

  // Authorizations
  if (goodPatientId) {
    const auths = await call(
      'SearchPatientAuthorizations',
      `<SearchFilters><PatientID>${goodPatientId}</PatientID></SearchFilters>`,
    );
    record(
      `SearchPatientAuthorizations(${goodPatientId})`,
      'authorizations',
      auths,
    );
    const authId = firstId(auths.bodyXml, ['AuthorizationID', 'ID']);
    if (authId) {
      record(
        `GetPatientAuthorizationInfo(${goodPatientId},${authId})`,
        'authorizations',
        await call(
          'GetPatientAuthorizationInfo',
          `<AuthorizationInfo>
  <PatientID>${goodPatientId}</PatientID>
  <AuthorizationID>${authId}</AuthorizationID>
</AuthorizationInfo>`,
        ),
      );
    } else {
      results.methods[`GetPatientAuthorizationInfo`] = {
        need: 'authorizations',
        ok: false,
        skipped: true,
        notes: 'no AuthorizationID from search',
      };
      console.log('SKIP GetPatientAuthorizationInfo                  | no auth id');
    }
  }

  // Visits — omit CaregiverID=0 (that caused Invalid caregiver ID)
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 90);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  let visitId;
  if (goodPatientId) {
    const visits = await call(
      'SearchVisits',
      `<SearchFilters>
  <StartDate>${startDate}</StartDate>
  <EndDate>${endDate}</EndDate>
  <PatientID>${goodPatientId}</PatientID>
  <OfficeID>${officeId}</OfficeID>
</SearchFilters>`,
    );
    record(
      `SearchVisits(patient=${goodPatientId})`,
      'visits',
      visits,
      'no CaregiverID (omit 0)',
    );
    visitId = firstId(visits.bodyXml, ['VisitID', 'ID']);
  }

  if (!visitId) {
    // office-wide search
    const visitsOffice = await call(
      'SearchVisits',
      `<SearchFilters>
  <StartDate>${startDate}</StartDate>
  <EndDate>${endDate}</EndDate>
  <OfficeID>${officeId}</OfficeID>
</SearchFilters>`,
    );
    record(
      `SearchVisits(office=${officeId})`,
      'visits',
      visitsOffice,
    );
    visitId = firstId(visitsOffice.bodyXml, ['VisitID', 'ID']);
  }

  if (visitId) {
    record(
      `GetVisitInfoV2(${visitId})`,
      'visit/EVV read',
      await call(
        'GetVisitInfoV2',
        `<VisitInfo><VisitID>${visitId}</VisitID></VisitInfo>`,
      ),
    );
    record(
      `GetVisitInfoV3(${visitId})`,
      'visit/EVV read',
      await call('GetVisitInfoV3', `<VisitInfo><ID>${visitId}</ID></VisitInfo>`),
    );
  } else {
    console.log('SKIP GetVisitInfoV2/V3                              | no visit id');
  }

  // --- Write validation probes (incomplete payloads → expect field errors, NOT auth -5/-8) ---
  console.log('\n--- Write validation probes (expect business/validation errors, not auth) ---');

  const writeProbes = [
    [
      'CreatePatient',
      'create patient',
      `<PatientInfo>
  <OfficeID>${officeId}</OfficeID>
  <FirstName>WGProbe</FirstName>
  <LastName>TestOnly</LastName>
</PatientInfo>`,
    ],
    [
      'UpdatePatientDemographics',
      'update patient',
      `<PatientInfo>
  <PatientID>${goodPatientId ?? 1}</PatientID>
  <FirstName></FirstName>
</PatientInfo>`,
    ],
    [
      'AddPatientContract',
      'add placement',
      `<PatientContractInfo>
  <PatientID>${goodPatientId ?? 1}</PatientID>
  <ContractID>${contractId}</ContractID>
  <StartDate>${endDate}</StartDate>
</PatientContractInfo>`,
    ],
    [
      'UpdatePatientContract',
      'close/discharge',
      `<PatientContractInfo>
  <PatientID>${goodPatientId ?? 1}</PatientID>
  <PlacementID>1</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>${endDate}</DischargeDate>
</PatientContractInfo>`,
    ],
    [
      'CreatePatientAuthorization',
      'create auth',
      `<CreateAuthorizationInfo>
  <PatientID>${goodPatientId ?? 1}</PatientID>
  <ContractID>${contractId}</ContractID>
  <DisciplineID>${disciplineId}</DisciplineID>
  <AuthorizationNumber>WG-PROBE-001</AuthorizationNumber>
  <FromDate>${startDate}</FromDate>
  <ToDate>${endDate}</ToDate>
</CreateAuthorizationInfo>`,
    ],
    [
      'UpdatePatientAuthorization',
      'update auth',
      `<UpdateAuthorizationInfo>
  <AuthorizationID>1</AuthorizationID>
  <AuthorizationNumber>WG-PROBE</AuthorizationNumber>
</UpdateAuthorizationInfo>`,
    ],
    [
      'CreateSchedule',
      'schedule visit',
      `<ScheduleInfo>
  <PatientID>${goodPatientId ?? 1}</PatientID>
  <VisitDate>${endDate}</VisitDate>
  <ScheduleStartTime>09:00</ScheduleStartTime>
  <ScheduleEndTime>11:00</ScheduleEndTime>
</ScheduleInfo>`,
    ],
    [
      'UpdateSchedule',
      'update schedule',
      `<ScheduleInfo>
  <VisitID>${visitId ?? 1}</VisitID>
  <ScheduleStartTime>09:00</ScheduleStartTime>
</ScheduleInfo>`,
    ],
    [
      'ConfirmVisits',
      'approve visit',
      `<VisitInfo>
  <VisitID>${visitId ?? 1}</VisitID>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>Yes</TimesheetApproved>
</VisitInfo>`,
    ],
    [
      'ConfirmVisitsV2',
      'approve visit v2',
      `<VisitV2Info>
  <VisitID>${visitId ?? 1}</VisitID>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>Yes</TimesheetApproved>
</VisitV2Info>`,
    ],
  ];

  for (const [method, need, body] of writeProbes) {
    const r = await call(method, body);
    const authFail = ['-5', '-8'].includes(String(r.errorId));
    record(
      `${method}[validation]`,
      need,
      r,
      authFail
        ? 'AUTH FAILURE'
        : r.ok
          ? 'unexpected success with minimal payload'
          : 'reachable (validation/business error — auth OK)',
    );
  }

  // --- Optional real writes ---
  if (DO_WRITES && goodPatientId && coordinatorId) {
    console.log('\n--- Real write attempts (HHA_PROBE_WRITES=true) ---');
    const create = await call(
      'CreatePatient',
      `<PatientInfo>
  <OfficeID>${officeId}</OfficeID>
  <FirstName>WGAuto</FirstName>
  <LastName>Probe${Date.now().toString().slice(-6)}</LastName>
  <BirthDate>1990-01-15</BirthDate>
  <Gender>Male</Gender>
  <CoordinatorID1>${coordinatorId}</CoordinatorID1>
  <AdmissionID>WGPROBE${Date.now().toString().slice(-8)}</AdmissionID>
  <AllowDuplicate>1</AllowDuplicate>
  <Addresses>
    <Address>
      <Address1>1 Test St</Address1>
      <City>Brooklyn</City>
      <State>NY</State>
      <ZipCode>11201</ZipCode>
    </Address>
  </Addresses>
</PatientInfo>`,
    );
    record('CreatePatient[real]', 'create patient', create);
  } else if (DO_WRITES) {
    console.log(
      `\nSKIP real CreatePatient — need patient/coordinator (patient=${goodPatientId}, coordinator=${coordinatorId})`,
    );
  }

  results.discovered = {
    officeId,
    contractId,
    disciplineId,
    coordinatorId: coordinatorId ?? null,
    goodPatientId: goodPatientId ?? null,
    visitId: visitId ?? null,
  };

  // Summary
  const entries = Object.entries(results.methods);
  const pass = entries.filter(([, v]) => v.ok).length;
  const fail = entries.filter(([, v]) => v.ok === false && !v.skipped).length;
  const authFails = entries.filter(([, v]) =>
    ['-5', '-8'].includes(String(v.errorId)),
  );

  results.summary = {
    total: entries.length,
    pass,
    fail,
    authFailures: authFails.length,
    note:
      authFails.length === 0
        ? 'No auth failures — all methods reachable with PROD key on sandbox'
        : 'Some auth failures',
  };

  const outDir = path.join(repoRoot, 'docs');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'hha-endpoint-probe-results.json');
  // strip full bodyXml from stored methods (already only preview)
  writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nWrote ${outFile}`);
  console.log(
    `Summary: ${pass} pass / ${fail} fail / ${authFails.length} auth failures (of ${entries.length})`,
  );
  console.log('Discovered IDs:', results.discovered);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
