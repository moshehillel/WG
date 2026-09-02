(function () {
  const drop = document.getElementById('drop');
  const mapDrop = document.getElementById('mapDrop');
  const fileInput = document.getElementById('file');
  const mapFile = document.getElementById('mapFile');
  const statusEl = document.getElementById('status');
  const mapStatusEl = document.getElementById('mapStatus');
  const tableWrap = document.getElementById('tableWrap');
  const tbody = document.getElementById('tbody');
  const actions = document.getElementById('actions');
  const btnExcel = document.getElementById('btnExcel');
  const btnTimesheet = document.getElementById('btnTimesheet');
  const btnBoth = document.getElementById('btnBoth');
  const btnAdd = document.getElementById('btnAdd');
  const btnClear = document.getElementById('btnClear');
  const btnClearMap = document.getElementById('btnClearMap');
  const metaEl = document.getElementById('meta');
  const warnEl = document.getElementById('warnings');
  const codesBody = document.getElementById('codesBody');
  const MAP_STORE = 'rsConverterCaseloadCsv.v1';

  let meta = { district: '', service: '', sourceName: '' };
  let caseloadEntries = [];
  let caseloadName = '';

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.dataset.kind = kind || '';
  }

  function setMapStatus(msg, kind) {
    mapStatusEl.textContent = msg || '';
    mapStatusEl.dataset.kind = kind || '';
  }

  function todayStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  function loadStoredMap() {
    try {
      const raw = localStorage.getItem(MAP_STORE);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.csv) return;
      caseloadEntries = rsMapping.parseCsv(parsed.csv);
      caseloadName = parsed.name || 'saved caseload map';
      setMapStatus(
        caseloadEntries.length
          ? `Caseload map: ${caseloadName} (${caseloadEntries.length} rows).`
          : 'Saved caseload map had no usable rows.',
        caseloadEntries.length ? 'ok' : 'err',
      );
    } catch (err) {
      caseloadEntries = [];
    }
  }

  function saveStoredMap(csv, name) {
    try {
      localStorage.setItem(MAP_STORE, JSON.stringify({ csv, name, savedAt: Date.now() }));
    } catch (err) {
      /* ignore quota */
    }
  }

  function applyMap(rows) {
    return rsMapping.applyMapping(rows, caseloadEntries, rsHistory);
  }

  async function pdfFileToPages(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    let doc;
    try {
      doc = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
    } catch (err) {
      doc = await pdfjsLib.getDocument({ data, verbosity: 0, disableWorker: true }).promise;
    }
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.map((it) => {
        const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
        return { str: it.str, x: tx[4], y: tx[5], w: it.width || 0 };
      });
      pages.push({ width: viewport.width, height: viewport.height, items });
    }
    return pages;
  }

  function val(tr, name) {
    const el = tr.querySelector(`[data-f="${name}"]`);
    return el ? el.value.trim() : '';
  }

  function readRow(tr) {
    let mappingWarnings = [];
    try {
      mappingWarnings = JSON.parse(tr.dataset.mappingWarnings || '[]');
    } catch (err) {
      mappingWarnings = [];
    }
    return {
      childFirst: val(tr, 'childFirst'),
      childLast: val(tr, 'childLast'),
      providerFirst: val(tr, 'providerFirst'),
      providerLast: val(tr, 'providerLast'),
      ratio: val(tr, 'ratio'),
      dateOfService: val(tr, 'dateOfService'),
      attendance: val(tr, 'attendance'),
      beginTime: val(tr, 'beginTime'),
      endTime: val(tr, 'endTime'),
      serviceDetail: val(tr, 'serviceDetail'),
      location: val(tr, 'location'),
      procedures: val(tr, 'procedures'),
      authorization: val(tr, 'authorization'),
      diagnoses: val(tr, 'diagnoses'),
      cancellationReason: val(tr, 'attendance') === 'Missed' ? val(tr, 'cancellationReason') : '',
      dosMadeUp: val(tr, 'attendance') === 'Makeup' ? val(tr, 'dosMadeUp') : '',
      region: '',
      covisit: '',
      service: tr.dataset.service || meta.service,
      district: tr.dataset.district || meta.district,
      mappedReason: tr.dataset.mappedReason || '',
      mappedServiceType: tr.dataset.mappedServiceType || '',
      mappingWarnings,
    };
  }

  function collectRows() {
    return [...tbody.querySelectorAll('tr')].map(readRow);
  }

  function recalcCode(tr) {
    if (tr.dataset.codeLocked === '1') return;
    const minutes = rsCodes.minutesBetween(val(tr, 'beginTime'), val(tr, 'endTime'));
    const code = rsCodes.buildServiceDetail({
      service: tr.dataset.service || meta.service,
      minutes,
      ratio: val(tr, 'ratio'),
    });
    const input = tr.querySelector('[data-f="serviceDetail"]');
    if (input) input.value = code;
  }

  function emptyRow() {
    return {
      childFirst: '',
      childLast: '',
      providerFirst: '',
      providerLast: '',
      ratio: '1:1',
      dateOfService: '',
      attendance: 'Attended',
      beginTime: '',
      endTime: '',
      serviceDetail: '',
      location: '',
      procedures: '',
      authorization: '',
      diagnoses: '',
      cancellationReason: '',
      dosMadeUp: '',
      service: meta.service,
      district: meta.district,
    };
  }

  function render(list, append) {
    if (!append) tbody.innerHTML = '';
    for (const r of list) {
      const tr = document.createElement('tr');
      tr.dataset.service = r.service || meta.service || '';
      tr.dataset.district = r.district || meta.district || '';
      if (r.mappedReason && r.mappedReason !== 'unmapped') tr.dataset.codeLocked = '1';
      if (r.mappedReason) tr.dataset.mappedReason = r.mappedReason;
      if (r.mappedServiceType) tr.dataset.mappedServiceType = r.mappedServiceType;
      tr.dataset.mappingWarnings = JSON.stringify(r.mappingWarnings || []);
      tr.innerHTML = `
        <td>
          <input data-f="childFirst" placeholder="First" value="${esc(r.childFirst)}" />
          <input data-f="childLast" placeholder="Last" value="${esc(r.childLast)}" />
        </td>
        <td><input data-f="ratio" value="${esc(r.ratio)}" /></td>
        <td>
          <input data-f="providerFirst" placeholder="First" value="${esc(r.providerFirst)}" />
          <input data-f="providerLast" placeholder="Last" value="${esc(r.providerLast)}" />
        </td>
        <td><input data-f="dateOfService" value="${esc(r.dateOfService)}" /></td>
        <td>
          <select data-f="attendance">
            <option${r.attendance === 'Attended' ? ' selected' : ''}>Attended</option>
            <option${r.attendance === 'Missed' ? ' selected' : ''}>Missed</option>
            <option${r.attendance === 'Makeup' ? ' selected' : ''}>Makeup</option>
          </select>
          <input data-f="cancellationReason" placeholder="Cancel reason if missed" value="${esc(r.cancellationReason || '')}" />
          <input data-f="dosMadeUp" placeholder="Original DOS if makeup" value="${esc(r.dosMadeUp || '')}" />
        </td>
        <td><input data-f="beginTime" value="${esc(r.beginTime)}" /></td>
        <td><input data-f="endTime" value="${esc(r.endTime)}" /></td>
        <td><input data-f="serviceDetail" value="${esc(r.serviceDetail)}" /></td>
        <td><input data-f="location" value="${esc(r.location)}" /></td>
        <td>
          <input data-f="procedures" placeholder="CPT" value="${esc(r.procedures)}" />
          <input data-f="diagnoses" placeholder="ICD" value="${esc(r.diagnoses)}" />
          <input data-f="authorization" placeholder="Auth #" value="${esc(r.authorization)}" />
        </td>
        <td><button type="button" class="btn-tiny" data-remove>Remove</button></td>
      `;
      tbody.appendChild(tr);
    }
    const count = tbody.querySelectorAll('tr').length;
    tableWrap.hidden = count === 0;
    actions.hidden = count === 0;
    metaEl.textContent = count
      ? `${count} session${count === 1 ? '' : 's'}${meta.district ? `  ·  ${meta.district}` : ''}${meta.service ? `  ·  ${meta.service}` : ''}${caseloadEntries.length ? `  ·  map ${caseloadName}` : ''}`
      : '';
    refreshWarnings();
  }

  function remapCurrentRows() {
    const rows = collectRows();
    if (!rows.length) return;
    render(applyMap(rows));
  }

  function refreshWarnings() {
    tbody.querySelectorAll('.invalid, .warn-field').forEach((el) => {
      el.classList.remove('invalid', 'warn-field');
    });
    tbody.querySelectorAll('tr').forEach((tr) => tr.classList.remove('row-error'));
    const rows = collectRows();
    if (!rows.length) {
      warnEl.hidden = true;
      warnEl.innerHTML = '';
      return { ok: false, errors: [{ message: 'No sessions to export.' }], warnings: [] };
    }
    const result = rsValidate.validateRows(rows);
    for (const issue of result.issues) {
      if (issue.row == null || issue.row < 0) continue;
      const tr = tbody.querySelectorAll('tr')[issue.row];
      if (!tr) continue;
      if (issue.level === 'error') tr.classList.add('row-error');
      const field = issue.field && tr.querySelector(`[data-f="${issue.field}"]`);
      if (field) field.classList.toggle(issue.level === 'error' ? 'invalid' : 'warn-field', true);
    }
    const has = result.errors.length || result.warnings.length;
    warnEl.hidden = !has;
    warnEl.dataset.kind = result.errors.length ? 'error' : 'warning';
    const blocks = [];
    if (result.errors.length) {
      blocks.push(
        `<strong>${result.errors.length} error${result.errors.length === 1 ? '' : 's'} — download is blocked until these are fixed</strong><ul>${result.errors.map((x) => `<li>${esc(x.message)}</li>`).join('')}</ul>`,
      );
    }
    if (result.warnings.length) {
      blocks.push(
        `<strong>${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}</strong><ul>${result.warnings.map((x) => `<li>${esc(x.message)}</li>`).join('')}</ul>`,
      );
    }
    warnEl.innerHTML = blocks.join('');
    return result;
  }

  function rowsIfValid() {
    const result = refreshWarnings();
    if (!result.ok) {
      setStatus(
        `Fix ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} before download.`,
        'err',
      );
      warnEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return null;
    }
    return collectRows();
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  async function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) {
      setStatus('Please choose a PDF session-notes report.', 'err');
      return;
    }
    const notPdf = files.filter((f) => !/\.pdf$/i.test(f.name));
    if (notPdf.length) {
      setStatus(`Not a PDF: ${notPdf.map((f) => f.name).join(', ')}`, 'err');
      return;
    }
    if (files.some((f) => f.size < 80)) {
      setStatus('That PDF file is empty or too small to be a session report.', 'err');
      return;
    }
    setStatus(`Reading ${files.length} PDF${files.length === 1 ? '' : 's'}…`);
    try {
      const allRows = [];
      const names = [];
      for (const file of files) {
        const head = String.fromCharCode(...new Uint8Array(await file.slice(0, 5).arrayBuffer()));
        if (!head.startsWith('%PDF')) {
          throw new Error(`${file.name} is not a valid PDF.`);
        }
        const pages = await pdfFileToPages(file);
        const sessions = rsParser.parsePages(pages);
        const rows = applyMap(rsParser.toImportRows(sessions));
        if (!rows.length) {
          throw new Error(`${file.name} has no session rows. Use a Related Service Session Notes PDF.`);
        }
        allRows.push(...rows);
        names.push(file.name);
      }
      if (!allRows.length) {
        setStatus('No sessions found. Use a Related Service Session Notes PDF.', 'err');
        render([]);
        return;
      }
      meta = {
        district: allRows[0]?.district || '',
        service: allRows.length === 1 || allRows.every((r) => r.service === allRows[0].service)
          ? allRows[0].service
          : 'Mixed services',
        sourceName: names.join(', '),
      };
      render(allRows);
      const mapped = allRows.filter((r) => r.mappedReason && r.mappedReason !== 'unmapped').length;
      setStatus(
        `Loaded ${allRows.length} session${allRows.length === 1 ? '' : 's'} from ${files.length} file${files.length === 1 ? '' : 's'}${mapped ? ` · ${mapped} matched to the caseload map` : ''}. Files stayed in this browser.`,
        'ok',
      );
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : String(err), 'err');
    }
  }

  function handleMapText(text, name) {
    const entries = rsMapping.parseCsv(text);
    if (!entries.length) {
      setMapStatus('That CSV has no child / service-type rows.', 'err');
      return;
    }
    caseloadEntries = entries;
    caseloadName = name || 'caseload map';
    saveStoredMap(text, caseloadName);
    setMapStatus(`Caseload map: ${caseloadName} (${entries.length} rows).`, 'ok');
    remapCurrentRows();
  }

  async function handleMapFiles(fileList) {
    const file = [...fileList][0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setMapStatus('Caseload map must be a CSV file.', 'err');
      return;
    }
    handleMapText(await file.text(), file.name);
  }

  function fillCodesTable() {
    if (!codesBody) return;
    codesBody.innerHTML = rsCodes.listSchoolCodes()
      .map(
        (r) =>
          `<tr><td>${r.discipline}</td><td>${r.minutes} min</td><td>${r.ratio}</td><td><code>${r.code}</code></td></tr>`,
      )
      .join('');
  }

  function bindDrop(el, onFiles) {
    el.addEventListener('click', () => {
      if (el === drop) fileInput.click();
      else mapFile.click();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
    ['dragenter', 'dragover'].forEach((ev) => {
      el.addEventListener(ev, (e) => {
        e.preventDefault();
        el.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      el.addEventListener(ev, (e) => {
        e.preventDefault();
        el.classList.remove('over');
      });
    });
    el.addEventListener('drop', (e) => {
      onFiles(e.dataTransfer?.files || []);
    });
  }

  tbody.addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    if (e.target.matches('[data-f="serviceDetail"]')) tr.dataset.codeLocked = '1';
    if (e.target.matches('[data-f="ratio"], [data-f="beginTime"], [data-f="endTime"]')) recalcCode(tr);
    refreshWarnings();
  });
  tbody.addEventListener('change', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    if (e.target.matches('[data-f="ratio"], [data-f="beginTime"], [data-f="endTime"]')) recalcCode(tr);
    if (e.target.matches('[data-f="attendance"]') && e.target.value === 'Makeup') {
      const dosEl = tr.querySelector('[data-f="dosMadeUp"]');
      if (dosEl && !dosEl.value.trim()) {
        const found = rsHistory.findUnusedMissed(val(tr, 'childFirst'), val(tr, 'childLast'), val(tr, 'dateOfService'));
        if (found) dosEl.value = found.date;
      }
    }
    refreshWarnings();
  });
  tbody.addEventListener('click', (e) => {
    if (!e.target.matches('[data-remove]')) return;
    e.target.closest('tr')?.remove();
    if (!tbody.querySelector('tr')) {
      render([]);
      setStatus('All rows removed.');
      return;
    }
    refreshWarnings();
    metaEl.textContent = `${tbody.querySelectorAll('tr').length} session(s)`;
  });

  bindDrop(drop, handleFiles);
  bindDrop(mapDrop, handleMapFiles);
  fileInput.addEventListener('change', () => handleFiles(fileInput.files || []));
  mapFile.addEventListener('change', () => handleMapFiles(mapFile.files || []));

  async function downloadExcel() {
    const current = rowsIfValid();
    if (!current) return;
    const wb = await rsExcel.buildActivityWorkbook(current);
    await rsExcel.downloadWorkbook(wb, `ActivityImport-${todayStamp()}.xlsx`);
    rsHistory.recordFromRows(current);
    setStatus('Excel import downloaded. Import it in ProviderSoft after a last name check.', 'ok');
  }

  function downloadTimesheet() {
    const current = rowsIfValid();
    if (!current) return;
    rsTimesheet.downloadTimesheet(current, meta, `Timesheet-${todayStamp()}.pdf`);
    setStatus('Fillable timesheet PDF downloaded.', 'ok');
  }

  btnExcel.addEventListener('click', downloadExcel);
  btnTimesheet.addEventListener('click', downloadTimesheet);
  btnBoth.addEventListener('click', async () => {
    downloadTimesheet();
    await downloadExcel();
  });
  btnAdd.addEventListener('click', () => render([emptyRow()], true));
  btnClear.addEventListener('click', () => {
    render([]);
    fileInput.value = '';
    setStatus('Cleared.');
  });
  btnClearMap.addEventListener('click', () => {
    caseloadEntries = [];
    caseloadName = '';
    try {
      localStorage.removeItem(MAP_STORE);
    } catch (err) {
      /* ignore */
    }
    mapFile.value = '';
    setMapStatus('Caseload map cleared. Service codes will use time, ratio, and discipline.');
    remapCurrentRows();
  });

  fillCodesTable();
  loadStoredMap();
})();
