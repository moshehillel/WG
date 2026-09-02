(function (root) {
  const KEY = 'rsConverterMissedDates.v1';

  function childKey(first, last) {
    return `${root.rsMapping.normalize(last)}|${root.rsMapping.normalize(first)}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (err) {
      /* ignore quota */
    }
  }

  function parseStamp(date) {
    const p = String(date || '').split('/');
    if (p.length !== 3) return 0;
    const y = Number(p[2].length === 2 ? `20${p[2]}` : p[2]);
    return Date.UTC(y, Number(p[0]) - 1, Number(p[1]));
  }

  function findUnusedMissed(first, last, beforeDate) {
    const key = childKey(first, last);
    const before = parseStamp(beforeDate) || Date.now();
    const list = load()
      .filter((x) => x.key === key && !x.used && parseStamp(x.date) && parseStamp(x.date) < before)
      .sort((a, b) => parseStamp(b.date) - parseStamp(a.date));
    return list[0] || null;
  }

  function recordFromRows(rows) {
    const list = load();
    for (const row of rows) {
      const key = childKey(row.childFirst, row.childLast);
      if (!key.replace('|', '')) continue;
      if (row.attendance === 'Missed' && row.dateOfService) {
        const exists = list.some(
          (x) => x.key === key && x.date === row.dateOfService && !x.used,
        );
        if (!exists) {
          list.push({
            key,
            date: row.dateOfService,
            used: false,
            child: `${row.childFirst} ${row.childLast}`.trim(),
          });
        }
      }
      if (row.attendance === 'Makeup' && row.dosMadeUp) {
        const hit = list.find((x) => x.key === key && x.date === row.dosMadeUp && !x.used);
        if (hit) hit.used = true;
      }
    }
    save(list);
  }

  root.rsHistory = { load, save, findUnusedMissed, recordFromRows, childKey };
})(typeof window !== 'undefined' ? window : globalThis);
