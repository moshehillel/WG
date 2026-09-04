const CFG = (typeof window !== 'undefined' && window.TMS_CONFIG) || {};
const API = (localStorage.getItem('tmsApi') || CFG.apiUrl || 'http://127.0.0.1:8787').replace(/\/$/, '');
const USER_POOL_ID = CFG.userPoolId || '';
const CLIENT_ID = CFG.clientId || '';
// Real sign-in only when the build gives us a Cognito app client id.
// Without it (local dev) the role dropdown + dev headers keep working.
const COGNITO_MODE = Boolean(CLIENT_ID);

const state = {
  role: 'therapist',
  email: '',
  idToken: localStorage.getItem('tmsIdToken') || '',
  accessToken: localStorage.getItem('tmsAccessToken') || '',
  weekId: '',
  weekStart: mondayIso(),
  last: null,
  mandateDraft: null,
  caseloadPreview: null,
  caseloadImport: null,
  reportFrom: '',
  reportTo: '',
  childDetailBack: 'children',
  focusSchoolId: '',
  lastServiceProviderId: '',
  childSessionFrom: '',
  childSessionTo: '',
};

function mondayIso() {
  const d = new Date();
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function mondayFromDos(dos) {
  const s = String(dos || '').trim();
  let d;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (iso) d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  else if (md) {
    let y = Number(md[3]);
    if (y < 100) y += 2000;
    d = new Date(Date.UTC(y, Number(md[1]) - 1, Number(md[2])));
  } else return '';
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function downloadReportXlsx(path, filename) {
  const res = await fetch(API + path, { method: 'GET', headers: headers() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not export ${filename}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function headers() {
  if (COGNITO_MODE) {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${state.idToken}`,
    };
  }
  return {
    'content-type': 'application/json',
    'x-tms-role': state.role,
    'x-tms-email': state.role === 'admin' ? 'admin@whiteglove.local' : 'therapist@whiteglove.local',
  };
}

function issueListFromPayload(data) {
  const fromArr = Array.isArray(data?.errors)
    ? data.errors
        .map((e) => (typeof e === 'string' ? e : e?.message || e?.problem || JSON.stringify(e)))
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    : [];
  const warnArr = Array.isArray(data?.warnings)
    ? data.warnings.map((w) => String(w || '').trim()).filter(Boolean)
    : [];
  const base = String(data?.error || data?.message || '').trim();
  const errors = fromArr.length ? fromArr : base ? [base] : [];
  return { errors, warnings: warnArr, summary: base || errors[0] || '' };
}

function apiError(message, extras = {}) {
  const err = new Error(message || 'Request failed.');
  err.errors = Array.isArray(extras.errors) ? extras.errors : [];
  err.warnings = Array.isArray(extras.warnings) ? extras.warnings : [];
  err.status = extras.status;
  return err;
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw apiError(
      'Could not reach the server. If you use NetFree, the app must use the /api proxy. Try refresh.',
    );
  }
  if (res.status === 401 && COGNITO_MODE) {
    signOut('Your sign in ended. Please sign in again.');
    throw apiError('Please sign in again.', { status: 401 });
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('pdf') ? await res.blob() : await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 207)) {
    const { errors, warnings, summary } = issueListFromPayload(data);
    const msg =
      summary ||
      (res.statusText && res.statusText !== 'Bad Request' ? res.statusText : '') ||
      `Request failed (${res.status}). Check the red messages under Read PDF.`;
    throw apiError(msg, { errors, warnings, status: res.status });
  }
  return data;
}

function setUploadIssues(errors, warnings) {
  const el = document.getElementById('uploadIssues');
  if (!el) return;
  const errs = (errors || []).map((e) => String(e || '').trim()).filter(Boolean);
  const warns = (warnings || []).map((w) => String(w || '').trim()).filter(Boolean);
  if (!errs.length && !warns.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = [
    errs.length
      ? `<div class="err-box upload-issue-block"><strong>Upload blocked</strong>${errs
          .map((e) => `<div class="upload-issue-line">${esc(e)}</div>`)
          .join('')}</div>`
      : '',
    warns.length
      ? `<div class="warn-box upload-issue-block"><strong>Warnings</strong>${warns
          .map((w) => `<div class="upload-issue-line">${esc(w)}</div>`)
          .join('')}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');
}

function openingAccountView() {
  view(`
    <div class="card">
      <h2>Opening your account…</h2>
      <p>Please wait a moment.</p>
    </div>
  `);
}

function homeLoadErrorView(err) {
  view(`
    <div class="card">
      <h2>Could not load</h2>
      <div class="err-box">${esc(err?.message || 'Something went wrong.')}</div>
      <button type="button" class="btn-primary" id="retryHome">Retry</button>
    </div>
  `);
  document.getElementById('retryHome').onclick = () => {
    showRole();
  };
}

function normalizeStatusKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'ok' || k === 'success') return 'success';
  if (k === 'err' || k === 'error') return 'error';
  if (k === 'warn' || k === 'warning') return 'warn';
  return '';
}

/** Top status: green success / red error / yellow warn chips. */
function setStatus(msgOrItems, kind) {
  const el = document.getElementById('status');
  if (!el) return;
  const items = [];
  const push = (text, k) => {
    const t = String(text || '').trim();
    if (!t) return;
    items.push({ text: t, kind: normalizeStatusKind(k) });
  };

  if (Array.isArray(msgOrItems)) {
    for (const it of msgOrItems) {
      if (typeof it === 'string') push(it, kind);
      else if (it && typeof it === 'object') push(it.text || it.message, it.kind || kind);
    }
  } else if (
    msgOrItems &&
    typeof msgOrItems === 'object' &&
    (msgOrItems.success ||
      msgOrItems.error ||
      msgOrItems.warn ||
      msgOrItems.ok ||
      msgOrItems.err ||
      msgOrItems.warnings ||
      msgOrItems.errors)
  ) {
    for (const t of msgOrItems.success || msgOrItems.ok || []) push(t, 'success');
    for (const t of msgOrItems.error || msgOrItems.err || msgOrItems.errors || []) push(t, 'error');
    for (const t of msgOrItems.warn || msgOrItems.warnings || []) push(t, 'warn');
  } else {
    push(msgOrItems, kind);
  }

  if (!items.length) {
    el.textContent = '';
    el.className = '';
    return;
  }
  el.className = 'status-stack';
  el.innerHTML = items
    .map((it) => `<span class="status-chip ${it.kind || 'neutral'}">${esc(it.text)}</span>`)
    .join('');
}

/** Week top summary: optional flash successes + red errors + yellow warnings. */
function setWeekTopStatus({ success = [], error = [], warn = [] } = {}) {
  setStatus({ success, error, warn });
}

function view(html) {
  document.getElementById('view').innerHTML = html;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/** Checkbox column header (select all) for bulk delete tables. */
function bulkTh(group) {
  return `<th class="bulk-col"><input type="checkbox" data-bulk-all="${esc(group)}" aria-label="Select all" /></th>`;
}

/** Row checkbox. Pass extraAttrs e.g. ` data-bulk-kind="user"`. */
function bulkTd(group, id, extraAttrs = '') {
  return `<td class="bulk-col"><input type="checkbox" data-bulk-group="${esc(group)}" data-bulk-id="${esc(id)}"${extraAttrs} /></td>`;
}

function bulkTdEmpty() {
  return `<td class="bulk-col"></td>`;
}

/** Hidden until ≥1 row checked. */
function bulkBar(group) {
  return `<div class="bulk-bar" data-bulk-bar="${esc(group)}" hidden>
    <button type="button" class="btn" data-bulk-delete="${esc(group)}">Delete selected</button>
    <span class="muted" data-bulk-count="${esc(group)}"></span>
  </div>`;
}

function selectedBulkEls(group) {
  return [...document.querySelectorAll(`input[data-bulk-group="${group}"]:checked`)];
}

function syncBulkBar(group) {
  const bar = document.querySelector(`[data-bulk-bar="${group}"]`);
  const els = selectedBulkEls(group);
  const n = els.length;
  if (bar) bar.hidden = n < 1;
  const count = document.querySelector(`[data-bulk-count="${group}"]`);
  if (count) count.textContent = n ? `${n} selected` : '';
  const all = document.querySelector(`input[data-bulk-all="${group}"]`);
  if (all) {
    const boxes = [...document.querySelectorAll(`input[data-bulk-group="${group}"]`)];
    const checked = boxes.filter((b) => b.checked).length;
    all.checked = boxes.length > 0 && checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }
}

function confirmBulkDelete(n, noun) {
  if (!confirm(`Delete ${n} selected ${noun}? This cannot be undone.`)) return false;
  if (!confirm(`Really delete ${n} items permanently?`)) return false;
  return true;
}

/**
 * Wire select-all + Delete selected for a bulk group.
 * deleteOne(id, checkboxEl) should call the existing per-id DELETE API.
 */
function bindBulkDelete(group, { noun, deleteOne, refresh }) {
  const all = document.querySelector(`input[data-bulk-all="${group}"]`);
  if (all) {
    all.addEventListener('change', () => {
      document.querySelectorAll(`input[data-bulk-group="${group}"]`).forEach((cb) => {
        cb.checked = all.checked;
      });
      syncBulkBar(group);
    });
  }
  document.querySelectorAll(`input[data-bulk-group="${group}"]`).forEach((cb) => {
    cb.addEventListener('change', () => syncBulkBar(group));
  });
  const btn = document.querySelector(`[data-bulk-delete="${group}"]`);
  if (btn) {
    btn.addEventListener('click', async () => {
      const els = selectedBulkEls(group);
      if (!els.length) return;
      if (!confirmBulkDelete(els.length, noun)) return;
      try {
        const errors = [];
        let ok = 0;
        for (const el of els) {
          const id = el.getAttribute('data-bulk-id');
          try {
            await deleteOne(id, el);
            ok += 1;
          } catch (e) {
            errors.push(e.message || String(e));
          }
        }
        if (errors.length) {
          setStatus(
            `Deleted ${ok}. ${errors.length} failed: ${errors[0]}`,
            ok === 0 ? 'err' : 'warn',
          );
        } else {
          setStatus(`Deleted ${ok} ${noun}.`, 'ok');
        }
        await refresh();
      } catch (e) {
        setStatus(e.message, 'err');
      }
    });
  }
  syncBulkBar(group);
}

function readPayRatesFromIds(ids) {
  const num = (id) => {
    const raw = document.getElementById(id)?.value?.trim?.() ?? '';
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return {
    payRate30Min: num(ids.min30),
    payRate42Min: num(ids.min42),
    payRate45Min: num(ids.min45),
    payRatePerHour: num(ids.hour),
    payRateGroup30Min: num(ids.g30),
    payRateGroup42Min: num(ids.g42),
    payRateGroup45Min: num(ids.g45),
    payRateAdditionalHourly: num(ids.extra),
  };
}

function payRatesFieldset(p, prefix) {
  const v = (k) => esc(p?.[k] ?? '');
  return `<fieldset class="pay-rates">
        <legend>Pay rates</legend>
        <div class="row">
          <label>30 min session <input id="${prefix}30" type="number" step="0.01" min="0" value="${v('payRate30Min')}" /></label>
          <label>42 min session <input id="${prefix}42" type="number" step="0.01" min="0" value="${v('payRate42Min')}" /></label>
        </div>
        <div class="row">
          <label>45 min session <input id="${prefix}45" type="number" step="0.01" min="0" value="${v('payRate45Min')}" /></label>
          <label>Per hour session <input id="${prefix}Hour" type="number" step="0.01" min="0" value="${v('payRatePerHour')}" /></label>
        </div>
        <div class="row">
          <label>Group 30 min <input id="${prefix}G30" type="number" step="0.01" min="0" value="${v('payRateGroup30Min')}" /></label>
          <label>Group 42 min <input id="${prefix}G42" type="number" step="0.01" min="0" value="${v('payRateGroup42Min')}" /></label>
        </div>
        <div class="row">
          <label>Group 45 min <input id="${prefix}G45" type="number" step="0.01" min="0" value="${v('payRateGroup45Min')}" /></label>
          <label>Additional services (hourly, billed to the minute) <input id="${prefix}Extra" type="number" step="0.01" min="0" value="${v('payRateAdditionalHourly')}" /></label>
        </div>
      </fieldset>`;
}

const ADDITIONAL_SERVICE_LABELS = {
  eval: 'Eval',
  progress_report: 'Progress report',
  consultation: 'Consultation',
  meetings: 'Meetings',
  paid_absence: 'Paid absence',
};

function additionalServiceOptions(selected) {
  return ['eval', 'progress_report', 'consultation', 'meetings', 'paid_absence']
    .map((v) => `<option value="${v}"${selected === v ? ' selected' : ''}>${esc(ADDITIONAL_SERVICE_LABELS[v])}</option>`)
    .join('');
}

function additionalServiceLabel(value) {
  if (!value) return '';
  return ADDITIONAL_SERVICE_LABELS[value] || String(value);
}

function studentOptions(students, selected) {
  return `<option value="">Select a student</option>${(students || []).map((s) => {
    const id = s.id;
    const label = `${s.firstName || ''} ${s.lastName || ''}`.trim() || id;
    return `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('')}`;
}

function providerOptions(providers, selected) {
  return `<option value="">Select a provider</option>${(providers || []).map((p) => {
    const label = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.id;
    return `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('')}`;
}

function schoolOptions(schools, selected) {
  return `<option value="">Select a school</option>${(schools || []).map((s) =>
    `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name || s.id)}</option>`,
  ).join('')}`;
}

function formatIsoDateLabel(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '—';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatCalendarSummary(calendar) {
  if (!calendar?.yearStart || !calendar?.yearEnd) return '';
  const n = (calendar.offDays || []).length;
  const offLabel = n === 1 ? '1 off day' : `${n} off days`;
  return `${formatIsoDateLabel(calendar.yearStart)} – ${formatIsoDateLabel(calendar.yearEnd)}, ${offLabel}`;
}

function renderCalendarSavedHtml(calendar, schoolName) {
  const name = schoolName ? ` for ${esc(schoolName)}` : '';
  if (!calendar?.yearStart && !calendar?.yearEnd && !(calendar?.offDays || []).length) {
    return `<div class="cal-saved muted"><p>No calendar saved yet${name}. Set first day, last day, and off days below, then Save calendar.</p></div>`;
  }
  const offs = [...(calendar.offDays || [])].sort();
  const offList = offs.length
    ? `<ul class="cal-off-summary">${offs.map((d) => `<li>${esc(formatIsoDateLabel(d))} <span class="muted">(${esc(d)})</span></li>`).join('')}</ul>`
    : '<p class="muted">No off days.</p>';
  return `<div class="cal-saved">
    <h3>Saved calendar${name}</h3>
    <p><strong>First day:</strong> ${esc(calendar.yearStart ? formatIsoDateLabel(calendar.yearStart) : '—')} ${calendar.yearStart ? `<span class="muted">(${esc(calendar.yearStart)})</span>` : ''}</p>
    <p><strong>Last day:</strong> ${esc(calendar.yearEnd ? formatIsoDateLabel(calendar.yearEnd) : '—')} ${calendar.yearEnd ? `<span class="muted">(${esc(calendar.yearEnd)})</span>` : ''}</p>
    <p><strong>Off days (${offs.length}):</strong></p>
    ${offList}
  </div>`;
}

async function fileToBase64(file) {
  if (!file) return '';
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function studentName(students, id) {
  const st = (students || []).find((x) => x.id === id);
  return st ? `${st.firstName} ${st.lastName}`.trim() : id;
}

function childNameLink(studentId, label) {
  const id = String(studentId || '').trim();
  const text = String(label || '').trim() || id || '—';
  if (!id) return esc(text);
  return `<button type="button" class="linkish" data-open-child="${esc(id)}">${esc(text)}</button>`;
}

function mandateFreqLabel(m) {
  if (m?.freqDisplay) return m.freqDisplay;
  const kind = m?.frequencyKind === 'school_day_cycle' ? 'school_day_cycle' : 'weekly';
  const n = m?.sessionsPerPeriod ?? m?.frequencyPerWeek;
  if (n == null || n === '') return '—';
  if (kind === 'school_day_cycle') return `${n} / ${m?.periodSchoolDays || 6} school days`;
  return `${n} / week`;
}

function bindOpenChildLinks(opts = {}) {
  document.querySelectorAll('[data-open-child]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-open-child');
      if (id) adminChildDetail(id, opts);
    });
  });
}

function sessionExtraLabel(s) {
  const bits = [];
  const addl = additionalServiceLabel(s?.additionalServiceType);
  if (addl) bits.push(addl);
  else if (s?.serviceType) bits.push(String(s.serviceType));
  if (s?.location) bits.push(String(s.location));
  if (s?.cancelReason) bits.push(`Cancel: ${s.cancelReason}`);
  return bits.join(' · ');
}

function closeTimesheetModal() {
  document.getElementById('timesheetModal')?.remove();
}

function openTimesheetModal(opts) {
  closeTimesheetModal();
  const {
    weekStart = '',
    providerName = '',
    status = '',
    signerName = '',
    signerEmail = '',
    sessions = [],
    students = [],
  } = opts || {};
  const sorted = [...(sessions || [])].sort((a, b) =>
    String(a.dateOfService || '').localeCompare(String(b.dateOfService || ''))
      || String(a.beginTime || '').localeCompare(String(b.beginTime || '')),
  );
  const meta = [
    weekStart ? `Week of ${weekStart}` : '',
    providerName ? `Provider: ${providerName}` : '',
    status ? `Status: ${status}` : '',
    signerEmail || signerName
      ? `Signer: ${signerName || signerEmail}${signerEmail && signerName ? ` <${signerEmail}>` : ''}`
      : '',
  ].filter(Boolean);
  const backdrop = document.createElement('div');
  backdrop.id = 'timesheetModal';
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Timesheet');
  backdrop.innerHTML = `
    <div class="modal-panel timesheet-print">
      <div class="modal-head">
        <h2>Timesheet</h2>
        <div class="modal-actions">
          <button type="button" class="btn" data-print-timesheet>Print</button>
          <button type="button" class="btn" data-close-timesheet>Close</button>
        </div>
      </div>
      ${meta.length ? `<p class="muted">${meta.map((m) => esc(m)).join(' · ')}</p>` : ''}
      <table class="timesheet-table">
        <tr>
          <th>Date</th><th>Child</th><th>Time</th><th>Attendance</th>
          <th>Flags</th><th>Notes</th><th>Additional</th>
        </tr>
        ${sorted.map((s) => {
          const name = studentName(students, s.studentId);
          const time = [s.beginTime, s.endTime].filter(Boolean).join(' – ');
          const flags = s.aiFlags || [];
          const hard = Boolean(s.aiBlock);
          const pill = hard ? 'pill-err' : 'pill-warn';
          const extra = sessionExtraLabel(s);
          return `<tr class="${hard ? 'hard' : flags.length ? 'warn' : ''}">
            <td>${esc(s.dateOfService)}</td>
            <td>${esc(name)}</td>
            <td>${esc(time)}</td>
            <td>${esc(s.attendance)}</td>
            <td>${flags.length ? `<span class="${pill}">${esc(flags.join('; '))}</span>` : '—'}</td>
            <td>${esc(s.notes || '—')}</td>
            <td>${extra ? esc(extra) : '—'}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="7">No sessions for this week.</td></tr>'}
      </table>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeTimesheetModal();
  });
  backdrop.querySelector('[data-close-timesheet]').onclick = () => closeTimesheetModal();
  backdrop.querySelector('[data-print-timesheet]').onclick = () => window.print();
}

async function fetchAndShowTimesheet({ weekStart, providerId, providerName, status }) {
  const q = new URLSearchParams();
  if (weekStart) q.set('weekStart', weekStart);
  if (providerId) q.set('providerId', providerId);
  const data = await api('GET', `/week?${q.toString()}`);
  openTimesheetModal({
    weekStart: data.week?.weekStart || weekStart || '',
    providerName: providerName || '',
    status: data.week?.status || status || '',
    signerName: data.week?.signerName || '',
    signerEmail: data.week?.signerEmail || '',
    sessions: data.sessions || [],
    students: data.students || [],
  });
}

async function loadMissedOptions(studentId, selected) {
  const sel = document.getElementById('makeupOf');
  if (!sel) return;
  if (!studentId) {
    sel.innerHTML = '<option value="">None — use makeup auth if needed</option>';
    return;
  }
  try {
    const out = await api('GET', `/students/${studentId}/missed`);
    const missed = out.missed || [];
    sel.innerHTML = `<option value="">None — use makeup auth if needed</option>${missed.map((m) =>
      `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(m.dateOfService || m.id)}</option>`,
    ).join('')}`;
  } catch {
    sel.innerHTML = '<option value="">None — use makeup auth if needed</option>';
  }
}

function bindMakeupPickers() {
  const att = document.getElementById('att');
  const student = document.getElementById('studentId');
  const wrap = document.getElementById('makeupWrap');
  const makeupOf = document.getElementById('makeupOf');
  const notes = document.getElementById('notes');
  if (!att || !student || !wrap) return;
  const fillMakeupNote = () => {
    if (!notes || att.value !== 'makeup') return;
    let cur = notes.value || '';
    if (!/\bmakeup\b|\bmake[\s-]?up\b/i.test(cur)) {
      cur = `${cur ? `${cur.trim()} ` : ''}Makeup session`;
    }
    if (makeupOf?.value) {
      const date = makeupOf.selectedOptions[0]?.textContent?.trim() || '';
      if (date && !cur.includes(date)) {
        cur = `${cur.trim()} for missed session on ${date}`;
      }
    }
    notes.value = cur;
  };
  const sync = () => {
    wrap.hidden = att.value !== 'makeup';
    if (att.value === 'makeup') {
      loadMissedOptions(student.value).then(fillMakeupNote);
    }
  };
  att.onchange = sync;
  student.onchange = sync;
  if (makeupOf) makeupOf.onchange = fillMakeupNote;
  sync();
}

function weekApprovalLabel(status) {
  if (status === 'locked' || status === 'signed') {
    return {
      key: 'approved',
      title: 'Approved',
      detail: 'Your timesheet is signed and locked. You will be paid.',
      box: 'ok-box',
    };
  }
  if (status === 'submitted') {
    return {
      key: 'pending',
      title: 'Pending',
      detail: 'Waiting for the school signer (or admin) to approve. This will change to Approved when it is signed.',
      box: 'warn-box',
    };
  }
  if (status === 'reopened') {
    return {
      key: 'reopened',
      title: 'Needs fixes',
      detail: 'An admin reopened this week. Fix it and send the timesheet again.',
      box: 'warn-box',
    };
  }
  return {
    key: 'draft',
    title: 'Not sent yet',
    detail: 'Upload notes or add sessions, then send the timesheet.',
    box: 'warn-box',
  };
}

function approvalBanner(status) {
  const a = weekApprovalLabel(status);
  return `<div class="${a.box}"><strong>Status: ${esc(a.title)}</strong><div>${esc(a.detail)}</div></div>`;
}

async function therapistHome(statusFlash) {
  let banner = '';
  let week = null;
  let sessions = [];
  let students = [];
  let errors = [];
  let warnings = [];
  let signerName = '';
  let signerEmail = '';
  let providerId = '';
  let loadFailed = null;

  try {
    const me = await api('GET', '/me');
    providerId = me.provider?.id || '';
    const dues = (me.dueDates || []).filter((d) => d.status !== 'done');
    const alerts = me.alerts || [];
    if (dues.length || alerts.length) {
      banner = `<div class="warn-box">${[...alerts.map((a) => a.body), ...dues.map((d) => `${d.schoolName || d.schoolId || 'School'}: ${d.kind} due ${d.dueOn}`)].map((t) => `<div>${esc(t)}</div>`).join('')}</div>`;
    }
    if (providerId) {
      const ensured = await api('POST', '/week/ensure', { weekStart: state.weekStart, providerId });
      week = ensured.week;
      state.weekId = week.id;
      signerName = week.signerName || '';
      signerEmail = week.signerEmail || '';
    }
  } catch (e) {
    loadFailed = e.message || 'Could not load week.';
  }

  try {
    const list = await api('GET', `/students?weekStart=${encodeURIComponent(state.weekStart)}`);
    students = list.students || [];
  } catch {
    students = [];
  }

  try {
    const data = await api('GET', `/week?weekStart=${encodeURIComponent(state.weekStart)}`);
    if (data.week) {
      week = data.week;
      state.weekId = week.id;
      sessions = data.sessions || [];
      if ((data.students || []).length) students = data.students;
      errors = data.errors || [];
      warnings = data.warnings || [];
      signerName = week.signerName || signerName;
      signerEmail = week.signerEmail || signerEmail;
    }
  } catch {
    /* keep empty week */
  }

  const status = week?.status || 'draft';
  const locked = status === 'submitted' || status === 'signed' || status === 'locked';
  const canSend = Boolean(week) && sessions.length > 0 && !locked && errors.length === 0;

  const flash = statusFlash && typeof statusFlash === 'object' ? statusFlash : null;
  const topSuccess = [...(flash?.success || [])];
  if (!topSuccess.length && sessions.length && (errors.length || warnings.length || flash)) {
    topSuccess.push(`${sessions.length} session(s) on this week.`);
  }
  setWeekTopStatus({
    success: topSuccess,
    error: [...(loadFailed ? [loadFailed] : []), ...(flash?.error || []), ...errors],
    warn: [...(flash?.warn || []), ...warnings],
  });

  view(`
    <div class="card">
      <h2>My week</h2>
      ${banner}
      ${week ? approvalBanner(status) : '<div class="warn-box">Ask the office to finish setting up your therapist profile.</div>'}
      <p class="muted">Week of ${esc(state.weekStart)}</p>
      <button class="btn" id="refreshHome">Refresh status</button>
      ${errors.length ? `<div class="err-box"><strong>Fix these before sending.</strong>${errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
      ${warnings.length ? `<div class="warn-box"><strong>Warnings (you can still send).</strong>${warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
      <p class="muted">Red = blocked (over-mandate or AI note issues). Yellow = under-mandate / soft warnings only.</p>
      <div class="table-wrap">
      <table>
        <tr><th>Date</th><th>Child</th><th>Service</th><th>Time</th><th>Attendance</th><th>Flags</th><th>Notes</th>${locked ? '' : '<th></th>'}</tr>
        ${sessions.map((s) => {
          const name = studentName(students, s.studentId);
          const time = [s.beginTime, s.endTime].filter(Boolean).join(' – ');
          const flags = s.aiFlags || [];
          const hard = Boolean(s.aiBlock);
          const rowClass = hard ? 'hard' : flags.length ? 'warn' : '';
          const pill = hard ? 'pill-err' : 'pill-warn';
          const serviceLabel = additionalServiceLabel(s.additionalServiceType) || s.serviceType || '—';
          const removeCell = locked
            ? ''
            : `<td><button type="button" class="btn" data-remove-session="${esc(s.id)}">Remove</button></td>`;
          return `<tr class="${rowClass}"><td>${esc(s.dateOfService)}</td><td>${esc(name)}</td><td>${esc(serviceLabel)}</td><td>${esc(time)}</td><td>${esc(s.attendance)}</td><td>${flags.length ? `<span class="${pill}">${esc(flags.join('; '))}</span>` : ''}</td><td>${esc(s.notes || '')}</td>${removeCell}</tr>`;
        }).join('') || `<tr><td colspan="${locked ? 7 : 8}">No sessions yet.</td></tr>`}
      </table>
    </div>
    </div>

    ${locked ? `
    <div class="card">
      <p>This week is ${esc(weekApprovalLabel(status).title.toLowerCase())}. You cannot edit it.</p>
      <button type="button" class="btn" id="viewTimesheet" ${sessions.length ? '' : 'disabled'}>View timesheet</button>
    </div>
    ` : `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">1</span> Upload weekly report</h2>
      <p>Choose your Frontline Related Service Session Notes PDF (text PDF, not a scan). Children and schools must already exist from caseload import — this upload will not create them.</p>
      <input id="pdfFile" type="file" accept="application/pdf,.pdf" />
      <button class="btn-primary big" id="upload">Read PDF</button>
      <p class="muted" id="uploadHint">This upload is for weekly session notes PDFs only (Frontline text). Caseloads go to Mandates → Import. Scanned PDFs won’t work.</p>
    </div>

    <div id="uploadIssues" class="upload-issues" hidden></div>

    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">2</span> Additional Services</h2>
      <div class="row">
        <label>Service type
          <select id="additionalServiceType">
            <option value="">Select…</option>
            <option value="eval">Eval</option>
            <option value="progress_report">Progress report</option>
            <option value="consultation">Consultation</option>
            <option value="meetings">Meetings</option>
            <option value="paid_absence">Paid absence</option>
          </select>
        </label>
        <label>Student
          <select id="studentId">${studentOptions(students)}</select>
        </label>
      </div>
      <div class="row">
        <label>Date of service <input id="dos" placeholder="MM/DD/YYYY" /></label>
        <label>Attendance
          <select id="att">
            <option value="attended">attended</option>
            <option value="missed">missed</option>
            <option value="makeup">makeup</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label>Begin time <input id="beginTime" placeholder="9:00 am" /></label>
        <label>End time <input id="endTime" placeholder="9:30 am" /></label>
      </div>
      <div class="row">
        <label id="makeupWrap" hidden>Makeup of missed (optional)
          <select id="makeupOf"><option value="">None — use makeup auth if needed</option></select>
        </label>
      </div>
      <label>Notes <textarea id="notes" rows="3"></textarea></label>
      <button type="button" class="btn big" id="add">Save session</button>
    </div>

    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">3</span> Send timesheet</h2>
      <p>We send it to the school signer on file${signerEmail ? `: ${esc(signerName || signerEmail)} &lt;${esc(signerEmail)}&gt;` : ''}.</p>
      <div class="row timesheet-actions">
        <button type="button" class="btn big" id="viewTimesheet" ${sessions.length ? '' : 'disabled'}>View timesheet</button>
        <button type="button" class="btn-primary big" id="submit" ${canSend ? '' : 'disabled'}>Send timesheet</button>
      </div>
      ${!canSend && !errors.length ? '<p class="muted">Add at least one session before sending.</p>' : ''}
    </div>
    `}
  `);

  document.getElementById('refreshHome').onclick = () => therapistHome();

  const viewTimesheetBtn = document.getElementById('viewTimesheet');
  if (viewTimesheetBtn) {
    viewTimesheetBtn.onclick = () => {
      openTimesheetModal({
        weekStart: state.weekStart,
        status,
        signerName,
        signerEmail,
        sessions,
        students,
      });
    };
  }

  const viewEl = document.getElementById('view');
  if (locked) {
    viewEl.onclick = null;
  }

  if (!locked) {
    bindMakeupPickers();

    viewEl.onclick = async (e) => {
      const removeBtn = e.target.closest('[data-remove-session]');
      if (!removeBtn) return;
      if (!confirm('Remove this session (including additional services)? This cannot be undone.')) return;
      try {
        await api('DELETE', `/sessions/${removeBtn.getAttribute('data-remove-session')}`);
        await therapistHome({ success: ['Session removed.'] });
      } catch (err) {
        setStatus(err.message, 'error');
      }
    };

    document.getElementById('upload').onclick = async () => {
      const btn = document.getElementById('upload');
      try {
        const file = document.getElementById('pdfFile').files[0];
        if (!file) throw apiError('Choose your notes PDF first.', { errors: ['Choose your notes PDF first.'] });
        if (!providerId) {
          throw apiError('Your provider profile is not linked yet. Ask the office for help.', {
            errors: ['Your provider profile is not linked yet. Ask the office for help.'],
          });
        }
        btn.disabled = true;
        btn.textContent = 'Reading…';
        setUploadIssues([], []);
        setStatus('Reading PDF…', '');
        const pdfBase64 = await fileToBase64(file);
        const out = await api('POST', '/week/upload-sessions', {
          weekStart: state.weekStart,
          providerId,
          pdfBase64,
        });
        state.weekId = out.week.id;
        const warnList = Array.isArray(out.warnings) ? out.warnings : [];
        await therapistHome({
          success: [`Loaded ${out.parsed} session(s).`],
          warn: warnList,
        });
        if (warnList.length) setUploadIssues([], warnList);
      } catch (e) {
        const errs = Array.isArray(e.errors) && e.errors.length
          ? e.errors
          : [e.message || 'Could not read this PDF.'];
        const warns = Array.isArray(e.warnings) ? e.warnings : [];
        setUploadIssues(errs, warns);
        setStatus({
          error: errs.length
            ? errs
            : ['Upload blocked — see details below.'],
          warn: warns,
        });
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Read PDF';
        }
      }
    };

    document.getElementById('add').onclick = async () => {
      const btn = document.getElementById('add');
      try {
        if (!state.weekId) {
          if (!providerId) throw new Error('Your week is not open yet. Ask the office to finish your provider profile.');
          const ensured = await api('POST', '/week/ensure', { weekStart: state.weekStart, providerId });
          state.weekId = ensured.week?.id || '';
        }
        if (!state.weekId) throw new Error('Your week is not open yet. Ask the office for help.');
        const additionalServiceType = document.getElementById('additionalServiceType').value;
        const studentId = document.getElementById('studentId').value;
        const dateOfService = document.getElementById('dos').value.trim();
        const notes = document.getElementById('notes').value.trim();
        if (!additionalServiceType) throw new Error('Pick a service type.');
        if (!studentId) throw new Error('Pick a student.');
        if (!dateOfService) throw new Error('Enter the date of service.');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        await api('POST', '/week/sessions', {
          weekId: state.weekId,
          studentId,
          dateOfService,
          beginTime: document.getElementById('beginTime').value,
          endTime: document.getElementById('endTime').value,
          attendance: document.getElementById('att').value,
          makeupOfSessionId: document.getElementById('makeupOf').value,
          additionalServiceType,
          notes,
        });
        await therapistHome({ success: ['Session saved.'] });
      } catch (e) {
        const errs = Array.isArray(e.errors) && e.errors.length ? e.errors : [e.message];
        const warns = Array.isArray(e.warnings) ? e.warnings : [];
        setStatus({ error: errs, warn: warns });
        btn.disabled = false;
        btn.textContent = 'Save session';
      }
    };

    document.getElementById('submit').onclick = async () => {
      try {
        if (!state.weekId) throw new Error('Add sessions first.');
        if (!signerEmail) throw new Error('No school signer on file. Ask the office to set the signer.');
        const out = await api('POST', `/weeks/${state.weekId}/submit`, {
          signerName,
          signerEmail,
        });
        state.last = out;
        await therapistHome({
          success: [out.message || 'Sent. Status is now Pending.'],
        });
      } catch (e) {
        const errs = Array.isArray(e.errors) && e.errors.length ? e.errors : [e.message];
        const warns = Array.isArray(e.warnings) ? e.warnings : [];
        setStatus({ error: errs, warn: warns });
      }
    };
  }
}

async function adminDash() {
  const d = await api('GET', '/dashboard');
  const listed = await api('GET', '/admin/weeks');
  const weeks = listed.weeks || [];
  const weekActions = (w) => {
    const status = w.status || 'draft';
    const sessions = Number(w.sessionCount) || 0;
    const canSign = status === 'submitted' && sessions > 0;
    const canReopen = status === 'signed' || status === 'locked';
    const canHha = status === 'signed' || status === 'locked';
    const parts = [];
    parts.push(
      `<button type="button" class="btn" data-view-timesheet="${esc(w.id)}" data-week-start="${esc(w.weekStart)}" data-provider-id="${esc(w.providerId || '')}" data-provider-name="${esc(w.providerName || '')}" data-week-status="${esc(status)}">View</button>`,
    );
    // Remove so it stays visible even when the actions cell is narrow.
    parts.push(`<button type="button" class="btn" data-remove-week="${esc(w.id)}" data-week-status="${esc(status)}">Remove</button>`);
    if (status === 'submitted') {
      parts.push(
        canSign
          ? `<button type="button" class="btn-primary" data-sign="${esc(w.id)}">Sign</button>`
          : `<button type="button" class="btn-primary" disabled title="Week needs at least one session before it can be signed.">Sign</button>`,
      );
    }
    if (canReopen) {
      parts.push(`<button type="button" class="btn" data-reopen="${esc(w.id)}">Reopen</button>`);
    }
    if (canHha) {
      parts.push(`<button type="button" class="btn" data-hha="${esc(w.id)}">Send to HHA</button>`);
    }
    if (status === 'draft') {
      parts.push(`<span class="muted">Waiting for therapist to submit</span>`);
    } else if (status === 'reopened') {
      parts.push(`<span class="muted">Waiting for therapist to resubmit</span>`);
    }
    return parts.join(' ') || '<span class="muted">—</span>';
  };
  view(`
    <div class="card">
      <h2>Dashboard</h2>
      <p>Timesheets — draft ${d.timesheet.draft} · submitted ${d.timesheet.submitted} · signed ${d.timesheet.signed} · locked ${d.timesheet.locked}</p>
      <p>HHA — pending ${d.hha.pending} · confirmed ${d.hha.confirmed} · failed ${d.hha.failed}</p>
    </div>
    <div class="card">
      <h2>Weeks</h2>
      ${bulkBar('weeks')}
      <div class="table-wrap">
      <table>
        <tr>${bulkTh('weeks')}<th>Week</th><th>Provider</th><th>Sessions</th><th>Status</th><th>Signer</th><th>HHA</th><th></th></tr>
        ${weeks.map((w) => `<tr>
          ${bulkTd('weeks', w.id)}
          <td>${esc(w.weekStart)}</td>
          <td>${esc(w.providerName || '—')}</td>
          <td>${esc(w.sessionCount)}</td>
          <td>${esc(w.status)}</td>
          <td>${esc(w.signerName || w.signerEmail || '—')}</td>
          <td>${esc(w.hhaStatus)}</td>
          <td class="week-actions">${weekActions(w)}</td>
        </tr>`).join('') || `<tr><td colspan="8">No weeks yet.</td></tr>`}
      </table>
      </div>
    </div>
  `);
  bindBulkDelete('weeks', {
    noun: 'weeks',
    deleteOne: (id) => api('DELETE', `/admin/weeks/${id}`),
    refresh: () => adminDash(),
  });
  document.getElementById('view').onclick = async (e) => {
    const viewTs = e.target.closest('[data-view-timesheet]');
    const sign = e.target.closest('[data-sign]');
    const reopen = e.target.closest('[data-reopen]');
    const hha = e.target.closest('[data-hha]');
    const removeWeek = e.target.closest('[data-remove-week]');
    try {
      if (viewTs) {
        await fetchAndShowTimesheet({
          weekStart: viewTs.getAttribute('data-week-start') || '',
          providerId: viewTs.getAttribute('data-provider-id') || '',
          providerName: viewTs.getAttribute('data-provider-name') || '',
          status: viewTs.getAttribute('data-week-status') || '',
        });
        return;
      }
      if (sign) {
        const out = await api('POST', `/admin/weeks/${sign.getAttribute('data-sign')}/sign`, {});
        setStatus(out.therapistMessage || 'Success. This week is signed and locked. You will be paid.', 'ok');
        await adminDash();
        return;
      }
      if (reopen) {
        await api('POST', `/admin/weeks/${reopen.getAttribute('data-reopen')}/reopen`, {});
        setStatus('Week reopened.', 'ok');
        await adminDash();
        return;
      }
      if (hha) {
        const out = await api('POST', `/weeks/${hha.getAttribute('data-hha')}/hha`, {});
        setStatus({
          success: [`HHA transferred ${out.transferred}.`],
          error: out.ok ? [] : out.errors?.length ? out.errors : ['HHA transfer had errors.'],
          warn: out.ok && out.errors?.length ? out.errors : [],
        });
        await adminDash();
        return;
      }
      if (removeWeek) {
        const st = removeWeek.getAttribute('data-week-status') || 'draft';
        if (!confirm(`Remove this ${st} week? All sessions for this week will be deleted. This cannot be undone.`)) return;
        await api('DELETE', `/admin/weeks/${removeWeek.getAttribute('data-remove-week')}`);
        setStatus('Week removed.', 'ok');
        await adminDash();
      }
    } catch (err) {
      setStatus(err.message, 'err');
    }
  };
}

async function adminChildren() {
  const out = await api('GET', '/admin/students');
  const students = out.students || [];
  view(`
    <div class="card">
      <h2>Children</h2>
      <p class="muted">All students on the caseload. Open one to edit, review mandates/sessions, or remove.</p>
      <label>Search
        <input id="childSearch" type="search" placeholder="First, last, school, program type, ID, grade…" autocomplete="off" />
      </label>
      ${bulkBar('children')}
      <table>
        <tr>${bulkTh('children')}<th>Name</th><th>School</th><th>Grade</th><th>Program</th><th>Mandates</th><th>Sessions</th><th></th></tr>
        <tbody id="childrenBody">
        ${students.map((s) => `<tr data-child-row
          data-search="${esc([s.firstName, s.lastName, s.name, s.schoolName, s.grade, s.programId, s.programType, s.id].filter(Boolean).join(' ').toLowerCase())}">
          ${bulkTd('children', s.id)}
          <td>${childNameLink(s.id, s.name)}</td>
          <td>${esc(s.schoolName)}</td>
          <td>${esc(s.grade || '—')}</td>
          <td>${esc([s.programType, s.programId].filter(Boolean).join(' · ') || '—')}</td>
          <td>${esc(s.mandateCount)}</td>
          <td>${esc(s.sessionCount)}</td>
          <td>
            <button type="button" class="btn" data-open-child="${esc(s.id)}">Open</button>
            <button type="button" class="btn" data-del-child="${esc(s.id)}">Remove</button>
          </td>
        </tr>`).join('') || '<tr id="childrenEmpty"><td colspan="8">No children yet. Import a caseload on Mandates.</td></tr>'}
        </tbody>
      </table>
      <p class="muted" id="childrenFilterEmpty" hidden>No children match this search.</p>
    </div>
  `);
  const searchEl = document.getElementById('childSearch');
  const filterEmpty = document.getElementById('childrenFilterEmpty');
  const applyChildFilter = () => {
    const q = String(searchEl?.value || '').trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('[data-child-row]').forEach((row) => {
      const hay = row.getAttribute('data-search') || '';
      const ok = !q || hay.includes(q) || q.split(/\s+/).every((t) => hay.includes(t));
      row.hidden = !ok;
      if (ok) shown += 1;
    });
    if (filterEmpty) filterEmpty.hidden = shown > 0 || !q;
  };
  if (searchEl) searchEl.addEventListener('input', applyChildFilter);
  bindOpenChildLinks();
  bindBulkDelete('children', {
    noun: 'children',
    deleteOne: (id) => api('DELETE', `/admin/students/${id}`),
    refresh: () => adminChildren(),
  });
  document.querySelectorAll('[data-del-child]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this child? Mandates, sessions, and student files for this child will also be removed. This cannot be undone.')) return;
        await api('DELETE', `/admin/students/${btn.getAttribute('data-del-child')}`);
        setStatus('Child removed.', 'ok');
        await adminChildren();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminChildDetail(studentId, opts = {}) {
  state.childDetailBack = opts.backTo === 'reports' ? 'reports' : 'children';
  const [detail, schoolsOut] = await Promise.all([
    api('GET', `/admin/students/${studentId}`),
    api('GET', '/admin/schools'),
  ]);
  const s = detail.student;
  const school = detail.school;
  const schools = schoolsOut.schools || [];
  const mandates = detail.mandates || [];
  const sessions = detail.sessions || [];
  const weeks = detail.weeks || [];
  const dueDates = detail.dueDates || [];
  const files = detail.files || [];
  const schoolName = detail.schoolName || school?.name || '—';
  const cal = detail.schoolCalendar;
  const calSummary = detail.schoolCalendarSummary || formatCalendarSummary(cal);
  const calendarLine = calSummary
    ? `<p class="muted"><strong>Calendar:</strong> ${esc(calSummary)}${(cal?.offDays || []).length ? ` — off: ${esc((cal.offDays || []).slice().sort().join(', '))}` : ''}</p>`
    : '<p class="muted"><strong>Calendar:</strong> Not set (Schools → open school)</p>';
  const assignedProviders = detail.assignedProviders?.length
    ? detail.assignedProviders
    : [...new Map(mandates.filter((m) => m.providerId || m.providerName).map((m) => [
      m.providerId || m.providerName,
      { id: m.providerId || '', name: m.providerName || m.providerId || '—' },
    ])).values()];
  const providerNames = assignedProviders.map((p) => p.name).filter(Boolean);
  const backLabel = state.childDetailBack === 'reports' ? '← Reports' : '← Children';
  const sessFrom = state.childSessionFrom || '';
  const sessTo = state.childSessionTo || '';
  const filteredSessions = sessions.filter((x) => {
    const d = String(x.dateOfService || '');
    if (sessFrom && d < sessFrom) return false;
    if (sessTo && d > sessTo) return false;
    return true;
  });
  view(`
    <div class="card">
      <button type="button" class="btn" id="backChildren">${backLabel}</button>
      <h2>${esc(`${s.firstName || ''} ${s.lastName || ''}`.trim() || 'Child')}</h2>
      <p class="muted"><strong>School:</strong> ${esc(schoolName)}</p>
      ${calendarLine}
      <p class="muted"><strong>Provider(s) on mandates:</strong> ${esc(providerNames.length ? providerNames.join(', ') : '—')}</p>
      <div class="row">
        <label>First name <input id="cFirst" value="${esc(s.firstName || '')}" /></label>
        <label>Last name <input id="cLast" value="${esc(s.lastName || '')}" /></label>
      </div>
      <div class="row">
        <label>School
          <select id="cSchool">${schoolOptions(schools, s.schoolId)}</select>
        </label>
        <label>Grade <input id="cGrade" value="${esc(s.grade || '')}" /></label>
      </div>
      <div class="row">
        <label>DOB <input id="cDob" value="${esc(s.dob || '')}" placeholder="YYYY-MM-DD" />
          <span class="muted" style="display:block;font-size:0.85rem">Optional now; recommended for HHA transfer later.</span>
        </label>
        <label>HHA patient id <input id="cHha" value="${esc(s.hhaPatientId || '')}" /></label>
      </div>
      <div class="row">
        <label>Program id <input id="cProgId" value="${esc(s.programId || '')}" /></label>
        <label>Program type <input id="cProgType" value="${esc(s.programType || '')}" /></label>
      </div>
      <button type="button" class="btn-primary" id="saveChild">Save child</button>
      <button type="button" class="btn" id="deleteChild">Delete child</button>
    </div>
    <div class="card">
      <h3>Mandates</h3>
      ${bulkBar('child-mandates')}
      <table>
        <tr>${bulkTh('child-mandates')}<th>Discipline / service</th><th>Ratio</th><th>Frequency</th><th>Dates</th><th>Provider</th><th></th></tr>
        ${mandates.map((m) => {
          const service = [m.discipline, m.serviceType].filter(Boolean).join(' · ') || '—';
          const dates = [m.startOn, m.endOn].filter(Boolean).join(' → ') || '—';
          return `<tr>
          ${bulkTd('child-mandates', m.id)}
          <td>${esc(service)}</td>
          <td>${esc(m.ratioLabel || (m.ratioGroup ? 'Group' : 'Individual'))}</td>
          <td>${esc(mandateFreqLabel(m))}</td>
          <td>${esc(dates)}</td>
          <td>${esc(m.providerName || '—')}</td>
          <td><button type="button" class="btn" data-del-mandate="${esc(m.id)}">Delete</button></td>
        </tr>`;
        }).join('') || '<tr><td colspan="7">No mandates.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3>Sessions</h3>
      <div class="row">
        <label>From <input id="sessFrom" type="date" value="${esc(sessFrom)}" /></label>
        <label>To <input id="sessTo" type="date" value="${esc(sessTo)}" /></label>
        <button type="button" class="btn" id="sessFilter">Filter</button>
        <button type="button" class="btn" id="sessClear">Clear</button>
      </div>
      ${bulkBar('child-sessions')}
      <table>
        <tr>${bulkTh('child-sessions')}<th>Date</th><th>Week</th><th>Status</th><th>Attendance</th><th>Notes</th><th></th></tr>
        ${filteredSessions.map((x) => `<tr>
          ${bulkTd('child-sessions', x.id)}
          <td>${esc(x.dateOfService)}</td>
          <td>${esc(x.weekStart || '—')}</td>
          <td>${esc(x.weekStatus || '—')}</td>
          <td>${esc(x.attendance)}</td>
          <td>${esc(x.notes || '')}</td>
          <td><button type="button" class="btn" data-del-session="${esc(x.id)}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="7">No sessions in this range.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3 title="Weekly timesheet periods that include sessions for this child">Timesheet weeks</h3>
      <p class="muted">Weekly timesheet periods linked to this child’s sessions.</p>
      ${bulkBar('child-weeks')}
      <table>
        <tr>${bulkTh('child-weeks')}<th>Week</th><th>Status</th><th>HHA</th><th></th></tr>
        ${weeks.map((w) => `<tr>
          ${bulkTd('child-weeks', w.id)}
          <td>${esc(w.weekStart)}</td>
          <td>${esc(w.status)}</td>
          <td>${esc(w.hhaStatus)}</td>
          <td><button type="button" class="btn" data-del-week="${esc(w.id)}" data-week-status="${esc(w.status || '')}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="5">None.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3>Progress report due dates</h3>
      <p class="muted">School-level progress / annual / reeval due dates for this child’s school.</p>
      ${bulkBar('child-dues')}
      <table>
        <tr>${bulkTh('child-dues')}<th>Kind</th><th>Due</th><th>Status</th><th></th></tr>
        ${dueDates.map((d) => `<tr>
          ${bulkTd('child-dues', d.id)}
          <td>${esc(d.kind)}</td>
          <td>${esc(d.dueOn)}</td>
          <td>${esc(d.status)}</td>
          <td><button type="button" class="btn" data-del-due="${esc(d.id)}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="5">None for this school.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3 title="Uploaded PDFs and documents kept with this child">Student files</h3>
      <p class="muted">Uploaded documents kept with this child (timesheets, notes PDFs, etc.).</p>
      ${bulkBar('child-files')}
      <table>
        <tr>${bulkTh('child-files')}<th>Label</th><th>Kind</th><th>When</th><th></th></tr>
        ${files.map((f) => `<tr>
          ${bulkTd('child-files', f.id)}
          <td>${esc(f.label || f.s3Key || '—')}</td>
          <td>${esc(f.kind || '—')}</td>
          <td>${esc((f.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
          <td><button type="button" class="btn" data-del-file="${esc(f.id)}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="5">No files.</td></tr>'}
      </table>
    </div>
  `);
  const refreshChild = () => adminChildDetail(studentId, { backTo: state.childDetailBack });
  bindBulkDelete('child-mandates', {
    noun: 'mandates',
    deleteOne: (id) => api('DELETE', `/admin/mandates/${id}`),
    refresh: refreshChild,
  });
  bindBulkDelete('child-sessions', {
    noun: 'sessions',
    deleteOne: (id) => api('DELETE', `/sessions/${id}`),
    refresh: refreshChild,
  });
  bindBulkDelete('child-weeks', {
    noun: 'weeks',
    deleteOne: (id) => api('DELETE', `/admin/weeks/${id}`),
    refresh: refreshChild,
  });
  bindBulkDelete('child-dues', {
    noun: 'due dates',
    deleteOne: (id) => api('DELETE', `/admin/due-dates/${id}`),
    refresh: refreshChild,
  });
  bindBulkDelete('child-files', {
    noun: 'files',
    deleteOne: (id) => api('DELETE', `/admin/files/${id}`),
    refresh: refreshChild,
  });
  document.getElementById('backChildren').onclick = () => {
    if (state.childDetailBack === 'reports') adminReports();
    else adminChildren();
  };
  document.getElementById('sessFilter').onclick = () => {
    state.childSessionFrom = document.getElementById('sessFrom').value || '';
    state.childSessionTo = document.getElementById('sessTo').value || '';
    adminChildDetail(studentId, { backTo: state.childDetailBack });
  };
  document.getElementById('sessClear').onclick = () => {
    state.childSessionFrom = '';
    state.childSessionTo = '';
    adminChildDetail(studentId, { backTo: state.childDetailBack });
  };
  document.getElementById('saveChild').onclick = async () => {
    try {
      await api('POST', `/admin/students/${studentId}`, {
        firstName: document.getElementById('cFirst').value,
        lastName: document.getElementById('cLast').value,
        schoolId: document.getElementById('cSchool').value,
        grade: document.getElementById('cGrade').value,
        dob: document.getElementById('cDob').value,
        hhaPatientId: document.getElementById('cHha').value,
        programId: document.getElementById('cProgId').value,
        programType: document.getElementById('cProgType').value,
      });
      setStatus('Child saved.', 'ok');
      await adminChildren();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('deleteChild').onclick = async () => {
    try {
      if (!confirm('Remove this child? Mandates, sessions, and student files for this child will also be removed. This cannot be undone.')) return;
      await api('DELETE', `/admin/students/${studentId}`);
      setStatus('Child removed.', 'ok');
      await adminChildren();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.querySelectorAll('[data-del-mandate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this mandate? This cannot be undone.')) return;
        await api('DELETE', `/admin/mandates/${btn.getAttribute('data-del-mandate')}`);
        setStatus('Mandate removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-session]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this session? This cannot be undone.')) return;
        await api('DELETE', `/sessions/${btn.getAttribute('data-del-session')}`);
        setStatus('Session removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this student file record? This cannot be undone.')) return;
        await api('DELETE', `/admin/files/${btn.getAttribute('data-del-file')}`);
        setStatus('File removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-week]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const st = btn.getAttribute('data-week-status') || 'draft';
        if (!confirm(`Remove this ${st} week? All sessions for this week will be deleted. This cannot be undone.`)) return;
        await api('DELETE', `/admin/weeks/${btn.getAttribute('data-del-week')}`);
        setStatus('Week removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-due]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this progress report due date? Alerts for it will stop. This cannot be undone.')) return;
        await api('DELETE', `/admin/due-dates/${btn.getAttribute('data-del-due')}`);
        setStatus('Due date removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminProviderDetail(providerId) {
  const detail = await api('GET', `/admin/providers/${providerId}`);
  const p = detail.provider;
  const user = detail.user;
  const notes = detail.notes || [];
  const mandates = detail.mandates || [];
  const weeks = detail.weeks || [];
  view(`
    <div class="card">
      <button type="button" class="btn" id="backProviders">← Providers</button>
      <h2>${esc(`${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Provider')}</h2>
      <p class="muted">Linked login: ${esc(user?.email || '—')} · Cognito: ${esc(user?.cognitoSub || '—')}</p>
      <div class="row">
        <label>First name <input id="pFirst" value="${esc(p.firstName || '')}" /></label>
        <label>Last name <input id="pLast" value="${esc(p.lastName || '')}" /></label>
      </div>
      <div class="row">
        <label>Email <input id="pEmail" type="email" value="${esc(user?.email || '')}" /></label>
        <label>Discipline
          <select id="pDisc">
            ${['OT', 'PT', 'SLP'].map((d) => `<option ${p.discipline === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="row">
        <label>HHA caregiver code <input id="pHha" value="${esc(p.hhaCaregiverCode || '')}" /></label>
        <label>Status
          <select id="pActive">
            <option value="true"${p.active !== false ? ' selected' : ''}>Active</option>
            <option value="false"${p.active === false ? ' selected' : ''}>Inactive</option>
          </select>
        </label>
      </div>
      ${payRatesFieldset(p, 'pRate')}
      <button type="button" class="btn-primary" id="saveProvider">Save provider</button>
      <button type="button" class="btn" id="deleteProvider">Delete provider</button>
    </div>
    <div class="card">
      <h3>Caseload (${esc(detail.caseloadCount || 0)} children)</h3>
      <p class="muted">From this provider’s mandates (a child can appear under more than one provider).</p>
      ${bulkBar('prov-mandates')}
      <table>
        <tr>${bulkTh('prov-mandates')}<th>Child</th><th>Service</th><th>Freq</th><th></th></tr>
        ${mandates.map((m) => `<tr>
          ${bulkTd('prov-mandates', m.id)}
          <td>${esc(m.studentName || '—')}</td>
          <td>${esc(m.serviceType || '—')}</td>
          <td>${esc(m.sessionsPerPeriod ?? m.frequencyPerWeek ?? '—')}</td>
          <td><button type="button" class="btn" data-del-mandate="${esc(m.id)}">Delete mandate</button></td>
        </tr>`).join('') || '<tr><td colspan="5">No mandates assigned.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3>Weeks</h3>
      ${bulkBar('prov-weeks')}
      <table>
        <tr>${bulkTh('prov-weeks')}<th>Week</th><th>Status</th><th>HHA</th><th></th></tr>
        ${weeks.map((w) => `<tr>
          ${bulkTd('prov-weeks', w.id)}
          <td>${esc(w.weekStart)}</td>
          <td>${esc(w.status)}</td>
          <td>${esc(w.hhaStatus)}</td>
          <td><button type="button" class="btn" data-del-week="${esc(w.id)}" data-week-status="${esc(w.status || '')}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="5">No weeks yet.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3>Generate timesheet</h3>
      <p class="muted">Open or create a week for this provider, then view the timesheet.</p>
      <div class="row">
        <label>Week start (Monday) <input id="pWeekStart" type="date" value="${esc(mondayIso())}" /></label>
        <button type="button" class="btn-primary" id="pGenTimesheet">View timesheet</button>
      </div>
    </div>
    <div class="card">
      <h3>Additional services</h3>
      <p class="muted">Same kinds as therapist login, including paid absence.</p>
      <div class="row">
        <label>Service type
          <select id="pAddlType">
            <option value="">Select…</option>
            ${additionalServiceOptions()}
          </select>
        </label>
        <label>Child
          <select id="pAddlStudent">${(mandates || []).map((m) => `<option value="${esc(m.studentId)}">${esc(m.studentName || m.studentId)}</option>`).join('') || '<option value="">No caseload children</option>'}</select>
        </label>
      </div>
      <div class="row">
        <label>Date of service <input id="pAddlDos" placeholder="MM/DD/YYYY" /></label>
        <label>Begin / end
          <div class="row">
            <input id="pAddlBegin" placeholder="9:00 am" />
            <input id="pAddlEnd" placeholder="9:30 am" />
          </div>
        </label>
      </div>
      <label>Notes <textarea id="pAddlNotes" rows="2"></textarea></label>
      <button type="button" class="btn" id="pAddlSave">Save additional service</button>
    </div>
    <div class="card">
      <h3>Uploaded reports</h3>
      <input id="pReportFile" type="file" />
      <label>Label <input id="pReportLabel" placeholder="IEP / progress / other" /></label>
      <button type="button" class="btn" id="pUploadReport">Upload</button>
      ${bulkBar('prov-files')}
      <table>
        <tr>${bulkTh('prov-files')}<th>Label</th><th>When</th><th></th></tr>
        ${(detail.files || []).map((f) => `<tr>
          ${bulkTd('prov-files', f.id)}
          <td>${esc(f.label || f.s3Key)}</td>
          <td>${esc((f.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
          <td><button type="button" class="btn" data-del-file="${esc(f.id)}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="4">No files.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3>Internal notes</h3>
      <p class="muted">Hidden from the therapist. Tag notes so you can filter later.</p>
      <label>Filter by tag
        <select id="pNoteFilter">
          <option value="">All</option>
          ${(detail.noteTagOptions || ['Session note follow up', 'Gap in service']).map((t) => `<option>${esc(t)}</option>`).join('')}
        </select>
      </label>
      <label>New note <textarea id="pNoteBody" rows="3"></textarea></label>
      <div class="row" id="pNoteTags">
        ${(detail.noteTagOptions || ['Session note follow up', 'Gap in service']).map((t) =>
          `<label class="chk"><input type="checkbox" data-new-tag value="${esc(t)}" /> ${esc(t)}</label>`,
        ).join('')}
      </div>
      <label>Add a tag <input id="pNoteTagCustom" placeholder="New tag name" /></label>
      <button type="button" class="btn" id="pAddNote">Add note</button>
      <table>
        <tr><th>When</th><th>Tags</th><th>Note</th><th></th></tr>
        ${notes.slice().reverse().map((n) => `<tr data-note-tags="${esc((n.tags || []).join('|').toLowerCase())}">
          <td>${esc((n.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
          <td>${(n.tags || []).map((t) => `<span class="status-chip">${esc(t)}</span>`).join(' ') || '—'}</td>
          <td><textarea data-note-body="${esc(n.id)}" rows="2">${esc(n.body || '')}</textarea></td>
          <td>
            <button type="button" class="btn" data-save-note="${esc(n.id)}">Save</button>
            <button type="button" class="btn" data-del-note="${esc(n.id)}">Delete</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="4">No notes yet.</td></tr>'}
      </table>
    </div>
  `);
  const refreshProvider = () => adminProviderDetail(providerId);
  bindBulkDelete('prov-mandates', {
    noun: 'mandates',
    deleteOne: (id) => api('DELETE', `/admin/mandates/${id}`),
    refresh: refreshProvider,
  });
  bindBulkDelete('prov-weeks', {
    noun: 'weeks',
    deleteOne: (id) => api('DELETE', `/admin/weeks/${id}`),
    refresh: refreshProvider,
  });
  bindBulkDelete('prov-files', {
    noun: 'files',
    deleteOne: (id) => api('DELETE', `/admin/files/${id}`),
    refresh: refreshProvider,
  });
  document.getElementById('backProviders').onclick = () => adminProviders();
  document.getElementById('saveProvider').onclick = async () => {
    try {
      await api('PATCH', `/admin/providers/${providerId}`, {
        firstName: document.getElementById('pFirst').value,
        lastName: document.getElementById('pLast').value,
        email: document.getElementById('pEmail').value,
        discipline: document.getElementById('pDisc').value,
        ...readPayRatesFromIds({
          min30: 'pRate30',
          min42: 'pRate42',
          min45: 'pRate45',
          hour: 'pRateHour',
          g30: 'pRateG30',
          g42: 'pRateG42',
          g45: 'pRateG45',
          extra: 'pRateExtra',
        }),
        hhaCaregiverCode: document.getElementById('pHha').value,
        active: document.getElementById('pActive')?.value !== 'false',
      });
      setStatus('Provider saved.', 'ok');
      await adminProviders();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('deleteProvider').onclick = async () => {
    try {
      if (!confirm('Remove this provider? Their profile and internal notes will be deleted, and the linked therapist login will be deactivated. Mandates stay but become unassigned. This cannot be undone.')) return;
      await api('DELETE', `/admin/providers/${providerId}`);
      setStatus('Provider removed.', 'ok');
      await adminProviders();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('pAddNote').onclick = async () => {
    try {
      const text = document.getElementById('pNoteBody').value.trim();
      if (!text) throw new Error('Type a note first.');
      const tags = [...document.querySelectorAll('[data-new-tag]:checked')].map((el) => el.value);
      const custom = document.getElementById('pNoteTagCustom')?.value?.trim();
      if (custom) tags.push(custom);
      await api('POST', `/admin/providers/${providerId}/notes`, { body: text, tags });
      setStatus('Note saved.', 'ok');
      await adminProviderDetail(providerId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  const noteFilter = document.getElementById('pNoteFilter');
  if (noteFilter) {
    noteFilter.onchange = () => {
      const want = noteFilter.value.toLowerCase();
      document.querySelectorAll('[data-note-tags]').forEach((tr) => {
        const hay = tr.getAttribute('data-note-tags') || '';
        tr.hidden = Boolean(want) && !hay.split('|').includes(want);
      });
    };
  }
  document.getElementById('pUploadReport').onclick = async () => {
    try {
      const file = document.getElementById('pReportFile').files[0];
      if (!file) throw new Error('Choose a file first.');
      const fileBase64 = await fileToBase64(file);
      await api('POST', '/files', {
        providerId,
        studentId: '',
        kind: 'provider_report',
        label: document.getElementById('pReportLabel').value.trim() || file.name,
        fileName: file.name,
        fileBase64,
      });
      setStatus('Report uploaded.', 'ok');
      await adminProviderDetail(providerId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('pGenTimesheet').onclick = async () => {
    try {
      const weekStart = document.getElementById('pWeekStart').value;
      if (!weekStart) throw new Error('Pick a week start.');
      await api('POST', '/week/ensure', { providerId, weekStart });
      await fetchAndShowTimesheet({
        weekStart,
        providerId,
        providerName: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
      });
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('pAddlSave').onclick = async () => {
    try {
      const additionalServiceType = document.getElementById('pAddlType').value;
      const studentId = document.getElementById('pAddlStudent').value;
      const dateOfService = document.getElementById('pAddlDos').value.trim();
      if (!additionalServiceType) throw new Error('Pick a service type.');
      if (!studentId) throw new Error('Pick a child.');
      if (!dateOfService) throw new Error('Enter the date of service.');
      const weekStart = mondayFromDos(dateOfService) || mondayIso();
      const ensured = await api('POST', '/week/ensure', { providerId, weekStart });
      await api('POST', '/week/sessions', {
        weekId: ensured.week?.id,
        studentId,
        dateOfService,
        beginTime: document.getElementById('pAddlBegin').value,
        endTime: document.getElementById('pAddlEnd').value,
        attendance: additionalServiceType === 'paid_absence' ? 'attended' : 'attended',
        additionalServiceType,
        notes: document.getElementById('pAddlNotes').value,
      });
      setStatus('Additional service saved.', 'ok');
      await adminProviderDetail(providerId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.querySelectorAll('[data-del-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this file record?')) return;
        await api('DELETE', `/admin/files/${btn.getAttribute('data-del-file')}`);
        setStatus('File removed.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-save-note]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const id = btn.getAttribute('data-save-note');
        const body = document.querySelector(`[data-note-body="${id}"]`)?.value?.trim();
        if (!body) throw new Error('Note text is required.');
        await api('PATCH', `/admin/providers/${providerId}/notes/${id}`, { body });
        setStatus('Note updated.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-note]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Delete this internal note? This cannot be undone.')) return;
        await api('DELETE', `/admin/providers/${providerId}/notes/${btn.getAttribute('data-del-note')}`);
        setStatus('Note deleted.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-mandate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this mandate? This cannot be undone.')) return;
        await api('DELETE', `/admin/mandates/${btn.getAttribute('data-del-mandate')}`);
        setStatus('Mandate removed.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-week]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const st = btn.getAttribute('data-week-status') || 'draft';
        if (!confirm(`Remove this ${st} week? All sessions for this week will be deleted. This cannot be undone.`)) return;
        await api('DELETE', `/admin/weeks/${btn.getAttribute('data-del-week')}`);
        setStatus('Week removed.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminSchoolDetail(schoolId) {
  const [detail, duesOut] = await Promise.all([
    api('GET', `/admin/schools/${schoolId}`),
    api('GET', '/admin/reports/due-dates'),
  ]);
  const school = detail.school;
  const cal = detail.calendar;
  const dueDates = (duesOut.rows || []).filter((d) => d.schoolId === schoolId);
  const calSummary = detail.schoolCalendarSummary || formatCalendarSummary(cal);
  view(`
    <div class="card">
      <button type="button" class="btn" id="backSchools">← Schools</button>
      <h2>${esc(school.name || 'School')}</h2>
      <p class="muted">${esc(detail.studentCount || 0)} children on caseload</p>
      <div class="row">
        <label>School name <input id="sname" value="${esc(school.name || '')}" /></label>
        <label>District <input id="sdistrict" value="${esc(school.district || '')}" /></label>
      </div>
      <div class="row">
        <label>Signer name <input id="signerName" value="${esc(school.signerName || '')}" /></label>
        <label>Signer email <input id="signerEmail" value="${esc(school.signerEmail || '')}" /></label>
      </div>
      <button type="button" class="btn-primary" id="saveSchool">Save school</button>
      <button type="button" class="btn" id="deleteSchool">Remove school</button>
    </div>
    <div class="card" id="schoolCalendarSection">
      <h3>School calendar</h3>
      <p class="muted">School year and closed days (holidays, breaks). Used for school-day mandate tracking.</p>
      <div id="calSavedView" class="cal-saved-view">${renderCalendarSavedHtml(cal, school.name)}</div>
      <div class="row">
        <label>First day (YYYY-MM-DD) <input id="calYearStart" type="date" value="${esc(cal?.yearStart || '')}" /></label>
        <label>Last day (YYYY-MM-DD) <input id="calYearEnd" type="date" value="${esc(cal?.yearEnd || '')}" /></label>
      </div>
      <div class="row">
        <label>Add off day <input id="calOffDayPick" type="date" /></label>
        <button type="button" class="btn" id="calAddOffDay">Add off day</button>
      </div>
      <ul id="calOffDaysList" class="off-days-list"></ul>
      <label>Paste off days (one YYYY-MM-DD per line)
        <textarea id="calOffDaysPaste" rows="3" placeholder="2026-11-27&#10;2026-12-25"></textarea>
      </label>
      <button type="button" class="btn-primary" id="calSave">Save calendar</button>
      ${calSummary ? `<p class="muted" style="margin-top:0.5rem">Saved: ${esc(calSummary)}</p>` : ''}
    </div>
    <div class="card">
      <h3>Progress report due dates</h3>
      <p class="muted">One due date per kind (progress / annual / reeval) applies to this school’s whole caseload.</p>
      <div class="row">
        <label>Kind
          <select id="dueKind"><option value="progress">progress</option><option value="annual">annual</option><option value="reeval">reeval</option></select>
        </label>
        <label>Due on (YYYY-MM-DD) <input id="dueOn" placeholder="2026-10-15" /></label>
      </div>
      <button type="button" class="btn" id="duebtn">Save due date</button>
      ${bulkBar('school-dues')}
      <table>
        <tr>${bulkTh('school-dues')}<th>Kind</th><th>Due</th><th>Status</th><th></th></tr>
        ${dueDates.map((r) => `<tr>
          ${bulkTd('school-dues', r.id)}
          <td>${esc(r.kind)}</td>
          <td>${esc(r.dueOn)}</td>
          <td>${esc(r.status)}</td>
          <td><button type="button" class="btn" data-del-due="${esc(r.id)}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="5">None yet</td></tr>'}
      </table>
    </div>
  `);

  let calOffDays = [...(cal?.offDays || [])].sort();
  const calOffDaysList = document.getElementById('calOffDaysList');
  const renderCalOffDays = () => {
    if (!calOffDaysList) return;
    calOffDaysList.innerHTML = calOffDays.length
      ? calOffDays.map((d) => `<li>${esc(d)} <button type="button" class="btn" data-rm-off="${esc(d)}">Remove</button></li>`).join('')
      : '<li class="muted">No off days yet.</li>';
    calOffDaysList.querySelectorAll('[data-rm-off]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const date = btn.getAttribute('data-rm-off');
        if (!confirm(`Remove off day ${date}?`)) return;
        calOffDays = calOffDays.filter((x) => x !== date);
        renderCalOffDays();
      });
    });
  };
  renderCalOffDays();
  document.getElementById('calAddOffDay').onclick = () => {
    const d = document.getElementById('calOffDayPick').value;
    if (!d) return;
    if (!calOffDays.includes(d)) calOffDays = [...calOffDays, d].sort();
    document.getElementById('calOffDayPick').value = '';
    renderCalOffDays();
  };
  document.getElementById('calSave').onclick = async () => {
    try {
      const paste = document.getElementById('calOffDaysPaste').value || '';
      const pasted = paste.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const offDays = [...new Set([...calOffDays, ...pasted])].sort();
      await api('POST', `/admin/schools/${schoolId}/calendar`, {
        yearStart: document.getElementById('calYearStart').value,
        yearEnd: document.getElementById('calYearEnd').value,
        offDays,
      });
      setStatus('School calendar saved.', 'ok');
      await adminSchoolDetail(schoolId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('backSchools').onclick = () => adminSchools();
  document.getElementById('saveSchool').onclick = async () => {
    try {
      await api('POST', '/admin/schools', {
        id: schoolId,
        name: document.getElementById('sname').value,
        district: document.getElementById('sdistrict').value,
        signerName: document.getElementById('signerName').value,
        signerEmail: document.getElementById('signerEmail').value,
      });
      setStatus('School saved.', 'ok');
      await adminSchoolDetail(schoolId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('deleteSchool').onclick = async () => {
    try {
      if (!confirm('Remove this school? Its due dates will be deleted and children will be unlinked from it. This cannot be undone.')) return;
      await api('DELETE', `/admin/schools/${schoolId}`);
      setStatus('School removed.', 'ok');
      await adminSchools();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('duebtn').onclick = async () => {
    try {
      await api('POST', '/admin/due-dates', {
        schoolId,
        kind: document.getElementById('dueKind').value,
        dueOn: document.getElementById('dueOn').value,
      });
      setStatus('Progress report due date saved. Alerts stay until marked complete.', 'ok');
      document.getElementById('dueOn').value = '';
      await adminSchoolDetail(schoolId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  bindBulkDelete('school-dues', {
    noun: 'due dates',
    deleteOne: (id) => api('DELETE', `/admin/due-dates/${id}`),
    refresh: () => adminSchoolDetail(schoolId),
  });
  document.querySelectorAll('[data-del-due]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this progress report due date? Alerts for it will stop. This cannot be undone.')) return;
        await api('DELETE', `/admin/due-dates/${btn.getAttribute('data-del-due')}`);
        setStatus('Due date removed.', 'ok');
        await adminSchoolDetail(schoolId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminProviders() {
  const [usersOut, providersOut] = await Promise.all([
    api('GET', '/admin/users'),
    api('GET', '/admin/providers'),
  ]);
  const users = usersOut.users || [];
  const providers = providersOut.providers || [];
  const therapists = users.filter((u) => u.role === 'therapist');
  view(`
    <div class="card entry-card">
      <div class="entry-collapsed" id="addProviderCollapsed">
        <button type="button" class="btn-primary" id="openAddProvider">Add provider</button>
      </div>
      <div id="addProviderForm" hidden>
        <h2>Add provider</h2>
        <p class="muted">One person = one login + provider profile, already linked.</p>
        <label>Email <input id="temail" type="email" autocomplete="off" /></label>
        <div class="row">
          <label>First name <input id="tfirst" /></label>
          <label>Last name <input id="tlast" /></label>
        </div>
        <div class="row">
          <label>Discipline
            <select id="tdisc"><option>OT</option><option selected>PT</option><option>SLP</option></select>
          </label>
        </div>
        ${payRatesFieldset({}, 't')}
        <label>HHA caregiver code (optional) <input id="thha" /></label>
        <label>Internal note (optional, hidden from therapist) <textarea id="tnote" rows="3"></textarea></label>
        <div class="entry-form-actions">
          <button class="btn-primary big" id="createTherapist">Create provider</button>
          <button type="button" class="btn" id="cancelAddProvider">Cancel</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Providers</h2>
      ${bulkBar('providers')}
      <table>
        <tr>${bulkTh('providers')}<th>Name</th><th>Email</th><th>Provider id</th><th>Discipline</th><th></th></tr>
        ${therapists.map((u) => {
          const p = providers.find((x) => x.id === u.providerId) || providers.find((x) => x.userId === u.id);
          const name = p ? `${p.firstName} ${p.lastName}`.trim() : u.displayName;
          const pid = p?.id || u.providerId || '';
          return `<tr>
            ${pid
              ? bulkTd('providers', pid, ' data-bulk-kind="provider"')
              : bulkTd('providers', u.id, ' data-bulk-kind="user"')}
            <td>${esc(name || '—')}</td>
            <td>${esc(u.email)}</td>
            <td>${esc(pid || '—')}</td>
            <td>${esc(p?.discipline || '—')}</td>
            <td>${pid ? `
              <button type="button" class="btn" data-open-provider="${esc(pid)}">Open</button>
              <button type="button" class="btn" data-del-provider="${esc(pid)}">Remove</button>
            ` : `<button type="button" class="btn" data-remove-therapist="${esc(u.id)}">Remove</button>`}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="6">None yet</td></tr>'}
      </table>
    </div>
  `);

  bindBulkDelete('providers', {
    noun: 'providers',
    deleteOne: (id, el) => {
      const kind = el.getAttribute('data-bulk-kind') || 'provider';
      if (kind === 'user') return api('DELETE', `/admin/users/${id}`);
      return api('DELETE', `/admin/providers/${id}`);
    },
    refresh: () => adminProviders(),
  });

  const setAddProviderOpen = (open) => {
    const c = document.getElementById('addProviderCollapsed');
    const f = document.getElementById('addProviderForm');
    if (c) c.hidden = open;
    if (f) f.hidden = !open;
  };
  document.getElementById('openAddProvider').onclick = () => setAddProviderOpen(true);
  document.getElementById('cancelAddProvider').onclick = () => setAddProviderOpen(false);

  document.querySelectorAll('[data-remove-therapist]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this therapist login? They have no provider profile. Their login will be deleted and they will disappear from this list.')) return;
        const id = btn.getAttribute('data-remove-therapist');
        const out = await api('DELETE', `/admin/users/${id}`);
        setStatus(out.message || 'Therapist removed.', 'ok');
        await adminProviders();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.getElementById('createTherapist').onclick = async () => {
    try {
      const note = document.getElementById('tnote').value.trim();
      const out = await api('POST', '/admin/therapists', {
        email: document.getElementById('temail').value,
        firstName: document.getElementById('tfirst').value,
        lastName: document.getElementById('tlast').value,
        discipline: document.getElementById('tdisc').value,
        ...readPayRatesFromIds({
          min30: 't30',
          min42: 't42',
          min45: 't45',
          hour: 'tHour',
          g30: 'tG30',
          g42: 'tG42',
          g45: 'tG45',
          extra: 'tExtra',
        }),
        hhaCaregiverCode: document.getElementById('thha').value,
        role: 'therapist',
      });
      const providerId = out.provider?.id;
      if (note && providerId) {
        await api('POST', `/admin/providers/${providerId}/notes`, { body: note });
      }
      setStatus(out.message || `Provider ready: ${out.user?.email} ↔ ${providerId}`, 'ok');
      await adminProviders();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.querySelectorAll('[data-open-provider]').forEach((btn) => {
    btn.addEventListener('click', () => adminProviderDetail(btn.getAttribute('data-open-provider')));
  });
  document.querySelectorAll('[data-del-provider]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this provider? Their profile and internal notes will be deleted, and the linked therapist login will be deactivated. Mandates stay but become unassigned. This cannot be undone.')) return;
        await api('DELETE', `/admin/providers/${btn.getAttribute('data-del-provider')}`);
        setStatus('Provider removed.', 'ok');
        await adminProviders();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminSchools(opts = {}) {
  if (opts.focusSchoolId) state.focusSchoolId = opts.focusSchoolId;
  const schoolsOut = await api('GET', '/admin/schools');
  const schools = schoolsOut.schools || [];
  const calendarsBySchoolId = schoolsOut.calendarsBySchoolId || {};
  view(`
    <div class="card entry-card">
      <div class="entry-collapsed" id="addSchoolCollapsed">
        <button type="button" class="btn-primary" id="openAddSchool">Add school</button>
      </div>
      <div id="addSchoolForm" hidden>
        <h2>Add school</h2>
        <label>School <input id="sname" /></label>
        <label>Signer name <input id="signerName" /></label>
        <label>Signer email <input id="signerEmail" /></label>
        <div class="entry-form-actions">
          <button class="btn-primary big" id="school">Save school</button>
          <button type="button" class="btn" id="cancelAddSchool">Cancel</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Schools</h2>
      <p class="muted">Open a school for signer, progress report due dates, and calendar.</p>
      ${bulkBar('schools')}
      <table>
        <tr>${bulkTh('schools')}<th>School</th><th>Signer</th><th>Calendar</th><th></th></tr>
        ${schools.map((s) => {
          const cal = calendarsBySchoolId[s.id];
          const summary = formatCalendarSummary(cal);
          return `<tr>
          ${bulkTd('schools', s.id)}
          <td><button type="button" class="linkish" data-open-school="${esc(s.id)}">${esc(s.name)}</button></td>
          <td>${esc(s.signerName || s.signerEmail || '')}</td>
          <td>${summary ? esc(summary) : '<span class="muted">Not set</span>'}</td>
          <td>
            <button type="button" class="btn" data-open-school="${esc(s.id)}">Open</button>
            <button type="button" class="btn" data-del-school="${esc(s.id)}">Remove</button>
          </td>
        </tr>`;
        }).join('') || '<tr><td colspan="5">None</td></tr>'}
      </table>
    </div>
  `);

  bindBulkDelete('schools', {
    noun: 'schools',
    deleteOne: async (id) => {
      if (state.focusSchoolId === id) state.focusSchoolId = '';
      await api('DELETE', `/admin/schools/${id}`);
    },
    refresh: () => adminSchools(),
  });

  const setAddSchoolOpen = (open) => {
    const c = document.getElementById('addSchoolCollapsed');
    const f = document.getElementById('addSchoolForm');
    if (c) c.hidden = open;
    if (f) f.hidden = !open;
  };
  document.getElementById('openAddSchool').onclick = () => setAddSchoolOpen(true);
  document.getElementById('cancelAddSchool').onclick = () => setAddSchoolOpen(false);

  document.querySelectorAll('[data-open-school]').forEach((btn) => {
    btn.addEventListener('click', () => adminSchoolDetail(btn.getAttribute('data-open-school')));
  });
  document.querySelectorAll('[data-del-school]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this school? Its due dates will be deleted and children will be unlinked from it. This cannot be undone.')) return;
        const id = btn.getAttribute('data-del-school');
        if (state.focusSchoolId === id) state.focusSchoolId = '';
        const out = await api('DELETE', `/admin/schools/${id}`);
        setStatus(out.message || 'School removed.', 'ok');
        await adminSchools();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.getElementById('school').onclick = async () => {
    try {
      const out = await api('POST', '/admin/schools', {
        name: document.getElementById('sname').value,
        signerName: document.getElementById('signerName').value,
        signerEmail: document.getElementById('signerEmail').value,
      });
      const schoolId = out.school?.id || '';
      setStatus('School saved.', 'ok');
      if (schoolId) await adminSchoolDetail(schoolId);
      else await adminSchools();
    } catch (e) { setStatus(e.message, 'err'); }
  };

  if (opts.focusSchoolId) {
    await adminSchoolDetail(opts.focusSchoolId);
  }
}

async function adminAdmins() {
  const usersOut = await api('GET', '/admin/users');
  const admins = (usersOut.users || []).filter((u) => u.role === 'admin');
  view(`
    <div class="card entry-card">
      <div class="entry-collapsed" id="addAdminCollapsed">
        <button type="button" class="btn-primary" id="openAddAdmin">Add admin</button>
      </div>
      <div id="addAdminForm" hidden>
        <h2>Add admin</h2>
        <p class="muted">Invites another office login (Cognito Admin group). Only existing admins can do this.</p>
        <label>Email <input id="aemail" type="email" autocomplete="off" /></label>
        <label>Display name <input id="aname" placeholder="Optional" /></label>
        <div class="entry-form-actions">
          <button class="btn-primary big" id="createAdmin">Invite admin</button>
          <button type="button" class="btn" id="cancelAddAdmin">Cancel</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Admins</h2>
      ${bulkBar('admins')}
      <table>
        <tr>${bulkTh('admins')}<th>Name</th><th>Email</th><th></th></tr>
        ${admins.map((u) => {
          const self = state.email && u.email && state.email.toLowerCase() === String(u.email).toLowerCase();
          return `<tr>
            ${self ? bulkTdEmpty() : bulkTd('admins', u.id)}
            <td>${esc(u.displayName || '—')}</td>
            <td>${esc(u.email)}</td>
            <td>${
              self
                ? '—'
                : `<button type="button" class="btn" data-remove-admin="${esc(u.id)}">Remove</button>`
            }</td>
          </tr>`;
        }).join('') || '<tr><td colspan="4">None yet</td></tr>'}
      </table>
    </div>
  `);

  bindBulkDelete('admins', {
    noun: 'admins',
    deleteOne: (id) => api('DELETE', `/admin/users/${id}`),
    refresh: () => adminAdmins(),
  });

  const setAddAdminOpen = (open) => {
    const c = document.getElementById('addAdminCollapsed');
    const f = document.getElementById('addAdminForm');
    if (c) c.hidden = open;
    if (f) f.hidden = !open;
  };
  document.getElementById('openAddAdmin').onclick = () => setAddAdminOpen(true);
  document.getElementById('cancelAddAdmin').onclick = () => setAddAdminOpen(false);

  document.getElementById('createAdmin').onclick = async () => {
    try {
      const email = document.getElementById('aemail').value.trim();
      const displayName = document.getElementById('aname').value.trim();
      if (!email) throw new Error('Email is required.');
      const out = await api('POST', '/admin/users', {
        email,
        displayName: displayName || email,
        role: 'admin',
      });
      setStatus(out.message || `Admin invited: ${out.user?.email}`, 'ok');
      await adminAdmins();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.querySelectorAll('[data-remove-admin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this admin? Their login will be deleted and they will disappear from this list.')) return;
        const id = btn.getAttribute('data-remove-admin');
        const out = await api('DELETE', `/admin/users/${id}`);
        setStatus(out.message || 'Admin removed.', 'ok');
        await adminAdmins();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminMandates() {
  const [studentsOut, providersOut] = await Promise.all([
    api('GET', '/students'),
    api('GET', '/admin/providers'),
  ]);
  const students = studentsOut.students || [];
  const providers = providersOut.providers || [];
  const preview = state.caseloadPreview;
  const previewRows = preview?.rows || [];
  const previewErrors = preview?.errors || [];
  const previewWarnings = preview?.warnings || [];
  view(`
    <div class="card">
      <h2>Import caseload</h2>
      <p class="muted">Use the KU export <strong>Related Service by serviceschool (WG)</strong> (Listing Results sheet) as CSV or Excel (.xls / .xlsx). Import saves immediately.</p>
      <p class="muted" style="margin-top:0.35rem">Columns: CR Recommended School, Student Last/First Name, CR Expected Grade, CR Decision/Status, Related Service, RS Start/End, RS Ratio, RS Frequency, RS Period, RS Location, RS Provider. Optional when present: Program ID, Program Type, Date of Birth. (RS Duration is ignored. Older short headers still work.)</p>
      <p class="muted" style="margin-top:0.35rem">Freq: <em>Weekly</em> = sessions per week; <em>6 day cycle</em> = N sessions per 6 school days. Providers must already exist in TMS and match “Last, First” / “First Last”. Agency labels like “White Glove” / “White, Glove” are errors — replace with the therapist name. Unmatched RS Provider rows are skipped (no empty-provider mandates).</p>
      <input id="caseloadFile" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      <div class="row" style="margin-top:0.6rem">
        <button class="btn-primary" id="caseloadImportBtn">Import caseload</button>
        ${preview ? `<button type="button" class="btn" id="caseloadCompleteBtn">Complete</button>` : ''}
      </div>
      ${preview ? `
      <p style="margin-top:0.8rem">${previewRows.length} mandate row(s) · ${preview.createdStudents || 0} new students · ${preview.updatedStudents || 0} updated students · ${preview.createdSchools || 0} new schools · ${preview.createdMandates || 0} new mandates · ${preview.updatedMandates || 0} updated mandates</p>
      ${previewErrors.length ? `
      <div class="err-box caseload-issues">
        <strong>Errors (${previewErrors.length})</strong>
        <p class="muted" style="margin:0.35rem 0 0.5rem">One problem per row. Fix these in the spreadsheet, then import again. Valid rows in the table below can still be imported.</p>
        <table class="issue-table">
          <tr><th>Row #</th><th>Field</th><th>What went wrong</th><th>How to fix</th></tr>
          ${previewErrors.map((e) => {
            const rowNum = e.row ?? e.rowNumber ?? 0;
            const rowLabel = Number(rowNum) > 0 ? String(rowNum) : 'File';
            const field = e.field || (e.student ? String(e.student) : '—');
            const problem = e.problem || e.message || '';
            const fix = e.fix || '';
            return `<tr class="row-err">
              <td>${esc(rowLabel)}</td>
              <td>${esc(field)}${e.student ? `<div class="muted">${esc(String(e.student))}</div>` : ''}</td>
              <td>${esc(problem)}</td>
              <td>${esc(fix || '—')}</td>
            </tr>`;
          }).join('')}
        </table>
      </div>` : ''}
      ${previewWarnings.length ? `
      <div class="warn-box caseload-issues">
        <strong>Warnings (${previewWarnings.length})</strong>
        <table class="issue-table">
          <tr><th>Row #</th><th>Field</th><th>What went wrong</th><th>How to fix</th></tr>
          ${previewWarnings.map((w) => {
            const rowNum = w.row ?? w.rowNumber ?? 0;
            const rowLabel = Number(rowNum) > 0 ? String(rowNum) : 'File';
            const field = w.field || '—';
            const problem = w.problem || w.message || '';
            const fix = w.fix || '';
            return `<tr>
              <td>${esc(rowLabel)}</td>
              <td>${esc(field)}${w.student ? `<div class="muted">${esc(String(w.student))}</div>` : ''}</td>
              <td>${esc(problem)}</td>
              <td>${esc(fix || '—')}</td>
            </tr>`;
          }).join('')}
        </table>
      </div>` : ''}
      <table>
        <tr><th>Row</th><th>Student</th><th>School</th><th>Service</th><th>Ratio</th><th>Freq</th><th>RS Provider</th><th>Assigned to</th></tr>
        ${(() => {
          const errRows = new Set(
            previewErrors.map((e) => Number(e.row ?? e.rowNumber)).filter((n) => Number.isFinite(n) && n > 0),
          );
          const providerLabel = (id) => {
            if (!id) return '';
            const p = providers.find((x) => x.id === id);
            return p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || id : id;
          };
          return previewRows.map((r) => {
            const badRow = errRows.has(Number(r.rowNumber));
            const cls = badRow ? 'row-err' : '';
            const assigned = providerLabel(r.providerId);
            const assignedNote = r.providerMatched
              ? ' <span class="muted">(matched)</span>'
              : '';
            return `<tr${cls ? ` class="${cls}"` : ''}>
              <td>${esc(String(r.rowNumber || ''))}</td>
              <td>${esc(r.firstName)} ${esc(r.lastName)}${r.grade ? ` <span class="muted">(gr ${esc(r.grade)})</span>` : ''}</td>
              <td>${esc(r.schoolName || '')}</td>
              <td>${esc(r.serviceType || r.discipline || '')}</td>
              <td>${r.ratioGroup ? 'Group' : 'Individual'}</td>
              <td>${esc(r.freqDisplay || '')}</td>
              <td>${esc(r.providerName || '—')}${badRow ? ' <span class="err-inline">(see Errors)</span>' : ''}</td>
              <td>${esc(assigned || '—')}${assignedNote}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="8">No valid rows to import</td></tr>';
        })()}
      </table>` : ''}
    </div>
    <div class="card">
      <h2>Add mandate manually</h2>
      <p class="muted">Kind: <strong>Weekly</strong> (normal frequency) or <strong>Makeup auth</strong> (leftover pool, e.g. 12). Unlinked makeups use Makeup auth; miss-linked makeups do not.</p>
      <div class="row">
        <label>Student
          <select id="manStudent">${studentOptions(students)}</select>
        </label>
        <label>Provider
          <select id="manProvider">${providerOptions(providers)}</select>
        </label>
      </div>
      <div class="row">
        <label>Service type <input id="manService" placeholder="PT School" /></label>
        <label>Kind
          <select id="manKind">
            <option value="regular">Weekly</option>
            <option value="makeup_auth">Makeup auth</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label>Ratio
          <select id="manRatio">
            <option value="individual">Individual</option>
            <option value="group">Group</option>
          </select>
        </label>
        <label>Freq / count <input id="manFreq" type="number" min="0" step="1" placeholder="2" /></label>
      </div>
      <div class="row">
        <label>Period
          <select id="manPeriod">
            <option value="weekly">Weekly</option>
            <option value="school_day_cycle">School-day cycle</option>
          </select>
        </label>
        <label>Start / end
          <div class="row">
            <input id="manStart" type="date" />
            <input id="manEnd" type="date" />
          </div>
        </label>
      </div>
      <button type="button" class="btn-primary" id="manSave">Save mandate</button>
    </div>
  `);

  async function readCaseloadFile() {
    const file = document.getElementById('caseloadFile').files[0];
    if (!file) throw new Error('Choose a CSV or Excel file first.');
    const name = file.name || '';
    const mime = file.type || '';
    if (/\.xlsx?$/i.test(name) || /excel|spreadsheetml/i.test(mime)) {
      const fileBase64 = await fileToBase64(file);
      state.caseloadImport = { fileName: name, mime, fileBase64 };
      return state.caseloadImport;
    }
    const csvText = await file.text();
    state.caseloadImport = { fileName: name, mime, csvText };
    return state.caseloadImport;
  }

  document.getElementById('caseloadImportBtn').onclick = async () => {
    try {
      const payload = await readCaseloadFile();
      const out = await api('POST', '/admin/caseloads/import', payload);
      state.caseloadPreview = out;
      const errN = (out.errors || []).length;
      const createdM = out.createdMandates || 0;
      const updatedM = out.updatedMandates || 0;
      const createdS = out.createdStudents || 0;
      const updatedS = out.updatedStudents || 0;
      if (errN && !createdM && !updatedM && !createdS) {
        setStatus(`Import failed: ${errN} row error(s). See the table below.`, 'err');
      } else if (errN) {
        setStatus(
          `Imported with ${errN} row error(s). ${createdM} new / ${updatedM} updated mandate(s), ${createdS} new / ${updatedS} updated student(s).`,
          'warn',
        );
      } else {
        setStatus(
          `Imported ${createdM} new / ${updatedM} updated mandate(s), ${createdS} new / ${updatedS} updated student(s).`,
          'ok',
        );
      }
      await adminMandates();
    } catch (e) { setStatus(e.message, 'err'); }
  };

  const completeBtn = document.getElementById('caseloadCompleteBtn');
  if (completeBtn) {
    completeBtn.onclick = async () => {
      state.caseloadPreview = null;
      state.caseloadImport = null;
      setStatus('Import results cleared.', 'ok');
      await adminMandates();
    };
  }

  document.getElementById('manSave').onclick = async () => {
    try {
      const studentId = document.getElementById('manStudent').value;
      const mandateKind = document.getElementById('manKind').value;
      const freq = Number(document.getElementById('manFreq').value);
      if (!studentId) throw new Error('Pick a student.');
      if (!Number.isFinite(freq) || freq < 0) throw new Error('Enter frequency / makeup count.');
      const out = await api('POST', '/admin/mandates', {
        studentId,
        providerId: document.getElementById('manProvider').value,
        serviceType: document.getElementById('manService').value || (mandateKind === 'makeup_auth' ? 'Makeup authorization' : ''),
        mandateKind,
        ratioGroup: document.getElementById('manRatio').value === 'group',
        frequencyKind: document.getElementById('manPeriod').value,
        frequencyPerWeek: freq,
        sessionsPerPeriod: freq,
        startOn: document.getElementById('manStart').value,
        endOn: document.getElementById('manEnd').value,
      });
      setStatus(out.message || 'Mandate saved.', 'ok');
      await adminMandates();
    } catch (e) { setStatus(e.message, 'err'); }
  };
}

function weekProgressRowsHtml(progressRows) {
  return (progressRows || [])
    .map((r) => {
      const badge =
        r.progressPct >= 100
          ? '<span class="prog-badge prog-100">100% notes</span>'
          : r.progressPct >= 50
            ? '<span class="prog-badge prog-50">50% provided</span>'
            : '<span class="prog-badge prog-0">0%</span>';
      return `<tr>
            <td><button type="button" class="linkish" data-open-child="${esc(r.studentId)}">${esc(r.childName)}</button></td>
            <td>${esc(r.mandateLabel || '—')}</td>
            <td>${esc(r.weekLabel || r.weekStart || '—')}</td>
            <td>${esc(String(r.sessionsProvided ?? 0))}</td>
            <td>${esc(String(r.notesPosted ?? 0))}</td>
            <td>${esc(String(r.sessionsMissed ?? 0))}</td>
            <td>${esc(String(r.notesFollowUp ?? 0))}</td>
            <td>${badge}</td>
          </tr>`;
    })
    .join('') || '<tr><td colspan="8">No sessions in this week range.</td></tr>';
}

function bindAdminReportsShell({ from, to }) {
  const loadBtn = document.getElementById('progLoad');
  if (loadBtn) {
    loadBtn.onclick = async () => {
      if (loadBtn.disabled) return;
      state.reportFrom = document.getElementById('progFrom').value || from;
      state.reportTo = document.getElementById('progTo').value || to;
      const nextFrom = state.reportFrom;
      const nextTo = state.reportTo;
      const q = `from=${encodeURIComponent(nextFrom)}&to=${encodeURIComponent(nextTo)}`;
      const tbody = document.getElementById('progBody');
      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading…';
      if (tbody) tbody.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
      try {
        const progress = await api('GET', `/admin/reports/week-progress?${q}`);
        if (tbody) tbody.innerHTML = weekProgressRowsHtml(progress.rows || []);
        setStatus('', '');
      } catch (e) {
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="8">${esc(e.message || 'Could not load progress.')}</td></tr>`;
        }
        setStatus(e.message || 'Could not load progress.', 'err');
      } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load';
      }
    };
  }
  const lastLoad = document.getElementById('lastLoad');
  if (lastLoad) {
    lastLoad.onclick = async () => {
      state.lastServiceProviderId = document.getElementById('lastProvider')?.value || '';
      await adminReports();
    };
  }
  document.getElementById('view').onclick = async (e) => {
    const openChild = e.target.closest('[data-open-child]');
    if (openChild) {
      adminChildDetail(openChild.getAttribute('data-open-child'), { backTo: 'reports' });
      return;
    }
    const delDue = e.target.closest('[data-del-due]');
    if (delDue) {
      try {
        if (!confirm('Remove this progress report due date? Alerts for it will stop. This cannot be undone.')) return;
        await api('DELETE', `/admin/due-dates/${delDue.getAttribute('data-del-due')}`);
        setStatus('Due date removed.', 'ok');
        adminReports();
      } catch (err) {
        setStatus(err.message, 'err');
      }
      return;
    }
    const btn = e.target.closest('[data-complete]');
    if (!btn) return;
    try {
      await api('POST', `/admin/due-dates/${btn.getAttribute('data-complete')}/complete`, {});
      setStatus('Due date marked complete. Alerts stop.', 'ok');
      adminReports();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  };
}

async function adminReports() {
  const fromDefault = state.reportFrom || (() => {
    const d = new Date(`${mondayIso()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 28);
    return d.toISOString().slice(0, 10);
  })();
  const toDefault = state.reportTo || mondayIso();
  const from = state.reportFrom || fromDefault;
  const to = state.reportTo || toDefault;
  state.reportFrom = from;
  state.reportTo = to;
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const lastProviderId = state.lastServiceProviderId || '';

  const providersOut = await api('GET', '/admin/providers').catch(() => ({ providers: [] }));
  const providers = providersOut.providers || [];

  view(`
    <div class="card">
      <h2>Sessions &amp; notes progress</h2>
      <p class="muted">Sessions provided vs mandate (e.g. 50%). Session notes posted (e.g. 100%). Note follow-up counts missing or short notes plus missed sessions that still need attention.</p>
      <div class="row">
        <label>Week from <input id="progFrom" type="date" value="${esc(from)}" /></label>
        <label>Week to <input id="progTo" type="date" value="${esc(to)}" /></label>
        <button type="button" class="btn-primary" id="progLoad" disabled>Loading…</button>
        <button type="button" class="btn" id="progXlsx">Export Excel</button>
      </div>
      <table>
        <tr>
          <th>Child</th>
          <th>Mandate</th>
          <th>Week</th>
          <th>Sessions provided</th>
          <th>Session notes posted</th>
          <th>Missed</th>
          <th>Note follow-up</th>
          <th>Progress</th>
        </tr>
        <tbody id="progBody"><tr><td colspan="8">Loading…</td></tr></tbody>
      </table>
    </div>
    <div class="card">
      <h2>Last service date</h2>
      <p class="muted">Latest attended/makeup DOS per child and provider. Filter by provider.</p>
      <div class="row">
        <label>Provider
          <select id="lastProvider">
            <option value="">All providers</option>
            ${providers.map((p) => {
              const label = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.id;
              const sel = lastProviderId === p.id ? ' selected' : '';
              return `<option value="${esc(p.id)}"${sel}>${esc(label)}</option>`;
            }).join('')}
          </select>
        </label>
        <button type="button" class="btn-primary" id="lastLoad">Load</button>
        <button type="button" class="btn" id="lastXlsx">Export Excel</button>
      </div>
      <table><tr><th>Child</th><th>Provider</th><th>School</th><th>Last DOS</th></tr>
      <tbody id="lastBody"><tr><td colspan="4">Loading…</td></tr></tbody>
      </table>
      <h2>Progress report due dates</h2>
      <div class="row">
        <label>From <input id="dueFrom" type="date" value="${esc(from)}" /></label>
        <label>To <input id="dueTo" type="date" value="${esc(to)}" /></label>
        <button type="button" class="btn" id="duesXlsx">Export Excel</button>
      </div>
      ${bulkBar('report-dues')}
      <table><tr>${bulkTh('report-dues')}<th>School</th><th>Kind</th><th>Due</th><th>Status</th><th></th></tr>
      <tbody id="duesBody"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
  `);
  bindAdminReportsShell({ from, to });

  const loadBtn = document.getElementById('progLoad');
  let progress = { rows: [] };
  let last = { rows: [] };
  let dues = { rows: [] };
  const lastQ = lastProviderId
    ? `providerId=${encodeURIComponent(lastProviderId)}`
    : '';
  try {
    [progress, last, dues] = await Promise.all([
      api('GET', `/admin/reports/week-progress?${q}`),
      api('GET', `/admin/reports/last-service${lastQ ? `?${lastQ}` : ''}`),
      api('GET', `/admin/reports/due-dates?${q}`),
    ]);
  } catch (e) {
    setStatus(e.message || 'Could not load reports.', 'err');
    const progBody = document.getElementById('progBody');
    if (progBody) {
      progBody.innerHTML = `<tr><td colspan="8">${esc(e.message || 'Could not load reports.')}</td></tr>`;
    }
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load';
    }
    return;
  }

  const progBody = document.getElementById('progBody');
  const lastBody = document.getElementById('lastBody');
  const duesBody = document.getElementById('duesBody');
  if (progBody) progBody.innerHTML = weekProgressRowsHtml(progress.rows || []);
  if (lastBody) {
    lastBody.innerHTML =
      (last.rows || [])
        .map(
          (r) =>
            `<tr><td>${childNameLink(r.studentId, r.name)}</td><td>${esc(r.providerName || '—')}</td><td>${esc(r.schoolName || '—')}</td><td>${esc(r.lastDos)}</td></tr>`,
        )
        .join('') || '<tr><td colspan="4">None</td></tr>';
  }
  if (duesBody) {
    duesBody.innerHTML =
      (dues.rows || [])
        .map(
          (r) =>
            `<tr>${bulkTd('report-dues', r.id)}<td>${esc(r.schoolName || r.schoolId)}</td><td>${esc(r.kind)}</td><td>${esc(r.dueOn)}</td><td>${esc(r.status)}</td><td>${r.completedAt ? `<button class="btn" data-del-due="${esc(r.id)}">Remove</button>` : `<button class="btn" data-complete="${esc(r.id)}">Mark complete</button> <button class="btn" data-del-due="${esc(r.id)}">Remove</button>`}</td></tr>`,
        )
        .join('') || '<tr><td colspan="6">None</td></tr>';
  }
  bindBulkDelete('report-dues', {
    noun: 'due dates',
    deleteOne: (id) => api('DELETE', `/admin/due-dates/${id}`),
    refresh: () => adminReports(),
  });
  if (loadBtn) {
    loadBtn.disabled = false;
    loadBtn.textContent = 'Load';
  }
  const bindXlsx = (id, path, name, fromId, toId) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = async () => {
      try {
        const f = document.getElementById(fromId)?.value || from;
        const t = document.getElementById(toId)?.value || to;
        const qq = `from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
        await downloadReportXlsx(`${path}?${qq}`, name);
        setStatus(`Downloaded ${name}.`, 'ok');
      } catch (e) {
        setStatus(e.message, 'err');
      }
    };
  };
  bindXlsx('progXlsx', '/admin/reports/week-progress.xlsx', 'sessions-notes-progress.xlsx', 'progFrom', 'progTo');
  bindXlsx('duesXlsx', '/admin/reports/due-dates.xlsx', 'due-dates.xlsx', 'dueFrom', 'dueTo');
  const lastXlsx = document.getElementById('lastXlsx');
  if (lastXlsx) {
    lastXlsx.onclick = async () => {
      try {
        const pid = document.getElementById('lastProvider')?.value || '';
        const qq = pid ? `providerId=${encodeURIComponent(pid)}` : '';
        await downloadReportXlsx(`/admin/reports/last-service.xlsx${qq ? `?${qq}` : ''}`, 'last-service.xlsx');
        setStatus('Downloaded last-service.xlsx.', 'ok');
      } catch (e) {
        setStatus(e.message, 'err');
      }
    };
  }
}

// ---- Cognito sign-in (only when the build set a clientId) ----

function cognitoRegion() {
  return USER_POOL_ID.split('_')[0] || 'us-east-1';
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

function cognitoType(data) {
  return String(data?.__type || '').split('#').pop();
}

function loginErrorMessage(data) {
  const type = cognitoType(data);
  const plain = {
    NotAuthorizedException: 'Wrong email or password. Please try again.',
    UserNotFoundException: 'No account with that email. Ask the office to invite you.',
    UserNotConfirmedException: 'This account is not ready yet. Ask the office for help.',
    PasswordResetRequiredException: 'Your password needs a reset. Use Forgot password below, or ask the office for help.',
    InvalidPasswordException: 'That password is too simple. Use at least 8 characters with a capital letter, a small letter, and a number.',
    TooManyRequestsException: 'Too many tries. Wait a minute and try again.',
    LimitExceededException: 'Too many tries. Wait a minute and try again.',
    CodeMismatchException: 'That code is wrong. Please try again.',
    ExpiredCodeException: 'That code expired. Request a new code with Forgot password.',
    InvalidParameterException: 'Check the email and try again.',
    ResourceNotFoundException: 'Sign-in is misconfigured (wrong app client). Ask the office for help.',
  };
  if (plain[type]) return plain[type];
  if (data?.message) return type ? `${data.message} (${type})` : String(data.message);
  return 'Sign in did not work. Please try again.';
}

function changePasswordErrorMessage(data) {
  const type = cognitoType(data);
  const plain = {
    NotAuthorizedException: 'Wrong current password. Please try again.',
    InvalidPasswordException: 'That password is too simple. Use at least 8 characters with a capital letter, a small letter, and a number.',
    InvalidParameterException: 'That password is too simple. Use at least 8 characters with a capital letter, a small letter, and a number.',
    LimitExceededException: 'Too many tries. Wait a minute and try again.',
    TooManyRequestsException: 'Too many tries. Wait a minute and try again.',
    CodeMismatchException: 'That code is wrong. Please try again.',
    ExpiredCodeException: 'That code expired. Request a new code with Forgot password.',
    UserNotFoundException: 'No account with that email. Ask the office to invite you.',
  };
  if (plain[type]) return plain[type];
  if (data?.message) return type ? `${data.message} (${type})` : String(data.message);
  return 'Could not change password. Please try again.';
}

const COGNITO_NETFREE_HINT =
  'Could not reach Cognito. If you use NetFree, allowlist cognito-idp.us-east-1.amazonaws.com, then try again.';

async function cognitoCall(target, body, errorFn = loginErrorMessage) {
  const url = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(COGNITO_NETFREE_HINT);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Cognito uses HTTP 400 for wrong password etc. Empty/opaque bodies often mean a filter mangled the call.
    if (!data.__type && !data.message) {
      throw new Error(
        `Sign-in service returned ${res.status}. If you use NetFree, allowlist cognito-idp.us-east-1.amazonaws.com.`,
      );
    }
    throw new Error(errorFn(data));
  }
  return data;
}

function applyToken(idToken, accessToken) {
  const payload = decodeJwtPayload(idToken) || {};
  const groups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [];
  state.idToken = idToken;
  state.email = String(payload.email || payload['cognito:username'] || '');
  state.role = groups.includes('Admin') || groups.includes('admin') ? 'admin' : 'therapist';
  localStorage.setItem('tmsIdToken', idToken);
  if (arguments.length >= 2) {
    state.accessToken = accessToken || '';
    if (accessToken) localStorage.setItem('tmsAccessToken', accessToken);
    else localStorage.removeItem('tmsAccessToken');
  }
}

function tokenStillGood(token) {
  const payload = token ? decodeJwtPayload(token) : null;
  return Boolean(payload && payload.exp && payload.exp * 1000 > Date.now() + 30000);
}

function signOut(message) {
  state.idToken = '';
  state.accessToken = '';
  state.email = '';
  localStorage.removeItem('tmsIdToken');
  localStorage.removeItem('tmsAccessToken');
  showLogin(message || '');
}

function loginError(msg) {
  const box = document.getElementById('loginErr');
  if (!box) return;
  box.textContent = msg || '';
  box.hidden = !msg;
}

function showLogin(message) {
  if (COGNITO_MODE && tokenStillGood(state.idToken)) {
    showRole();
    return;
  }
  hideAppChrome();
  setStatus('', '');
  view(`
    <div class="card login-card">
      <h2>Sign in</h2>
      <p>Use the email and password from your White Glove invite email.</p>
      <div id="loginErr" class="err-box" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
      <label>Email <input id="loginEmail" type="email" autocomplete="username" placeholder="you@example.com" /></label>
      <label>Password <input id="loginPassword" type="password" autocomplete="current-password" /></label>
      <button class="btn-primary big" id="loginBtn">Sign in</button>
      <p class="login-footer-link"><button type="button" class="linkish" id="forgotPasswordBtn">Forgot password?</button></p>
    </div>
  `);
  const submit = async () => {
    const btn = document.getElementById('loginBtn');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    loginError('');
    if (!email || !password) {
      loginError('Type your email and password first.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const out = await cognitoCall('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
      if (out.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        showNewPassword(email, out.Session);
        return;
      }
      const auth = out.AuthenticationResult || {};
      const idToken = auth.IdToken;
      if (!idToken) throw new Error('Sign in did not work. Please try again.');
      applyToken(idToken, auth.AccessToken || '');
      openingAccountView();
      await showRole();
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  };
  document.getElementById('loginBtn').onclick = submit;
  document.getElementById('loginPassword').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('forgotPasswordBtn').onclick = () => {
    const email = document.getElementById('loginEmail').value.trim();
    showForgotPassword(email);
  };
  document.getElementById('loginEmail').focus();
}

function showForgotPassword(prefillEmail) {
  hideAppChrome();
  setStatus('', '');
  view(`
    <div class="card login-card">
      <h2>Forgot password</h2>
      <p>We will email you a confirmation code. Then you pick a new password.</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>Email <input id="forgotEmail" type="email" autocomplete="username" placeholder="you@example.com" value="${esc(prefillEmail || '')}" /></label>
      <button class="btn-primary big" id="forgotSendBtn">Email me a code</button>
      <p><button type="button" class="btn" id="forgotBackBtn">Back to sign in</button></p>
    </div>
  `);
  document.getElementById('forgotBackBtn').onclick = () => showLogin('');
  document.getElementById('forgotSendBtn').onclick = async () => {
    const btn = document.getElementById('forgotSendBtn');
    const email = document.getElementById('forgotEmail').value.trim();
    loginError('');
    if (!email) {
      loginError('Type your email first.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await cognitoCall('ForgotPassword', {
        ClientId: CLIENT_ID,
        Username: email,
      });
      showConfirmForgotPassword(email);
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = 'Email me a code';
    }
  };
  document.getElementById('forgotEmail').focus();
}

function showConfirmForgotPassword(email) {
  hideAppChrome();
  setStatus('', '');
  view(`
    <div class="card login-card">
      <h2>Enter the code</h2>
      <p>Check <strong>${esc(email)}</strong> for a confirmation code, then choose a new password (at least 8 characters with a capital letter, a small letter, and a number).</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>Confirmation code <input id="forgotCode" type="text" autocomplete="one-time-code" inputmode="numeric" /></label>
      <label>New password <input id="forgotNew" type="password" autocomplete="new-password" /></label>
      <label>Type new password again <input id="forgotNew2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="forgotConfirmBtn">Save new password</button>
      <p><button type="button" class="linkish" id="forgotResendBtn">Send another code</button></p>
      <p><button type="button" class="btn" id="forgotBackBtn">Back to sign in</button></p>
    </div>
  `);
  document.getElementById('forgotBackBtn').onclick = () => showLogin('');
  document.getElementById('forgotResendBtn').onclick = () => showForgotPassword(email);
  const submit = async () => {
    const btn = document.getElementById('forgotConfirmBtn');
    const code = document.getElementById('forgotCode').value.trim();
    const p1 = document.getElementById('forgotNew').value;
    const p2 = document.getElementById('forgotNew2').value;
    loginError('');
    if (!code || !p1 || !p2) {
      loginError('Fill in the code and both password fields.');
      return;
    }
    if (p1 !== p2) {
      loginError('The two passwords do not match.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await cognitoCall('ConfirmForgotPassword', {
        ClientId: CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        Password: p1,
      });
      setStatus('Password updated. Sign in with your new password.', 'ok');
      showLogin('');
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = 'Save new password';
    }
  };
  document.getElementById('forgotConfirmBtn').onclick = submit;
  document.getElementById('forgotNew2').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('forgotCode').focus();
}

function showNewPassword(email, session) {
  hideAppChrome();
  view(`
    <div class="card login-card">
      <h2>Choose a new password</h2>
      <p>First sign in: pick your own password. At least 8 characters with a capital letter, a small letter, and a number.</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>New password <input id="newPassword" type="password" autocomplete="new-password" /></label>
      <label>Type it again <input id="newPassword2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="newPassBtn">Save password and sign in</button>
    </div>
  `);
  const submit = async () => {
    const btn = document.getElementById('newPassBtn');
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('newPassword2').value;
    loginError('');
    if (!p1) {
      loginError('Type a new password first.');
      return;
    }
    if (p1 !== p2) {
      loginError('The two passwords do not match.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const out = await cognitoCall('RespondToAuthChallenge', {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: CLIENT_ID,
        Session: session,
        ChallengeResponses: { USERNAME: email, NEW_PASSWORD: p1 },
      });
      const auth = out.AuthenticationResult || {};
      const idToken = auth.IdToken;
      if (!idToken) throw new Error('Sign in did not work. Please sign in again.');
      applyToken(idToken, auth.AccessToken || '');
      openingAccountView();
      await showRole();
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = 'Save password and sign in';
    }
  };
  document.getElementById('newPassBtn').onclick = submit;
  document.getElementById('newPassword2').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('newPassword').focus();
}

function changePasswordError(msg) {
  const box = document.getElementById('changePwErr');
  if (!box) return;
  box.textContent = msg || '';
  box.hidden = !msg;
}

function showChangePassword() {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    signOut('Your sign in ended. Please sign in again.');
    return;
  }
  if (!state.accessToken) {
    view(`
      <div class="card login-card">
        <h2>Change password</h2>
        <div class="err-box">Sign out and Sign in again, then you can change your password.</div>
        <button type="button" class="btn" id="changePwCancel">Back</button>
      </div>
    `);
    document.getElementById('changePwCancel').onclick = () => showRole();
    return;
  }
  view(`
    <div class="card login-card">
      <h2>Change password</h2>
      <p>At least 8 characters with a capital letter, a small letter, and a number.</p>
      <div id="changePwErr" class="err-box" hidden></div>
      <label>Current password <input id="changePwCurrent" type="password" autocomplete="current-password" /></label>
      <label>New password <input id="changePwNew" type="password" autocomplete="new-password" /></label>
      <label>Type new password again <input id="changePwNew2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="changePwSave">Save</button>
      <p><button type="button" class="btn" id="changePwCancel">Cancel</button></p>
    </div>
  `);
  const submit = async () => {
    const btn = document.getElementById('changePwSave');
    const current = document.getElementById('changePwCurrent').value;
    const p1 = document.getElementById('changePwNew').value;
    const p2 = document.getElementById('changePwNew2').value;
    changePasswordError('');
    if (!current || !p1 || !p2) {
      changePasswordError('Fill in all three password fields.');
      return;
    }
    if (p1 !== p2) {
      changePasswordError('The two new passwords do not match.');
      return;
    }
    if (!state.accessToken) {
      changePasswordError('Sign out and Sign in again, then you can change your password.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await cognitoCall(
        'ChangePassword',
        {
          PreviousPassword: current,
          ProposedPassword: p1,
          AccessToken: state.accessToken,
        },
        changePasswordErrorMessage,
      );
      setStatus('Password changed. Use the new password next time you sign in.', 'ok');
      showRole();
    } catch (e) {
      changePasswordError(e.message);
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  };
  document.getElementById('changePwSave').onclick = submit;
  document.getElementById('changePwCancel').onclick = () => showRole();
  document.getElementById('changePwNew2').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('changePwCurrent').focus();
}

// ---- Navigation ----

function hideAppChrome() {
  document.body.classList.add('is-auth');
  document.body.classList.remove('is-app');
  document.getElementById('whoBar').hidden = true;
  document.getElementById('rolePick').hidden = true;
  document.getElementById('adminNav').hidden = true;
  document.getElementById('therapistNav').hidden = true;
  document.getElementById('changePassword').hidden = true;
  document.getElementById('signout').hidden = true;
  document.getElementById('whoami').textContent = '';
}

async function showRole() {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    signOut('Your sign in ended. Please sign in again.');
    return;
  }
  const admin = state.role === 'admin';
  document.body.classList.remove('is-auth');
  document.body.classList.add('is-app');
  // Always show whoBar after login for both therapist and admin
  const whoBar = document.getElementById('whoBar');
  whoBar.hidden = false;
  whoBar.removeAttribute('hidden');
  // Therapists get one page — never show therapist tab nav
  document.getElementById('therapistNav').hidden = true;
  document.getElementById('adminNav').hidden = !admin;
  document.getElementById('rolePick').hidden = COGNITO_MODE;
  const label = admin ? 'Admin' : 'Therapist';
  document.getElementById('whoami').textContent = COGNITO_MODE && state.email ? `${state.email} — ${label}` : label;
  const changePw = document.getElementById('changePassword');
  const signOutBtn = document.getElementById('signout');
  if (COGNITO_MODE) {
    changePw.hidden = false;
    changePw.removeAttribute('hidden');
    signOutBtn.hidden = false;
    signOutBtn.removeAttribute('hidden');
  } else {
    changePw.hidden = true;
    signOutBtn.hidden = true;
  }
  // Replace Sign in (or any prior) content before API calls so chrome never
  // shows "signed in" while the login form is still stuck on Signing in…
  openingAccountView();
  try {
    if (admin) await adminDash();
    else await therapistHome();
  } catch (e) {
    homeLoadErrorView(e);
  }
}

document.getElementById('role').onchange = (e) => {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    hideAppChrome();
    signOut('');
    return;
  }
  state.role = e.target.value;
  showRole();
};

document.getElementById('changePassword').onclick = () => {
  showChangePassword();
};

document.getElementById('signout').onclick = () => {
  signOut('');
};

document.getElementById('therapistNav').onclick = (e) => {
  e.preventDefault();
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    hideAppChrome();
    signOut('');
    return;
  }
  therapistHome();
};

document.getElementById('adminNav').onclick = (e) => {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    hideAppChrome();
    signOut('');
    return;
  }
  const btn = e.target.closest('[data-admin]');
  if (!btn) return;
  document.querySelectorAll('#adminNav .nav').forEach((b) => b.classList.toggle('on', b === btn));
  const screen = btn.getAttribute('data-admin');
  if (screen === 'dash') adminDash();
  if (screen === 'children') adminChildren();
  if (screen === 'providers') adminProviders();
  if (screen === 'mandates') adminMandates();
  if (screen === 'schools') adminSchools();
  if (screen === 'admins') adminAdmins();
  if (screen === 'reports') adminReports();
};

if (COGNITO_MODE) {
  hideAppChrome();
  if (tokenStillGood(state.idToken)) {
    applyToken(state.idToken);
    showRole();
  } else {
    showLogin('');
  }
} else {
  showRole();
}
