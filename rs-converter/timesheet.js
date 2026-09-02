(function (root) {
  function dateRange(rows) {
    const dates = rows.map((r) => r.dateOfService).filter(Boolean);
    if (!dates.length) return '';
    const uniq = [...new Set(dates)];
    uniq.sort((a, b) => {
      const [ma, da, ya] = a.split('/').map(Number);
      const [mb, db, yb] = b.split('/').map(Number);
      return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
    });
    return uniq[0] === uniq[uniq.length - 1]
      ? uniq[0]
      : `${uniq[0]} – ${uniq[uniq.length - 1]}`;
  }

  function jspdfNamespace() {
    const candidates = [
      root.jspdf,
      typeof window !== 'undefined' ? window.jspdf : null,
      typeof globalThis !== 'undefined' ? globalThis.jspdf : null,
    ];
    return candidates.find((ns) => ns && ns.jsPDF) || null;
  }

  function acroFormApi() {
    const ns = jspdfNamespace();
    return (ns && ns.jsPDF && ns.jsPDF.AcroForm) || null;
  }

  function addTextField(doc, name, x, y, w, h) {
    const Acro = acroFormApi();
    if (!Acro || !Acro.TextField || typeof doc.addField !== 'function') return false;
    const field = new Acro.TextField();
    field.fieldName = name;
    field.Rect = [x, y, w, h];
    field.fontSize = 10;
    field.multiline = false;
    try {
      doc.addField(field);
      return true;
    } catch (err) {
      return false;
    }
  }

  function drawSignatureBlock(doc, y, margin, lineW) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Provider signature', margin, y);
    doc.line(margin, y + 26, margin + lineW, y + 26);
    addTextField(doc, 'providerSignature', margin, y + 8, lineW, 18);
    doc.text('Date', margin + lineW + 28, y);
    doc.line(margin + lineW + 28, y + 26, margin + lineW + 150, y + 26);
    addTextField(doc, 'providerDate', margin + lineW + 28, y + 8, 122, 18);

    y += 52;
    doc.text('Supervisor signature', margin, y);
    doc.line(margin, y + 26, margin + lineW, y + 26);
    addTextField(doc, 'supervisorSignature', margin, y + 8, lineW, 18);
    doc.text('Date', margin + lineW + 28, y);
    doc.line(margin + lineW + 28, y + 26, margin + lineW + 150, y + 26);
    addTextField(doc, 'supervisorDate', margin + lineW + 28, y + 8, 122, 18);
    return y;
  }

  function buildTimesheetPdf(rows, meta) {
    const JsPDF = jspdfNamespace().jsPDF;
    const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 36;

    const title = 'Related Service Timesheet';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(title, pageW / 2, 36, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const subtitle = [meta.district, meta.service, dateRange(rows)].filter(Boolean).join('  ·  ');
    if (subtitle) doc.text(subtitle, pageW / 2, 52, { align: 'center' });

    const body = rows.map((r) => [
      `${r.childFirst} ${r.childLast}`.trim(),
      r.ratio || '',
      `${r.providerFirst} ${r.providerLast}`.trim(),
      r.dateOfService || '',
      r.attendance || '',
      r.beginTime || '',
      r.endTime || '',
      r.serviceDetail || '',
    ]);

    doc.autoTable({
      startY: 66,
      margin: { left: margin, right: margin, bottom: 88 },
      head: [[
        'Child name',
        'Ratio',
        'Provider name',
        'Date of service',
        'Attended or missed',
        'Time in',
        'Time out',
        'Service code',
      ]],
      body,
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 40 },
        2: { cellWidth: 100 },
        3: { cellWidth: 78 },
        4: { cellWidth: 78 },
        5: { cellWidth: 54 },
        6: { cellWidth: 54 },
        7: { cellWidth: 120 },
      },
      didDrawPage() {
        const n = doc.internal.getNumberOfPages();
        const current = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text(`Page ${current} of ${n}`, pageW - margin, pageH - 18, { align: 'right' });
        doc.setTextColor(0);
      },
    });

    let y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : 66) + 40;
    if (y > pageH - 100) {
      doc.addPage();
      y = 64;
    }
    drawSignatureBlock(doc, y, margin, 240);
    return doc;
  }

  function downloadTimesheet(rows, meta, filename) {
    const doc = buildTimesheetPdf(rows, meta);
    doc.save(filename);
  }

  root.rsTimesheet = { buildTimesheetPdf, downloadTimesheet, addTextField };
})(typeof window !== 'undefined' ? window : globalThis);
