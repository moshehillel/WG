/** Parse SESIS awarded-mandate rows and match them to Bids cases/bids. */

import { mapDiscipline, mapLanguage, normalizeCode, stableCaseId, childInitials, hoursFromMandate, areaInAddress } from './import-cases.js';
import { normalizeAwardStatus } from './boe-status.js';

export function detectAwardedHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const cells = (rows[i] || []).map((cell) => String(cell).toLowerCase());
    if (cells.includes('student id') && cells.includes('service type')) return i;
  }
  return 0;
}

export function rowToAwarded(row, program) {
  const discipline = mapDiscipline(row['Service Type'] || row.serviceType);
  if (!discipline) return null;
  const nycId = String(row['Student ID'] || row.nycId || '').replace(/\D/g, '');
  if (!nycId) return null;
  const adminDbn = String(row['Admin DBN'] || '').trim();
  const buildingCode = String(row['Phys Site Bldg Code'] || '').trim();
  const providerName = String(row.Provider || row['Assigned Provider'] || '').trim();
  const schoolName = String(row['School Name'] || '').trim();
  const frequency = String(row.Freq || row['Remaining Freq'] || '');
  const duration = String(row.Dur || '');
  const caseId = stableCaseId({ nycId, buildingCode, adminDbn, discipline });
  return {
    caseId,
    program: program === 'preschool' ? 'preschool' : 'school-age',
    nycId,
    child: childInitials(row['First Name'], row['Last Name']),
    adminDbn,
    buildingCode,
    schoolName,
    discipline,
    language: mapLanguage(row.Lang || row.Language),
    hoursPerWeek: hoursFromMandate(frequency, duration) || 1,
    providerName,
    mandateId: String(row['Mandate ID'] || '').trim(),
    assignmentId: String(row['Assignment ID'] || '').trim(),
    assignStatus: String(row['Assign.Status'] || row['Mandate Status'] || '').trim(),
    serviceStartDate: String(row['Service Start Date'] || '').trim(),
    firstAttendDate: String(row['First Attend Date'] || '').trim(),
    caseload: `${childInitials(row['First Name'], row['Last Name'])}, ${program === 'preschool' ? 'preschool' : 'school age'}, ${discipline}`,
    awardDate: String(row['Service Start Date'] || row['Finalized On'] || new Date().toISOString().slice(0, 10)).slice(0, 20),
    source: 'awarded-report',
  };
}

export function parseAwardedRows(preschoolRows, schoolAgeRows) {
  const out = [];
  for (const row of preschoolRows || []) {
    const item = rowToAwarded(row, 'preschool');
    if (item) out.push(item);
  }
  for (const row of schoolAgeRows || []) {
    const item = rowToAwarded(row, 'school-age');
    if (item) out.push(item);
  }
  return out;
}

function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function matchProviderId(providerName, people) {
  const want = normName(providerName);
  if (!want) return '';
  const list = Array.isArray(people) ? people : Object.values(people || {});
  const exact = list.find((who) => normName(who.name) === want);
  if (exact) return exact.id;
  const parts = want.split(' ');
  const last = parts[parts.length - 1];
  const soft = list.find((who) => {
    const have = normName(who.name);
    return have.includes(want) || want.includes(have) || (last && have.endsWith(last));
  });
  return soft?.id || '';
}

export function matchAwardedToState(awardedRows, { cases = [], bids = [], people = {} } = {}) {
  const caseById = new Map(cases.map((row) => [row.id || row.caseId, row]));
  const caseByNyc = new Map();
  for (const row of cases) {
    if (row.nycId) caseByNyc.set(`${row.nycId}|${row.discipline}`, row);
  }
  const bidByCase = new Map(bids.map((bid) => [bid.caseId, bid]));
  const matched = [];
  const unmatched = [];
  for (const row of awardedRows) {
    const existing = caseById.get(row.caseId) || caseByNyc.get(`${row.nycId}|${row.discipline}`);
    const caseId = existing?.id || existing?.caseId || row.caseId;
    const bid = bidByCase.get(caseId);
    const personId = bid?.personId || matchProviderId(row.providerName, people);
    const hasProvider = Boolean(personId);
    matched.push({
      ...row,
      caseId,
      personId: personId || '',
      matchedBid: Boolean(bid),
      status: hasProvider ? 'awarded-confirmed-provider' : 'awarded-pending-provider',
      existingCase: Boolean(existing),
    });
    if (!existing) unmatched.push(row.caseId);
  }
  return { matched, createdCaseIds: unmatched };
}

export function awardRecordFromMatch(row) {
  return {
    caseId: row.caseId,
    personId: row.personId || '',
    providerName: row.providerName || '',
    schoolName: row.schoolName || '',
    caseload: row.caseload || '',
    discipline: row.discipline,
    transmittals: 1,
    awardDate: row.awardDate,
    status: normalizeAwardStatus(row.status),
    source: 'awarded-report',
    mandateId: row.mandateId || '',
    assignmentId: row.assignmentId || '',
    nycId: row.nycId,
    program: row.program,
  };
}

export function caseShellFromAwarded(row) {
  const address = '';
  return {
    id: row.caseId,
    caseId: row.caseId,
    program: row.program,
    child: row.child,
    nycId: row.nycId,
    schoolCode: normalizeCode(row.buildingCode) || normalizeCode(row.adminDbn) || row.caseId,
    adminDbn: row.adminDbn,
    buildingCode: row.buildingCode,
    schoolName: row.schoolName,
    address,
    area: areaInAddress(address),
    building: row.buildingCode || '',
    discipline: row.discipline,
    hoursPerWeek: row.hoursPerWeek,
    service: `${row.discipline}, ${row.hoursPerWeek} hrs/week`,
    language: row.language || '',
    source: 'sesis',
    audience: 'either',
    mandateId: row.mandateId || '',
    assignmentId: row.assignmentId || '',
  };
}
