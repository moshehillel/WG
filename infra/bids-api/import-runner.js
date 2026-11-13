import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { parseAvailableBidRows } from './import-cases.js';
import {
  awardRecordFromMatch,
  caseShellFromAwarded,
  matchAwardedToState,
  parseAwardedRows,
} from './import-awarded.js';
import { parseAddressWorkbook, parseBidWorkbook, writeFixtureWorkbook } from './sheetio.js';
import { downloadAvailableBidBytes, downloadAwardedBytes } from './sesis-available.js';

export function fixtureWorkbooks() {
  const preschool = writeFixtureWorkbook([
    {
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
    },
    {
      'Bid Status': 'In Progress',
      'Student NYCID': '230046667',
      'Last Name': 'KLINGER',
      'First Name': 'SARA',
      'Admin DBN': '20KCIE',
      'Phys Site Bldg Code': '20 KCIE',
      'Service Type': 'Occupational Therapy',
      Language: 'YIDDISH',
      'Individual/Group': 'Group',
      'Group Size': 8,
      'Remaining Frequency': '2x Weekly',
      Duration: '30 Minutes',
      'Response Due By': '10/31/2026',
    },
    {
      'Bid Status': 'In Progress',
      'Student NYCID': '230051148',
      'Last Name': 'RAMSAMMY',
      'First Name': 'ROBERT',
      'Admin DBN': '',
      'Phys Site Bldg Code': '',
      'Service Type': 'Speech-Language Therapy',
      Language: 'ENGLISH',
      'Individual/Group': 'Group',
      'Group Size': 2,
      'Remaining Frequency': '2x Weekly',
      Duration: '30 Minutes',
      'Response Due By': '10/30/2026',
    },
  ]);
  const schoolAge = writeFixtureWorkbook([
    {
      'Bid Status': 'In Progress',
      'Student NYCID': '250136984',
      'Last Name': 'DUNN',
      'First Name': 'DAMIEN',
      'Admin DBN': '23K184',
      'Phys Site Bldg Code': '23 K184',
      'Service Type': 'Occupational Therapy',
      Language: 'ENGLISH',
      'Individual/Group': 'Individual',
      'Group Size': 1,
      'Remaining Frequency': '1x Weekly',
      Duration: '30 Minutes',
      'Response Due By': '10/28/2026',
    },
  ]);
  const addresses = writeFixtureWorkbook([
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
  return { preschool, schoolAge, addresses };
}

async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function putImportObject(s3, bucket, key, bytes) {
  if (!bucket || !s3) return;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
}

export async function latestObject(s3, bucket, prefix) {
  if (!bucket || !s3) return null;
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  const objects = (listed.Contents || []).filter((item) => item.Key && item.Size).sort((a, b) => String(b.LastModified).localeCompare(String(a.LastModified)));
  if (!objects.length) return null;
  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objects[0].Key }));
  return streamToBuffer(got.Body);
}

export async function upsertImportedCases(ddb, tableName, cases) {
  let written = 0;
  let updated = 0;
  for (const row of cases) {
    const got = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: { program: row.program, caseId: row.caseId },
    }));
    const prior = got.Item || null;
    const item = {
      ...row,
      audience: prior?.audience && prior.audience !== 'either' ? prior.audience : (row.audience || 'either'),
      language: row.language || prior?.language || '',
    };
    await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
    if (prior) updated += 1;
    else written += 1;
  }
  return { written, updated, total: cases.length };
}

export async function saveImportMeta(ddb, providersTable, meta) {
  if (!providersTable) return;
  await ddb.send(new PutCommand({
    TableName: providersTable,
    Item: {
      id: '_import',
      activity: 'system',
      ...meta,
    },
  }));
}

export async function runCaseImport({
  ddb,
  s3,
  casesTable,
  providersTable,
  bucket,
  mode,
  preschoolBytes,
  schoolAgeBytes,
  addressBytes,
  credentials,
  onStep,
}) {
  const importedAt = new Date().toISOString();
  let preschool = preschoolBytes;
  let schoolAge = schoolAgeBytes;
  let addresses = addressBytes;
  let source = mode || 'bytes';

  if (mode === 'fixture' || (!preschool && !schoolAge && mode !== 'live' && mode !== 's3')) {
    const fixture = fixtureWorkbooks();
    preschool = fixture.preschool;
    schoolAge = fixture.schoolAge;
    addresses = fixture.addresses;
    source = 'fixture';
  } else if (mode === 'live') {
    if (!credentials?.username || !credentials?.password) {
      throw new Error('SESIS credentials are not configured for a live import.');
    }
    const files = await downloadAvailableBidBytes(credentials, onStep);
    preschool = files.preschool;
    schoolAge = files.schoolAge;
    source = 'live';
  } else if (mode === 's3') {
    preschool = preschool || await latestObject(s3, bucket, 'sesis/preschool-available/');
    schoolAge = schoolAge || await latestObject(s3, bucket, 'sesis/school-age-available/');
    addresses = addresses || await latestObject(s3, bucket, 'sesis/locations/');
    source = 's3';
    if (!preschool && !schoolAge) throw new Error('No SESIS available-bid files were found in S3.');
  }

  if (bucket && s3) {
    const stamp = importedAt.replace(/[:.]/g, '-');
    if (preschool) await putImportObject(s3, bucket, `sesis/preschool-available/${stamp}-possible-bids-preschool.xlsx`, preschool);
    if (schoolAge) await putImportObject(s3, bucket, `sesis/school-age-available/${stamp}-possible-bids-school-age.xlsx`, schoolAge);
    if (addresses) await putImportObject(s3, bucket, `sesis/locations/${stamp}-available-bids-by-building.xlsx`, addresses);
  }

  const parsed = parseAvailableBidRows(
    preschool ? parseBidWorkbook(preschool) : [],
    schoolAge ? parseBidWorkbook(schoolAge) : [],
    addresses ? parseAddressWorkbook(addresses) : [],
    importedAt,
  );
  const counts = await upsertImportedCases(ddb, casesTable, parsed.cases);
  const meta = {
    lastAt: importedAt,
    source,
    preschoolRows: preschool ? parseBidWorkbook(preschool).length : 0,
    schoolAgeRows: schoolAge ? parseBidWorkbook(schoolAge).length : 0,
    caseCount: counts.total,
    written: counts.written,
    updated: counts.updated,
    withAddress: parsed.cases.filter((row) => row.address).length,
    blankAddress: parsed.cases.filter((row) => !row.address).length,
  };
  await saveImportMeta(ddb, providersTable, meta);
  return { ok: true, ...meta, cases: parsed.cases };
}

export function fixtureAwardedWorkbooks() {
  const preschool = writeFixtureWorkbook([
    {
      'Student ID': '230046667',
      'Last Name': 'KLINGER',
      'First Name': 'SARA',
      'Admin DBN': '20KCIE',
      'Phys Site Bldg Code': '20 KCIE',
      'School Name': 'Sample Pre-K',
      'Service Type': 'Occupational Therapy',
      Lang: 'YIDDISH',
      Freq: '1x Weekly',
      Dur: '30 Minutes',
      Provider: 'Ada Berg',
      'Mandate ID': 'M-1',
      'Assignment ID': 'A-1',
      'Service Start Date': '2026-11-01',
      'Assign.Status': 'Fully Assigned',
    },
  ], 'Mandates');
  const schoolAge = writeFixtureWorkbook([
    {
      'Student ID': '250136984',
      'Last Name': 'DUNN',
      'First Name': 'DAMIEN',
      'Admin DBN': '23K184',
      'Phys Site Bldg Code': '23 K184',
      'School Name': 'PS 184',
      'Service Type': 'Occupational Therapy',
      Lang: 'ENGLISH',
      Freq: '1x Weekly',
      Dur: '30 Minutes',
      Provider: 'Unknown Provider',
      'Mandate ID': 'M-2',
      'Assignment ID': 'A-2',
      'Service Start Date': '2026-10-28',
      'Assign.Status': 'Pending',
    },
  ], 'Mandates');
  return { preschool, schoolAge };
}

async function scanTable(ddb, tableName) {
  const items = [];
  let startKey;
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: startKey,
    }));
    items.push(...(out.Items || []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function saveAwardedMeta(ddb, providersTable, meta) {
  if (!providersTable) return;
  await ddb.send(new PutCommand({
    TableName: providersTable,
    Item: { id: '_awarded_import', activity: 'system', ...meta },
  }));
}

export async function runAwardedImport({
  ddb,
  s3,
  casesTable,
  bidsTable,
  awardsTable,
  providersTable,
  unfilledTable,
  bucket,
  mode,
  preschoolBytes,
  schoolAgeBytes,
  credentials,
  people,
  onStep,
}) {
  const importedAt = new Date().toISOString();
  let preschool = preschoolBytes;
  let schoolAge = schoolAgeBytes;
  let source = mode || 'bytes';

  if (mode === 'fixture' || (!preschool && !schoolAge && mode !== 'live' && mode !== 's3')) {
    const fixture = fixtureAwardedWorkbooks();
    preschool = fixture.preschool;
    schoolAge = fixture.schoolAge;
    source = 'fixture';
  } else if (mode === 'live') {
    if (!credentials?.username || !credentials?.password) {
      throw new Error('SESIS credentials are not configured for a live awarded import.');
    }
    const files = await downloadAwardedBytes(credentials, onStep);
    preschool = files.preschool;
    schoolAge = files.schoolAge;
    source = 'live';
  } else if (mode === 's3') {
    preschool = preschool || await latestObject(s3, bucket, 'sesis/preschool-awarded/');
    schoolAge = schoolAge || await latestObject(s3, bucket, 'sesis/school-age-awarded/');
    source = 's3';
    if (!preschool && !schoolAge) throw new Error('No SESIS awarded files were found in S3.');
  }

  if (bucket && s3) {
    const stamp = importedAt.replace(/[:.]/g, '-');
    if (preschool) await putImportObject(s3, bucket, `sesis/preschool-awarded/${stamp}-awarded-cases-preschool.xlsx`, preschool);
    if (schoolAge) await putImportObject(s3, bucket, `sesis/school-age-awarded/${stamp}-awarded-cases-school-age.xlsx`, schoolAge);
  }

  const awardedRows = parseAwardedRows(
    preschool ? parseBidWorkbook(preschool) : [],
    schoolAge ? parseBidWorkbook(schoolAge) : [],
  );
  const cases = await scanTable(ddb, casesTable);
  const bids = bidsTable ? await scanTable(ddb, bidsTable) : [];
  const providers = providersTable ? (await scanTable(ddb, providersTable)).filter((row) => row.id && !String(row.id).startsWith('_')) : [];
  const peopleMap = people || Object.fromEntries(providers.map((row) => [row.id, row]));
  const { matched } = matchAwardedToState(awardedRows, { cases, bids, people: peopleMap });

  let awardsWritten = 0;
  let casesCreated = 0;
  let confirmed = 0;
  let pending = 0;
  for (const row of matched) {
    if (!row.existingCase) {
      await ddb.send(new PutCommand({ TableName: casesTable, Item: caseShellFromAwarded(row) }));
      casesCreated += 1;
    } else {
      const prior = await ddb.send(new GetCommand({
        TableName: casesTable,
        Key: { program: row.program, caseId: row.caseId },
      }));
      if (prior.Item) {
        await ddb.send(new PutCommand({
          TableName: casesTable,
          Item: {
            ...prior.Item,
            mandateId: row.mandateId || prior.Item.mandateId || '',
            assignmentId: row.assignmentId || prior.Item.assignmentId || '',
            schoolName: row.schoolName || prior.Item.schoolName || '',
          },
        }));
      }
    }
    const award = awardRecordFromMatch(row);
    const existingAward = await ddb.send(new GetCommand({
      TableName: awardsTable,
      Key: { caseId: award.caseId },
    }));
    await ddb.send(new PutCommand({
      TableName: awardsTable,
      Item: {
        ...(existingAward.Item || {}),
        ...award,
        importedAt,
        steps: existingAward.Item?.steps || {},
      },
    }));
    awardsWritten += 1;
    if (award.status === 'awarded-confirmed-provider') confirmed += 1;
    else pending += 1;
    if (!award.personId && unfilledTable) {
      await ddb.send(new PutCommand({
        TableName: unfilledTable,
        Item: {
          id: award.caseId,
          child: row.child,
          schoolCode: row.buildingCode || row.adminDbn || award.caseId,
          schoolName: row.schoolName,
          program: row.program,
          discipline: row.discipline,
          service: `${row.discipline}, ${row.hoursPerWeek} hrs/week`,
          hoursPerWeek: row.hoursPerWeek,
          day: 1,
          clockStartedAt: importedAt,
          screening: [],
          followNote: '',
          source: 'awarded-report',
        },
      }));
    }
  }

  const meta = {
    lastAt: importedAt,
    source,
    awardedRows: awardedRows.length,
    awardsWritten,
    casesCreated,
    confirmed,
    pending,
  };
  await saveAwardedMeta(ddb, providersTable, meta);
  return { ok: true, ...meta, matched };
}
