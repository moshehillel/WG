/**
 * One-time read-only lookup against production HHA:
 * - Program Type → ContractID (GetContracts, name match)
 * - Service Type → ServiceCodeID (GetBillingServiceCodes per contract)
 * - DischargeTo "Home" → DischargeToID (GetPatientDischargeTo)
 *
 * Writes tmp/hha-lookup-results.json and optional config snippets.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const PROD_URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const URL = process.env.HHA_LOOKUP_URL ?? PROD_URL;
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = process.env.HHA_APP_KEY?.replace(/\s+/g, '');

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
  const status = xml.match(/Status="([^"]+)"/)?.[1];
  const eid = xml.match(/<ErrorID>([^<]*)/)?.[1];
  const msg = xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? xml.match(/<faultstring>([^<]*)/)?.[1] ?? '';
  const ok = status?.toLowerCase() === 'success' || eid === '0';
  return { ok, eid, msg, xml };
}

const norm = (s) =>
  (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\u2013/g, '-');

function parseProgramTypes(ts) {
  const block = (name) => {
    const re = new RegExp(`export const ${name}[\\s\\S]*?\\[([\\s\\S]*?)\\];`);
    const m = ts.match(re);
    if (!m) return [];
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  return [...block('EVV_PROGRAM_TYPES'), ...block('NO_EVV_PROGRAM_TYPES')];
}

/** Parse contracts from GetContracts — handles ContractID/ContractName and nested Contract/ID/Name. */
function parseContracts(xml) {
  const list = [];
  for (const m of xml.matchAll(
    /<ContractInfo>[\s\S]*?<ContractID>(\d+)<\/ContractID>[\s\S]*?<ContractName>([^<]*)<\/ContractName>/gi,
  )) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  for (const m of xml.matchAll(/<Contract>\s*<ID>(\d+)<\/ID>\s*<Name>([^<]*)<\/Name>/gi)) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  for (const m of xml.matchAll(/<ContractID>(\d+)<\/ContractID>\s*<ContractName>([^<]*)<\/ContractName>/gi)) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  return [...new Map(list.map((c) => [c.id, c])).values()];
}

/** Parse discharge destinations from GetPatientDischargeTo. */
function parseDischargeTo(xml) {
  const list = [];
  for (const m of xml.matchAll(
    /<PatientDischargeToID>(\d+)<\/PatientDischargeToID>\s*<PatientDischargeToName>([^<]*)<\/PatientDischargeToName>/gi,
  )) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  for (const m of xml.matchAll(
    /<DischargeToInfo>[\s\S]*?<DischargeToID>(\d+)<\/DischargeToID>[\s\S]*?<DischargeToName>([^<]*)<\/DischargeToName>/gi,
  )) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  for (const m of xml.matchAll(
    /<DischargeTo>\s*<ID>(\d+)<\/ID>\s*<Name>([^<]*)<\/Name>/gi,
  )) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  return [...new Map(list.map((d) => [d.id, d])).values()];
}

/** Parse service codes from GetBillingServiceCodes / GetContractServiceCode. */
function parseServiceCodes(xml) {
  const list = [];
  for (const m of xml.matchAll(
    /<ServiceCodeID>(\d+)<\/ServiceCodeID>\s*<ServiceCodeName>([^<]*)<\/ServiceCodeName>/gi,
  )) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  for (const m of xml.matchAll(/<ServiceCode>\s*<ID>(\d+)<\/ID>\s*<Name>([^<]*)<\/Name>/gi)) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  return [...new Map(list.map((s) => [s.id, s])).values()];
}

function parsePayCodes(xml) {
  const list = [];
  for (const m of xml.matchAll(
    /<PayCodeID>(\d+)<\/PayCodeID>\s*<PayCodeName>([^<]*)<\/PayCodeName>/gi,
  )) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  for (const m of xml.matchAll(/<PayCode>\s*<ID>(\d+)<\/ID>\s*<Name>([^<]*)<\/Name>/gi)) {
    list.push({ id: m[1], name: m[2].trim() });
  }
  return [...new Map(list.map((p) => [p.id, p])).values()];
}

function matchByName(needle, haystack, nameKey = 'name') {
  const n = norm(needle);
  let hit = haystack.find((x) => norm(x[nameKey]) === n);
  if (hit) return hit;
  hit = haystack.find((x) => norm(x[nameKey]).includes(n) || n.includes(norm(x[nameKey])));
  return hit;
}

console.log('READ-ONLY HHA reference lookup');
console.log('Endpoint:', URL);
console.log('');

mkdirSync(path.join(repoRoot, 'tmp'), { recursive: true });

// --- Discharge To (Q7) ---
const dis = await call('GetPatientDischargeTo', '');
writeFileSync(path.join(repoRoot, 'tmp/hha-discharge-to.xml'), dis.xml);
const dischargeEntries = parseDischargeTo(dis.xml);
const home =
  dischargeEntries.find((e) => norm(e.name) === 'home') ??
  dischargeEntries.find((e) => norm(e.name).includes('home')) ??
  dischargeEntries.find((e) => norm(e.name) === 'self/family/friend');
console.log('GetPatientDischargeTo:', dis.ok ? 'OK' : `FAIL ${dis.eid} ${dis.msg}`);
console.log('  options:', dischargeEntries.length, dischargeEntries.slice(0, 8).map((d) => `${d.id}:${d.name}`).join(', '));
console.log('  Home:', home ? `${home.id} (${home.name})` : 'NOT FOUND');

// --- Contracts / Program Types ---
const contracts = await call('GetContracts', '');
writeFileSync(path.join(repoRoot, 'tmp/hha-contracts.xml'), contracts.xml);
const contractList = parseContracts(contracts.xml);
console.log('GetContracts:', contracts.ok ? 'OK' : `FAIL ${contracts.eid}`, `count=${contractList.length}`);

const programTypes = parseProgramTypes(
  readFileSync(path.join(repoRoot, 'packages/shared/src/config/program-types.ts'), 'utf8'),
);

const programMatches = programTypes.map((pt) => {
  const match = matchByName(pt, contractList);
  return {
    programType: pt,
    contractId: match?.id,
    contractName: match?.name,
    matched: Boolean(match),
  };
});

const matchedPrograms = programMatches.filter((p) => p.matched);
const unmatchedPrograms = programMatches.filter((p) => !p.matched);
console.log('Program→Contract:', matchedPrograms.length, '/', programTypes.length);
for (const u of unmatchedPrograms.slice(0, 5)) console.log('  UNMATCHED:', u.programType);
if (unmatchedPrograms.length > 5) console.log(`  ... +${unmatchedPrograms.length - 5} more`);

// --- Service Types from sample API report ---
const apiCsv = readFileSync(path.join(repoRoot, 'docs/samples/api-report.csv'), 'utf8');
const headers = apiCsv.split(/\r?\n/)[0].split(',');
const stIdx = headers.findIndex((h) => h.toLowerCase().includes('service type'));
const serviceTypes = new Set();
for (const line of apiCsv.split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const cols = line.split(',');
  const st = cols[stIdx]?.trim();
  if (st) serviceTypes.add(st);
}

// Collect billing service codes for matched program contracts only (dedupe by id)
const allServiceCodes = new Map();
const contractsForServiceLookup = [
  ...new Map(
    matchedPrograms.map((p) => [p.contractId, { id: p.contractId, name: p.contractName }]),
  ).values(),
];
console.log('Fetching service codes for', contractsForServiceLookup.length, 'program contracts…');
for (const contract of contractsForServiceLookup) {
  for (const st of ['Skilled', 'Non-Skilled']) {
    const sc = await call(
      'GetBillingServiceCodes',
      `<ContractID>${contract.id}</ContractID><ScheduleType>${st}</ScheduleType>`,
    );
    for (const code of parseServiceCodes(sc.xml)) {
      allServiceCodes.set(code.id, code);
    }
  }
}
console.log('Unique billing service codes (sampled contracts):', allServiceCodes.size);

const serviceCodeList = [...allServiceCodes.values()];
const serviceTypeMatches = [...serviceTypes].sort().map((st) => {
  const match = matchByName(st, serviceCodeList);
  return {
    serviceType: st,
    serviceCodeId: match?.id,
    serviceCodeName: match?.name,
    matched: Boolean(match),
  };
});

const matchedServices = serviceTypeMatches.filter((s) => s.matched);
const unmatchedServices = serviceTypeMatches.filter((s) => !s.matched);
console.log('Service Type→ServiceCodeID:', matchedServices.length, '/', serviceTypeMatches.length);
for (const u of unmatchedServices.slice(0, 8)) console.log('  UNMATCHED:', u.serviceType);

// --- Pay codes (sample) ---
const pay = await call('GetCaregiverPayCodes', '');
const payCodes = parsePayCodes(pay.xml);
console.log('Pay codes:', payCodes.length);

const out = {
  lookedUpAt: new Date().toISOString(),
  hhaBaseUrl: URL,
  mode: 'read-only',
  homeDischargeTo: home,
  dischargeToOptions: dischargeEntries,
  programContractMatches: programMatches,
  programContractMap: Object.fromEntries(
    matchedPrograms.map((p) => [p.programType, Number(p.contractId)]),
  ),
  allContracts: contractList,
  serviceTypeMatches,
  serviceTypeMap: Object.fromEntries(
    matchedServices.map((s) => [s.serviceType, Number(s.serviceCodeId)]),
  ),
  unmatchedServiceTypes: unmatchedServices.map((s) => s.serviceType),
  unmatchedProgramTypes: unmatchedPrograms.map((p) => p.programType),
  payCodesSample: payCodes.slice(0, 50),
  stats: {
    contracts: contractList.length,
    programsMatched: matchedPrograms.length,
    programsTotal: programTypes.length,
    serviceTypesMatched: matchedServices.length,
    serviceTypesTotal: serviceTypeMatches.length,
    uniqueServiceCodes: serviceCodeList.length,
    payCodes: payCodes.length,
  },
};

const outPath = path.join(repoRoot, 'tmp/hha-lookup-results.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('\nWrote', outPath);

if (home) {
  console.log(`\nSuggested env: HHA_DISCHARGE_TO_ID=${home.id}`);
}
