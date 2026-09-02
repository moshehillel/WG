(function (root) {
  const CREDS = new Set(['pt', 'ot', 'slp', 'st', 'dpt', 'cota', 'pta', 'ms', 'ma', 'ccc', 'r', 'l']);

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function splitPersonName(raw) {
    let s = String(raw || '')
      .replace(/\(white glove\)/gi, '')
      .replace(/\(.*?\)/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/,$/, '')
      .trim();
    if (!s) return { first: '', last: '' };
    if (s.includes(',')) {
      const bits = s.split(',').map((p) => p.trim()).filter(Boolean);
      const last = bits[0];
      const firstParts = bits.slice(1).filter((p) => !CREDS.has(p.toLowerCase().replace(/\./g, '')));
      return { first: firstParts.join(' ').trim(), last };
    }
    const parts = s.split(' ');
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  /** Caseload CSV is usually Last … First (e.g. De Oliveira Jack). */
  function splitMappingName(raw) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return { first: '', last: '' };
    const parts = s.split(' ');
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[parts.length - 1], last: parts.slice(0, -1).join(' ') };
  }

  function nameKeys(first, last) {
    const f = normalize(first);
    const l = normalize(last);
    const keys = new Set();
    if (f && l) {
      keys.add(`${l}|${f}`);
      keys.add(`${f}|${l}`);
    }
    const tokens = `${l} ${f}`.trim().split(/\s+/).filter(Boolean).sort();
    if (tokens.length) keys.add(tokens.join(' '));
    return [...keys];
  }

  function parseCsv(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const split = (line) => {
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
          q = !q;
        } else if (ch === ',' && !q) {
          out.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      out.push(cur.trim());
      return out;
    };
    const header = split(lines[0]).map((h) => h.replace(/"/g, '').trim().toLowerCase());
    const col = (aliases) => {
      const exact = header.findIndex((h) => aliases.some((a) => h === a));
      if (exact >= 0) return exact;
      return header.findIndex((h) => aliases.some((a) => h.includes(a)));
    };
    const iName = col(["child's name", 'child name', 'child']);
    const iDob = col(['date of birth', 'birth', 'dob']);
    const iType = col(['service type']);
    const iFreq = col(['basic mandate frequency', 'frequency', 'mandate']);
    const iProg = col(['program type']);
    const iId = col(['program id']);
    const rows = [];
    for (const line of lines.slice(1)) {
      const cells = split(line);
      const name = cells[iName] || '';
      const serviceType = cells[iType] || '';
      if (!name || !serviceType) continue;
      if (/^parent communication$/i.test(name)) continue;
      const person = splitMappingName(name);
      rows.push({
        name,
        first: person.first,
        last: person.last,
        dob: iDob >= 0 ? cells[iDob] : '',
        serviceType,
        frequency: iFreq >= 0 ? cells[iFreq] : '',
        programType: iProg >= 0 ? cells[iProg] : '',
        programId: iId >= 0 ? cells[iId] : '',
      });
    }
    return rows;
  }

  function indexCaseload(entries) {
    const byKey = new Map();
    for (const e of entries) {
      for (const k of nameKeys(e.first, e.last)) {
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(e);
      }
    }
    return byKey;
  }

  function lookupChild(index, first, last) {
    for (const k of nameKeys(first, last)) {
      if (index.has(k)) return index.get(k);
    }
    return [];
  }

  function isGroupType(type) {
    return /\bgroup\b/i.test(type);
  }

  function isMakeupType(type) {
    return /\bmakeup\b/i.test(type) || /make[\s-]?up/i.test(type);
  }

  function isEvalType(type) {
    return /\beval\b/i.test(type);
  }

  function pickServiceType(entries, row) {
    if (!entries.length) return { serviceDetail: row.serviceDetail, reason: 'unmapped' };
    const therapy = entries.filter((e) => !isEvalType(e.serviceType));
    const pool = therapy.length ? therapy : entries;
    const makeup = pool.find((e) => isMakeupType(e.serviceType));
    const group = pool.find((e) => isGroupType(e.serviceType));
    const individual = pool.find((e) => !isGroupType(e.serviceType) && !isMakeupType(e.serviceType));
    const sessionGroup = root.rsCodes.parseRatio(row.ratio).group;

    if (row.attendance === 'Makeup' && !String(row.dosMadeUp || '').trim() && makeup) {
      return { serviceDetail: makeup.serviceType, reason: 'makeup-mandate', mapped: makeup };
    }
    if (row.attendance === 'Makeup' && makeup && String(row.dosMadeUp || '').trim()) {
      const base = group || individual || makeup;
      return { serviceDetail: base.serviceType, reason: 'makeup-with-date', mapped: base, makeupType: makeup.serviceType };
    }
    if (group && !sessionGroup) {
      return {
        serviceDetail: group.serviceType,
        reason: 'group-mandate-1to1',
        mapped: group,
        warning: `Group mandate (${group.serviceType}) but session ratio is ${row.ratio || '1:1'}. Imported as group — change the rate in ProviderSoft.`,
      };
    }
    if (group && sessionGroup) {
      return { serviceDetail: group.serviceType, reason: 'group', mapped: group };
    }
    if (individual) {
      return { serviceDetail: individual.serviceType, reason: 'individual', mapped: individual };
    }
    return { serviceDetail: pool[0].serviceType, reason: 'first', mapped: pool[0] };
  }

  function dateStamp(date) {
    const p = String(date || '').split('/');
    if (p.length !== 3) return 0;
    const y = Number(p[2].length === 2 ? `20${p[2]}` : p[2]);
    return Date.UTC(y, Number(p[0]) - 1, Number(p[1]));
  }

  function sameChild(a, b) {
    const keys = new Set(nameKeys(a.childFirst, a.childLast));
    return nameKeys(b.childFirst, b.childLast).some((k) => keys.has(k));
  }

  function applyMapping(rows, entries, history) {
    const list = entries || [];
    const index = indexCaseload(list);
    const hist = history || root.rsHistory;
    const usedMissed = new Set();
    return rows.map((row) => {
      const next = { ...row, mappingWarnings: [...(row.mappingWarnings || [])] };
      if (next.attendance === 'Makeup' && !next.dosMadeUp) {
        const before = dateStamp(next.dateOfService) || Date.now();
        const fromFile = rows
          .filter((r) => r.attendance === 'Missed' && r.dateOfService && sameChild(r, next))
          .filter((r) => dateStamp(r.dateOfService) && dateStamp(r.dateOfService) < before)
          .filter((r) => !usedMissed.has(`${r.childFirst}|${r.childLast}|${r.dateOfService}`.toLowerCase()))
          .sort((a, b) => dateStamp(b.dateOfService) - dateStamp(a.dateOfService));
        if (fromFile[0]) {
          next.dosMadeUp = fromFile[0].dateOfService;
          usedMissed.add(`${fromFile[0].childFirst}|${fromFile[0].childLast}|${fromFile[0].dateOfService}`.toLowerCase());
          next.mappingWarnings.push(`Makeup DOS filled from a missed visit in this file (${next.dosMadeUp}).`);
        } else if (hist) {
          const found = hist.findUnusedMissed(next.childFirst, next.childLast, next.dateOfService);
          if (found) {
            next.dosMadeUp = found.date;
            next.mappingWarnings.push(`Makeup DOS filled from last imported missed visit (${found.date}).`);
          }
        }
      }
      if (!list.length) return next;
      const hits = lookupChild(index, next.childFirst, next.childLast);
      if (!hits.length) {
        next.mappingWarnings.push('Child not found on the caseload map.');
        return next;
      }
      const picked = pickServiceType(hits, next);
      next.serviceDetail = picked.serviceDetail;
      next.mappedServiceType = picked.serviceDetail;
      next.mappedReason = picked.reason;
      if (picked.warning) next.mappingWarnings.push(picked.warning);
      return next;
    });
  }

  root.rsMapping = {
    normalize,
    splitPersonName,
    splitMappingName,
    nameKeys,
    parseCsv,
    indexCaseload,
    lookupChild,
    isGroupType,
    isMakeupType,
    pickServiceType,
    applyMapping,
  };
})(typeof window !== 'undefined' ? window : globalThis);
