(function (root) {
  function parseClockParts(value) {
    const mins = root.rsCodes.parseClock(value);
    if (mins == null) return null;
    return { h: Math.floor(mins / 60), m: mins % 60 };
  }

  function parseDateParts(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return { y: year, mo: Number(m[1]) - 1, d: Number(m[2]) };
  }

  function excelDate(value) {
    const p = parseDateParts(value);
    if (!p) return String(value || '') || null;
    return new Date(p.y, p.mo, p.d);
  }

  function excelTime(value, dateValue) {
    const t = parseClockParts(value);
    if (!t) return String(value || '') || null;
    const d = parseDateParts(dateValue) || { y: 1899, mo: 11, d: 30 };
    return new Date(d.y, d.mo, d.d, t.h, t.m, 0);
  }

  async function buildActivityWorkbook(rows) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'RS Converter';
    const ws = wb.addWorksheet('Sheet1');
    ws.columns = [
      { header: 'Child First', key: 'childFirst', width: 16 },
      { header: 'Child Last', key: 'childLast', width: 16 },
      { header: 'Provider First', key: 'providerFirst', width: 16 },
      { header: 'Provider Last', key: 'providerLast', width: 16 },
      { header: 'Service Detail', key: 'serviceDetail', width: 24 },
      { header: 'Authorization #', key: 'authorization', width: 18 },
      { header: 'Date Of Service', key: 'dateOfService', width: 16 },
      { header: 'Begin Time', key: 'beginTime', width: 14 },
      { header: 'End Time', key: 'endTime', width: 14 },
      { header: 'Diagnoses', key: 'diagnoses', width: 14 },
      { header: 'Procedures', key: 'procedures', width: 22 },
      { header: 'Attendance', key: 'attendance', width: 14 },
      { header: 'Cancellation Reason', key: 'cancellationReason', width: 22 },
      { header: 'DOS Made Up', key: 'dosMadeUp', width: 14 },
      { header: 'Location', key: 'location', width: 22 },
      { header: 'Region', key: 'region', width: 12 },
      { header: 'Covisit', key: 'covisit', width: 10 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };

    for (const r of rows) {
      const row = ws.addRow({
        childFirst: r.childFirst,
        childLast: r.childLast,
        providerFirst: r.providerFirst,
        providerLast: r.providerLast,
        serviceDetail: r.serviceDetail,
        authorization: r.authorization || '',
        dateOfService: excelDate(r.dateOfService) || '',
        beginTime: excelTime(r.beginTime, r.dateOfService) || '',
        endTime: excelTime(r.endTime, r.dateOfService) || '',
        diagnoses: r.diagnoses || '',
        procedures: r.procedures || '',
        attendance: r.attendance || 'Attended',
        cancellationReason: r.attendance === 'Missed' ? r.cancellationReason || '' : '',
        dosMadeUp: r.attendance === 'Makeup' ? excelDate(r.dosMadeUp) || r.dosMadeUp || '' : '',
        location: r.location || '',
        region: r.region || '',
        covisit: r.covisit || '',
      });
      row.getCell('dateOfService').numFmt = 'mm/dd/yyyy';
      row.getCell('beginTime').numFmt = 'h:mm AM/PM';
      row.getCell('endTime').numFmt = 'h:mm AM/PM';
      if (r.attendance === 'Makeup' && r.dosMadeUp) row.getCell('dosMadeUp').numFmt = 'mm/dd/yyyy';
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 17 },
    };
    return wb;
  }

  async function downloadWorkbook(wb, filename) {
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    triggerDownload(blob, filename);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  root.rsExcel = { buildActivityWorkbook, downloadWorkbook, triggerDownload };
})(typeof window !== 'undefined' ? window : globalThis);
