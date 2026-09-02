import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const store = {};
const context = {
  console,
  localStorage: {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    },
  },
};
vm.createContext(context);
context.globalThis = context;
for (const file of ['codes.js', 'mapping.js', 'history.js', 'parser.js', 'validate.js']) {
  vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context);
}

let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed += 1;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

const { rsCodes, rsParser, rsValidate, rsMapping, rsHistory } = context;

eq(rsCodes.buildServiceDetail({ service: 'Speech Language', minutes: 30, ratio: '2:1' }), 'SLP school Group', '30 min 2:1 SLP');
eq(rsCodes.buildServiceDetail({ service: 'SLP', minutes: 40, ratio: '2:1' }), 'SLP school 40 Group', '40 min 2:1 SLP');
eq(rsCodes.buildServiceDetail({ service: 'Physical Therapy', minutes: 30, ratio: '1:1' }), 'PT School', '30 min 1:1 PT');
eq(rsCodes.buildServiceDetail({ service: 'Occupational Therapy', minutes: 40, ratio: '1:1' }), 'OT school 40', '40 min 1:1 OT');
eq(rsCodes.buildServiceDetail({ service: 'OT', minutes: 30, ratio: '3:1' }), 'OT school Group', '30 min 3:1 OT');
eq(rsCodes.buildServiceDetail({ service: 'Speech Language', minutes: 30, ratio: '4:1' }), 'SLP school Group', '30 min 4:1 SLP');
eq(rsCodes.minutesBetween('8:50 am', '9:20 am'), 30, 'duration 30');
eq(rsCodes.minutesBetween('9:00 am', '9:40 am'), 40, 'duration 40');
eq(rsParser.splitPersonName('Souverain, Regine'), { first: 'Regine', last: 'Souverain' }, 'provider last, first');
eq(rsParser.splitPersonName('Aiden Odne'), { first: 'Aiden', last: 'Odne' }, 'child first last');
eq(rsMapping.splitPersonName('Kraupner, PT, Diana'), { first: 'Diana', last: 'Kraupner' }, 'provider creds in name');
eq(rsMapping.splitPersonName('Kraupner, Diana (White Glove)'), { first: 'Diana', last: 'Kraupner' }, 'provider org suffix');
eq(rsMapping.splitMappingName('De Oliveira Jack'), { first: 'Jack', last: 'De Oliveira' }, 'CSV last…first');
eq(rsParser.attendanceFromNotes('Student Absent from session', '8:50 am', '9:20 am'), 'Missed', 'absent → missed');
eq(rsParser.attendanceFromNotes('Student Absence: Student not in school', '', ''), 'Missed', 'student absence line');
eq(rsParser.attendanceFromNotes('Student Not Available: class trip', '9:00 am', '9:30 am'), 'Missed', 'not available');
eq(rsParser.attendanceFromNotes('Service Provided: work on balance', '8:50 am', '9:20 am'), 'Attended', 'provided → attended');
eq(rsParser.attendanceFromNotes('Makeup session for 08/01/2026', '8:50 am', '9:20 am'), 'Makeup', 'makeup');
eq(rsParser.attendanceFromNotes('Make up session #9', '8:50 am', '9:20 am'), 'Makeup', 'make up session #');
eq(rsParser.extractMakeupDate('Makeup session for 08/01/2026'), '08/01/2026', 'makeup date in notes');
eq(rsParser.extractIcd('ICD R62.50 noted'), 'R62.50', 'ICD from notes');
eq(rsParser.cancellationFromNotes('Student Not Available: trip', 'Missed'), 'Student Not Available', 'not available reason');
eq(rsParser.cancellationFromNotes('Student Absence: Student not in school', 'Missed'), 'Student not in school', 'not in school reason');

function w(x, y, str) {
  return { str, x, y, w: String(str).length * 5 };
}

function header(service, provider, student) {
  return [
    w(256, 20, 'District/Agency/BOCES:'),
    w(352, 20, 'Valley Stream UFSD 30'),
    w(30, 47, 'Service:'),
    w(80, 47, service),
    w(30, 59, 'Service'),
    w(60, 59, `Provider:${provider}`),
    w(580, 71, 'Student'),
    w(611, 71, 'Name:'),
    w(638, 71, student),
  ];
}

function sessionRow(y, { date, ratio, start, end, cpt, units, notes, icd }) {
  const items = [
    w(26, y, date),
    w(98, y, ratio),
    w(141, y, start),
    w(214, y, end),
    w(293, y, notes),
    w(570, y, cpt),
    w(644, y, units),
  ];
  if (icd) items.push(w(720, y, icd));
  return items;
}

const ptPages = [
  {
    width: 792,
    height: 612,
    items: [
      ...header('Physical Therapy', 'Souverain, Regine', 'Aiden Odne, D.O.B. 07/12/2019'),
      ...sessionRow(116, {
        date: '08/11/2026',
        ratio: '1:1',
        start: '8:50 am',
        end: '9:20 am',
        cpt: '97112',
        units: '1',
        notes: 'Service Provided: balance',
      }),
      w(26, 128, 'Forest Road School'),
      ...sessionRow(209, {
        date: '08/11/2026',
        ratio: '1:1',
        start: '8:50 am',
        end: '9:20 am',
        cpt: '97110',
        units: '1',
        notes: 'Service Provided: balance',
      }),
      w(26, 221, 'Forest Road School'),
    ],
  },
];

const ptRows = rsParser.toImportRows(rsParser.parsePages(ptPages));
eq(ptRows.length, 1, 'PT CPT rows merge to one session');
eq(ptRows[0].serviceDetail, 'PT School', 'PT 1:1 30 → PT School');
eq(ptRows[0].procedures, '97112x1, 97110x1', 'merged CPT');
eq(ptRows[0].attendance, 'Attended', 'PT attended');
eq(ptRows[0].location, 'Forest Road School', 'setting');
eq(ptRows[0].childFirst, 'Aiden', 'child first');
eq(ptRows[0].providerLast, 'Souverain', 'provider last');

const slpPages = [
  {
    width: 792,
    height: 612,
    items: [
      ...header('Speech Language Therapy', 'Cohen, Sarah', 'Maya Levi, D.O.B. 01/02/2018'),
      ...sessionRow(116, {
        date: '08/12/2026',
        ratio: '2:1',
        start: '10:00 am',
        end: '10:40 am',
        cpt: '92507',
        units: '1',
        notes: 'Service Provided: articulation group',
      }),
      w(26, 128, 'Howell Road School'),
    ],
  },
];
const slpRows = rsParser.toImportRows(rsParser.parsePages(slpPages));
eq(slpRows.length, 1, 'SLP one session');
eq(slpRows[0].serviceDetail, 'SLP school 40 Group', '40 min 2:1 SLP');
eq(slpRows[0].group, true, 'group flag');

const missedPages = [
  {
    width: 792,
    height: 612,
    items: [
      ...header('Occupational Therapy', 'Brown, Alex', 'Noah Kim, D.O.B. 03/04/2017'),
      ...sessionRow(116, {
        date: '08/13/2026',
        ratio: '1:1',
        start: '1:00 pm',
        end: '1:30 pm',
        cpt: '97530',
        units: '1',
        notes: 'Student Absent',
      }),
      w(26, 128, 'Forest Road School'),
    ],
  },
];
const missedRows = rsParser.toImportRows(rsParser.parsePages(missedPages));
eq(missedRows[0].attendance, 'Missed', 'OT absent → Missed');
eq(missedRows[0].cancellationReason, 'Student Absent', 'default cancel reason');
eq(missedRows[0].serviceDetail, 'OT School', 'OT 1:1 30 still codes');

const absenceLinePages = [
  {
    width: 792,
    height: 612,
    items: [
      ...header('Physical Therapy', 'Kraupner, PT, Diana', 'Jack De Oliveira, D.O.B. 10/19/2012'),
      ...sessionRow(116, {
        date: '09/02/2026',
        ratio: '0',
        start: '',
        end: '',
        cpt: '',
        units: '',
        notes: '',
      }),
      w(293, 128, 'Student Absence: Student not in school'),
      w(26, 128, 'Carle Place Elementary'),
    ],
  },
];
const absenceRows = rsParser.toImportRows(rsParser.parsePages(absenceLinePages));
eq(absenceRows[0].attendance, 'Missed', 'absence continuation → Missed');
eq(absenceRows[0].cancellationReason, 'Student not in school', 'not in school cancel');
eq(absenceRows[0].beginTime, '', 'missed can have no time in');
eq(absenceRows[0].providerFirst, 'Diana', 'creds stripped from provider');
eq(absenceRows[0].childLast, 'De Oliveira', 'multi-word last name');

const makeupPages = [
  {
    width: 792,
    height: 612,
    items: [
      ...header('Physical Therapy', 'Kraupner, Diana (White Glove)', 'Maeve Leahy, D.O.B. 05/09/2014'),
      ...sessionRow(116, {
        date: '09/10/2026',
        ratio: '1:1',
        start: '9:00 am',
        end: '9:30 am',
        cpt: '97110',
        units: '1',
        notes: 'Make up session #9',
        icd: 'R62.50',
      }),
      w(26, 128, 'Carle Place Elementary'),
    ],
  },
];
const makeupRows = rsParser.toImportRows(rsParser.parsePages(makeupPages));
eq(makeupRows[0].attendance, 'Makeup', 'make up session # → Makeup');
eq(makeupRows[0].diagnoses, 'R62.50', 'ICD on session line');
eq(makeupRows[0].providerLast, 'Kraupner', 'White Glove suffix stripped');

const group31Pages = [
  {
    width: 792,
    height: 612,
    items: [
      ...header('Speech Language Therapy', 'Bardoo, Kaila', 'Leo Chen, D.O.B. 01/01/2016'),
      ...sessionRow(116, {
        date: '09/11/2026',
        ratio: '3:1',
        start: '11:00 am',
        end: '11:30 am',
        cpt: '92507',
        units: '1',
        notes: 'Service Provided: group language',
        icd: 'F80.2',
      }),
      w(26, 128, 'Bethpage School'),
    ],
  },
];
const group31 = rsParser.toImportRows(rsParser.parsePages(group31Pages));
eq(group31[0].serviceDetail, 'SLP school Group', '3:1 30 SLP group');
eq(group31[0].diagnoses, 'F80.2', 'SLP ICD');

eq(Boolean(rsValidate.parseDate('08/11/2026')), true, 'valid date');
eq(rsValidate.parseDate('02/30/2026'), null, 'invalid calendar date');
eq(rsValidate.validateRows([]).ok, false, 'empty export blocked');

const goodRow = {
  childFirst: 'Aiden',
  childLast: 'Odne',
  providerFirst: 'Regine',
  providerLast: 'Souverain',
  ratio: '1:1',
  dateOfService: '08/11/2026',
  attendance: 'Attended',
  beginTime: '8:50 am',
  endTime: '9:20 am',
  serviceDetail: 'PT School',
  procedures: '97112x1, 97110x1',
};
eq(rsValidate.validateRows([goodRow]).ok, true, 'valid attended row');
eq(rsValidate.validateRow({ ...goodRow, childFirst: '', childLast: '' }, 0).some((i) => i.level === 'error'), true, 'missing child blocked');
eq(rsValidate.validateRow({ ...goodRow, endTime: '8:50 am' }, 0).some((i) => /after time in/.test(i.message)), true, 'same in/out blocked');
eq(rsValidate.validateRow({ ...goodRow, attendance: 'Missed', cancellationReason: '' }, 0).some((i) => /Cancellation Reason/.test(i.message)), true, 'missed needs reason');
eq(
  rsValidate.validateRow({
    ...goodRow,
    attendance: 'Missed',
    cancellationReason: 'Student Absent',
    beginTime: '',
    endTime: '',
    ratio: '0',
  }, 0).some((i) => i.level === 'error'),
  false,
  'missed without times is allowed',
);
eq(
  rsValidate.validateRow({ ...goodRow, attendance: 'Makeup', dosMadeUp: '' }, 0).some((i) => i.level === 'error' && /DOS Made Up/.test(i.message)),
  false,
  'makeup without DOS is not an error',
);
eq(
  rsValidate.validateRow({ ...goodRow, attendance: 'Makeup', dosMadeUp: '' }, 0).some((i) => i.level === 'warning' && /DOS Made Up/.test(i.message)),
  true,
  'makeup without DOS warns',
);
eq(rsValidate.validateRow({ ...goodRow, procedures: 'abc' }, 0).some((i) => /CPT/.test(i.message)), true, 'bad CPT blocked');
eq(rsValidate.validateRow({ ...goodRow, dateOfService: '13/40/2026' }, 0).some((i) => /real date/.test(i.message)), true, 'bad date blocked');
eq(rsValidate.validateRows([goodRow, goodRow]).ok, false, 'duplicate session blocked');
eq(rsValidate.validateRow({ ...goodRow, authorization: 'AUTH1' }, 0).some((i) => i.level === 'warning'), true, 'auth ignores names warning');

const csv = `Child's Name,Program Id,Date of Birth,Service Type,Times per Basic Mandate,Basic Mandate Frequency,Program Type,
De Oliveira Jack,258272153,10/19/2012,PT School,3,Weekly,Carle Place UFSD,
Klicpera Elizabeth,258272154,11/10/2011,PT School Group,4,Weekly,Carle Place UFSD,
Leahy Maeve,258272157,05/09/2014,PT School,1,Weekly,Carle Place UFSD,
Leahy Maeve,258272157,05/09/2014,PT Makeup,1,Weekly,Carle Place UFSD,
Kid Testy,1,01/01/2015,PT Makeup,1,Weekly,Carle Place UFSD,
Parent Communication,,01/01/2000,PT meeting 30,1,Weekly,Carle Place UFSD,
`;
const map = rsMapping.parseCsv(csv);
eq(map.some((r) => r.name === 'Parent Communication'), false, 'skip parent communication');
eq(map.find((r) => r.first === 'Jack').last, 'De Oliveira', 'map last…first Jack');
eq(map.find((r) => r.first === 'Jack').programType, 'Carle Place UFSD', 'program type not program id');

const groupMandate = rsMapping.applyMapping(
  [{
    ...goodRow,
    childFirst: 'Elizabeth',
    childLast: 'Klicpera',
    ratio: '1:1',
    serviceDetail: 'PT School',
    mappingWarnings: [],
  }],
  map,
);
eq(groupMandate[0].serviceDetail, 'PT School Group', 'group mandate on 1:1 session');
eq(groupMandate[0].mappingWarnings.some((m) => /change the rate/i.test(m)), true, 'rate warning for group mandate');

rsHistory.recordFromRows([{
  childFirst: 'Maeve',
  childLast: 'Leahy',
  attendance: 'Missed',
  dateOfService: '09/01/2026',
}]);
const makeupMapped = rsMapping.applyMapping(
  [{
    ...goodRow,
    childFirst: 'Maeve',
    childLast: 'Leahy',
    attendance: 'Makeup',
    dosMadeUp: '',
    dateOfService: '09/10/2026',
    serviceDetail: 'PT School',
    mappingWarnings: [],
  }],
  map,
);
eq(makeupMapped[0].dosMadeUp, '09/01/2026', 'makeup DOS from unused missed history');
eq(makeupMapped[0].serviceDetail, 'PT School', 'makeup with DOS keeps school type');

const makeupNoHist = rsMapping.applyMapping(
  [{
    ...goodRow,
    childFirst: 'Testy',
    childLast: 'Kid',
    attendance: 'Makeup',
    dosMadeUp: '',
    dateOfService: '09/04/2026',
    serviceDetail: 'PT School',
    mappingWarnings: [],
  }],
  map,
);
eq(makeupNoHist[0].serviceDetail, 'PT Makeup', 'makeup with no DOS uses makeup mandate');

const sameFile = rsMapping.applyMapping(
  [
    {
      ...goodRow,
      childFirst: 'Jack',
      childLast: 'De Oliveira',
      attendance: 'Missed',
      cancellationReason: 'Student Absent',
      dateOfService: '09/01/2026',
      serviceDetail: 'PT School',
      mappingWarnings: [],
    },
    {
      ...goodRow,
      childFirst: 'Jack',
      childLast: 'De Oliveira',
      attendance: 'Makeup',
      dosMadeUp: '',
      dateOfService: '09/10/2026',
      serviceDetail: 'PT School',
      mappingWarnings: [],
    },
  ],
  map,
);
eq(sameFile[1].dosMadeUp, '09/01/2026', 'makeup DOS from missed row in the same file');

function dumpPdf(pdfPath) {
  const py = `
import fitz, json, sys
doc = fitz.open(sys.argv[1])
pages = []
for page in doc:
    items = []
    for word in page.get_text('words'):
        x0,y0,x1,y1,token = word[:5]
        items.append({"str": token, "x": x0, "y": y0, "w": x1-x0})
    pages.append({"width": page.rect.width, "height": page.rect.height, "items": items})
print(json.dumps(pages))
`;
  const dumped = spawnSync('python', ['-c', py, pdfPath], { encoding: 'utf-8', maxBuffer: 10_000_000 });
  if (dumped.status !== 0) return null;
  return JSON.parse(dumped.stdout);
}

const livePdfs = [
  ['C:\\Users\\Moshe\\Downloads\\RS Report VS 30 8.11.pdf', (live) => {
    eq(live.length, 1, 'live VS30 session count');
    eq(live[0].serviceDetail, 'PT School', 'live VS30 service code');
    eq(rsValidate.validateRows(live).ok, true, 'live VS30 rows pass validation');
  }],
  ['C:\\Users\\Moshe\\Downloads\\report (2)(86).pdf', (live) => {
    eq(live.length > 0, true, 'live Westbury has sessions');
    eq(live.some((r) => r.attendance === 'Missed'), true, 'live Westbury has missed');
    eq(live.some((r) => String(r.ratio).includes('2:1')), true, 'live Westbury has 2:1');
  }],
  ['C:\\Users\\Moshe\\Downloads\\report (1)(110).pdf', (live) => {
    eq(live.length > 0, true, 'live Carle Place has sessions');
    eq(live.some((r) => r.attendance === 'Makeup'), true, 'live Carle Place has makeup');
    eq(live.some((r) => r.attendance === 'Missed'), true, 'live Carle Place has missed');
  }],
  ['C:\\Users\\Moshe\\Downloads\\report (1)(101).pdf', (live) => {
    eq(live.length > 0, true, 'live Bethpage has sessions');
    eq(live.some((r) => r.group), true, 'live Bethpage has group');
  }],
];

for (const [pdfPath, check] of livePdfs) {
  if (!fs.existsSync(pdfPath)) {
    console.log(`skip live PDF (missing) ${path.basename(pdfPath)}`);
    continue;
  }
  const pages = dumpPdf(pdfPath);
  if (!pages) {
    console.log(`skip live PDF (python extract failed) ${path.basename(pdfPath)}`);
    continue;
  }
  check(rsParser.toImportRows(rsParser.parsePages(pages)));
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall tests passed');
