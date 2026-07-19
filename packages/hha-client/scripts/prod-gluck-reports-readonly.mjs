/**
 * Read-only HHA production tests using samples from Gluck open / closure / discharge service.
 * No Create / Update / Confirm calls.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

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

function loadCsv(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  });
}

function splitName(raw) {
  const n = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!n) return { firstName: '', lastName: '' };
  const parts = n.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  // Reports look like "Last First" or "Last  First Middle"
  return { lastName: parts[0], firstName: parts.slice(1).join(' ') };
}

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

function pickSamples(rows, getProgramType, n = 3) {
  const nonEi = rows.filter((r) => !/early intervention/i.test(getProgramType(r) || ''));
  const ei = rows.filter((r) => /early intervention/i.test(getProgramType(r) || ''));
  const out = [];
  for (const pool of [nonEi, ei]) {
    for (const r of pool) {
      if (out.length >= n) break;
      const pid = String(r['Program Id'] || r['Program ID'] || '').trim();
      if (!pid) continue;
      if (out.some((x) => x.programId === pid)) continue;
      out.push(r);
    }
  }
  return out.slice(0, n);
}

async function findPatient(programId, childName) {
  const { firstName, lastName } = splitName(childName);
  const attempts = [];
  const variants = [
    ['AdmissionID exact', programId, null, null, null],
    ['AdmissionID no leading 0', String(Number(programId)), null, null, null],
    ['MRNumber no leading 0', null, String(Number(programId)), null, null],
    ['MRNumber exact', null, programId, null, null],
    ['Name', null, null, firstName, lastName],
  ];

  let found = [];
  for (const [label, admissionId, mrNumber, fn, ln] of variants) {
    const r = await call(
      'SearchPatients',
      `<SearchFilters>
  <FirstName>${fn ?? ''}</FirstName>
  <LastName>${ln ?? ''}</LastName>
  <Status></Status>
  <PhoneNumber></PhoneNumber>
  <AdmissionID>${admissionId ?? ''}</AdmissionID>
  <MRNumber>${mrNumber ?? ''}</MRNumber>
  <SSN></SSN>
</SearchFilters>`,
    );
    const patientIds = ids(r.xml, 'PatientID');
    attempts.push({
      label,
      ok: ok(r),
      eid: r.eid,
      msg: r.msg,
      patientIds: patientIds.slice(0, 5),
    });
    if (patientIds.length && !found.length) found = patientIds;
  }
  return { found, attempts, firstName, lastName };
}

async function probePatient(patientId, visitDate) {
  const demo = await call('GetPatientDemographics', `<PatientInfo><ID>${patientId}</ID></PatientInfo>`);
  const date = visitDate || new Date().toISOString().slice(0, 10);
  const contracts = await call(
    'GetPatientContracts',
    `<PatientID>${patientId}</PatientID><VisitDate>${date}</VisitDate>`,
  );
  const auths = await call(
    'SearchPatientAuthorizations',
    `<SearchFilters><PatientID>${patientId}</PatientID></SearchFilters>`,
  );
  const authBlocks = auths.xml.match(/<Authorization>[\s\S]*?<\/Authorization>/gi) ?? [];
  const authPreview = authBlocks.slice(0, 5).map((block) => ({
    id: block.match(/<(?:AuthorizationID|ID)>(\d+)/)?.[1],
    number: block.match(/<AuthorizationNumber>([^<]*)/)?.[1],
    from: block.match(/<(?:FromDate|StartDate)>([^<]*)/)?.[1],
    to: block.match(/<(?:ToDate|EndDate)>([^<]*)/)?.[1],
    serviceCodeId: block.match(/<ServiceCodeID>(\d+)/)?.[1],
  }));

  return {
    demographics: {
      ok: ok(demo),
      eid: demo.eid,
      msg: demo.msg,
      firstName: first(demo.xml, 'FirstName'),
      lastName: first(demo.xml, 'LastName'),
      birthDate: first(demo.xml, 'BirthDate'),
      admissionId: first(demo.xml, 'AdmissionID'),
      mrNumber: first(demo.xml, 'MRNumber'),
      officeId: first(demo.xml, 'OfficeID'),
    },
    contracts: {
      ok: ok(contracts),
      eid: contracts.eid,
      msg: contracts.msg,
      placementIds: ids(contracts.xml, 'PlacementID'),
      contractIds: [...contracts.xml.matchAll(/<Contract>\s*<ID>(\d+)/g)].map((m) => Number(m[1])),
      serviceCodeIds: [...contracts.xml.matchAll(/<ServiceCode>\s*<ID>(\d+)/g)].map((m) =>
        Number(m[1]),
      ),
    },
    authorizations: {
      ok: ok(auths),
      eid: auths.eid,
      msg: auths.msg,
      count: authBlocks.length,
      preview: authPreview,
    },
  };
}

const results = {
  testedAt: new Date().toISOString(),
  endpoint: URL,
  mode: 'read-only',
  reports: {},
};

console.log('READ-ONLY production tests');
console.log('Endpoint:', URL);

// ---- OPEN ----
const openRows = loadCsv('C:\\Users\\Moshe\\Downloads\\Gluck open (1).csv');
const openSamples = pickSamples(openRows, (r) => r['Program Type'], 4);
results.reports.open = { sampleCount: openSamples.length, samples: [] };
console.log('\n=== GLUCK OPEN ===');

for (const row of openSamples) {
  const programId = String(row['Program Id']).trim();
  const childName = row["Child's Name"];
  const programType = row['Program Type'];
  const serviceType = row['Service Type'];
  const intake = row['Date of Intake'];
  const begin = row['Service Begin Date'];
  console.log(`\nOpen sample ProgramId=${programId} name=${childName} type=${programType} service=${serviceType}`);

  const found = await findPatient(programId, childName);
  const entry = {
    programId,
    childName,
    programType,
    serviceType,
    dateOfIntake: intake,
    serviceBegin: begin,
    serviceEnd: row['Service End Date'],
    patientLookup: found.attempts,
    patientIds: found.found.slice(0, 5),
  };

  if (found.found[0]) {
    entry.hha = await probePatient(found.found[0], begin || undefined);
    console.log(
      `  FOUND patient=${found.found[0]} placements=${entry.hha.contracts.placementIds.join(',')} auths=${entry.hha.authorizations.count}`,
    );
  } else {
    console.log('  NOT FOUND in HHA');
  }
  results.reports.open.samples.push(entry);
}

// ---- CLOSURE ----
const closeRows = loadCsv('C:\\Users\\Moshe\\Downloads\\gluck closure.csv');
// prefer recent closures
const closeSorted = [...closeRows].sort((a, b) =>
  String(b['Closure Date'] || '').localeCompare(String(a['Closure Date'] || '')),
);
const closeSamples = pickSamples(closeSorted, (r) => r['Program Type'], 4);
results.reports.closure = { sampleCount: closeSamples.length, samples: [] };
console.log('\n=== GLUCK CLOSURE ===');

for (const row of closeSamples) {
  const programId = String(row['Program Id']).trim();
  const childName = row["Child's Name"];
  const programType = row['Program Type'];
  const closureDate = row['Closure Date'];
  console.log(`\nClosure sample ProgramId=${programId} name=${childName} closed=${closureDate} type=${programType}`);

  const found = await findPatient(programId, childName);
  const entry = {
    programId,
    childName,
    programType,
    closureDate,
    patientLookup: found.attempts,
    patientIds: found.found.slice(0, 5),
  };

  if (found.found[0]) {
    // use closure date for contracts context
    const iso = closureDate.includes('/')
      ? (() => {
          const [m, d, y] = closureDate.split('/');
          return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        })()
      : closureDate;
    entry.hha = await probePatient(found.found[0], iso);
    const discharged = (entry.hha.contracts.placementIds || []).length;
    console.log(
      `  FOUND patient=${found.found[0]} placements=${entry.hha.contracts.placementIds.join(',')} auths=${entry.hha.authorizations.count}`,
    );
    entry.note = discharged
      ? 'Patient still has placements on/near closure date — discharge fields need visual check in XML if DischargeDate set'
      : 'No placements returned for that date';
  } else {
    console.log('  NOT FOUND in HHA');
  }
  results.reports.closure.samples.push(entry);
}

// ---- DISCHARGE SERVICE ----
const discRows = loadCsv('C:\\Users\\Moshe\\Downloads\\discharge service.csv');
const discSorted = [...discRows].sort((a, b) =>
  String(b['Service Discharge Date'] || '').localeCompare(String(a['Service Discharge Date'] || '')),
);
const discSamples = pickSamples(discSorted, (r) => r['Program Type'], 4);
results.reports.dischargeService = { sampleCount: discSamples.length, samples: [] };
console.log('\n=== DISCHARGE SERVICE ===');

for (const row of discSamples) {
  const programId = String(row['Program Id']).trim();
  const childName = row["Child's Name"];
  const programType = row['Program Type'];
  const serviceType = row['Service Type'];
  const dischargeDate = row['Service Discharge Date'];
  const begin = row['Service Begin Date'];
  const end = row['Service End Date'];
  console.log(
    `\nDischarge sample ProgramId=${programId} name=${childName} service=${serviceType} discharged=${dischargeDate}`,
  );

  const found = await findPatient(programId, childName);
  const entry = {
    programId,
    childName,
    programType,
    serviceType,
    serviceBegin: begin,
    serviceEnd: end,
    serviceDischargeDate: dischargeDate,
    providerName: row['Provider Name'],
    patientLookup: found.attempts,
    patientIds: found.found.slice(0, 5),
  };

  if (found.found[0]) {
    const iso = begin?.includes('/')
      ? (() => {
          const [m, d, y] = begin.split('/');
          return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        })()
      : begin;
    entry.hha = await probePatient(found.found[0], iso || undefined);
    const authMatch = (entry.hha.authorizations.preview || []).filter((a) => a.id);
    entry.authMatchHint = {
      authCount: entry.hha.authorizations.count,
      canListAuths: entry.hha.authorizations.ok,
      note: 'Service Type name match to HHA ServiceCodeID still needs mapping table; AuthID list available for update targeting once mapped',
      authPreview: authMatch,
    };
    console.log(
      `  FOUND patient=${found.found[0]} placements=${entry.hha.contracts.placementIds.join(',')} auths=${entry.hha.authorizations.count}`,
    );
  } else {
    console.log('  NOT FOUND in HHA');
  }
  results.reports.dischargeService.samples.push(entry);
}

// summary
function summarize(report) {
  const samples = report.samples || [];
  const found = samples.filter((s) => (s.patientIds || []).length > 0).length;
  return { samples: samples.length, patientsFound: found, patientsMissing: samples.length - found };
}

results.summary = {
  open: summarize(results.reports.open),
  closure: summarize(results.reports.closure),
  dischargeService: summarize(results.reports.dischargeService),
};

const outFile = path.join(repoRoot, 'docs', 'hha-gluck-reports-prod-readonly.json');
writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(results.summary, null, 2));
console.log('Wrote', outFile);
