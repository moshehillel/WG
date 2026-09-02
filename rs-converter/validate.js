/**
 * ProviderSoft Activity Import checks (Sheet1).
 * Errors block Excel/timesheet download. Warnings are shown but allowed.
 */
(function (root) {
  const ATTENDANCE = new Set(['Attended', 'Missed', 'Makeup']);
  const NAME_RE = /^[A-Za-z][A-Za-z .'\-]*$/;
  const RATIO_RE = /^\d+\s*:\s*\d+$/;
  const CPT_TOKEN_RE = /^\d{4,5}(x\d{1,2})?$/i;
  const ICD_RE = /^[A-TV-Z]\d[0-9A-Z](\.[0-9A-Z]{1,4})?$/i;
  const COVISIT_RE = /^(yes|no|y|n)$/i;

  function parseDate(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const month = Number(m[1]);
    const day = Number(m[2]);
    const dt = new Date(year, month - 1, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
    return dt;
  }

  function knownCodes() {
    const set = new Set(
      (root.rsCodes.listSchoolCodes() || []).map((r) => r.code.trim().toLowerCase()),
    );
    [
      'Annual Review',
      'PT Annual Review',
      'OT Annual Review',
      'PT School Eval',
      'OT School Eval',
      'SLP SCHOOL EVAL',
    ].forEach((c) => set.add(c.toLowerCase()));
    return set;
  }

  function validateRow(row, index) {
    const issues = [];
    const n = index + 1;
    const mark = (field, message, level) => {
      issues.push({ field, message, level: level || 'error', row: index });
    };
    const auth = String(row.authorization || '').trim();
    const hasAuth = Boolean(auth);
    const childOk = Boolean(row.childFirst && row.childLast);
    const providerOk = Boolean(row.providerFirst && row.providerLast);
    const serviceOk = Boolean(String(row.serviceDetail || '').trim());

    if (!hasAuth && !childOk) {
      mark(!row.childFirst ? 'childFirst' : 'childLast', `Row ${n}: child first and last name are required (or use Authorization #).`);
    }
    if (!hasAuth && !providerOk) {
      mark(!row.providerFirst ? 'providerFirst' : 'providerLast', `Row ${n}: provider first and last name are required (or use Authorization #).`);
    }
    if (!hasAuth && !serviceOk) {
      mark('serviceDetail', `Row ${n}: Service Detail is required (or use Authorization #).`);
    }
    if (hasAuth && childOk && providerOk && serviceOk) {
      mark('authorization', `Row ${n}: Authorization # is set — ProviderSoft will ignore child, provider, and Service Detail.`, 'warning');
    }

    if (row.childFirst && !NAME_RE.test(row.childFirst)) {
      mark('childFirst', `Row ${n}: child first name has invalid characters.`);
    }
    if (row.childLast && !NAME_RE.test(row.childLast)) {
      mark('childLast', `Row ${n}: child last name has invalid characters.`);
    }
    if (row.providerFirst && !NAME_RE.test(row.providerFirst)) {
      mark('providerFirst', `Row ${n}: provider first name has invalid characters.`);
    }
    if (row.providerLast && !NAME_RE.test(row.providerLast)) {
      mark('providerLast', `Row ${n}: provider last name has invalid characters.`);
    }

    if (row.ratio && row.ratio !== '0' && !RATIO_RE.test(row.ratio)) {
      mark('ratio', `Row ${n}: ratio must look like 1:1 or 2:1.`);
    }

    const dos = parseDate(row.dateOfService);
    if (!row.dateOfService) {
      mark('dateOfService', `Row ${n}: Date Of Service is required.`);
    } else if (!dos) {
      mark('dateOfService', `Row ${n}: Date Of Service must be a real date (MM/DD/YYYY).`);
    }

    const attendance = String(row.attendance || '').trim();
    if (!ATTENDANCE.has(attendance)) {
      mark('attendance', `Row ${n}: Attendance must be Attended, Missed, or Makeup.`);
    }

    const tIn = root.rsCodes.parseClock(row.beginTime);
    const tOut = root.rsCodes.parseClock(row.endTime);
    const missedNoTimes = attendance === 'Missed' && !row.beginTime && !row.endTime;
    if (!missedNoTimes) {
      if (!row.beginTime) {
        mark('beginTime', `Row ${n}: Begin Time (time in) is required.`);
      } else if (tIn == null) {
        mark('beginTime', `Row ${n}: Begin Time is not a valid time.`);
      }
      if (!row.endTime) {
        mark('endTime', `Row ${n}: End Time (time out) is required.`);
      } else if (tOut == null) {
        mark('endTime', `Row ${n}: End Time is not a valid time.`);
      }
    }
    if (tIn != null && tOut != null) {
      let mins = tOut - tIn;
      if (mins < 0) mins += 24 * 60;
      if (mins === 0) {
        mark('endTime', `Row ${n}: time out must be after time in.`);
      } else if (mins > 120) {
        mark('endTime', `Row ${n}: session is ${mins} minutes — confirm time in / time out.`, 'warning');
      }
    }

    if (attendance === 'Missed' && !String(row.cancellationReason || '').trim()) {
      mark('cancellationReason', `Row ${n}: Cancellation Reason is required for Missed activities.`);
    }
    if (attendance === 'Makeup') {
      if (!String(row.dosMadeUp || '').trim()) {
        mark(
          'dosMadeUp',
          `Row ${n}: DOS Made Up is empty. Fill the original missed date if you have it; the import can still be downloaded.`,
          'warning',
        );
      } else if (!parseDate(row.dosMadeUp)) {
        mark('dosMadeUp', `Row ${n}: DOS Made Up must be a real date (MM/DD/YYYY).`);
      }
    }

    const procs = String(row.procedures || '').trim();
    if (procs) {
      const tokens = procs.split(',').map((p) => p.trim()).filter(Boolean);
      if (!tokens.length || tokens.some((p) => !CPT_TOKEN_RE.test(p))) {
        mark('procedures', `Row ${n}: Procedures must be CPT codes like 97112x1 or 97112, 97110x1.`);
      }
    }

    const icd = String(row.diagnoses || '').trim();
    if (icd && !ICD_RE.test(icd.split(',')[0].trim())) {
      mark('diagnoses', `Row ${n}: Diagnoses should be an ICD-10 code assigned to the child.`, 'warning');
    }

    const covisit = String(row.covisit || '').trim();
    if (covisit && !COVISIT_RE.test(covisit)) {
      mark('covisit', `Row ${n}: Covisit must be Yes or No.`);
    }

    const detail = String(row.serviceDetail || '').trim();
    const mappedOk = Boolean(row.mappedServiceType || row.mappedReason);
    if (detail && !mappedOk && !knownCodes().has(detail.toLowerCase())) {
      mark(
        'serviceDetail',
        `Row ${n}: "${detail}" is not in the school code list — it must still match the child’s Ongoing Care tab.`,
        'warning',
      );
    }
    for (const msg of row.mappingWarnings || []) {
      mark('serviceDetail', `Row ${n}: ${msg}`, 'warning');
    }

    return issues;
  }

  function validateRows(rows) {
    const issues = [];
    if (!rows.length) {
      issues.push({ field: '', message: 'No sessions to export.', level: 'error' });
      return { issues, errors: issues, warnings: [], ok: false };
    }
    const seen = new Map();
    const nameCount = new Map();
    rows.forEach((row, i) => {
      issues.push(...validateRow(row, i));
      const key = [
        row.childFirst,
        row.childLast,
        row.providerFirst,
        row.providerLast,
        row.dateOfService,
        row.beginTime,
        row.endTime,
      ]
        .map((v) => String(v || '').trim().toLowerCase())
        .join('|');
      if (seen.has(key) && row.childFirst) {
        issues.push({
          field: 'dateOfService',
          message: `Row ${i + 1}: duplicate of row ${seen.get(key)} (same child, provider, date, and times).`,
          level: 'error',
          row: i,
        });
      } else {
        seen.set(key, i + 1);
      }
      const nameKey = `${String(row.childFirst || '').trim().toLowerCase()}|${String(row.childLast || '').trim().toLowerCase()}`;
      if (row.childFirst && row.childLast) {
        if (!nameCount.has(nameKey)) nameCount.set(nameKey, []);
        nameCount.get(nameKey).push(i + 1);
      }
    });
    for (const [, nums] of nameCount) {
      if (nums.length > 1) {
        issues.push({
          field: 'childFirst',
          message: `Rows ${nums.join(', ')}: same child name. That is OK for one child with several visits. If these are two different children, add Authorization #.`,
          level: 'warning',
          row: nums[0] - 1,
        });
      }
    }
    const errors = issues.filter((x) => x.level === 'error');
    const warnings = issues.filter((x) => x.level === 'warning');
    return { issues, errors, warnings, ok: errors.length === 0 };
  }

  root.rsValidate = {
    parseDate,
    validateRow,
    validateRows,
    NAME_RE,
    CPT_TOKEN_RE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
