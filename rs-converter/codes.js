/**
 * Service Detail from duration + ratio + discipline.
 *
 * Client rule:
 *   total time = time out − time in
 *   2:1 or more = Group; 1:1 = individual
 *   30 min omits the number
 *   Ex: 30 min 2:1 SLP → SLP school Group
 *       40 min 2:1 SLP → SLP school 40 Group
 */
(function (root) {
  const DISCIPLINE_FROM_SERVICE = [
    { test: /\b(speech|language|slp|s\/?lp)\b/i, code: 'SLP' },
    { test: /\b(occupational|\bot\b)/i, code: 'OT' },
    { test: /\b(physical|\bpt\b)/i, code: 'PT' },
  ];

  const BUCKETS = [15, 30, 40, 45, 60];
  const DISCIPLINES = ['SLP', 'OT', 'PT'];

  function disciplineFromService(service) {
    const s = String(service || '').trim();
    if (!s) return '';
    if (/annual review/i.test(s)) return 'AR';
    if (/^slp\b/i.test(s) || /^st\b/i.test(s)) return 'SLP';
    if (/^ot\b/i.test(s)) return 'OT';
    if (/^pt\b/i.test(s)) return 'PT';
    for (const row of DISCIPLINE_FROM_SERVICE) {
      if (row.test.test(s)) return row.code;
    }
    return '';
  }

  function bucketMinutes(mins) {
    const n = Number(mins);
    if (!Number.isFinite(n) || n <= 0) return 30;
    return BUCKETS.reduce((best, b) => (Math.abs(b - n) < Math.abs(best - n) ? b : best));
  }

  function parseRatio(ratio) {
    const m = String(ratio || '').trim().match(/^(\d+)\s*:\s*(\d+)$/);
    if (!m) return { students: 1, providers: 1, group: false };
    const students = Number(m[1]);
    const providers = Number(m[2]);
    return { students, providers, group: students >= 2 };
  }

  function schoolCode(disc, bucket, group) {
    if (disc === 'AR') return 'Annual Review';
    if (!disc) {
      if (group) return bucket === 30 ? 'school Group' : `school ${bucket} Group`;
      return bucket === 30 ? 'School' : `school ${bucket}`;
    }
    if (!group && bucket === 30) return `${disc} School`;
    if (!group) return `${disc} school ${bucket}`;
    if (bucket === 30) return `${disc} school Group`;
    return `${disc} school ${bucket} Group`;
  }

  function buildServiceDetail({ discipline, minutes, ratio, service }) {
    if (/annual review/i.test(String(service || ''))) {
      const disc = disciplineFromService(service);
      if (disc === 'PT') return 'PT Annual Review';
      if (disc === 'OT') return 'OT Annual Review';
      return 'Annual Review';
    }
    const disc = discipline || disciplineFromService(service);
    const bucket = bucketMinutes(minutes);
    const { group } = parseRatio(ratio);
    return schoolCode(disc, bucket, group);
  }

  function listSchoolCodes() {
    const rows = [];
    for (const disc of DISCIPLINES) {
      for (const bucket of BUCKETS) {
        rows.push({
          discipline: disc,
          minutes: bucket,
          ratio: '1:1',
          code: schoolCode(disc, bucket, false),
        });
        rows.push({
          discipline: disc,
          minutes: bucket,
          ratio: '2:1+',
          code: schoolCode(disc, bucket, true),
        });
      }
    }
    return rows;
  }

  function minutesBetween(timeIn, timeOut) {
    const a = parseClock(timeIn);
    const b = parseClock(timeOut);
    if (a == null || b == null) return 0;
    let diff = b - a;
    if (diff < 0) diff += 24 * 60;
    return diff;
  }

  function parseClock(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getHours() * 60 + value.getMinutes();
    }
    const s = String(value || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?$/i);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h * 60 + min;
  }

  root.rsCodes = {
    DISCIPLINES,
    BUCKETS,
    disciplineFromService,
    bucketMinutes,
    parseRatio,
    buildServiceDetail,
    listSchoolCodes,
    minutesBetween,
    parseClock,
    schoolCode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
