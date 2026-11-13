import assert from 'node:assert/strict';
import {
  buildAddressIndex,
  buildPaGroups,
  hoursFromMandate,
  mapDiscipline,
  mapLanguage,
  matchKind,
  mergeCaseLines,
  parseAvailableBidRows,
  resolveAddress,
  rowToCase,
  stableCaseId,
} from './import-cases.js';
import { parseAddressWorkbook, parseBidWorkbook, writeFixtureWorkbook } from './sheetio.js';

assert.equal(mapDiscipline('Occupational Therapy'), 'OT');
assert.equal(mapDiscipline('Speech-Language Therapy'), 'SLP');
assert.equal(mapDiscipline('Physical Therapy'), 'PT');
assert.equal(mapDiscipline('Nurse - Transportation'), '');
assert.equal(mapLanguage('ENGLISH'), 'English');
assert.equal(mapLanguage('YIDDISH'), 'Yiddish');
assert.equal(hoursFromMandate('2x Weekly', '30 Minutes'), 1);
assert.equal(hoursFromMandate('1x Weekly', '30 Minutes'), 0.5);

const addressIndex = buildAddressIndex([
  {
    Program: 'Building',
    'Admin DBN': '20KCIE',
    'Phys Site Bldg Code': '20 KCIE',
    'School Name': 'Sample Pre-K',
    'Street Address': '1234 50th St, Borough Park, Brooklyn, NY 11219',
    'Address Source': 'DOE location file',
  },
]);
assert.equal(resolveAddress({ 'Admin DBN': '20KCIE' }, addressIndex).address.includes('Borough Park'), true);
assert.equal(resolveAddress({ 'Phys Site Bldg Code': '20 KCIE' }, addressIndex).schoolName, 'Sample Pre-K');
assert.equal(resolveAddress({ 'Admin DBN': '99Z999' }, addressIndex).address, '');

const base = {
  'Bid Status': 'In Progress',
  'Student NYCID': '230046667',
  'Last Name': 'KLINGER',
  'First Name': 'SARA',
  'Admin DBN': '20KCIE',
  'Phys Site Bldg Code': '20 KCIE',
  'Service Type': 'Occupational Therapy',
  Language: 'YIDDISH',
  'Individual/Group': 'Individual',
  'Group Size': 1,
  'Remaining Frequency': '1x Weekly',
  Duration: '30 Minutes',
  'Response Due By': '10/31/2026',
};
const one = rowToCase(base, { program: 'preschool', addressIndex, importedAt: '2026-11-02T12:00:00.000Z' });
assert.equal(one.id, stableCaseId({ nycId: '230046667', buildingCode: '20 KCIE', adminDbn: '20KCIE', discipline: 'OT' }));
assert.equal(one.discipline, 'OT');
assert.equal(one.hoursPerWeek, 0.5);
assert.equal(one.language, 'Yiddish');
assert.equal(one.area, 'Borough Park');
assert.equal(one.source, 'sesis');
assert.equal(one.child, 'S. K.');

const groupLine = rowToCase({
  ...base,
  'Individual/Group': 'Group',
  'Group Size': 8,
  'Remaining Frequency': '2x Weekly',
}, { program: 'preschool', addressIndex, importedAt: '2026-11-02T12:00:00.000Z' });
const merged = mergeCaseLines([one, groupLine]);
assert.equal(merged.length, 1);
assert.equal(merged[0].hoursPerWeek, 1.5);
assert.equal(merged[0].individualSessions, 1);
assert.equal(merged[0].groupSessions, 1);

assert.equal(rowToCase({ ...base, 'Service Type': 'Nurse' }, { program: 'preschool', addressIndex }), null);

const preschoolBytes = writeFixtureWorkbook([
  base,
  { ...base, 'Individual/Group': 'Group', 'Remaining Frequency': '2x Weekly' },
  { ...base, 'Student NYCID': '230051148', 'Admin DBN': '', 'Phys Site Bldg Code': '', Language: 'ENGLISH', 'Service Type': 'Speech-Language Therapy' },
]);
const schoolBytes = writeFixtureWorkbook([
  {
    ...base,
    'Student NYCID': '250136984',
    'Admin DBN': '23K184',
    'Phys Site Bldg Code': '23 K184',
    'Service Type': 'Occupational Therapy',
    Language: 'ENGLISH',
    'Response Due By': '10/28/2026',
  },
]);
const addressBytes = writeFixtureWorkbook([
  {
    Program: 'Building',
    'Admin DBN': '20KCIE',
    'Phys Site Bldg Code': '20 KCIE',
    'School Name': 'Sample Pre-K',
    'Street Address': '1234 50th St, Borough Park, Brooklyn, NY 11219',
    'Address Source': 'DOE location file',
  },
  {
    Program: 'Building',
    'Admin DBN': '23K184',
    'Phys Site Bldg Code': '23 K184',
    'School Name': 'PS 184',
    'Street Address': '500 Mother Gaston Blvd, Brooklyn, NY 11212',
    'Address Source': 'DOE location file',
  },
], 'Available bids');

const parsed = parseAvailableBidRows(
  parseBidWorkbook(preschoolBytes),
  parseBidWorkbook(schoolBytes),
  parseAddressWorkbook(addressBytes),
  '2026-11-02T12:00:00.000Z',
);
assert.ok(parsed.cases.length >= 2);
assert.ok(parsed.cases.every((row) => row.source === 'sesis'));
assert.ok(parsed.cases.find((row) => row.adminDbn === '20KCIE').address.includes('Borough Park'));
assert.equal(parsed.cases.find((row) => row.adminDbn === '' || !row.address)?.address || '', '');

const groups = buildPaGroups(parsed.cases);
assert.ok(groups.length >= 1);
assert.ok(groups.every((group) => Array.isArray(group.caseIds) && group.childCount >= 1));

const therapist = {
  address: '10 50th St, Borough Park',
  location: 'Borough Park',
  desiredHours: 1,
};
const boroughCase = parsed.cases.find((row) => row.area === 'Borough Park');
assert.ok(boroughCase);
const exact = matchKind(boroughCase, therapist);
assert.equal(exact.kind, 'exact');
const partial = matchKind({ ...boroughCase, area: 'Midwood', hoursPerWeek: 0.5 }, therapist);
assert.equal(partial.kind, 'partial');
assert.equal(partial.farther, true);
assert.equal(partial.short, true);

console.log('import-cases checks passed');
