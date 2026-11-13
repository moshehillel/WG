/** Parse SESIS available-bid rows into Bids cases. No login, no place-bid. */

export const AREAS = ['Borough Park', 'Midwood', 'Flatbush', 'Williamsburg'];

const DISCIPLINE_MAP = [
  [/occupational|\bot\b/i, 'OT'],
  [/physical|\bpt\b/i, 'PT'],
  [/speech|language|\bslp\b/i, 'SLP'],
];

export function areaInAddress(address) {
  const text = String(address || '').toLowerCase();
  return AREAS.find((area) => text.includes(area.toLowerCase())) || '';
}

export function mapDiscipline(serviceType) {
  const text = String(serviceType || '');
  for (const [re, code] of DISCIPLINE_MAP) {
    if (re.test(text)) return code;
  }
  return '';
}

export function mapLanguage(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const known = {
    english: 'English',
    spanish: 'Spanish',
    yiddish: 'Yiddish',
    hebrew: 'Hebrew',
    russian: 'Russian',
    chinese: 'Chinese',
    mandarin: 'Chinese',
    cantonese: 'Chinese',
  };
  return known[text.toLowerCase()] || text.slice(0, 40);
}

export function parseFrequency(value) {
  const text = String(value || '');
  const match = text.match(/(\d+)\s*x/i);
  return match ? Number(match[1]) : 0;
}

export function parseDurationHours(value) {
  const text = String(value || '');
  const minutes = text.match(/(\d+)\s*min/i);
  if (minutes) return Number(minutes[1]) / 60;
  const hours = text.match(/(\d+(?:\.\d+)?)\s*hr/i);
  if (hours) return Number(hours[1]);
  return 0;
}

export function hoursFromMandate(frequency, duration) {
  const hours = parseFrequency(frequency) * parseDurationHours(duration);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 100) / 100;
}

export function normalizeCode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase().slice(0, 40);
}

export function childInitials(firstName, lastName) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  const a = first ? first[0].toUpperCase() : '?';
  const b = last ? last[0].toUpperCase() : '?';
  return `${a}. ${b}.`;
}

export function stableCaseId({ nycId, buildingCode, adminDbn, discipline }) {
  const place = normalizeCode(buildingCode) || normalizeCode(adminDbn) || 'NA';
  const student = String(nycId || '').replace(/\D/g, '').slice(0, 12) || '0';
  return `S${student}-${place}-${discipline}`;
}

export function groupKey(row) {
  return [
    row.responseDueBy || '',
    row.address || '',
    row.language || '',
    row.discipline || '',
    row.adminDbn || '',
    row.buildingCode || '',
    row.program || '',
  ].join('|');
}

export function buildAddressIndex(rows) {
  const byDbn = new Map();
  const byBuilding = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const address = String(row['Street Address'] || row.address || '').trim();
    if (!address) continue;
    const name = String(row['School Name'] || row.schoolName || '').trim();
    const dbn = normalizeCode(row['Admin DBN'] || row.adminDbn);
    const building = normalizeCode(row['Phys Site Bldg Code'] || row.buildingCode);
    const entry = { address, schoolName: name, source: String(row['Address Source'] || row.addressSource || '') };
    if (dbn) byDbn.set(dbn, entry);
    if (building) byBuilding.set(building, entry);
  }
  return { byDbn, byBuilding };
}

export function resolveAddress(row, index) {
  const dbn = normalizeCode(row['Admin DBN'] || row.adminDbn);
  const building = normalizeCode(row['Phys Site Bldg Code'] || row.buildingCode);
  const hit = (dbn && index.byDbn.get(dbn)) || (building && index.byBuilding.get(building)) || null;
  return hit || { address: '', schoolName: '', source: '' };
}

function isBidRow(row) {
  const status = String(row['Bid Status'] || row.bidStatus || '').toLowerCase();
  if (status && status !== 'in progress') return false;
  const nycId = String(row['Student NYCID'] || row.nycId || '').trim();
  return Boolean(nycId);
}

export function rowToCase(row, { program, addressIndex, importedAt }) {
  if (!isBidRow(row)) return null;
  const discipline = mapDiscipline(row['Service Type'] || row.serviceType || row.Service);
  if (!discipline) return null;
  const nycId = String(row['Student NYCID'] || row.nycId || '').trim();
  const adminDbn = String(row['Admin DBN'] || row.adminDbn || '').trim();
  const buildingCode = String(row['Phys Site Bldg Code'] || row.buildingCode || '').trim();
  const place = resolveAddress({ 'Admin DBN': adminDbn, 'Phys Site Bldg Code': buildingCode }, addressIndex);
  const frequency = String(row['Remaining Frequency'] || row.frequency || '');
  const duration = String(row.Duration || row.duration || '');
  const sessionType = String(row['Individual/Group'] || row.sessionType || '');
  const hoursPerWeek = hoursFromMandate(frequency, duration);
  const language = mapLanguage(row.Language || row.language);
  const schoolName = place.schoolName || adminDbn || buildingCode || 'School';
  const address = place.address || '';
  const area = areaInAddress(address);
  const id = stableCaseId({ nycId, buildingCode, adminDbn, discipline });
  const groupSessions = /group/i.test(sessionType) ? 1 : 0;
  const individualSessions = /individual/i.test(sessionType) ? 1 : 0;
  const item = {
    id,
    caseId: id,
    program: program === 'preschool' ? 'preschool' : 'school-age',
    child: childInitials(row['First Name'], row['Last Name']),
    nycId,
    schoolCode: normalizeCode(buildingCode) || normalizeCode(adminDbn) || id,
    adminDbn,
    buildingCode,
    schoolName,
    address,
    addressSource: place.source || '',
    area,
    building: buildingCode || '',
    discipline,
    hoursPerWeek: hoursPerWeek || 1,
    service: `${discipline}, ${frequency || 'mandate'}${duration ? `, ${duration}` : ''}`.slice(0, 120),
    language,
    responseDueBy: String(row['Response Due By'] || row.responseDueBy || '').slice(0, 40),
    sessionType,
    groupSize: Number(row['Group Size'] || row.groupSize) || null,
    groupSessions,
    individualSessions,
    source: 'sesis',
    audience: 'either',
    importedAt: importedAt || new Date().toISOString(),
  };
  item.groupKey = groupKey(item);
  return item;
}

export function mergeCaseLines(lines) {
  const byId = new Map();
  for (const row of lines) {
    if (!row) continue;
    const current = byId.get(row.id);
    if (!current) {
      byId.set(row.id, { ...row });
      continue;
    }
    current.hoursPerWeek = Math.round((Number(current.hoursPerWeek) + Number(row.hoursPerWeek)) * 100) / 100;
    current.groupSessions = (current.groupSessions || 0) + (row.groupSessions || 0);
    current.individualSessions = (current.individualSessions || 0) + (row.individualSessions || 0);
    if (!current.address && row.address) {
      current.address = row.address;
      current.addressSource = row.addressSource;
      current.area = row.area;
      current.schoolName = row.schoolName || current.schoolName;
    }
    if (!current.language && row.language) current.language = row.language;
    if (!current.responseDueBy && row.responseDueBy) current.responseDueBy = row.responseDueBy;
    current.service = `${current.discipline}, ${current.hoursPerWeek} hrs/week`;
    current.groupKey = groupKey(current);
  }
  return [...byId.values()];
}

export function parseAvailableBidRows(preschoolRows, schoolAgeRows, addressRows, importedAt) {
  const addressIndex = buildAddressIndex(addressRows);
  const lines = [];
  for (const row of preschoolRows || []) {
    lines.push(rowToCase(row, { program: 'preschool', addressIndex, importedAt }));
  }
  for (const row of schoolAgeRows || []) {
    lines.push(rowToCase(row, { program: 'school-age', addressIndex, importedAt }));
  }
  const cases = mergeCaseLines(lines.filter(Boolean));
  return { cases, addressIndex, skipped: lines.filter((row) => row == null).length };
}

export function buildPaGroups(cases) {
  const map = new Map();
  for (const row of cases || []) {
    if (!row || row.awarded) continue;
    const key = row.groupKey || groupKey(row);
    if (!map.has(key)) {
      map.set(key, {
        key,
        responseDueBy: row.responseDueBy || '',
        address: row.address || '',
        language: row.language || '',
        discipline: row.discipline || '',
        adminDbn: row.adminDbn || '',
        buildingCode: row.buildingCode || '',
        program: row.program || '',
        schoolName: row.schoolName || '',
        area: row.area || '',
        childCount: 0,
        groupSessions: 0,
        individualSessions: 0,
        hoursTotal: 0,
        caseIds: [],
      });
    }
    const group = map.get(key);
    group.childCount += 1;
    group.groupSessions += Number(row.groupSessions) || 0;
    group.individualSessions += Number(row.individualSessions) || 0;
    group.hoursTotal = Math.round((group.hoursTotal + Number(row.hoursPerWeek || 0)) * 100) / 100;
    group.caseIds.push(row.id);
  }
  return [...map.values()].sort((a, b) => String(a.responseDueBy).localeCompare(String(b.responseDueBy))
    || String(a.schoolName).localeCompare(String(b.schoolName))
    || String(a.discipline).localeCompare(String(b.discipline)));
}

export function matchKind(row, therapist) {
  const home = areaInAddress(therapist.address) || therapist.location || '';
  const schoolArea = row.area || areaInAddress(row.address) || '';
  const farther = Boolean(home && schoolArea && home !== schoolArea);
  const short = Number(row.hoursPerWeek) < Number(therapist.desiredHours);
  if (!farther && !short) return { kind: 'exact', home, schoolArea, farther: false, short: false };
  return { kind: 'partial', home, schoolArea, farther, short };
}
