(function (root) {
  const DATE_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})$/;
  const TIME_RE = /^(\d{1,2}:\d{2})\s*([ap]\.?m\.?)?$/i;
  const RATIO_RE = /^\d+\s*:\s*\d+$/;
  const CPT_RE = /^\d{4,5}$/;
  const MISSED_RE =
    /\b(absent|missed|cancell?ed|no[\s-]?show|did not attend|not present|refused|not available|not in school)\b/i;
  const MAKEUP_RE = /\b(makeup|make[\s-]?up|make up)\b/i;
  const HEADER_LINE_RE = /^(ratio|cpt code|cpt units|session (end|start)|service date|setting|log type|icd code)\b/i;

  function splitPersonName(raw) {
    if (root.rsMapping && root.rsMapping.splitPersonName) {
      return root.rsMapping.splitPersonName(raw);
    }
    const s = String(raw || '')
      .replace(/\s+/g, ' ')
      .replace(/,$/, '')
      .trim();
    if (!s) return { first: '', last: '' };
    if (s.includes(',')) {
      const [last, ...rest] = s.split(',');
      return { first: rest.join(' ').trim(), last: last.trim() };
    }
    const parts = s.split(' ');
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  function cols(width) {
    const w = width > 0 ? width : 792;
    return {
      date: [0, w * 0.12],
      ratio: [w * 0.105, w * 0.175],
      start: [w * 0.16, w * 0.255],
      end: [w * 0.25, w * 0.36],
      notes: [w * 0.35, w * 0.70],
      cpt: [w * 0.70, w * 0.80],
      units: [w * 0.80, w * 0.88],
      icd: [w * 0.88, w],
      left: [0, w * 0.185],
    };
  }

  function itemsToLines(items) {
    const rows = [];
    for (const it of items) {
      const str = String(it.str || '').replace(/\s+/g, ' ').trim();
      if (!str) continue;
      const x = it.x;
      const y = it.y;
      let row = rows.find((r) => Math.abs(r.y - y) < 4);
      if (!row) {
        row = { y, cells: [] };
        rows.push(row);
      }
      row.cells.push({ x, str, w: it.w || 0 });
    }
    rows.sort((a, b) => a.y - b.y);
    return rows.map((r) => {
      r.cells.sort((a, b) => a.x - b.x);
      return {
        y: r.y,
        text: r.cells
          .map((c) => c.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
        cells: r.cells,
      };
    });
  }

  function cellIn(cells, band) {
    return cells
      .filter((c) => c.x >= band[0] && c.x < band[1])
      .map((c) => c.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseHeaderValue(lines, labelRe) {
    for (const line of lines) {
      const m = line.text.match(labelRe);
      if (m) return m[1].trim();
    }
    return '';
  }

  function formatTime(raw) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    const m = s.match(/^(\d{1,2}:\d{2})\s*([ap]\.?m\.?)?$/i);
    if (!m) return s;
    const ap = m[2] ? m[2].toLowerCase().replace(/\./g, '') : '';
    return ap ? `${m[1]} ${ap}` : m[1];
  }

  function attendanceFromNotes(notes, timeIn, timeOut) {
    const n = String(notes || '');
    if (/student absence|student not available|student not in school|student absent/i.test(n)) {
      return 'Missed';
    }
    if (MAKEUP_RE.test(n)) return 'Makeup';
    if (MISSED_RE.test(n) && !/make[\s-]?up session/i.test(n)) return 'Missed';
    if (timeIn && timeOut) return 'Attended';
    return 'Missed';
  }

  function cancellationFromNotes(notes, attendance) {
    if (attendance !== 'Missed') return '';
    const n = String(notes || '');
    if (/not available/i.test(n)) return 'Student Not Available';
    if (/no[\s-]?show/i.test(n)) return 'No Show';
    if (/cancell?ed/i.test(n)) return 'Cancelled';
    if (/refused/i.test(n)) return 'Refused';
    if (/not in school/i.test(n)) return 'Student not in school';
    return 'Student Absent';
  }

  function extractMakeupDate(notes) {
    const n = String(notes || '');
    if (!MAKEUP_RE.test(n)) return '';
    const m = n.match(
      /(?:missed(?:\s+session)?(?:\s+on)?|makeup for|make[\s-]?up for|original(?:\s+date|\s+dos)?|for(?:\s+date)?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    );
    return m ? m[1] : '';
  }

  function extractIcd(text) {
    const m = String(text || '').match(/\b([A-TV-Z]\d{2}(?:\.\d{1,4})?)\b/i);
    return m ? m[1].toUpperCase() : '';
  }

  function extractSignature(text) {
    return String(text || '')
      .replace(/Provider Signature\/Credentials/gi, '')
      .replace(/\bDate\b/gi, '')
      .replace(/Telehealth:\s*(Yes|No)?/gi, '')
      .replace(/\(NPI#\s*\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isSessionDateLine(line, c) {
    const dateCell = cellIn(line.cells, c.date);
    if (!DATE_RE.test(dateCell)) return false;
    if (/^From:/i.test(line.text) || /\bTo:\s*\d{1,2}\//i.test(line.text)) return false;
    if (/D\.?O\.?B/i.test(line.text)) return false;
    if (HEADER_LINE_RE.test(line.text)) return false;
    return true;
  }

  function parsePages(pages) {
    const allLines = [];
    for (const page of pages) {
      const width = page.width || 792;
      for (const line of itemsToLines(page.items)) {
        if (/^Page\s+\d+\s+of\s+\d+$/i.test(line.text)) continue;
        allLines.push({ ...line, width });
      }
    }

    let district = parseHeaderValue(allLines, /District\/Agency\/BOCES:\s*(.+)$/i);
    let service = '';
    let providerRaw = '';
    let studentRaw = '';
    const sessions = [];

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      const t = line.text;
      const c = cols(line.width);

      if (/^Service:\s+/i.test(t) && !/Service Provided/i.test(t)) {
        service = t.replace(/^Service:\s+/i, '').trim();
        continue;
      }
      if (/Service Provider:?/i.test(t)) {
        providerRaw = t.replace(/^.*Service Provider:?\s*/i, '').trim();
        continue;
      }
      if (/Student Name:/i.test(t)) {
        const rest = t.replace(/^.*Student Name:\s*/i, '').trim();
        studentRaw = rest.replace(/,?\s*D\.?O\.?B\..*$/i, '').replace(/,$/, '').trim();
        continue;
      }

      if (!isSessionDateLine(line, c)) continue;

      const dateCell = cellIn(line.cells, c.date);
      const ratioCell = cellIn(line.cells, c.ratio);
      const ratio =
        (ratioCell.match(/\d+\s*:\s*\d+/) || [])[0] ||
        (t.match(/\b(\d+\s*:\s*\d+)\b/) || [])[1] ||
        (ratioCell === '0' ? '0' : '');
      const start = cellIn(line.cells, c.start);
      const end = cellIn(line.cells, c.end);
      const timesOnLine = [...t.matchAll(/(\d{1,2}:\d{2}\s*[ap]\.?m\.?)/gi)].map((m) => m[1]);
      const timeIn = formatTime(TIME_RE.test(start) ? start : timesOnLine[0] || '');
      const timeOut = formatTime(TIME_RE.test(end) ? end : timesOnLine[1] || '');
      const cpt = (cellIn(line.cells, c.cpt).match(/\b(\d{4,5})\b/) || [])[1] || '';
      const unitsRaw = cellIn(line.cells, c.units);
      const units = (unitsRaw.match(/\b(\d{1,2})\b/) || [])[1] || '';
      const notesHere = cellIn(line.cells, c.notes);
      const icd = cellIn(line.cells, c.icd);

      let setting = '';
      let notes = notesHere;
      let signature = '';
      let j = i + 1;
      while (j < allLines.length) {
        const nxt = allLines[j];
        const nc = cols(nxt.width);
        if (isSessionDateLine(nxt, nc)) break;
        if (/Student Name:/i.test(nxt.text)) break;
        if (/^Service:\s+/i.test(nxt.text) && !/Service Provided/i.test(nxt.text)) break;

        const left = cellIn(nxt.cells, nc.left);
        const midNotes = cellIn(nxt.cells, nc.notes);
        if (/Student Absence|Student Not Available|Service Provided:/i.test(nxt.text)) {
          notes = notes ? `${notes} ${nxt.text}` : nxt.text;
        } else if (midNotes) {
          notes = notes ? `${notes} ${midNotes}` : midNotes;
        }
        if (
          left &&
          !/^Telehealth/i.test(left) &&
          !/Signature\/Credentials/i.test(left) &&
          !/^Student (Absence|Not Available)/i.test(left) &&
          !DATE_RE.test(left) &&
          !TIME_RE.test(left) &&
          !setting
        ) {
          setting = left;
        }
        if (/Signature\/Credentials/i.test(nxt.text)) {
          const sig = extractSignature(nxt.text);
          if (sig) signature = sig;
        }
        j += 1;
      }

      sessions.push({
        district,
        service,
        providerRaw,
        studentRaw,
        date: dateCell,
        ratio: ratio.replace(/\s+/g, ''),
        timeIn,
        timeOut,
        cpt: String(cpt).trim(),
        units: String(units).replace(/\s+/g, '').trim() || '1',
        setting: setting.trim(),
        notes: String(notes || '').replace(/\s+/g, ' ').trim(),
        signature: signature.trim(),
        icd: String(icd || extractIcd(notes) || extractIcd(t) || '').trim(),
      });
    }

    return mergeSessions(sessions);
  }

  function mergeSessions(sessions) {
    const map = new Map();
    const order = [];
    for (const s of sessions) {
      const key = [s.studentRaw, s.providerRaw, s.date, s.timeIn, s.timeOut].join('|').toLowerCase();
      if (!map.has(key)) {
        map.set(key, { ...s, procedures: [], diagnoses: s.icd || '' });
        order.push(key);
      }
      const row = map.get(key);
      if (s.cpt) {
        const label = s.units && s.units !== '1' ? `${s.cpt}x${s.units}` : `${s.cpt}x1`;
        if (!row.procedures.some((p) => p.startsWith(`${s.cpt}x`))) row.procedures.push(label);
      }
      if (!row.setting && s.setting) row.setting = s.setting;
      if ((s.notes || '').length > (row.notes || '').length) row.notes = s.notes;
      if (s.signature) row.signature = s.signature;
      if (s.icd && !row.diagnoses) row.diagnoses = s.icd;
    }
    return order.map((k) => map.get(k));
  }

  function toImportRows(sessions) {
    const codes = root.rsCodes;
    return sessions.map((s) => {
      const child = splitPersonName(s.studentRaw);
      const provider = splitPersonName(s.providerRaw);
      const minutes = codes.minutesBetween(s.timeIn, s.timeOut);
      const discipline = codes.disciplineFromService(s.service);
      const ratioInfo = codes.parseRatio(s.ratio);
      const attendance = attendanceFromNotes(s.notes, s.timeIn, s.timeOut);
      const dosMadeUp = extractMakeupDate(s.notes);
      const ratioNorm = s.ratio === '0' ? '' : s.ratio;
      return {
        childFirst: child.first,
        childLast: child.last,
        providerFirst: provider.first,
        providerLast: provider.last,
        serviceDetail: codes.buildServiceDetail({
          discipline,
          minutes,
          ratio: ratioNorm || (attendance === 'Missed' ? '1:1' : s.ratio),
          service: s.service,
        }),
        authorization: '',
        dateOfService: s.date,
        beginTime: s.timeIn,
        endTime: s.timeOut,
        diagnoses: s.diagnoses || s.icd || '',
        procedures: (s.procedures || []).join(', '),
        attendance,
        cancellationReason: cancellationFromNotes(s.notes, attendance),
        dosMadeUp,
        location: s.setting,
        region: '',
        covisit: '',
        ratio: ratioNorm || s.ratio,
        durationMin: minutes,
        durationBucket: codes.bucketMinutes(minutes),
        group: ratioInfo.group,
        discipline,
        service: s.service,
        district: s.district,
        notes: s.notes,
        signature: s.signature,
      };
    });
  }

  root.rsParser = {
    splitPersonName,
    itemsToLines,
    parsePages,
    toImportRows,
    attendanceFromNotes,
    cancellationFromNotes,
    extractMakeupDate,
    extractIcd,
    DATE_RE,
    TIME_RE,
    RATIO_RE,
    CPT_RE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
