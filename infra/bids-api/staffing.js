/** BOE staffing rules for Bids. Drafts are stored, never sent. No HHA ids. */

export const LANGUAGES = ['Yiddish', 'English', 'Hebrew', 'Spanish', 'Russian'];
export const DISCIPLINES = ['OT', 'PT', 'SLP'];
export const PROGRAMS = ['preschool', 'school-age'];
export const AUDIENCES = ['either', 'cheder', 'girls'];
export const CSE_REASON = 'No provider found within five days.';

export const CHECKLIST = [
  { id: 'confirmInterest', label: 'Confirm interest', owner: 'coordinator' },
  { id: 'verifyActive', label: 'Verify active', owner: 'coordinator' },
  { id: 'schoolContact', label: 'School contact', owner: 'coordinator' },
  { id: 'startDate', label: 'Start date', owner: 'coordinator' },
  { id: 'sesisAccess', label: 'SESIS access email to Heather Dustas', owner: 'system' },
  { id: 'lsRate', label: 'LS rate check', owner: 'coordinator' },
  { id: 'photoRequest', label: 'Photo request for K. James', owner: 'system' },
  { id: 'caseloadCheck', label: 'Caseload check against the school list', owner: 'coordinator' },
  { id: 'missingStudents', label: 'Missing students', owner: 'coordinator' },
  { id: 'ewebFiles', label: 'eWeb files opened', owner: 'system' },
  { id: 'payRate', label: 'Pay rate from the LS form', owner: 'system' },
  { id: 'handoffGila', label: 'Handoff to Gila (CCD Provider Coordinator)', owner: 'coordinator' },
];

const DAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 };

export function profileComplete(person) {
  if (!person) return false;
  const languages = Array.isArray(person.languages) ? person.languages.filter(Boolean) : [];
  const programs = Array.isArray(person.programs) ? person.programs : [];
  const hours = Number(person.desiredHours);
  return String(person.address || '').trim().length >= 5
    && languages.length > 0
    && (person.gender === 'male' || person.gender === 'female')
    && DISCIPLINES.includes(person.discipline)
    && Number.isFinite(hours) && hours >= 1 && hours <= 20
    && programs.some((value) => PROGRAMS.includes(value));
}

export function profileGaps(person) {
  const gaps = [];
  if (String(person?.address || '').trim().length < 5) gaps.push('street address');
  if (!Array.isArray(person?.languages) || person.languages.filter(Boolean).length === 0) gaps.push('languages');
  if (person?.gender !== 'male' && person?.gender !== 'female') gaps.push('gender');
  if (!DISCIPLINES.includes(person?.discipline)) gaps.push('discipline');
  const hours = Number(person?.desiredHours);
  if (!Number.isFinite(hours) || hours < 1 || hours > 20) gaps.push('desired hours');
  const programs = Array.isArray(person?.programs) ? person.programs : [];
  if (!programs.some((value) => PROGRAMS.includes(value))) gaps.push('preschool and/or school age');
  return gaps;
}

export function genderAllows(gender, audience) {
  const rule = audience || 'either';
  if (rule === 'either') return true;
  if (rule === 'cheder') return gender === 'male';
  if (rule === 'girls') return gender === 'female';
  return true;
}

export function languageAllows(languages, caseLanguage) {
  const need = String(caseLanguage || '').trim().toLowerCase();
  if (!need) return true;
  const have = (Array.isArray(languages) ? languages : []).map((value) => String(value).trim().toLowerCase());
  return have.includes(need);
}

export function matchesProfile(person, row) {
  if (!profileComplete(person)) return false;
  if (person.discipline !== row.discipline) return false;
  const programs = Array.isArray(person.programs) ? person.programs : [];
  if (!programs.includes(row.program)) return false;
  if (!genderAllows(person.gender, row.audience || 'either')) return false;
  if (!languageAllows(person.languages, row.language)) return false;
  return true;
}

export function placementDue({ clockStartedAt, day, hasProvider, now }) {
  const storedDay = Number(day) || 1;
  if (hasProvider) return { reject: false, day: Math.min(5, storedDay) };
  const started = Date.parse(clockStartedAt || '');
  const elapsed = Number.isNaN(started) ? storedDay : Math.floor((now - started) / 86400000) + 1;
  const shown = Math.min(5, Math.max(storedDay, elapsed));
  const reject = shown >= 5;
  return { reject, day: reject ? 5 : shown, reason: reject ? CSE_REASON : '' };
}

export function startReminder(award, now) {
  if (!award?.personId || !award.awardDate || award.startedAt) return null;
  if (award.schoolRejected || award.providerResponse === 'declined') return null;
  const awardAt = Date.parse(award.awardDate);
  if (Number.isNaN(awardAt)) return null;
  const days = (now - awardAt) / 86400000;
  if (days < 5) return null;
  return {
    remind: true,
    reject: false,
    text: 'She accepted this award and has not started within five days of the award date. This reminder does not reject the case.',
  };
}

export function cseDraft(row, reason) {
  const school = row.schoolName || row.schoolCode || 'the school';
  const program = row.program === 'preschool' ? 'preschool' : 'school age';
  return {
    to: 'CSE',
    sent: false,
    reason,
    body: `CSE notice (draft, not sent): The transmittals for ${school}, ${program}, ${row.service || row.discipline || 'service'} are rejected. Reason: ${reason}`,
    at: new Date().toISOString(),
  };
}

function cleanLanguages(values) {
  const allowed = new Set(LANGUAGES.map((value) => value.toLowerCase()));
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim();
    const known = LANGUAGES.find((item) => item.toLowerCase() === text.toLowerCase());
    if (known && !out.includes(known)) out.push(known);
    else if (text && !allowed.has(text.toLowerCase()) && text.length <= 40 && !out.includes(text)) out.push(text);
  }
  return out;
}

export function readProfile(body) {
  const languages = cleanLanguages(body.languages);
  const programs = [...new Set((Array.isArray(body.programs) ? body.programs : []).map(String))]
    .filter((value) => PROGRAMS.includes(value));
  const gender = body.gender === 'male' || body.gender === 'female' ? body.gender : '';
  const discipline = DISCIPLINES.includes(body.discipline) ? body.discipline : '';
  const desiredHours = Number(body.desiredHours);
  const address = String(body.address || '').trim().slice(0, 160);
  const availability = String(body.availability || '').trim().slice(0, 500);
  const profile = {
    address,
    languages,
    gender,
    discipline,
    desiredHours: Number.isFinite(desiredHours) ? Math.round(desiredHours) : null,
    programs,
    availability,
  };
  return { profile, gaps: profileGaps(profile) };
}

export function parseDoeLines(text) {
  const rows = [];
  const errors = [];
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  lines.forEach((line, index) => {
    const parts = (line.includes('|') ? line.split('|') : line.includes('\t') ? line.split('\t') : line.split(','))
      .map((part) => part.trim())
      .filter((part) => part.length);
    if (parts.length < 5) {
      errors.push(`Line ${index + 1} needs school, discipline, program, hours, and address or DBN.`);
      return;
    }
    const [school, disciplineRaw, programRaw, hoursRaw, place, audienceRaw, languageRaw] = parts;
    const discipline = disciplineRaw.toUpperCase();
    const program = /pre/i.test(programRaw) ? 'preschool' : /school/i.test(programRaw) ? 'school-age' : '';
    const hours = Number(hoursRaw);
    const audience = AUDIENCES.includes(String(audienceRaw || '').toLowerCase()) ? String(audienceRaw).toLowerCase() : 'either';
    if (!DISCIPLINES.includes(discipline) || !program || !Number.isFinite(hours) || hours < 1 || hours > 40) {
      errors.push(`Line ${index + 1} has a discipline, program, or hours value Bids cannot store.`);
      return;
    }
    rows.push({
      school,
      discipline,
      program,
      hours: Math.round(hours),
      place,
      audience,
      language: languageRaw ? String(languageRaw).trim().slice(0, 40) : '',
    });
  });
  return { rows, errors };
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function minutesLabel(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function parseClock(hour, minute, suffix) {
  let h = Number(hour);
  const m = Number(minute || 0);
  const mark = String(suffix || '').toLowerCase();
  if (mark === 'pm' && h < 12) h += 12;
  if (mark === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function expandDays(start, end) {
  const a = DAY_INDEX[start];
  const b = DAY_INDEX[end];
  if (a == null || b == null || b < a) return [];
  const days = [];
  for (let i = a; i <= b; i += 1) days.push(i);
  return days;
}

export function parseSlots(text) {
  const slots = [];
  const source = String(text || '');
  const range = /(mon|tue|wed|thu|fri)(?:day)?\s*-\s*(mon|tue|wed|thu|fri)(?:day)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  const single = /(mon|tue|wed|thu|fri)(?:day)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  for (const match of source.matchAll(range)) {
    const start = parseClock(match[3], match[4], match[5] || match[8]);
    const end = parseClock(match[6], match[7], match[8] || match[5]);
    if (start == null || end == null || end <= start) continue;
    for (const day of expandDays(match[1].toLowerCase(), match[2].toLowerCase())) {
      slots.push({ day, start, end });
    }
  }
  const withoutRanges = source.replace(range, ' ');
  for (const match of withoutRanges.matchAll(single)) {
    const start = parseClock(match[2], match[3], match[4] || match[7]);
    const end = parseClock(match[5], match[6], match[7] || match[4]);
    const day = DAY_INDEX[match[1].toLowerCase()];
    if (day == null || start == null || end == null || end <= start) continue;
    slots.push({ day, start, end });
  }
  return slots;
}

function covers(slots, slot) {
  return slots.some((item) => item.day === slot.day && item.start <= slot.start && item.end >= slot.end);
}

export function buildSchedule({ mandates, studentSchedules, schoolHours, availability }) {
  const fields = [
    ['Mandates', mandates],
    ['Student schedules', studentSchedules],
    ['School operating hours', schoolHours],
    ['Therapist availability', availability],
  ];
  const missing = fields.filter(([, value]) => !String(value || '').trim()).map(([name]) => name);
  if (missing.length) return { ready: false, missing, proposal: [], conflicts: [] };
  const parsed = {
    Mandates: parseSlots(mandates),
    'Student schedules': parseSlots(studentSchedules),
    'School operating hours': parseSlots(schoolHours),
    'Therapist availability': parseSlots(availability),
  };
  const untimed = Object.entries(parsed).filter(([, slots]) => slots.length === 0).map(([name]) => `${name} (no times to read)`);
  if (untimed.length) return { ready: false, missing: untimed, proposal: [], conflicts: [] };
  const proposal = [];
  const conflicts = [];
  for (const slot of parsed['Student schedules']) {
    const label = `${DAY_NAMES[slot.day]} ${minutesLabel(slot.start)}-${minutesLabel(slot.end)}`;
    const inSchool = covers(parsed['School operating hours'], slot);
    const inTherapist = covers(parsed['Therapist availability'], slot);
    if (inSchool && inTherapist) proposal.push(label);
    else if (!inSchool) conflicts.push(`${label} is outside school operating hours`);
    else conflicts.push(`${label} is outside the therapist's availability`);
  }
  for (const slot of parsed.Mandates) {
    const label = `${DAY_NAMES[slot.day]} ${minutesLabel(slot.start)}-${minutesLabel(slot.end)}`;
    const covered = parsed['Student schedules'].some((item) => item.day === slot.day && item.start < slot.end && item.end > slot.start);
    if (!covered) conflicts.push(`Mandate ${label} is not covered by the student schedule`);
  }
  return { ready: true, missing: [], proposal, conflicts };
}

export function handoffState(award, provider) {
  const identity = Boolean(provider?.name && provider?.email && DISCIPLINES.includes(provider?.discipline));
  const photo = Boolean(award?.photo?.fileName);
  const students = Array.isArray(award?.students) ? award.students.map((item) => String(item).trim()).filter(Boolean) : [];
  const rate = String(award?.lsRate ?? '').trim();
  return {
    sesis: identity
      ? {
          status: 'queued',
          opened: false,
          name: provider.name,
          email: provider.email,
          discipline: provider.discipline,
          note: 'Queued for Heather Dustas. The SESIS downloader has no account-creation request, so this does not open an account.',
        }
      : { status: 'waiting', missing: 'provider name, email, and discipline' },
    badge: photo
      ? {
          status: 'queued',
          printed: false,
          fileName: award.photo.fileName,
          to: 'K. James',
          note: 'Print-and-mail request recorded. A physical badge was not printed.',
        }
      : { status: 'waiting', missing: 'provider photo' },
    eweb: students.length
      ? {
          status: 'recorded',
          written: false,
          providerName: provider?.name || '',
          students,
          note: 'File-open record only. Bids has no eWeb client, so nothing was written to eWeb.',
        }
      : { status: 'waiting', missing: 'student list' },
    payroll: rate
      ? {
          status: 'recorded',
          hhaCalled: false,
          lsRate: rate,
          note: 'Payroll setup record only. Production HHA was not called and no visit was created.',
        }
      : { status: 'waiting', missing: 'LS rate' },
  };
}

export function draftMessages({ provider, award, row, reason }) {
  const name = provider?.name || 'the therapist';
  const email = provider?.email || '';
  const discipline = provider?.discipline || '';
  const school = row?.schoolName || award?.schoolName || row?.schoolCode || 'the school';
  return {
    heather: {
      to: 'Heather Dustas',
      sent: false,
      subject: `SESIS access request for ${name}`,
      body: `Draft only, not sent. Please queue SESIS access for ${name}${email ? ` (${email})` : ''}, discipline ${discipline || 'not set'}. This message does not open the account.`,
    },
    james: {
      to: 'K. James',
      sent: false,
      subject: `Badge request for ${name}`,
      body: `Draft only, not sent. Photo for ${name} is on the award. Please print and mail the badge when the photo is in hand. Bids did not print a badge.`,
    },
    cse: cseDraft(row || award || {}, reason || CSE_REASON),
    gila: {
      to: 'Gila, CCD Provider Coordinator',
      sent: false,
      subject: `Intro for ${name}`,
      body: `Draft only, not sent. ${name}, ${discipline || 'discipline not set'}, is ready for handoff at ${school}. Caseload: ${award?.caseload || 'not entered'}.`,
    },
  };
}

export function nearbyTherapists(people, row) {
  const home = String(row?.area || '').toLowerCase();
  return (Array.isArray(people) ? people : [])
    .filter((who) => who
      && who.activity === 'active'
      && who.role !== 'admin'
      && who.id !== 'standin'
      && matchesProfile(who, row))
    .map((who) => {
      const area = String(who.location || '').toLowerCase();
      const exact = Boolean(home) && area === home;
      return {
        id: who.id,
        name: who.name,
        discipline: who.discipline,
        area: who.location || '',
        address: who.address || '',
        exact,
        why: exact ? 'Same area as the school' : 'Farther than the school area, still matches discipline, program, gender, and language',
      };
    })
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name));
}
