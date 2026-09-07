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
  reportView: '',
  childDetailBack: 'children',
  focusSchoolId: '',
  selectedSchoolId: sessionStorage.getItem('tmsSchoolId') || '',
  schoolConfirmed: sessionStorage.getItem('tmsSchoolConfirmed') === '1',
  lastServiceProviderId: '',
  childSessionFrom: '',
  childSessionTo: '',
  providerSessionFrom: '',
  providerSessionTo: '',
  therapistPane: sessionStorage.getItem('tmsTherapistPane') || 'current',
  listTabLetter: 'A',
  editingMandateId: '',
};

const REPORT_LIST = [
  {
    id: 'week-progress',
    title: 'Weekly session progress',
    blurb: 'Sessions delivered and notes posted by child and week.',
  },
  {
    id: 'last-service',
    title: 'Last date of service',
    blurb: 'Most recent attended or makeup date of service by child and provider.',
  },
  {
    id: 'due-dates',
    title: 'Progress-report due dates',
    blurb: 'School progress, annual, and reevaluation due dates with completion status.',
  },
];

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
    throw new Error(data.error || `Unable to export ${filename}`);
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
  const err = new Error(message || 'The request could not be completed.');
  err.errors = Array.isArray(extras.errors) ? extras.errors : [];
  err.warnings = Array.isArray(extras.warnings) ? extras.warnings : [];
  err.status = extras.status;
  return err;
}

async function api(method, path, body, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 0;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw apiError(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. Check your connection and try again.`,
      );
    }
    throw apiError(
      'Unable to reach the server. If you use NetFree, route traffic through the /api proxy, then refresh.',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401 && COGNITO_MODE) {
    signOut('Your session has ended. Please sign in again.');
    throw apiError('Please sign in again.', { status: 401 });
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('pdf') ? await res.blob() : await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 207)) {
    const { errors, warnings, summary } = issueListFromPayload(data);
    const msg =
      summary ||
      (res.statusText && res.statusText !== 'Bad Request' ? res.statusText : '') ||
      `Request failed (${res.status}). Review the error details under Import.`;
    throw apiError(msg, { errors, warnings, status: res.status });
  }
  return data;
}

function clearUploadIssues() {
  const el = document.getElementById('uploadIssues');
  if (el) {
    el.hidden = true;
    el.innerHTML = '';
  }
  const adminEl = document.getElementById('pUploadIssues');
  if (adminEl) {
    adminEl.hidden = true;
    adminEl.innerHTML = '';
  }
}

function setUploadIssues(errors, warnings, successes) {
  const el = document.getElementById('uploadIssues');
  if (!el) return;
  const errs = (errors || []).map((e) => String(e || '').trim()).filter(Boolean);
  const warns = (warnings || []).map((w) => String(w || '').trim()).filter(Boolean);
  const oks = (successes || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!errs.length && !warns.length && !oks.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = [
    `<div class="dismissible-toolbar">
      <button type="button" class="btn status-clear-btn" data-clear-upload-issues>Clear</button>
    </div>`,
    oks.length
      ? `<div class="ok-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-upload-issues aria-label="Clear upload results">×</button><strong>Saved</strong>${oks
          .map((s) => `<div class="upload-issue-line">${esc(s)}</div>`)
          .join('')}</div>`
      : '',
    errs.length
      ? `<div class="err-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-upload-issues aria-label="Clear upload issues">×</button><strong>${oks.length ? 'Failed sessions' : 'Upload issues'}</strong>${errs
          .map((e) => `<div class="upload-issue-line">${esc(e)}</div>`)
          .join('')}</div>`
      : '',
    warns.length
      ? `<div class="warn-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-upload-issues aria-label="Clear warnings">×</button><strong>Warnings</strong>${warns
          .map((w) => `<div class="upload-issue-line">${esc(w)}</div>`)
          .join('')}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  el.querySelectorAll('[data-clear-upload-issues]').forEach((btn) => {
    btn.onclick = () => {
      clearUploadIssues();
      clearStatus();
    };
  });
}

function openingAccountView() {
  view(`
    <div class="card">
      <h2>Loading your account…</h2>
      <p>One moment, please.</p>
    </div>
  `);
}

function homeLoadErrorView(err) {
  view(`
    <div class="card">
      <h2>Unable to load</h2>
      <div class="err-box">${esc(err?.message || 'An unexpected error occurred.')}</div>
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

function clearStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = '';
  el.className = '';
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
    clearStatus();
    return;
  }
  el.className = 'status-stack';
  el.innerHTML = `${items
    .map((it) => `<span class="status-chip ${it.kind || 'neutral'}">${esc(it.text)}</span>`)
    .join('')}
    <button type="button" class="status-clear-btn" id="clearStatusBtn" aria-label="Clear status messages">Clear</button>`;
  document.getElementById('clearStatusBtn')?.addEventListener('click', () => clearStatus());
}

/** Week top summary: optional flash successes + red errors + yellow warnings. */
function setWeekTopStatus({ success = [], error = [], warn = [] } = {}) {
  setStatus({ success, error, warn });
}

/** Bring top status chips into view — Send lives at the bottom of a long page. */
function revealStatus() {
  const el = document.getElementById('status');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

let actionToastTimer = 0;
function clearActionToast() {
  const el = document.getElementById('actionToast');
  if (actionToastTimer) clearTimeout(actionToastTimer);
  actionToastTimer = 0;
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
  el.className = 'action-toast';
}

/** Transient UI (import banners, toasts, top chips) — not server-side week validation. */
function clearTransientErrors() {
  clearStatus();
  clearActionToast();
  clearUploadIssues();
}

/** Fixed toast so Send feedback is visible without scrolling to the top status bar. */
function showActionToast(message, kind = 'neutral', { sticky = false } = {}) {
  let el = document.getElementById('actionToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'actionToast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  const text = String(message || '').trim();
  if (!text) {
    clearActionToast();
    return;
  }
  el.hidden = false;
  el.className = `action-toast ${normalizeStatusKind(kind) || 'neutral'}`;
  el.innerHTML = `<span class="action-toast-text">${esc(text)}</span><button type="button" class="action-toast-dismiss" aria-label="Dismiss">×</button>`;
  el.querySelector('.action-toast-dismiss')?.addEventListener('click', () => clearActionToast());
  if (actionToastTimer) clearTimeout(actionToastTimer);
  actionToastTimer = 0;
  if (!sticky) {
    actionToastTimer = setTimeout(() => {
      clearActionToast();
    }, kind === 'error' || kind === 'err' ? 10000 : 7000);
  }
}

function timesheetSendBlockReason({ week, sessions, locked, errors, signerEmail }) {
  if (locked) return 'This week is already submitted and cannot be sent again.';
  if (!week) return 'Your provider profile is not ready yet. Contact the office.';
  if (!sessions.length) return 'Add at least one session before submitting.';
  if (errors.length) {
    return 'Resolve the red blocking issues above before submitting.';
  }
  if (!String(signerEmail || '').trim()) {
    return 'No school signer is on file. Contact the office to assign a signer.';
  }
  return '';
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
  if (!confirm(`Permanently delete ${n} items? This cannot be reversed.`)) return false;
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
            `Removed ${ok}. ${errors.length} could not be removed: ${errors[0]}`,
            ok === 0 ? 'err' : 'warn',
          );
        } else {
          setStatus(`Removed ${ok} ${noun}.`, 'ok');
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
    payRateEval: num(ids.eval),
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
          <label>Hourly session <input id="${prefix}Hour" type="number" step="0.01" min="0" value="${v('payRatePerHour')}" /></label>
        </div>
        <div class="row">
          <label>Group 30 min <input id="${prefix}G30" type="number" step="0.01" min="0" value="${v('payRateGroup30Min')}" /></label>
          <label>Group 42 min <input id="${prefix}G42" type="number" step="0.01" min="0" value="${v('payRateGroup42Min')}" /></label>
        </div>
        <div class="row">
          <label>Group 45 min <input id="${prefix}G45" type="number" step="0.01" min="0" value="${v('payRateGroup45Min')}" /></label>
          <label>Eval <input id="${prefix}Eval" type="number" step="0.01" min="0" value="${v('payRateEval')}" /></label>
        </div>
        <div class="row">
          <label>Additional services (hourly, billed by the minute) <input id="${prefix}Extra" type="number" step="0.01" min="0" value="${v('payRateAdditionalHourly')}" /></label>
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
  const sorted = [...(students || [])].sort((a, b) => {
    const la = `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.id;
    const lb = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.id;
    return la.localeCompare(lb);
  });
  return `<option value="">Select a student</option>${sorted.map((s) => {
    const id = s.id;
    const label = `${s.firstName || ''} ${s.lastName || ''}`.trim() || id;
    return `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('')}`;
}

function providerOptions(providers, selected) {
  const sorted = [...(providers || [])].sort((a, b) => {
    const la = `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.id;
    const lb = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.id;
    return la.localeCompare(lb);
  });
  return `<option value="">Select a provider</option>${sorted.map((p) => {
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
    return `<div class="cal-saved muted"><p>No calendar saved yet${name}. Enter the first day, last day, and off days below, then save.</p></div>`;
  }
  const offs = [...(calendar.offDays || [])].sort();
  const offList = offs.length
    ? `<ul class="cal-off-summary">${offs.map((d) => `<li>${esc(formatIsoDateLabel(d))} <span class="muted">(${esc(d)})</span></li>`).join('')}</ul>`
    : '<p class="muted">No off days recorded.</p>';
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

function providerNameLink(providerId, label) {
  const id = String(providerId || '').trim();
  const text = String(label || '').trim() || id || '—';
  if (!id) return esc(text);
  return `<button type="button" class="linkish" data-open-provider="${esc(id)}">${esc(text)}</button>`;
}

function mandateFreqLabel(m) {
  if (m?.freqDisplay) return m.freqDisplay;
  const kind =
    m?.frequencyKind === 'school_day_cycle'
      ? 'school_day_cycle'
      : m?.frequencyKind === 'monthly'
        ? 'monthly'
        : 'weekly';
  const n = m?.sessionsPerPeriod ?? m?.frequencyPerWeek;
  if (n == null || n === '') return '—';
  if (kind === 'school_day_cycle') return `${n} / ${m?.periodSchoolDays || 6} school days`;
  if (kind === 'monthly') return `${n} / month`;
  return `${n} / week`;
}

function mandatePeriodOptions(selected) {
  const cur = String(selected || 'weekly');
  return [
    ['weekly', 'Weekly'],
    ['school_day_cycle', '6-Day Cycle'],
    ['monthly', 'Monthly'],
  ]
    .map(([v, label]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function bindMandateEditor(opts) {
  const { mandates, providers, students, onSaved, panelId = 'editMandatePanel' } = opts;
  document.querySelectorAll('[data-edit-mandate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-mandate');
      const m = (mandates || []).find((x) => x.id === id);
      const panel = document.getElementById(panelId);
      if (!m || !panel) return;
      const kind = m.mandateKind === 'makeup_auth' ? 'makeup_auth' : 'regular';
      const period = m.frequencyKind === 'school_day_cycle'
        ? 'school_day_cycle'
        : m.frequencyKind === 'monthly'
          ? 'monthly'
          : 'weekly';
      panel.hidden = false;
      panel.innerHTML = `
        <h3>Edit mandate</h3>
        <div class="row">
          <label>Student
            <select id="emStudent">${studentOptions(students || [], m.studentId)}</select>
          </label>
          <label>Provider
            <select id="emProvider">${providerOptions(providers || [], m.providerId)}</select>
          </label>
        </div>
        <div class="row">
          <label>Service type <input id="emService" value="${esc(m.serviceType || '')}" /></label>
          <label>Kind
            <select id="emKind">
              <option value="regular"${kind === 'regular' ? ' selected' : ''}>Weekly</option>
              <option value="makeup_auth"${kind === 'makeup_auth' ? ' selected' : ''}>Makeup auth</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label>Ratio
            <select id="emRatio">
              <option value="individual"${!m.ratioGroup ? ' selected' : ''}>Individual</option>
              <option value="group"${m.ratioGroup ? ' selected' : ''}>Group</option>
            </select>
          </label>
          <label>Group size <input id="emGroupSize" type="number" min="1" step="1" value="${esc(m.groupSize ?? '')}" /></label>
        </div>
        <div class="row">
          <label>Duration (minutes) <input id="emDuration" type="number" min="1" step="1" value="${esc(m.durationMinutes ?? '')}" /></label>
          <label>Freq / count <input id="emFreq" type="number" min="0" step="1" value="${esc(m.sessionsPerPeriod ?? m.frequencyPerWeek ?? '')}" /></label>
        </div>
        <div class="row">
          <label>Period
            <select id="emPeriod">${mandatePeriodOptions(period)}</select>
          </label>
          <label>Start / end
            <div class="row">
              <input id="emStart" type="date" value="${esc(m.startOn || '')}" />
              <input id="emEnd" type="date" value="${esc(m.endOn || '')}" />
            </div>
          </label>
        </div>
        <div class="entry-form-actions">
          <button type="button" class="btn-primary" id="emSave">Save changes</button>
          <button type="button" class="btn" id="emCancel">Cancel</button>
        </div>
      `;
      document.getElementById('emCancel').onclick = () => {
        panel.hidden = true;
        panel.innerHTML = '';
      };
      document.getElementById('emSave').onclick = async () => {
        try {
          const freq = Number(document.getElementById('emFreq').value);
          const durationRaw = document.getElementById('emDuration').value;
          const groupSizeRaw = document.getElementById('emGroupSize').value;
          const frequencyKind = document.getElementById('emPeriod').value;
          await api('PATCH', `/admin/mandates/${id}`, {
            studentId: document.getElementById('emStudent').value,
            providerId: document.getElementById('emProvider').value,
            serviceType: document.getElementById('emService').value,
            mandateKind: document.getElementById('emKind').value,
            ratioGroup: document.getElementById('emRatio').value === 'group',
            durationMinutes: durationRaw === '' ? null : Number(durationRaw),
            groupSize: groupSizeRaw === '' ? null : Number(groupSizeRaw),
            frequencyKind,
            frequencyPerWeek: freq,
            sessionsPerPeriod: freq,
            periodSchoolDays: frequencyKind === 'school_day_cycle' ? 6 : undefined,
            startOn: document.getElementById('emStart').value,
            endOn: document.getElementById('emEnd').value,
          });
          setStatus('Mandate updated.', 'ok');
          await onSaved();
        } catch (e) { setStatus(e.message, 'err'); }
      };
    });
  });
}

function mandateDurationLabel(m) {
  const n = m?.durationMinutes;
  if (n == null || n === '') return '—';
  return `${n} min`;
}

function mandateGroupSizeLabel(m) {
  const n = m?.groupSize;
  if (n == null || n === '') return '—';
  return String(n);
}

function bindOpenChildLinks(opts = {}) {
  document.querySelectorAll('[data-open-child]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-open-child');
      if (id) adminChildDetail(id, opts);
    });
  });
}

function bindOpenProviderLinks() {
  document.querySelectorAll('[data-open-provider]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-open-provider');
      if (id) adminProviderDetail(id);
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
  const modal = document.getElementById('timesheetModal');
  if (modal) {
    const frame = modal.querySelector('iframe');
    const src = frame?.getAttribute('src') || '';
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    modal.remove();
  }
}

async function openTimesheetModal(opts) {
  closeTimesheetModal();
  const {
    weekId = '',
    weekStart = '',
    providerName = '',
    status = '',
    signerName = '',
    signerEmail = '',
    schoolDistrict = '',
  } = opts || {};
  if (!weekId) {
    setStatus('Open a week before viewing the timesheet.', 'error');
    return;
  }
  const backdrop = document.createElement('div');
  backdrop.id = 'timesheetModal';
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Timesheet');
  const meta = [
    weekStart ? `Week of ${weekStart}` : '',
    providerName ? `Provider: ${providerName}` : '',
    schoolDistrict ? `District: ${schoolDistrict}` : '',
    status ? `Status: ${status}` : '',
    signerEmail || signerName
      ? `Signer: ${signerName || signerEmail}${signerEmail && signerName ? ` <${signerEmail}>` : ''}`
      : '',
  ].filter(Boolean);
  backdrop.innerHTML = `
    <div class="modal-panel timesheet-print timesheet-pdf-panel">
      <div class="modal-head">
        <h2>Timesheet</h2>
        <div class="modal-actions">
          <button type="button" class="btn" data-print-timesheet>Print</button>
          <button type="button" class="btn" data-close-timesheet>Close</button>
        </div>
      </div>
      ${meta.length ? `<p class="muted">${meta.map((m) => esc(m)).join(' · ')}</p>` : ''}
      <div class="timesheet-pdf-loading muted">Loading branded timesheet…</div>
      <iframe class="timesheet-pdf-frame" title="Timesheet PDF" hidden></iframe>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeTimesheetModal();
  });
  backdrop.querySelector('[data-close-timesheet]').onclick = () => closeTimesheetModal();
  try {
    const q = state.selectedSchoolId
      ? `?schoolId=${encodeURIComponent(state.selectedSchoolId)}`
      : '';
    const blob = await api('GET', `/weeks/${weekId}/timesheet${q}`);
    const url = URL.createObjectURL(blob);
    const frame = backdrop.querySelector('.timesheet-pdf-frame');
    const loading = backdrop.querySelector('.timesheet-pdf-loading');
    frame.src = url;
    frame.hidden = false;
    if (loading) loading.hidden = true;
    backdrop.querySelector('[data-print-timesheet]').onclick = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
    };
  } catch (err) {
    closeTimesheetModal();
    setStatus(err.message || 'Unable to load timesheet PDF.', 'error');
  }
}

async function fetchAndShowTimesheet({ weekId, weekStart, providerId, providerName, status }) {
  const q = new URLSearchParams();
  if (weekStart) q.set('weekStart', weekStart);
  if (providerId) q.set('providerId', providerId);
  if (state.selectedSchoolId) q.set('schoolId', state.selectedSchoolId);
  const data = await api('GET', `/week?${q.toString()}`);
  const id = data.week?.id || weekId;
  await openTimesheetModal({
    weekId: id,
    weekStart: data.week?.weekStart || weekStart || '',
    providerName: providerName || '',
    status: data.week?.status || status || '',
    signerName: data.week?.signerName || '',
    signerEmail: data.week?.signerEmail || '',
    schoolDistrict: data.schoolDistrict || '',
  });
}

async function loadMissedOptions(studentId, selected) {
  const sel = document.getElementById('makeupOf');
  if (!sel) return;
  if (!studentId) {
    sel.innerHTML = '<option value="">None — apply makeup authorization if needed</option>';
    return;
  }
  try {
    const out = await api('GET', `/students/${studentId}/missed`);
    const missed = out.missed || [];
    sel.innerHTML = `<option value="">None — apply makeup authorization if needed</option>${missed.map((m) =>
      `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(m.dateOfService || m.id)}</option>`,
    ).join('')}`;
  } catch {
    sel.innerHTML = '<option value="">None — apply makeup authorization if needed</option>';
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
      detail: 'This timesheet is signed and locked. Payment will proceed.',
      box: 'ok-box',
    };
  }
  if (status === 'submitted') {
    return {
      key: 'pending',
      title: 'Pending',
      detail: 'Awaiting approval from the school signer or an administrator. Status becomes Approved once signed.',
      box: 'warn-box',
    };
  }
  if (status === 'reopened') {
    return {
      key: 'reopened',
      title: 'Revision required',
      detail: 'An administrator reopened this week. Revise it and resubmit the timesheet.',
      box: 'warn-box',
    };
  }
  return {
    key: 'draft',
    title: 'Not submitted',
    detail: 'Upload session notes or add sessions, then submit the timesheet.',
    box: 'warn-box',
  };
}

/** Hide approval status until week or status key changes (not forever). */
const dismissedApprovalBanners = new Set();

function approvalBanner(status) {
  const a = weekApprovalLabel(status);
  const key = `${state.weekStart}:${a.key}`;
  if (dismissedApprovalBanners.has(key)) return '';
  return `<div class="${a.box} status-banner" data-approval-key="${esc(key)}">
    <button type="button" class="status-banner-dismiss" id="dismissApprovalBanner" aria-label="Dismiss status">×</button>
    <strong>Status: ${esc(a.title)}</strong>
    <div>${esc(a.detail)}</div>
  </div>`;
}


function alphaLetterFromName(name) {
  const ch = String(name || '').trim().charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

function letterTabsHtml(active, letters) {
  const tabs = letters.length ? letters : ['#'];
  return `<div class="letter-tabs" role="tablist">${tabs
    .map(
      (L) =>
        `<button type="button" class="letter-tab${L === active ? ' on' : ''}" data-letter="${esc(L)}" role="tab" aria-selected="${L === active ? 'true' : 'false'}">${esc(L)}</button>`,
    )
    .join('')}</div>`;
}

/** Full A–Z (+ # when needed) so long admin lists are scannable without scrolling. */
function alphabetLettersForRows(rows, getName) {
  const present = new Set(rows.map((row) => alphaLetterFromName(getName(row))));
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((L) => present.has(L));
  if (present.has('#')) letters.push('#');
  return letters.length ? letters : ['A'];
}

function bindLetterTabs(getRows, getName) {
  const rows = [...getRows()];
  const letters = alphabetLettersForRows(rows, getName);
  if (!letters.includes(state.listTabLetter)) state.listTabLetter = letters[0] || 'A';
  const host = document.getElementById('listLetterTabs');
  if (host) host.innerHTML = letterTabsHtml(state.listTabLetter, letters);
  const apply = () => {
    getRows().forEach((row) => {
      row.hidden = alphaLetterFromName(getName(row)) !== state.listTabLetter;
    });
    document.querySelectorAll('#listLetterTabs .letter-tab').forEach((btn) => {
      const on = btn.getAttribute('data-letter') === state.listTabLetter;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  };
  document.querySelectorAll('#listLetterTabs .letter-tab').forEach((btn) => {
    btn.onclick = () => {
      state.listTabLetter = btn.getAttribute('data-letter') || 'A';
      apply();
    };
  });
  apply();
}

async function therapistHome(statusFlash) {
  clearActionToast();
  clearUploadIssues();
  let banner = '';
  let week = null;
  let sessions = [];
  let students = [];
  let errors = [];
  let warnings = [];
  let signerName = '';
  let signerEmail = '';
  let providerId = '';
  let schoolDistrict = '';
  let loadFailed = null;
  let schools = [];

  try {
    const me = await api('GET', '/me');
    providerId = me.provider?.id || '';
    schools = me.schools || [];
    if (schools.length === 1) {
      state.selectedSchoolId = schools[0].id;
      state.schoolConfirmed = true;
      sessionStorage.setItem('tmsSchoolId', state.selectedSchoolId);
      sessionStorage.setItem('tmsSchoolConfirmed', '1');
    } else if (schools.length > 1) {
      const stillValid = schools.some((s) => s.id === state.selectedSchoolId);
      // Multi-school providers must pick a school on the dashboard before the homepage.
      if (!state.schoolConfirmed || !stillValid) {
        await showSchoolPicker(schools);
        return;
      }
    }
    const dues = (me.dueDates || []).filter((d) => d.status !== 'done');
    const alerts = me.alerts || [];
    if (dues.length || alerts.length) {
      banner = `<div class="warn-box">${[...alerts.map((a) => a.body), ...dues.map((d) => `${d.schoolName || d.schoolId || 'School'}: ${d.kind} due ${d.dueOn}`)].map((t) => `<div>${esc(t)}</div>`).join('')}</div>`;
    }
    if (providerId) {
      const ensured = await api('POST', '/week/ensure', {
        weekStart: state.weekStart,
        providerId,
        schoolId: state.selectedSchoolId || undefined,
      });
      week = ensured.week;
      state.weekId = week.id;
      signerName = week.signerName || '';
      signerEmail = week.signerEmail || '';
    }
  } catch (e) {
    loadFailed = e.message || 'Unable to load this week.';
  }

  const schoolQ = state.selectedSchoolId
    ? `&schoolId=${encodeURIComponent(state.selectedSchoolId)}`
    : '';

  try {
    const list = await api(
      'GET',
      `/students?weekStart=${encodeURIComponent(state.weekStart)}${schoolQ}`,
    );
    students = list.students || [];
  } catch {
    students = [];
  }

  try {
    const data = await api(
      'GET',
      `/week?weekStart=${encodeURIComponent(state.weekStart)}${schoolQ}`,
    );
    if (data.week) {
      week = data.week;
      state.weekId = week.id;
      sessions = data.sessions || [];
      if ((data.students || []).length) students = data.students;
      errors = data.errors || [];
      warnings = data.warnings || [];
      signerName = week.signerName || signerName;
      signerEmail = week.signerEmail || signerEmail;
      schoolDistrict = data.schoolDistrict || '';
    }
  } catch {
    /* keep empty week */
  }

  const status = week?.status || 'draft';
  const processed = status === 'signed' || status === 'locked';
  const pending = status === 'submitted';
  // Madison: while awaiting signature or already signed/locked, providers cannot mutate sessions.
  const canImport = !pending && !processed && (status === 'draft' || status === 'reopened');
  const canMutateExisting = canImport;
  const sendBlockReason = timesheetSendBlockReason({
    week,
    sessions,
    locked: pending || processed,
    errors,
    signerEmail,
  });
  const canSend = !sendBlockReason;
  const selectedSchool = schools.find((s) => s.id === state.selectedSchoolId);
  const schoolLabel = selectedSchool
    ? (selectedSchool.district || selectedSchool.name || '')
    : schoolDistrict;

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

  let priorWeeks = [];
  if (providerId) {
    try {
      const listed = await api('GET', '/weeks');
      priorWeeks = (listed.weeks || []).filter((w) => w.weekStart !== mondayIso());
    } catch {
      priorWeeks = [];
    }
  }
  const pane = state.therapistPane === 'prior' ? 'prior' : 'current';
  const isPriorPane = pane === 'prior';

  const addlForm = `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">2</span> Additional services</h2>
      <input type="hidden" id="editSessionId" value="" />
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
        <label>CPT code <input id="cptLabel" placeholder="97110x2" /></label>
        <label id="makeupWrap" hidden>Makeup for missed session (optional)
          <select id="makeupOf"><option value="">None — apply makeup authorization if needed</option></select>
        </label>
      </div>
      <label>Notes <textarea id="notes" rows="3"></textarea></label>
      <p class="muted">If a group-mandate child is seen alone (or as individual), the note must say no peer/partner was available.</p>
      <button type="button" class="btn big" id="add">Save session</button>
    </div>`;

  view(`
    <div class="hero-strip" aria-hidden="true"></div>
    <div class="card">
      <div class="pane-tabs" id="therapistPaneTabs" role="tablist">
        <button type="button" class="pane-tab${pane === 'current' ? ' on' : ''}" data-therapist-pane="current" role="tab">Pending Sessions</button>
        <button type="button" class="pane-tab${pane === 'prior' ? ' on' : ''}" data-therapist-pane="prior" role="tab">Processed Sessions</button>
      </div>
      ${isPriorPane ? `
      <h2>Processed sessions</h2>
      <p class="muted">Open a prior week to review timesheets. Sessions on signed or locked weeks are view-only for providers. Cancel a pending signature request (or ask an admin to reopen) before editing.</p>
      <div class="table-wrap"><table>
        <tr><th>Week</th><th>Status</th><th>Sessions</th><th></th></tr>
        ${priorWeeks.map((w) => `<tr>
          <td>${esc(w.weekStart)}</td>
          <td>${esc(w.status)}</td>
          <td>${esc(String(w.sessionCount ?? 0))}</td>
          <td><button type="button" class="btn" data-open-prior-week="${esc(w.weekStart)}">Open</button></td>
        </tr>`).join('') || '<tr><td colspan="4">No processed sessions yet.</td></tr>'}
      </table></div>
      ` : `
      <h2>Pending sessions</h2>
      ${banner}
      ${week ? approvalBanner(status) : '<div class="warn-box">Contact the office to complete your therapist profile setup.</div>'}
      <p class="muted">Week of ${esc(state.weekStart)}${schoolLabel ? ` · ${esc(schoolLabel)}` : ''}${pending ? ' · awaiting signature (sessions locked)' : ''}${processed ? ' · signed/locked (sessions locked)' : ''}</p>
      <div class="row">
        ${schools.length > 1 ? `<button type="button" class="btn" id="changeSchool">Change school</button>` : ''}
        <button class="btn" id="refreshHome">Reload week</button>
        ${pending ? `<button type="button" class="btn" id="cancelApproval">Cancel approval request</button>` : ''}
      </div>
      `}
      ${!isPriorPane && errors.length ? `<div class="err-box status-banner" id="weekErrorsBox" data-week-issue="errors"><button type="button" class="status-banner-dismiss" data-dismiss-week-issue aria-label="Dismiss errors">×</button><strong>Resolve these items before submitting.</strong>${errors.map((e) => `<div>${esc(e)}</div>`).join('')}<button type="button" class="btn status-clear-btn" data-dismiss-week-issue>Clear</button></div>` : ''}
      ${!isPriorPane && warnings.length ? `<div class="warn-box status-banner" id="weekWarningsBox" data-week-issue="warnings"><button type="button" class="status-banner-dismiss" data-dismiss-week-issue aria-label="Dismiss warnings">×</button><strong>Warnings (submission is still allowed).</strong>${warnings.map((w) => `<div>${esc(w)}</div>`).join('')}<button type="button" class="btn status-clear-btn" data-dismiss-week-issue>Clear</button></div>` : ''}
      ${!isPriorPane ? `<p class="muted">Red indicates a blocking issue (no mandate on file, over-mandate, or note review). Yellow indicates under-mandate or soft warnings only.</p>
      <div class="table-wrap">
      <table>
        <tr><th>Date</th><th>Child</th><th>Service</th><th>CPT</th><th>Time</th><th>Attendance</th><th>Notes</th><th></th></tr>
        ${sessions.map((s) => {
          const name = studentName(students, s.studentId);
          const time = [s.beginTime, s.endTime].filter(Boolean).join(' – ');
          const hard = Boolean(s.aiBlock);
          const flags = s.aiFlags || [];
          const rowClass = hard ? 'hard' : flags.length ? 'warn' : '';
          const serviceLabel = additionalServiceLabel(s.additionalServiceType) || s.serviceType || '—';
          const cpt = s.cptLabel || (s.cptCodes || []).join(', ') || '—';
          const canEditAddl = Boolean(s.additionalServiceType) && canMutateExisting;
          const canRemove = canMutateExisting;
          const canEditRow = canMutateExisting;
          const payload = {
            id: s.id,
            studentId: s.studentId,
            dateOfService: s.dateOfService,
            beginTime: s.beginTime,
            endTime: s.endTime,
            attendance: s.attendance,
            additionalServiceType: s.additionalServiceType || '',
            notes: s.notes || '',
            cptLabel: s.cptLabel || '',
            makeupOfSessionId: s.makeupOfSessionId || '',
          };
          const actions = `<td class="row-actions">
                ${canEditRow ? `<button type="button" class="icon-btn" data-edit-session="${esc(s.id)}" title="Edit" aria-label="Edit">${pencilIcon()}</button>` : ''}
                ${canRemove ? `<button type="button" class="btn" data-remove-session="${esc(s.id)}">Remove</button>` : ''}
              </td>`;
          return `<tr class="${rowClass}" data-session-json="${esc(JSON.stringify(payload))}"><td>${esc(s.dateOfService)}</td><td>${esc(name)}</td><td>${esc(serviceLabel)}</td><td>${esc(cpt)}</td><td>${esc(time)}</td><td>${esc(s.attendance)}</td><td>${esc(s.notes || '')}</td>${actions}</tr>`;
        }).join('') || `<tr><td colspan="8">No sessions recorded yet.</td></tr>`}
      </table>
    </div>` : ''}
    </div>

    ${!isPriorPane ? `
    ${processed ? `<div class="warn-box">This week is signed and locked. Sessions cannot be edited, removed, or added. Ask an admin to reopen the week if a change is required.</div>` : ''}
    ${pending ? `<div class="warn-box">Approval is pending. Sessions are locked until you cancel the approval request (returns the week to draft) or the timesheet is signed.</div>` : ''}
    ${canImport ? `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">1</span> Import session notes</h2>
      <p>Select a Frontline Related Service Session Notes PDF or a Therapist Activity Output PDF (text-based, not a scan). Children and schools must already exist from caseload import; this upload will not create them. Import is all-or-nothing — any error or yellow warning blocks the whole file. Already-imported sessions are skipped. Sessions attach to the week of each date of service (within the 14-day locker).</p>
      <input id="pdfFile" type="file" accept="application/pdf,.pdf" />
      <button class="btn-primary big" id="upload">Import</button>
      <p class="muted" id="uploadHint">Accepts Frontline session-notes or Therapist Activity Output PDFs. Import caseloads under Mandates. Scanned PDFs are not supported.</p>
    </div>

    <div id="uploadIssues" class="upload-issues" hidden></div>

    ${addlForm}
    ` : `
    <div id="uploadIssues" class="upload-issues" hidden></div>
    `}

    ${pending || processed ? `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">3</span> Timesheet</h2>
      <button type="button" class="btn big" id="viewTimesheet" ${sessions.length ? '' : 'disabled'}>View timesheet</button>
    </div>` : `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">3</span> Send timesheet</h2>
      <p>The timesheet is sent to the school signer on file${signerEmail ? `: ${esc(signerName || signerEmail)} &lt;${esc(signerEmail)}&gt;` : ''}.</p>
      <div class="row timesheet-actions">
        <button type="button" class="btn big" id="viewTimesheet" ${sessions.length ? '' : 'disabled'}>View timesheet</button>
        <button type="button" class="btn-primary big${canSend ? '' : ' is-blocked'}" id="submit" title="${esc(sendBlockReason || 'Send timesheet to the school signer')}">Send timesheet</button>
      </div>
      <p id="submitHint" class="${canSend ? 'muted' : 'err-inline'}"${canSend ? ' hidden' : ''}>${esc(sendBlockReason || '')}</p>
    </div>
    `}
    ` : ''}
  `);

  document.querySelectorAll('[data-therapist-pane]').forEach((btn) => {
    btn.onclick = () => {
      clearTransientErrors();
      state.therapistPane = btn.getAttribute('data-therapist-pane') || 'current';
      sessionStorage.setItem('tmsTherapistPane', state.therapistPane);
      if (state.therapistPane === 'current') state.weekStart = mondayIso();
      therapistHome();
    };
  });
  document.querySelectorAll('[data-open-prior-week]').forEach((btn) => {
    btn.onclick = () => {
      clearTransientErrors();
      state.weekStart = btn.getAttribute('data-open-prior-week') || mondayIso();
      state.therapistPane = 'current';
      sessionStorage.setItem('tmsTherapistPane', 'current');
      therapistHome();
    };
  });
  document.getElementById('refreshHome')?.addEventListener('click', () => {
    clearTransientErrors();
    therapistHome();
  });
  document.getElementById('changeSchool')?.addEventListener('click', async () => {
    clearTransientErrors();
    await showSchoolPicker(schools, { allowKeep: true });
  });
  document.getElementById('cancelApproval')?.addEventListener('click', async () => {
    if (!state.weekId) return;
    if (!confirm('Cancel the pending approval request? This voids the DocuSign envelope (if any) and returns the week to draft.')) return;
    try {
      clearTransientErrors();
      const out = await api('POST', `/weeks/${state.weekId}/cancel-approval`);
      await therapistHome({ success: [out.message || 'Approval cancelled. Week is draft again.'] });
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  const dismissApproval = document.getElementById('dismissApprovalBanner');
  if (dismissApproval) {
    dismissApproval.onclick = () => {
      const bannerEl = dismissApproval.closest('.status-banner');
      const key = bannerEl?.getAttribute('data-approval-key');
      if (key) dismissedApprovalBanners.add(key);
      if (bannerEl) bannerEl.remove();
    };
  }

  document.querySelectorAll('[data-dismiss-week-issue]').forEach((btn) => {
    btn.onclick = () => {
      const box = btn.closest('[data-week-issue]');
      if (box) box.remove();
      // UI only — next week GET still shows blockers if still invalid.
      clearStatus();
    };
  });

  const viewTimesheetBtn = document.getElementById('viewTimesheet');
  if (viewTimesheetBtn) {
    viewTimesheetBtn.onclick = () => {
      openTimesheetModal({
        weekId: state.weekId || week?.id,
        weekStart: state.weekStart,
        status,
        signerName,
        signerEmail,
        schoolDistrict: schoolLabel,
      });
    };
  }

  if (isPriorPane) return;

  const viewEl = document.getElementById('view');
  if (!canImport) {
    viewEl.onclick = null;
    return;
  }

  bindMakeupPickers();

  viewEl.onclick = async (e) => {
    const editBtn = e.target.closest('[data-edit-session]');
    if (editBtn) {
      const row = editBtn.closest('tr');
      let raw = {};
      try {
        raw = JSON.parse(row?.getAttribute('data-session-json') || '{}');
      } catch {
        raw = {};
      }
      document.getElementById('editSessionId').value = raw.id || '';
      document.getElementById('additionalServiceType').value = raw.additionalServiceType || '';
      document.getElementById('studentId').value = raw.studentId || '';
      document.getElementById('dos').value = raw.dateOfService || '';
      document.getElementById('att').value = raw.attendance || 'attended';
      document.getElementById('beginTime').value = raw.beginTime || '';
      document.getElementById('endTime').value = raw.endTime || '';
      document.getElementById('cptLabel').value = raw.cptLabel || '';
      document.getElementById('notes').value = raw.notes || '';
      bindMakeupPickers();
      if (raw.makeupOfSessionId) {
        await loadMissedOptions(raw.studentId, raw.makeupOfSessionId);
      }
      document.getElementById('add').textContent = 'Update session';
      document.getElementById('additionalServiceType')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const removeBtn = e.target.closest('[data-remove-session]');
    if (!removeBtn) return;
    if (!confirm('Remove this session, including any additional services? This cannot be undone.')) return;
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
      if (!file) throw apiError('Select a notes PDF first.', { errors: ['Select a notes PDF first.'] });
      if (!providerId) {
        throw apiError('Your provider profile is not linked yet. Contact the office for assistance.', {
          errors: ['Your provider profile is not linked yet. Contact the office for assistance.'],
        });
      }
      btn.disabled = true;
      btn.textContent = 'Importing…';
      clearTransientErrors();
      setStatus('Importing PDF…', '');
      const pdfBase64 = await fileToBase64(file);
      const out = await api('POST', '/week/upload-sessions', {
        weekStart: state.weekStart,
        providerId,
        pdfBase64,
      });
      state.weekId = out.week.id;
      const warnList = Array.isArray(out.warnings) ? out.warnings : [];
      const failedList = Array.isArray(out.failed)
        ? out.failed.map((f) => (typeof f === 'string' ? f : f.error || JSON.stringify(f)))
        : Array.isArray(out.errors)
          ? out.errors
          : [];
      const savedList = Array.isArray(out.saved)
        ? out.saved.map((s) => {
            if (typeof s === 'string') return s;
            const who = s.studentName || 'Session';
            const slot = [s.dateOfService, s.beginTime && s.endTime ? `${s.beginTime}–${s.endTime}` : '']
              .filter(Boolean)
              .join(' ');
            return `${who}${slot ? ` — ${slot}` : ''}`;
          })
        : [];
      const skippedN = Number(out.skippedCount || (out.skipped || []).length || 0);
      const importedN = Number(out.imported != null ? out.imported : savedList.length);
      const successMsgs = [];
      if (importedN > 0) successMsgs.push(`Imported ${importedN} session(s).`);
      if (skippedN > 0) successMsgs.push(`Skipped ${skippedN} already saved session(s).`);
      if (!successMsgs.length && !failedList.length) {
        successMsgs.push(`Imported ${out.parsed || 0} session(s).`);
      }
      if (failedList.length) successMsgs.length = 0;
      await therapistHome({
        success: successMsgs,
        error: failedList,
        warn: warnList,
      });
      setUploadIssues(failedList, warnList, failedList.length ? [] : savedList);
    } catch (e) {
      const errs = Array.isArray(e.errors) && e.errors.length
        ? e.errors
        : [e.message || 'Unable to import this PDF.'];
      const warns = Array.isArray(e.warnings) ? e.warnings : [];
      setUploadIssues(errs, warns);
      setStatus({
        error: errs.length ? errs : ['Import blocked — see details below.'],
        warn: warns,
      });
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Import';
      }
    }
  };

  document.getElementById('add').onclick = async () => {
    const btn = document.getElementById('add');
    try {
      if (!state.weekId) {
        if (!providerId) throw new Error('This week is not open yet. Contact the office to complete your provider profile.');
        const ensured = await api('POST', '/week/ensure', {
          weekStart: state.weekStart,
          providerId,
          schoolId: state.selectedSchoolId || undefined,
        });
        state.weekId = ensured.week?.id || '';
      }
      if (!state.weekId) throw new Error('This week is not open yet. Contact the office for assistance.');
      const additionalServiceType = document.getElementById('additionalServiceType').value;
      const studentId = document.getElementById('studentId').value;
      const dateOfService = document.getElementById('dos').value.trim();
      const notes = document.getElementById('notes').value.trim();
      const editId = document.getElementById('editSessionId').value.trim();
      if (!additionalServiceType) throw new Error('Select a service type.');
      if (!studentId) throw new Error('Select a student.');
      if (!dateOfService) throw new Error('Enter the date of service.');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      clearTransientErrors();
      setStatus('Saving session…', '');
      await api('POST', '/week/sessions', {
        id: editId || undefined,
        weekId: state.weekId,
        studentId,
        dateOfService,
        beginTime: document.getElementById('beginTime').value,
        endTime: document.getElementById('endTime').value,
        attendance: document.getElementById('att').value,
        makeupOfSessionId: document.getElementById('makeupOf').value,
        additionalServiceType,
        cptLabel: document.getElementById('cptLabel').value.trim(),
        notes,
      });
      await therapistHome({ success: [editId ? 'Session updated.' : 'Session saved.'] });
    } catch (e) {
      const errs = Array.isArray(e.errors) && e.errors.length ? e.errors : [e.message];
      const warns = Array.isArray(e.warnings) ? e.warnings : [];
      setStatus({ error: errs, warn: warns });
      btn.disabled = false;
      btn.textContent = document.getElementById('editSessionId')?.value ? 'Update session' : 'Save session';
    }
  };

  const submitBtn = document.getElementById('submit');
  if (submitBtn) {
    submitBtn.onclick = async () => {
      const hint = document.getElementById('submitHint');
      const blockNow = timesheetSendBlockReason({
        week,
        sessions,
        locked: false,
        errors,
        signerEmail,
      });
      if (blockNow) {
        if (hint) {
          hint.hidden = false;
          hint.className = 'err-inline';
          hint.textContent = blockNow;
        }
        setStatus({ error: [blockNow] });
        showActionToast(blockNow, 'error');
        revealStatus();
        return;
      }
      const prevLabel = submitBtn.textContent;
      try {
        if (!state.weekId) throw new Error('Add at least one session first.');
        if (!signerEmail) throw new Error('No school signer is on file. Contact the office to assign a signer.');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
        clearUploadIssues();
        if (hint) {
          hint.hidden = false;
          hint.className = 'muted';
          hint.textContent = 'Sending timesheet — this can take up to a minute (note review + email)…';
        }
        setStatus('Sending timesheet…', '');
        showActionToast(
          'Sending timesheet… note review can take up to a minute.',
          'neutral',
          { sticky: true },
        );
        revealStatus();
        const out = await api(
          'POST',
          `/weeks/${state.weekId}/submit`,
          { signerName, signerEmail, schoolId: state.selectedSchoolId || undefined },
          { timeoutMs: 120000 },
        );
        state.last = out;
        const okMsg = out.message || 'Submitted. Status is now Pending.';
        showActionToast(okMsg, 'success');
        await therapistHome({ success: [okMsg] });
        revealStatus();
      } catch (e) {
        const errs = Array.isArray(e.errors) && e.errors.length
          ? e.errors
          : [e.message || 'Unable to send timesheet.'];
        const warns = Array.isArray(e.warnings) ? e.warnings : [];
        setStatus({ error: errs, warn: warns });
        if (hint) {
          hint.hidden = false;
          hint.className = 'err-inline';
          hint.textContent = errs[0] || 'Unable to send timesheet.';
        }
        showActionToast(errs[0] || 'Unable to send timesheet.', 'error');
        revealStatus();
        submitBtn.disabled = false;
        submitBtn.textContent = prevLabel || 'Send timesheet';
      }
    };
  }
}

function pencilIcon() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.999-1.66z"/></svg>`;
}

async function showSchoolPicker(schools, opts = {}) {
  view(`
    <div class="hero-strip" aria-hidden="true"></div>
    <div class="card school-picker-card">
      <h2>Select your school</h2>
      <p class="muted">Choose the school for this session before continuing to your homepage. Your caseload and timesheet will be filtered to that school.</p>
      <div class="school-picker-grid">
        ${(schools || []).map((s) => `
          <button type="button" class="school-pick-btn" data-school-id="${esc(s.id)}">
            <strong>${esc(s.name || 'School')}</strong>
            ${s.district ? `<span class="muted">${esc(s.district)}</span>` : ''}
          </button>
        `).join('') || '<p class="muted">No schools on your caseload yet. Contact the office.</p>'}
      </div>
      ${opts.allowKeep && state.selectedSchoolId ? `<p><button type="button" class="btn" id="keepSchool">Keep current school</button></p>` : ''}
    </div>
  `);
  document.querySelectorAll('[data-school-id]').forEach((btn) => {
    btn.onclick = async () => {
      state.selectedSchoolId = btn.getAttribute('data-school-id') || '';
      state.schoolConfirmed = true;
      sessionStorage.setItem('tmsSchoolId', state.selectedSchoolId);
      sessionStorage.setItem('tmsSchoolConfirmed', '1');
      await therapistHome();
    };
  });
  document.getElementById('keepSchool')?.addEventListener('click', () => {
    state.schoolConfirmed = true;
    sessionStorage.setItem('tmsSchoolConfirmed', '1');
    therapistHome();
  });
}


function hhaStatusCell(w) {
  const status = String(w.hhaStatus || 'none');
  if (status === 'failed') {
    const reason = String(w.hhaError || '').trim() || 'HHA transfer failed (no detail stored). Use Send to HHA after fixing data.';
    const tip = 'HHA failed — click for details';
    return `<button type="button" class="triage-badge" data-triage-week="${esc(w.id)}" data-triage-error="${esc(reason)}" title="${tip}" aria-label="${tip}"><svg class="triage-warn-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></button>`;
  }
  return esc(status);
}

function showTriageDetail(errorText, weekId) {
  closeTimesheetModal();
  const existing = document.getElementById('triageModal');
  if (existing) existing.remove();
  const backdrop = document.createElement('div');
  backdrop.id = 'triageModal';
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'HHA triage');
  const lines = String(errorText || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const retryBtn = weekId
    ? `<button type="button" class="btn-primary" data-triage-hha="${esc(weekId)}">Send to HHA (retry)</button>`
    : '';
  backdrop.innerHTML = `
    <div class="modal-panel">
      <div class="modal-head">
        <h2>HHA Triage</h2>
        <div class="modal-actions">
          ${retryBtn}
          <button type="button" class="btn" data-close-triage>Close</button>
        </div>
      </div>
      <p class="muted">Exact failure reason from the last HHA transfer. Fix the data, then use <strong>Send to HHA</strong> to retry.</p>
      <div class="err-box triage-detail">${lines.map((l) => esc(l)).join('<br>') || 'No error detail available.'}</div>
    </div>
  `;
  backdrop.addEventListener('click', async (e) => {
    if (e.target === backdrop || e.target.closest('[data-close-triage]')) {
      backdrop.remove();
      return;
    }
    const retry = e.target.closest('[data-triage-hha]');
    if (retry) {
      const id = retry.getAttribute('data-triage-hha');
      backdrop.remove();
      if (!id) return;
      try {
        await api('POST', `/weeks/${id}/hha`);
        setStatus('Sent to HHA.', 'ok');
        await adminDash();
      } catch (err) {
        setStatus(err.message || 'HHA transfer failed.', 'err');
      }
    }
  });
  document.body.appendChild(backdrop);
}

async function adminDash() {
  let d = { timesheet: { draft: 0, submitted: 0, signed: 0, locked: 0 }, hha: { pending: 0, confirmed: 0, failed: 0 } };
  let weeks = [];
  try {
    d = await api('GET', '/dashboard');
  } catch (err) {
    console.warn('dashboard load failed', err);
  }
  try {
    const listed = await api('GET', '/admin/weeks');
    weeks = Array.isArray(listed?.weeks) ? listed.weeks : [];
  } catch (err) {
    console.warn('admin weeks load failed', err);
    weeks = [];
  }
  const weekActions = (w) => {
    const status = w.status || 'draft';
    const canReopen = status === 'signed' || status === 'locked';
    const canHha = status === 'signed' || status === 'locked';
    const parts = [];
    parts.push(
      `<button type="button" class="btn" data-view-timesheet="${esc(w.id)}" data-week-start="${esc(w.weekStart)}" data-provider-id="${esc(w.providerId || '')}" data-provider-name="${esc(w.providerName || '')}" data-week-status="${esc(status)}">View</button>`,
    );
    // Remove so it stays visible even when the actions cell is narrow.
    parts.push(`<button type="button" class="btn" data-remove-week="${esc(w.id)}" data-week-status="${esc(status)}">Remove</button>`);
    if (status === 'submitted') {
      parts.push(`<span class="muted">Awaiting DocuSign</span>`);
    }
    if (canReopen) {
      parts.push(`<button type="button" class="btn" data-reopen="${esc(w.id)}">Reopen</button>`);
    }
    if (canHha) {
      const failed = String(w.hhaStatus || '') === 'failed';
      parts.push(
        `<button type="button" class="btn${failed ? '-primary' : ''}" data-hha="${esc(w.id)}" title="${failed ? 'Retry HHA transfer after fixing the error' : 'Send week to HHA'}">${failed ? 'Retry HHA' : 'Send to HHA'}</button>`,
      );
    }
    if (status === 'draft') {
      parts.push(`<span class="muted">Awaiting therapist submission</span>`);
    } else if (status === 'reopened') {
      parts.push(`<span class="muted">Awaiting therapist resubmission</span>`);
    }
    return parts.join(' ') || '<span class="muted">—</span>';
  };
  view(`
    <div class="hero-strip" aria-hidden="true"></div>
    <div class="card">
      <h2>Dashboard</h2>
      <p>Timesheets — draft ${d?.timesheet?.draft ?? 0} · submitted ${d?.timesheet?.submitted ?? 0} · signed ${d?.timesheet?.signed ?? 0} · locked ${d?.timesheet?.locked ?? 0}</p>
      <p>HHA — pending ${d?.hha?.pending ?? 0} · confirmed ${d?.hha?.confirmed ?? 0} · failed ${d?.hha?.failed ?? 0}</p>
    </div>
    <div class="card">
      <h2>14-day session import locker</h2>
      <p class="muted">When enabled, providers cannot import or add sessions older than the max age. Unlock a week or provider below to grant an exception.</p>
      <div class="row">
        <label>Rule enabled
          <select id="ageLockEnabled">
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label>Max age (days) <input id="ageLockDays" type="number" min="1" step="1" value="14" /></label>
      </div>
      <div class="row">
        <label>Unlocked week IDs (comma-separated) <input id="ageUnlockWeeks" placeholder="week-uuid, …" /></label>
        <label>Unlocked provider IDs (comma-separated) <input id="ageUnlockProviders" placeholder="provider-uuid, …" /></label>
      </div>
      <button type="button" class="btn-primary" id="saveAgeLock">Save locker settings</button>
      <p class="muted" id="ageLockStatus"></p>
    </div>
    <div class="card">
      <h2>Weeks</h2>
      ${bulkBar('weeks')}
      <div class="table-wrap">
      <table>
        <tr>${bulkTh('weeks')}<th>Week</th><th>Provider</th><th>Sessions</th><th>Status</th><th>Signer</th><th>HHA</th><th></th></tr>
        ${weeks.map((w) => `<tr data-week-row="${esc(w.id)}" class="${String(w.hhaStatus) === 'failed' ? 'hha-failed-row' : ''}">
          ${bulkTd('weeks', w.id)}
          <td>${esc(w.weekStart)}</td>
          <td>${esc(w.providerName || '—')}</td>
          <td>${esc(w.sessionCount)}</td>
          <td>${esc(w.status)}</td>
          <td>${esc(w.signerName || w.signerEmail || '—')}</td>
          <td>${hhaStatusCell(w)}</td>
          <td class="week-actions">${weekActions(w)}</td>
        </tr>`).join('') || `<tr><td colspan="8">No weeks yet.</td></tr>`}
      </table>
      </div>
    </div>
  `);
  // Load 14-day locker settings
  (async () => {
    try {
      const out = await api('GET', '/admin/settings');
      const s = out.settings || {};
      const en = document.getElementById('ageLockEnabled');
      const days = document.getElementById('ageLockDays');
      const weeks = document.getElementById('ageUnlockWeeks');
      const providers = document.getElementById('ageUnlockProviders');
      if (en) en.value = s.sessionImportAgeLockEnabled === false ? 'false' : 'true';
      if (days) days.value = String(s.sessionImportMaxAgeDays || 14);
      if (weeks) weeks.value = (s.unlockedWeekIds || []).join(', ');
      if (providers) providers.value = (s.unlockedProviderIds || []).join(', ');
    } catch {
      /* ignore */
    }
  })();
  document.getElementById('saveAgeLock')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('ageLockStatus');
    try {
      const splitIds = (raw) =>
        String(raw || '')
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      const out = await api('POST', '/admin/settings', {
        sessionImportAgeLockEnabled: document.getElementById('ageLockEnabled').value === 'true',
        sessionImportMaxAgeDays: Number(document.getElementById('ageLockDays').value) || 14,
        unlockedWeekIds: splitIds(document.getElementById('ageUnlockWeeks').value),
        unlockedProviderIds: splitIds(document.getElementById('ageUnlockProviders').value),
      });
      if (statusEl) statusEl.textContent = 'Locker settings saved.';
      setStatus('14-day locker settings saved.', 'ok');
      const s = out.settings || {};
      document.getElementById('ageUnlockWeeks').value = (s.unlockedWeekIds || []).join(', ');
      document.getElementById('ageUnlockProviders').value = (s.unlockedProviderIds || []).join(', ');
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Save failed.';
      setStatus(err.message || 'Unable to save locker settings.', 'err');
    }
  });
  bindBulkDelete('weeks', {
    noun: 'weeks',
    deleteOne: (id) => api('DELETE', `/admin/weeks/${id}`),
    refresh: () => adminDash(),
  });
  document.getElementById('view').onclick = async (e) => {
    const viewTs = e.target.closest('[data-view-timesheet]');
    const triage = e.target.closest('[data-triage-week]');
    const reopen = e.target.closest('[data-reopen]');
    const hha = e.target.closest('[data-hha]');
    const removeWeek = e.target.closest('[data-remove-week]');
    try {
      if (viewTs) {
        await fetchAndShowTimesheet({
          weekId: viewTs.getAttribute('data-view-timesheet') || '',
          weekStart: viewTs.getAttribute('data-week-start') || '',
          providerId: viewTs.getAttribute('data-provider-id') || '',
          providerName: viewTs.getAttribute('data-provider-name') || '',
          status: viewTs.getAttribute('data-week-status') || '',
        });
        return;
      }
      if (triage) {
        showTriageDetail(
          triage.getAttribute('data-triage-error') || '',
          triage.getAttribute('data-triage-week') || '',
        );
        return;
      }
      if (reopen) {
        await api('POST', `/admin/weeks/${reopen.getAttribute('data-reopen')}/reopen`, {});
        setStatus('Week reopened for revision.', 'ok');
        await adminDash();
        return;
      }
      if (hha) {
        const out = await api('POST', `/weeks/${hha.getAttribute('data-hha')}/hha`, {});
        setStatus({
          success: [`HHA transfer completed: ${out.transferred}.`],
          error: out.ok ? [] : out.errors?.length ? out.errors : ['HHA transfer completed with errors.'],
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

  // Deep link from HHA error digest email: ?hhaWeek=<weekId>
  const focusWeek = new URLSearchParams(location.search).get('hhaWeek');
  if (focusWeek) {
    const row = document.querySelector(`[data-week-row="${CSS.escape(focusWeek)}"]`);
    if (row) {
      row.classList.add('hha-focus-row');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const triage = row.querySelector('[data-triage-week]');
      if (triage) {
        showTriageDetail(
          triage.getAttribute('data-triage-error') || '',
          triage.getAttribute('data-triage-week') || focusWeek,
        );
      }
    } else {
      setStatus('Linked week not found on the dashboard (may already be fixed or removed).', 'warn');
    }
    const url = new URL(location.href);
    url.searchParams.delete('hhaWeek');
    history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
}

async function adminChildren() {
  const out = await api('GET', '/admin/students');
  const students = out.students || [];
  view(`
    <div class="card">
      <h2>Children</h2>
      <p class="muted">All students on the caseload. Open a record to edit details, review mandates and sessions, or remove.</p>
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
        </tr>`).join('') || '<tr id="childrenEmpty"><td colspan="8">No children on file. Import a caseload under Mandates.</td></tr>'}
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
    : '<p class="muted"><strong>Calendar:</strong> Not set (open the school under Schools)</p>';
  // Only show providers that have a real providerId (never name-only / unmatched text).
  const assignedProviders = detail.assignedProviders?.length
    ? detail.assignedProviders.filter((p) => String(p.id || '').trim())
    : [...new Map(
      mandates
        .filter((m) => String(m.providerId || '').trim())
        .map((m) => [
          m.providerId,
          { id: m.providerId, name: m.providerName && m.providerName !== '—' ? m.providerName : m.providerId },
        ]),
    ).values()];
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
      <p class="muted"><strong>Provider(s) on mandates:</strong> ${
        assignedProviders.length
          ? assignedProviders.map((p) => providerNameLink(p.id, p.name)).join(', ')
          : '—'
      }</p>
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
          <span class="muted" style="display:block;font-size:0.85rem">Optional now; recommended before HHA transfer.</span>
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
        <tr>${bulkTh('child-mandates')}<th>Discipline / service</th><th>Ratio</th><th>Group size</th><th>Duration</th><th>Frequency</th><th>Dates</th><th>Provider</th><th></th></tr>
        ${mandates.map((m) => {
          const service = [m.discipline, m.serviceType].filter(Boolean).join(' · ') || '—';
          const billing = m.billingServiceName
            ? `<div class="muted" style="font-size:0.85rem">${esc(m.billingServiceName)}</div>`
            : '';
          const dates = [m.startOn, m.endOn].filter(Boolean).join(' → ') || '—';
          return `<tr>
          ${bulkTd('child-mandates', m.id)}
          <td>${esc(service)}${billing}</td>
          <td>${esc(m.ratioLabel || (m.ratioGroup ? 'Group' : 'Individual'))}</td>
          <td>${esc(mandateGroupSizeLabel(m))}</td>
          <td>${esc(mandateDurationLabel(m))}</td>
          <td>${esc(mandateFreqLabel(m))}</td>
          <td>${esc(dates)}</td>
          <td>${providerNameLink(m.providerId, m.providerName || '—')}</td>
          <td>
            <button type="button" class="btn" data-edit-mandate="${esc(m.id)}">Edit</button>
            <button type="button" class="btn" data-del-mandate="${esc(m.id)}">Delete</button>
          </td>
        </tr>`;
        }).join('') || '<tr><td colspan="9">No mandates on file.</td></tr>'}
      </table>
      <div id="editMandatePanel" class="entry-card" hidden style="margin-top:1rem"></div>
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
        </tr>`).join('') || '<tr><td colspan="7">No sessions in this date range.</td></tr>'}
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
          <td>${hhaStatusCell(w)}</td>
          <td><button type="button" class="btn" data-del-week="${esc(w.id)}" data-week-status="${esc(w.status || '')}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="5">None.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3>Progress-report due dates</h3>
      <p class="muted">School-level progress, annual, and reevaluation due dates for this child’s school.</p>
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
      <p class="muted">Documents stored with this child (timesheets, notes PDFs, and related files).</p>
      ${bulkBar('child-files')}
      <table>
        <tr>${bulkTh('child-files')}<th>Label</th><th>Kind</th><th>When</th><th></th></tr>
        ${files.map((f) => `<tr>
          ${bulkTd('child-files', f.id)}
          <td>${esc(f.label || f.s3Key || '—')}</td>
          <td>${esc(f.kind || '—')}</td>
          <td>${esc((f.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
          <td><button type="button" class="btn" data-del-file="${esc(f.id)}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="5">No files on file.</td></tr>'}
      </table>
    </div>
  `);
  const refreshChild = () => adminChildDetail(studentId, { backTo: state.childDetailBack });
  bindOpenProviderLinks();
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
  (async () => {
    try {
      const [providersOut] = await Promise.all([api('GET', '/admin/providers')]);
      bindMandateEditor({
        mandates,
        providers: providersOut.providers || [],
        students: [{ id: studentId, firstName: s.firstName, lastName: s.lastName }],
        onSaved: () => adminChildDetail(studentId, { backTo: state.childDetailBack }),
      });
    } catch {
      bindMandateEditor({
        mandates,
        providers: [],
        students: [{ id: studentId, firstName: s.firstName, lastName: s.lastName }],
        onSaved: () => adminChildDetail(studentId, { backTo: state.childDetailBack }),
      });
    }
  })();
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
  document.querySelectorAll('[data-triage-week]').forEach((btn) => {
    btn.addEventListener('click', () =>
      showTriageDetail(btn.getAttribute('data-triage-error') || '', btn.getAttribute('data-triage-week') || ''),
    );
  });
  document.querySelectorAll('[data-del-due]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this progress-report due date? Related alerts will stop. This cannot be undone.')) return;
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
  const sessions = detail.sessions || [];
  // Keep URL/state on the canonical linked id when duplicates were merged server-side.
  if (p?.id && String(p.id) !== String(providerId)) providerId = p.id;
  const sessFrom = state.providerSessionFrom || '';
  const sessTo = state.providerSessionTo || '';
  const filteredSessions = sessions.filter((x) => {
    const d = String(x.dateOfService || '');
    if (sessFrom && d < sessFrom) return false;
    if (sessTo && d > sessTo) return false;
    return true;
  });
  view(`
    <div class="card">
      <button type="button" class="btn" id="backProviders">← Providers</button>
      <h2>${esc(`${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Provider')}</h2>
      <p class="muted">Linked account: ${esc(user?.email || '—')} · Cognito: ${esc(user?.cognitoSub || '—')}</p>
      ${detail.redirectedFromProviderId ? `<p class="muted">Caseload from a duplicate profile was merged into this linked provider.</p>` : ''}
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
      <p class="muted">Drawn from this provider’s mandates (a child may appear under more than one provider).</p>
      ${bulkBar('prov-mandates')}
      <table>
        <tr>${bulkTh('prov-mandates')}<th>Child</th><th>Service</th><th>Group size</th><th>Duration</th><th>Freq</th><th></th></tr>
        ${mandates.map((m) => {
          const billing = m.billingServiceName
            ? `<div class="muted" style="font-size:0.85rem">${esc(m.billingServiceName)}</div>`
            : '';
          return `<tr>
          ${bulkTd('prov-mandates', m.id)}
          <td>${childNameLink(m.studentId, m.studentName || '—')}</td>
          <td>${esc(m.serviceType || '—')}${billing}</td>
          <td>${esc(mandateGroupSizeLabel(m))}</td>
          <td>${esc(mandateDurationLabel(m))}</td>
          <td>${esc(mandateFreqLabel(m))}</td>
          <td>
            <button type="button" class="btn" data-edit-mandate="${esc(m.id)}">Edit</button>
            <button type="button" class="btn" data-del-mandate="${esc(m.id)}">Delete mandate</button>
          </td>
        </tr>`;
        }).join('') || '<tr><td colspan="7">No mandates assigned.</td></tr>'}
      </table>
      <div id="editMandatePanel" class="entry-card" hidden style="margin-top:1rem"></div>
    </div>
    <div class="card">
      <h3>Sessions</h3>
      <p class="muted">All sessions for this provider (newest first). Filter by date of service as needed.</p>
      <div class="row">
        <label>From <input id="pSessFrom" type="date" value="${esc(sessFrom)}" /></label>
        <label>To <input id="pSessTo" type="date" value="${esc(sessTo)}" /></label>
        <button type="button" class="btn" id="pSessFilter">Filter</button>
        <button type="button" class="btn" id="pSessClear">Clear</button>
      </div>
      ${bulkBar('prov-sessions')}
      <table>
        <tr>${bulkTh('prov-sessions')}<th>Date</th><th>Child</th><th>Week</th><th>Status</th><th>Attendance</th><th>Notes</th><th></th></tr>
        ${filteredSessions.map((x) => `<tr>
          ${bulkTd('prov-sessions', x.id)}
          <td>${esc(x.dateOfService)}</td>
          <td>${childNameLink(x.studentId, x.studentName || '—')}</td>
          <td>${esc(x.weekStart || '—')}</td>
          <td>${esc(x.weekStatus || '—')}</td>
          <td>${esc(x.attendance)}</td>
          <td>${esc(x.notes || '')}</td>
          <td><button type="button" class="btn" data-del-session="${esc(x.id)}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="7">No sessions in this date range.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3>Import Frontline / Therapist Activity sessions</h3>
      <p class="muted">Same as the therapist workspace: upload a Frontline or Therapist Activity PDF (text-based). No week selection needed — each session attaches to the week of its date of service (within the 14-day locker). Children and schools must already exist. Import is all-or-nothing.</p>
      <input id="pSessionPdf" type="file" accept="application/pdf,.pdf" />
      <button type="button" class="btn-primary" id="pUploadSessions">Import sessions</button>
      <div id="pUploadIssues" class="upload-issues" hidden></div>
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
      <p class="muted">Same service types as the therapist workspace, including paid absence.</p>
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
      <label>CPT code <input id="pAddlCpt" placeholder="97110x2" /></label>
      <button type="button" class="btn" id="pAddlSave">Save additional service</button>
    </div>
    <div class="card">
      <h3>Upload reports</h3>
      <p class="muted">Admins can upload provider reports and documents here.</p>
      <input id="pReportFile" type="file" />
      <label>Label <input id="pReportLabel" placeholder="IEP / progress / other" /></label>
      <button type="button" class="btn" id="pUploadReport">Upload report</button>
      ${bulkBar('prov-files')}
      <table>
        <tr>${bulkTh('prov-files')}<th>Label</th><th>When</th><th></th></tr>
        ${(detail.files || []).map((f) => `<tr>
          ${bulkTd('prov-files', f.id)}
          <td>${esc(f.label || f.s3Key)}</td>
          <td>${esc((f.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
          <td><button type="button" class="btn" data-del-file="${esc(f.id)}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="4">No files on file.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3>Internal notes</h3>
      <p class="muted">Visible to administrators only. Tag notes to support later filtering.</p>
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
      <label>Add tag <input id="pNoteTagCustom" placeholder="New tag name" /></label>
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
  bindBulkDelete('prov-sessions', {
    noun: 'sessions',
    deleteOne: (id) => api('DELETE', `/sessions/${id}`),
    refresh: refreshProvider,
  });
  bindBulkDelete('prov-files', {
    noun: 'files',
    deleteOne: (id) => api('DELETE', `/admin/files/${id}`),
    refresh: refreshProvider,
  });
  bindOpenChildLinks();
  bindMandateEditor({
    mandates,
    providers: [p],
    students: mandates.map((m) => ({
      id: m.studentId,
      firstName: String(m.studentName || '').split(/\s+/)[0] || '',
      lastName: String(m.studentName || '').split(/\s+/).slice(1).join(' ') || m.studentName || '',
    })),
    onSaved: refreshProvider,
  });
  document.getElementById('pSessFilter')?.addEventListener('click', () => {
    state.providerSessionFrom = document.getElementById('pSessFrom')?.value || '';
    state.providerSessionTo = document.getElementById('pSessTo')?.value || '';
    refreshProvider();
  });
  document.getElementById('pSessClear')?.addEventListener('click', () => {
    state.providerSessionFrom = '';
    state.providerSessionTo = '';
    refreshProvider();
  });
  document.querySelectorAll('[data-del-session]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this session? This cannot be undone.')) return;
        await api('DELETE', `/sessions/${btn.getAttribute('data-del-session')}`);
        setStatus('Session removed.', 'ok');
        await refreshProvider();
      } catch (e) { setStatus(e.message, 'err'); }
    });
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
          eval: 'pRateEval',
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
      if (!confirm('Remove this provider? The profile and internal notes will be deleted, and the linked therapist account will be deactivated. Mandates remain but become unassigned. This cannot be undone.')) return;
      await api('DELETE', `/admin/providers/${providerId}`);
      setStatus('Provider removed.', 'ok');
      await adminProviders();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('pAddNote').onclick = async () => {
    try {
      const text = document.getElementById('pNoteBody').value.trim();
      if (!text) throw new Error('Enter a note first.');
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
      if (!file) throw new Error('Select a file first.');
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
  document.getElementById('pUploadSessions').onclick = async () => {
    const btn = document.getElementById('pUploadSessions');
    const issuesHost = document.getElementById('pUploadIssues');
    try {
      const file = document.getElementById('pSessionPdf').files[0];
      if (!file) throw new Error('Select a Frontline or Therapist Activity PDF first.');
      btn.disabled = true;
      btn.textContent = 'Importing…';
      if (issuesHost) {
        issuesHost.hidden = true;
        issuesHost.innerHTML = '';
      }
      setStatus('Importing PDF…', '');
      const pdfBase64 = await fileToBase64(file);
      const out = await api('POST', '/week/upload-sessions', {
        providerId,
        pdfBase64,
      });
      const warnList = Array.isArray(out.warnings) ? out.warnings : [];
      const failedList = Array.isArray(out.failed)
        ? out.failed.map((f) => (typeof f === 'string' ? f : f.error || JSON.stringify(f)))
        : Array.isArray(out.errors)
          ? out.errors
          : [];
      const savedList = Array.isArray(out.saved)
        ? out.saved.map((s) => {
            if (typeof s === 'string') return s;
            const who = s.studentName || s.studentId || 'session';
            const when = [s.dateOfService, s.beginTime, s.endTime].filter(Boolean).join(' ');
            return when ? `${who} — ${when}` : who;
          })
        : [];
      const skippedN = Array.isArray(out.skipped) ? out.skipped.length : out.skippedCount || 0;
      if (issuesHost && (failedList.length || warnList.length || savedList.length)) {
        const parts = [
          `<div class="dismissible-toolbar"><button type="button" class="btn status-clear-btn" data-clear-p-upload>Clear</button></div>`,
        ];
        if (savedList.length) {
          parts.push(
            `<div class="ok-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-p-upload aria-label="Clear">×</button><strong>Saved</strong>${savedList
              .map((s) => `<div class="upload-issue-line">${esc(s)}</div>`)
              .join('')}</div>`,
          );
        }
        if (failedList.length) {
          parts.push(
            `<div class="err-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-p-upload aria-label="Clear">×</button><strong>${savedList.length ? 'Failed sessions' : 'Upload issues'}</strong>${failedList
              .map((e) => `<div class="upload-issue-line">${esc(e)}</div>`)
              .join('')}</div>`,
          );
        }
        if (warnList.length) {
          parts.push(
            `<div class="warn-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-p-upload aria-label="Clear">×</button><strong>Warnings</strong>${warnList
              .map((w) => `<div class="upload-issue-line">${esc(w)}</div>`)
              .join('')}</div>`,
          );
        }
        issuesHost.innerHTML = parts.join('');
        issuesHost.hidden = false;
        issuesHost.querySelectorAll('[data-clear-p-upload]').forEach((b) => {
          b.onclick = () => {
            issuesHost.hidden = true;
            issuesHost.innerHTML = '';
            clearStatus();
          };
        });
      }
      if (failedList.length || out.ok === false) {
        setStatus(out.error || failedList[0] || 'Import blocked.', 'error');
      } else {
        const skipBit = skippedN ? ` (${skippedN} already imported skipped)` : '';
        setStatus(`Imported ${savedList.length || out.imported || 0} session(s)${skipBit}.`, 'ok');
        await adminProviderDetail(providerId);
      }
    } catch (e) {
      setStatus(e.message || 'Import failed.', 'err');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Import sessions';
      }
    }
  };
  document.getElementById('pGenTimesheet').onclick = async () => {
    try {
      const weekStart = document.getElementById('pWeekStart').value;
      if (!weekStart) throw new Error('Select a week start date.');
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
      if (!additionalServiceType) throw new Error('Select a service type.');
      if (!studentId) throw new Error('Select a child.');
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
        cptLabel: document.getElementById('pAddlCpt')?.value?.trim() || '',
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
  document.querySelectorAll('[data-triage-week]').forEach((btn) => {
    btn.addEventListener('click', () =>
      showTriageDetail(btn.getAttribute('data-triage-error') || '', btn.getAttribute('data-triage-week') || ''),
    );
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
  const calendarEmpty =
    !cal?.yearStart && !cal?.yearEnd && !(cal?.offDays || []).length;
  const calFallbackWarn =
    detail.calendarFallbackWarning ||
    (calendarEmpty
      ? `No school calendar for ${school.name || 'this school'} — falling back to Mon–Fri (weekends excluded; no holiday off-days).`
      : '');
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
      <p class="muted">School address is used when TMS creates an HHA patient (CreatePatient).</p>
      <div class="row">
        <label>Address <input id="saddress1" value="${esc(school.address1 || '')}" placeholder="Street" /></label>
        <label>City <input id="scity" value="${esc(school.city || '')}" /></label>
      </div>
      <div class="row">
        <label>State <input id="sstate" value="${esc(school.state || '')}" placeholder="NY" maxlength="2" /></label>
        <label>Zip <input id="szip" value="${esc(school.zipCode || '')}" placeholder="11514" /></label>
      </div>
      <button type="button" class="btn-primary" id="saveSchool">Save school</button>
      <button type="button" class="btn" id="deleteSchool">Remove school</button>
    </div>
    <div class="card" id="schoolCalendarSection">
      <h3>School calendar</h3>
      <p class="muted">School year dates and closed days (holidays and breaks). Used for school-day mandate tracking.</p>
      ${
        calFallbackWarn
          ? `<div class="warn-box cal-fallback-banner" id="calFallbackBanner"><strong>${esc(calFallbackWarn)}</strong><p>Cycle mandates currently use Mon–Fri until first day, last day, and off days are set.</p></div>`
          : ''
      }
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
      <h3>Progress-report due dates</h3>
      <p class="muted">One due date per kind (progress, annual, or reevaluation) applies to this school’s full caseload.</p>
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
        address1: document.getElementById('saddress1').value,
        city: document.getElementById('scity').value,
        state: document.getElementById('sstate').value,
        zipCode: document.getElementById('szip').value,
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
      setStatus('Progress-report due date saved. Alerts remain until marked complete.', 'ok');
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
        if (!confirm('Remove this progress-report due date? Related alerts will stop. This cannot be undone.')) return;
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
  const orphanPurge = providersOut.orphanPurge;
  if (orphanPurge?.deleted?.length) {
    const kept = orphanPurge.retained?.length
      ? ` Kept ${orphanPurge.retained.length} named orphan(s) that still hold caseload with no linked account.`
      : '';
    setStatus(
      `Cleaned ${orphanPurge.deleted.length} orphan provider profile(s).${kept}`,
      orphanPurge.retained?.length ? 'warn' : 'ok',
    );
  }
  const therapists = users.filter((u) => u.role === 'therapist');
  // List every provider profile (not only therapist logins). Orphans are purged on this GET when empty/merged.
  const providerRows = [...providers]
    .sort((a, b) => {
      const an = `${a.lastName || ''} ${a.firstName || ''}`.trim().toLowerCase();
      const bn = `${b.lastName || ''} ${b.firstName || ''}`.trim().toLowerCase();
      return an.localeCompare(bn);
    })
    .map((p) => {
      const u =
        (p.userId ? users.find((x) => x.id === p.userId) : null) ||
        users.find((x) => x.providerId === p.id) ||
        null;
      const name = `${p.firstName || ''} ${p.lastName || ''}`.trim() || u?.displayName || p.id;
      const orphan = !String(p.userId || '').trim() && !u;
      return { p, u, name, pid: p.id, orphan };
    });
  const loginOnly = therapists.filter(
    (u) => !providers.some((p) => p.id === u.providerId || p.userId === u.id),
  );
  view(`
    <div class="card entry-card">
      <div class="entry-collapsed" id="addProviderCollapsed">
        <button type="button" class="btn-primary" id="openAddProvider">Add provider</button>
      </div>
      <div id="addProviderForm" hidden>
        <h2>Add provider</h2>
        <p class="muted">Creates one linked account and provider profile.</p>
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
        <label>Internal note (optional; hidden from the therapist) <textarea id="tnote" rows="3"></textarea></label>
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
        ${providerRows.map(({ p, u, name, pid, orphan }) => `<tr data-provider-row data-provider-name="${esc(name || '')}">
            ${bulkTd('providers', pid, ' data-bulk-kind="provider"')}
            <td>${providerNameLink(pid, name || '—')}${orphan ? ' <span class="muted">(no account)</span>' : ''}</td>
            <td>${esc(u?.email || '—')}</td>
            <td>${esc(pid)}</td>
            <td>${esc(p.discipline || '—')}</td>
            <td>
              <button type="button" class="btn" data-open-provider="${esc(pid)}">Open</button>
              <button type="button" class="btn" data-del-provider="${esc(pid)}">Remove</button>
            </td>
          </tr>`).join('') || ''}
        ${loginOnly.map((u) => `<tr>
            ${bulkTd('providers', u.id, ' data-bulk-kind="user"')}
            <td>${esc(u.displayName || '—')} <span class="muted">(account only)</span></td>
            <td>${esc(u.email)}</td>
            <td>—</td>
            <td>—</td>
            <td><button type="button" class="btn" data-remove-therapist="${esc(u.id)}">Remove</button></td>
          </tr>`).join('')}
        ${!providerRows.length && !loginOnly.length ? '<tr><td colspan="6">None yet</td></tr>' : ''}
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
        if (!confirm('Remove this therapist account? There is no provider profile. The account will be deleted and removed from this list.')) return;
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
          eval: 'tEval',
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
  bindOpenProviderLinks();
  document.querySelectorAll('[data-del-provider]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this provider? The profile and internal notes will be deleted, and the linked therapist account will be deactivated. Mandates remain but become unassigned. This cannot be undone.')) return;
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
      <p class="muted">Open a school to manage the signer, progress-report due dates, and calendar.</p>
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
        <p class="muted">Invites another office account (Cognito Admin group). Only existing administrators can do this.</p>
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
        if (!confirm('Remove this administrator? Their account will be deleted and removed from this list.')) return;
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
      <p class="muted" style="margin-top:0.35rem">Columns: CR Recommended School, Student Last/First Name, CR Expected Grade, CR Decision/Status, Related Service, RS Start/End, RS Ratio, RS Frequency, RS Period, <strong>RS Duration</strong>, RS Location, RS Provider. Optional when present: Group Size, Program ID, Program Type, Date of Birth. (Older short headers still work.)</p>
      <p class="muted" style="margin-top:0.35rem">Frequency: <em>Weekly</em> = sessions per week; <em>6 day cycle</em> = N sessions per 6 school days. Providers must already exist in TMS and match “Last, First” or “First Last”. Agency labels such as “White Glove” or “White, Glove” are invalid — use the therapist name. Unmatched RS Provider rows are skipped (no empty-provider mandates).</p>
      <input id="caseloadFile" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      <div class="row" style="margin-top:0.6rem">
        <button class="btn-primary" id="caseloadImportBtn">Import caseload</button>
        ${preview ? `<button type="button" class="btn" id="caseloadCompleteBtn">Complete</button>` : ''}
      </div>
      ${preview ? `
      <p style="margin-top:0.8rem">${previewRows.length} mandate row(s) · ${preview.createdStudents || 0} new students · ${preview.updatedStudents || 0} updated students · ${preview.createdSchools || 0} new schools · ${preview.createdMandates || 0} new mandates · ${preview.updatedMandates || 0} updated mandates</p>
      ${previewErrors.length ? `
      <div class="err-box caseload-issues status-banner" id="caseloadErrorsBox">
        <button type="button" class="status-banner-dismiss" data-clear-caseload-issues aria-label="Dismiss errors">×</button>
        <strong>Errors (${previewErrors.length})</strong>
        <p class="muted" style="margin:0.35rem 0 0.5rem">One issue per row. Correct these in the spreadsheet, then import again. Valid rows in the table below can still be imported.</p>
        <table class="issue-table">
          <tr><th>Row #</th><th>Field</th><th>Issue</th><th>Resolution</th></tr>
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
        <button type="button" class="btn status-clear-btn" data-clear-caseload-issues>Clear</button>
      </div>` : ''}
      ${previewWarnings.length ? `
      <div class="warn-box caseload-issues status-banner" id="caseloadWarningsBox">
        <button type="button" class="status-banner-dismiss" data-clear-caseload-issues aria-label="Dismiss warnings">×</button>
        <strong>Warnings (${previewWarnings.length})</strong>
        <table class="issue-table">
          <tr><th>Row #</th><th>Field</th><th>Issue</th><th>Resolution</th></tr>
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
        <button type="button" class="btn status-clear-btn" data-clear-caseload-issues>Clear</button>
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
              <td>${esc(r.serviceType || r.discipline || '')}${
                r.billingServiceName
                  ? `<div class="muted" style="font-size:0.85rem">${esc(r.billingServiceName)}</div>`
                  : ''
              }</td>
              <td>${r.ratioGroup ? 'Group' : 'Individual'}</td>
              <td>${esc(r.freqDisplay || '')}</td>
              <td>${esc(r.providerName || '—')}${badRow ? ' <span class="err-inline">(see Errors)</span>' : ''}</td>
              <td>${esc(assigned || '—')}${assignedNote}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="8">No valid rows to import</td></tr>';
        })()}
      </table>` : ''}
    </div>
    <div class="card entry-card">
      <div class="entry-collapsed" id="addMandateCollapsed">
        <button type="button" class="btn-primary" id="openAddMandate">Add mandate manually</button>
      </div>
      <div id="addMandateForm" hidden>
        <h2>Add mandate manually</h2>
        <p class="muted">Kind: <strong>Weekly</strong> (standard frequency), <strong>6-Day Cycle</strong>, <strong>Monthly</strong>, or <strong>Makeup auth</strong> (remaining session pool). Unlinked makeups use Makeup auth; miss-linked makeups do not.</p>
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
          <label>Group size <input id="manGroupSize" type="number" min="1" step="1" placeholder="1" /></label>
        </div>
        <div class="row">
          <label>Duration (minutes) <input id="manDuration" type="number" min="1" step="1" placeholder="30" /></label>
          <label>Freq / count <input id="manFreq" type="number" min="0" step="1" placeholder="2" /></label>
        </div>
        <div class="row">
          <label>Period
            <select id="manPeriod">
              <option value="weekly">Weekly</option>
              <option value="school_day_cycle">6-Day Cycle</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>Start / end
            <div class="row">
              <input id="manStart" type="date" />
              <input id="manEnd" type="date" />
            </div>
          </label>
        </div>
        <div class="entry-form-actions">
          <button type="button" class="btn-primary big" id="manSave">Save mandate</button>
          <button type="button" class="btn" id="cancelAddMandate">Cancel</button>
        </div>
      </div>
    </div>
  `);

  async function readCaseloadFile() {
    const file = document.getElementById('caseloadFile').files[0];
    if (!file) throw new Error('Select a CSV or Excel file first.');
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
      clearStatus();
      document.querySelectorAll('[data-clear-caseload-issues]').forEach((b) => {
        b.closest('.caseload-issues')?.remove();
      });
      const payload = await readCaseloadFile();
      const out = await api('POST', '/admin/caseloads/import', payload);
      state.caseloadPreview = out;
      const errN = (out.errors || []).length;
      const warnN = (out.warnings || []).length;
      const createdM = out.createdMandates || 0;
      const updatedM = out.updatedMandates || 0;
      const createdS = out.createdStudents || 0;
      const updatedS = out.updatedStudents || 0;
      const saved =
        createdM > 0 || updatedM > 0 || createdS > 0 || updatedS > 0 || (out.rows || []).length > 0;
      const summary = `${createdM} new / ${updatedM} updated mandate(s), ${createdS} new / ${updatedS} updated student(s)`;
      // Re-render first so the status chip is not wiped by navigation work.
      await adminMandates();
      if (errN && !saved) {
        setStatus(`Import failed — no rows were saved. ${errN} row error(s). See the table below.`, 'err');
      } else if (errN || warnN) {
        setStatus(
          `Imported with warnings: ${errN ? `${errN} row error(s)` : ''}${errN && warnN ? ', ' : ''}${warnN ? `${warnN} warning(s)` : ''}. Saved: ${summary}.`,
          errN ? 'warn' : 'ok',
        );
      } else {
        setStatus(`Import complete: ${summary}.`, 'ok');
      }
    } catch (e) { setStatus(e.message, 'err'); }
  };

  document.querySelectorAll('[data-clear-caseload-issues]').forEach((btn) => {
    btn.onclick = () => {
      const box = btn.closest('.caseload-issues');
      if (box) box.remove();
      clearStatus();
    };
  });

  const completeBtn = document.getElementById('caseloadCompleteBtn');
  if (completeBtn) {
    completeBtn.onclick = async () => {
      state.caseloadPreview = null;
      state.caseloadImport = null;
      setStatus('Import results cleared.', 'ok');
      await adminMandates();
    };
  }

  const setAddMandateOpen = (open) => {
    const c = document.getElementById('addMandateCollapsed');
    const f = document.getElementById('addMandateForm');
    if (c) c.hidden = open;
    if (f) f.hidden = !open;
  };
  document.getElementById('openAddMandate').onclick = () => setAddMandateOpen(true);
  document.getElementById('cancelAddMandate').onclick = () => setAddMandateOpen(false);

  document.getElementById('manSave').onclick = async () => {
    try {
      const studentId = document.getElementById('manStudent').value;
      const mandateKind = document.getElementById('manKind').value;
      const freq = Number(document.getElementById('manFreq').value);
      const durationRaw = document.getElementById('manDuration').value;
      const groupSizeRaw = document.getElementById('manGroupSize').value;
      const durationMinutes = durationRaw === '' ? null : Number(durationRaw);
      const groupSize = groupSizeRaw === '' ? null : Number(groupSizeRaw);
      if (!studentId) throw new Error('Select a student.');
      if (!Number.isFinite(freq) || freq < 0) throw new Error('Enter frequency or makeup count.');
      if (durationMinutes != null && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
        throw new Error('Duration must be a positive number of minutes.');
      }
      if (groupSize != null && (!Number.isFinite(groupSize) || groupSize <= 0)) {
        throw new Error('Group size must be a positive number.');
      }
      const out = await api('POST', '/admin/mandates', {
        studentId,
        providerId: document.getElementById('manProvider').value,
        serviceType: document.getElementById('manService').value || (mandateKind === 'makeup_auth' ? 'Makeup authorization' : ''),
        mandateKind,
        ratioGroup: document.getElementById('manRatio').value === 'group',
        durationMinutes,
        groupSize,
        frequencyKind: document.getElementById('manPeriod').value,
        frequencyPerWeek: freq,
        sessionsPerPeriod: freq,
        periodSchoolDays: document.getElementById('manPeriod').value === 'school_day_cycle' ? 6 : undefined,
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
      return `<tr>
            <td><button type="button" class="linkish" data-open-child="${esc(r.studentId)}">${esc(r.childName)}</button></td>
            <td>${esc(r.mandateLabel || '—')}</td>
            <td>${esc(r.weekLabel || r.weekStart || '—')}</td>
            <td>${esc(String(r.sessionsProvided ?? 0))}</td>
            <td>${esc(String(r.notesPosted ?? 0))}</td>
          </tr>`;
    })
    .join('') || '<tr><td colspan="5">No sessions in this week range.</td></tr>';
}

function reportDateDefaults() {
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
  return { from, to };
}

function bindReportDetailChrome() {
  const back = document.getElementById('backReports');
  if (back) {
    back.onclick = () => {
      state.reportView = '';
      adminReports();
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
      setStatus('Due date marked complete. Alerts stopped.', 'ok');
      adminReports();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  };
}

function adminReportsLanding() {
  state.reportView = '';
  view(`
    <div class="card">
      <h2>Reports</h2>
      <p class="muted">Open a report to review caseload progress, last dates of service, or progress-report due dates.</p>
      <ul class="report-pick">
        ${REPORT_LIST.map(
          (r) => `<li>
            <button type="button" data-open-report="${esc(r.id)}">
              <span class="report-pick-copy">
                <span class="report-pick-title">${esc(r.title)}</span>
                <span class="report-pick-blurb muted">${esc(r.blurb)}</span>
              </span>
              <span class="report-pick-go">Open</span>
            </button>
          </li>`,
        ).join('')}
      </ul>
    </div>
  `);
  document.querySelectorAll('[data-open-report]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.reportView = btn.getAttribute('data-open-report') || '';
      adminReports();
    });
  });
}

async function adminReportWeekProgress() {
  const { from, to } = reportDateDefaults();
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Weekly session progress</h2>
      <p class="muted">Sessions delivered versus notes posted for each child and week.</p>
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
          <th>Sessions delivered</th>
          <th>Notes posted</th>
        </tr>
        <tbody id="progBody"><tr><td colspan="5">Loading…</td></tr></tbody>
      </table>
    </div>
  `);
  bindReportDetailChrome();
  const loadBtn = document.getElementById('progLoad');
  const loadProgress = async () => {
    if (loadBtn?.disabled) return;
    state.reportFrom = document.getElementById('progFrom').value || from;
    state.reportTo = document.getElementById('progTo').value || to;
    const nextFrom = state.reportFrom;
    const nextTo = state.reportTo;
    const qq = `from=${encodeURIComponent(nextFrom)}&to=${encodeURIComponent(nextTo)}`;
    const tbody = document.getElementById('progBody');
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading…';
    }
    if (tbody) tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    try {
      const progress = await api('GET', `/admin/reports/week-progress?${qq}`);
      if (tbody) tbody.innerHTML = weekProgressRowsHtml(progress.rows || []);
      setStatus('', '');
    } catch (e) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5">${esc(e.message || 'Unable to load progress.')}</td></tr>`;
      }
      setStatus(e.message || 'Unable to load progress.', 'err');
    } finally {
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load';
      }
    }
  };
  if (loadBtn) loadBtn.onclick = () => loadProgress();
  const progXlsx = document.getElementById('progXlsx');
  if (progXlsx) {
    progXlsx.onclick = async () => {
      try {
        const f = document.getElementById('progFrom')?.value || from;
        const t = document.getElementById('progTo')?.value || to;
        const qq = `from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
        await downloadReportXlsx(`/admin/reports/week-progress.xlsx?${qq}`, 'weekly-session-progress.xlsx');
        setStatus('Downloaded weekly-session-progress.xlsx.', 'ok');
      } catch (e) {
        setStatus(e.message, 'err');
      }
    };
  }
  try {
    const progress = await api('GET', `/admin/reports/week-progress?${q}`);
    const progBody = document.getElementById('progBody');
    if (progBody) progBody.innerHTML = weekProgressRowsHtml(progress.rows || []);
  } catch (e) {
    const progBody = document.getElementById('progBody');
    if (progBody) {
      progBody.innerHTML = `<tr><td colspan="5">${esc(e.message || 'Unable to load progress.')}</td></tr>`;
    }
    setStatus(e.message || 'Unable to load progress.', 'err');
  } finally {
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load';
    }
  }
}

async function adminReportLastService() {
  const lastProviderId = state.lastServiceProviderId || '';
  const providersOut = await api('GET', '/admin/providers').catch(() => ({ providers: [] }));
  const providers = providersOut.providers || [];
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Last date of service</h2>
      <p class="muted">Most recent attended or makeup date of service by child and provider. Filter by provider as needed.</p>
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
    </div>
  `);
  bindReportDetailChrome();
  const lastLoad = document.getElementById('lastLoad');
  if (lastLoad) {
    lastLoad.onclick = async () => {
      state.lastServiceProviderId = document.getElementById('lastProvider')?.value || '';
      await adminReports();
    };
  }
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
  const lastQ = lastProviderId ? `providerId=${encodeURIComponent(lastProviderId)}` : '';
  const lastBody = document.getElementById('lastBody');
  try {
    const last = await api('GET', `/admin/reports/last-service${lastQ ? `?${lastQ}` : ''}`);
    if (lastBody) {
      lastBody.innerHTML =
        (last.rows || [])
          .map(
            (r) =>
              `<tr><td>${childNameLink(r.studentId, r.name)}</td><td>${esc(r.providerName || '—')}</td><td>${esc(r.schoolName || '—')}</td><td>${esc(r.lastDos)}</td></tr>`,
          )
          .join('') || '<tr><td colspan="4">None</td></tr>';
    }
  } catch (e) {
    if (lastBody) {
      lastBody.innerHTML = `<tr><td colspan="4">${esc(e.message || 'Unable to load last service dates.')}</td></tr>`;
    }
    setStatus(e.message || 'Unable to load last service dates.', 'err');
  }
}

async function adminReportDueDates() {
  const { from, to } = reportDateDefaults();
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Progress-report due dates</h2>
      <p class="muted">School progress, annual, and reevaluation due dates in the selected range.</p>
      <div class="row">
        <label>From <input id="dueFrom" type="date" value="${esc(from)}" /></label>
        <label>To <input id="dueTo" type="date" value="${esc(to)}" /></label>
        <button type="button" class="btn-primary" id="duesLoad">Load</button>
        <button type="button" class="btn" id="duesXlsx">Export Excel</button>
      </div>
      ${bulkBar('report-dues')}
      <table><tr>${bulkTh('report-dues')}<th>School</th><th>Kind</th><th>Due</th><th>Status</th><th></th></tr>
      <tbody id="duesBody"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
  `);
  bindReportDetailChrome();
  const fillDues = (rows) => {
    const duesBody = document.getElementById('duesBody');
    if (!duesBody) return;
    duesBody.innerHTML =
      (rows || [])
        .map(
          (r) =>
            `<tr>${bulkTd('report-dues', r.id)}<td>${esc(r.schoolName || r.schoolId)}</td><td>${esc(r.kind)}</td><td>${esc(r.dueOn)}</td><td>${esc(r.status)}</td><td>${r.completedAt ? `<button class="btn" data-del-due="${esc(r.id)}">Remove</button>` : `<button class="btn" data-complete="${esc(r.id)}">Mark complete</button> <button class="btn" data-del-due="${esc(r.id)}">Remove</button>`}</td></tr>`,
        )
        .join('') || '<tr><td colspan="6">None</td></tr>';
  };
  const loadDues = async () => {
    const f = document.getElementById('dueFrom')?.value || from;
    const t = document.getElementById('dueTo')?.value || to;
    state.reportFrom = f;
    state.reportTo = t;
    const qq = `from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
    const duesBody = document.getElementById('duesBody');
    if (duesBody) duesBody.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
    try {
      const dues = await api('GET', `/admin/reports/due-dates?${qq}`);
      fillDues(dues.rows || []);
      setStatus('', '');
    } catch (e) {
      if (duesBody) {
        duesBody.innerHTML = `<tr><td colspan="6">${esc(e.message || 'Unable to load due dates.')}</td></tr>`;
      }
      setStatus(e.message || 'Unable to load due dates.', 'err');
    }
  };
  const duesLoad = document.getElementById('duesLoad');
  if (duesLoad) duesLoad.onclick = () => loadDues();
  const duesXlsx = document.getElementById('duesXlsx');
  if (duesXlsx) {
    duesXlsx.onclick = async () => {
      try {
        const f = document.getElementById('dueFrom')?.value || from;
        const t = document.getElementById('dueTo')?.value || to;
        const qq = `from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
        await downloadReportXlsx(`/admin/reports/due-dates.xlsx?${qq}`, 'due-dates.xlsx');
        setStatus('Downloaded due-dates.xlsx.', 'ok');
      } catch (e) {
        setStatus(e.message, 'err');
      }
    };
  }
  bindBulkDelete('report-dues', {
    noun: 'due dates',
    deleteOne: (id) => api('DELETE', `/admin/due-dates/${id}`),
    refresh: () => adminReports(),
  });
  try {
    const dues = await api('GET', `/admin/reports/due-dates?${q}`);
    fillDues(dues.rows || []);
  } catch (e) {
    const duesBody = document.getElementById('duesBody');
    if (duesBody) {
      duesBody.innerHTML = `<tr><td colspan="6">${esc(e.message || 'Unable to load due dates.')}</td></tr>`;
    }
    setStatus(e.message || 'Unable to load due dates.', 'err');
  }
}

async function adminReports() {
  const id = state.reportView || '';
  if (!id) {
    adminReportsLanding();
    return;
  }
  if (id === 'week-progress') {
    await adminReportWeekProgress();
    return;
  }
  if (id === 'last-service') {
    await adminReportLastService();
    return;
  }
  if (id === 'due-dates') {
    await adminReportDueDates();
    return;
  }
  adminReportsLanding();
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
    NotAuthorizedException: 'Incorrect email or password. Please try again.',
    UserNotFoundException: 'No account exists for that email. Contact the office for an invitation.',
    UserNotConfirmedException: 'This account is not ready yet. Contact the office for assistance.',
    PasswordResetRequiredException: 'Your password must be reset. Use Forgot password below, or contact the office for assistance.',
    InvalidPasswordException: 'That password does not meet requirements. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.',
    TooManyRequestsException: 'Too many attempts. Wait a minute and try again.',
    LimitExceededException: 'Too many attempts. Wait a minute and try again.',
    CodeMismatchException: 'Invalid confirmation code. Please try again.',
    ExpiredCodeException: 'That code has expired. Request a new code with Forgot password.',
    InvalidParameterException: 'Verify the email address and try again.',
    ResourceNotFoundException: 'Sign-in is misconfigured (incorrect app client). Contact the office for assistance.',
  };
  if (plain[type]) return plain[type];
  if (data?.message) return type ? `${data.message} (${type})` : String(data.message);
  return 'Sign-in was unsuccessful. Please try again.';
}

function changePasswordErrorMessage(data) {
  const type = cognitoType(data);
  const plain = {
    NotAuthorizedException: 'Incorrect current password. Please try again.',
    InvalidPasswordException: 'That password does not meet requirements. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.',
    InvalidParameterException: 'That password does not meet requirements. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.',
    LimitExceededException: 'Too many attempts. Wait a minute and try again.',
    TooManyRequestsException: 'Too many attempts. Wait a minute and try again.',
    CodeMismatchException: 'Invalid confirmation code. Please try again.',
    ExpiredCodeException: 'That code has expired. Request a new code with Forgot password.',
    UserNotFoundException: 'No account exists for that email. Contact the office for an invitation.',
  };
  if (plain[type]) return plain[type];
  if (data?.message) return type ? `${data.message} (${type})` : String(data.message);
  return 'Unable to change password. Please try again.';
}

const COGNITO_NETFREE_HINT =
  'Unable to reach Cognito. If you use NetFree, allowlist cognito-idp.us-east-1.amazonaws.com, then try again.';

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
  state.selectedSchoolId = '';
  state.schoolConfirmed = false;
  sessionStorage.removeItem('tmsSchoolId');
  sessionStorage.removeItem('tmsSchoolConfirmed');
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
      <p>Use the email and temporary password from your White Glove invitation.</p>
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
      loginError('Enter your email and password.');
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
      if (!idToken) throw new Error('Sign-in was unsuccessful. Please try again.');
      applyToken(idToken, auth.AccessToken || '');
      // Force school picker after each sign-in when the provider has multiple schools.
      state.schoolConfirmed = false;
      sessionStorage.removeItem('tmsSchoolConfirmed');
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
      <p>We will email a confirmation code. Then choose a new password.</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>Email <input id="forgotEmail" type="email" autocomplete="username" placeholder="you@example.com" value="${esc(prefillEmail || '')}" /></label>
      <button class="btn-primary big" id="forgotSendBtn">Send reset code</button>
      <p><button type="button" class="btn" id="forgotBackBtn">Back to sign in</button></p>
    </div>
  `);
  document.getElementById('forgotBackBtn').onclick = () => showLogin('');
  document.getElementById('forgotSendBtn').onclick = async () => {
    const btn = document.getElementById('forgotSendBtn');
    const email = document.getElementById('forgotEmail').value.trim();
    loginError('');
    if (!email) {
      loginError('Enter your email address.');
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
      btn.textContent = 'Send reset code';
    }
  };
  document.getElementById('forgotEmail').focus();
}

function showConfirmForgotPassword(email) {
  hideAppChrome();
  setStatus('', '');
  view(`
    <div class="card login-card">
      <h2>Enter confirmation code</h2>
      <p>Check <strong>${esc(email)}</strong> for a confirmation code, then choose a new password (at least 8 characters with an uppercase letter, a lowercase letter, and a number).</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>Confirmation code <input id="forgotCode" type="text" autocomplete="one-time-code" inputmode="numeric" /></label>
      <label>New password <input id="forgotNew" type="password" autocomplete="new-password" /></label>
      <label>Confirm new password <input id="forgotNew2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="forgotConfirmBtn">Save new password</button>
      <p><button type="button" class="linkish" id="forgotResendBtn">Resend code</button></p>
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
      loginError('Enter the confirmation code and both password fields.');
      return;
    }
    if (p1 !== p2) {
      loginError('The passwords do not match.');
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
      <p>First sign-in: choose your own password. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>New password <input id="newPassword" type="password" autocomplete="new-password" /></label>
      <label>Confirm password <input id="newPassword2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="newPassBtn">Save password and sign in</button>
    </div>
  `);
  const submit = async () => {
    const btn = document.getElementById('newPassBtn');
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('newPassword2').value;
    loginError('');
    if (!p1) {
      loginError('Enter a new password.');
      return;
    }
    if (p1 !== p2) {
      loginError('The passwords do not match.');
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
      if (!idToken) throw new Error('Sign-in was unsuccessful. Please sign in again.');
      applyToken(idToken, auth.AccessToken || '');
      state.schoolConfirmed = false;
      sessionStorage.removeItem('tmsSchoolConfirmed');
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
    signOut('Your session has ended. Please sign in again.');
    return;
  }
  if (!state.accessToken) {
    view(`
      <div class="card login-card">
        <h2>Change password</h2>
        <div class="err-box">Sign out and sign in again to change your password.</div>
        <button type="button" class="btn" id="changePwCancel">Back</button>
      </div>
    `);
    document.getElementById('changePwCancel').onclick = () => showRole();
    return;
  }
  view(`
    <div class="card login-card">
      <h2>Change password</h2>
      <p>Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.</p>
      <div id="changePwErr" class="err-box" hidden></div>
      <label>Current password <input id="changePwCurrent" type="password" autocomplete="current-password" /></label>
      <label>New password <input id="changePwNew" type="password" autocomplete="new-password" /></label>
      <label>Confirm new password <input id="changePwNew2" type="password" autocomplete="new-password" /></label>
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
      changePasswordError('Enter all three password fields.');
      return;
    }
    if (p1 !== p2) {
      changePasswordError('The new passwords do not match.');
      return;
    }
    if (!state.accessToken) {
      changePasswordError('Sign out and sign in again to change your password.');
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
      setStatus('Password changed. Use the new password the next time you sign in.', 'ok');
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
  clearTransientErrors();
  document.querySelectorAll('#adminNav .nav').forEach((b) => b.classList.toggle('on', b === btn));
  const screen = btn.getAttribute('data-admin');
  if (screen === 'dash') adminDash();
  if (screen === 'children') adminChildren();
  if (screen === 'providers') adminProviders();
  if (screen === 'mandates') adminMandates();
  if (screen === 'schools') adminSchools();
  if (screen === 'admins') adminAdmins();
  if (screen === 'reports') {
    state.reportView = '';
    adminReports();
  }
};

// ---- Luna support chatbot ----
const lunaState = {
  open: localStorage.getItem('tmsLunaOpen') === '1',
  busy: false,
  messages: [],
  pendingSummary: '',
  readyForHandoff: false,
};

function setLunaVisible(on) {
  const root = document.getElementById('lunaRoot');
  if (!root) return;
  root.hidden = !on;
  if (!on) {
    const panel = document.getElementById('lunaPanel');
    const fab = document.getElementById('lunaFab');
    if (panel) panel.hidden = true;
    if (fab) fab.setAttribute('aria-expanded', 'false');
    return;
  }
  setLunaOpen(lunaState.open);
}

function setLunaOpen(open) {
  lunaState.open = Boolean(open);
  localStorage.setItem('tmsLunaOpen', lunaState.open ? '1' : '0');
  const panel = document.getElementById('lunaPanel');
  const fab = document.getElementById('lunaFab');
  if (panel) panel.hidden = !lunaState.open;
  if (fab) fab.setAttribute('aria-expanded', lunaState.open ? 'true' : 'false');
  if (lunaState.open) {
    ensureLunaWelcome();
    const input = document.getElementById('lunaInput');
    if (input) input.focus();
  }
}

function ensureLunaWelcome() {
  if (lunaState.messages.length) return;
  lunaState.messages.push({
    role: 'assistant',
    content: 'Hi, I’m Luna. Tell me what’s going wrong and I’ll help gather the details for support.',
  });
  renderLunaMessages();
}

function renderLunaMessages(extraTyping) {
  const box = document.getElementById('lunaMessages');
  if (!box) return;
  const rows = lunaState.messages
    .map(
      (m) =>
        `<div class="luna-bubble ${m.role === 'user' ? 'luna-user' : 'luna-bot'}">${esc(m.content)}</div>`,
    )
    .join('');
  const typing = extraTyping
    ? '<div class="luna-bubble luna-bot luna-typing">Luna is typing…</div>'
    : '';
  box.innerHTML = rows + typing;
  box.scrollTop = box.scrollHeight;
  syncLunaHandoffBar();
}

function lunaContactDefaults() {
  const payload = state.idToken ? decodeJwtPayload(state.idToken) || {} : {};
  const given = String(payload.given_name || '').trim();
  const family = String(payload.family_name || '').trim();
  const full = [given, family].filter(Boolean).join(' ');
  const name = String(payload.name || full || payload['cognito:username'] || '').trim();
  const email = String(state.email || payload.email || '').trim();
  return { name, email };
}

function readLunaContact() {
  const nameEl = document.getElementById('lunaContactName');
  const emailEl = document.getElementById('lunaContactEmail');
  return {
    contactName: String(nameEl?.value || '').trim(),
    contactEmail: String(emailEl?.value || '').trim(),
  };
}

function lunaEmailLooksOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function syncLunaHandoffBar() {
  const bar = document.getElementById('lunaHandoffBar');
  const btn = document.getElementById('lunaSendHandoff');
  if (!bar) return;
  const show = Boolean(lunaState.readyForHandoff);
  bar.hidden = !show;
  if (show) {
    const nameEl = document.getElementById('lunaContactName');
    const emailEl = document.getElementById('lunaContactEmail');
    const defaults = lunaContactDefaults();
    if (nameEl && !String(nameEl.value || '').trim() && defaults.name) nameEl.value = defaults.name;
    if (emailEl && !String(emailEl.value || '').trim() && defaults.email) emailEl.value = defaults.email;
  }
  const { contactName, contactEmail } = readLunaContact();
  if (btn) btn.disabled = lunaState.busy || !show || !contactName || !lunaEmailLooksOk(contactEmail);
}

function setLunaStatus(msg) {
  const el = document.getElementById('lunaStatus');
  if (!el) return;
  const text = String(msg || '').trim();
  if (!text) {
    el.textContent = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = 'luna-status status-banner';
  el.innerHTML = `<span>${esc(text)}</span><button type="button" class="status-banner-dismiss" aria-label="Dismiss">×</button>`;
  el.querySelector('.status-banner-dismiss')?.addEventListener('click', () => setLunaStatus(''));
}

async function lunaChat(userText) {
  if (lunaState.busy) return;
  const text = String(userText || '').trim();
  if (!text) return;
  setLunaStatus('');
  lunaState.readyForHandoff = false;
  lunaState.pendingSummary = '';
  lunaState.messages.push({ role: 'user', content: text });
  renderLunaMessages(true);
  lunaState.busy = true;
  const sendBtn = document.getElementById('lunaSend');
  if (sendBtn) sendBtn.disabled = true;
  syncLunaHandoffBar();
  try {
    const out = await api('POST', '/support/luna/chat', {
      messages: lunaState.messages.map((m) => ({ role: m.role, content: m.content })),
      pageUrl: typeof location !== 'undefined' ? location.href : '',
    });
    const reply = String(out.reply || '').trim() || 'Thanks — could you share a bit more detail?';
    lunaState.messages.push({ role: 'assistant', content: reply });
    if (String(out.action || '').toLowerCase() === 'handoff') {
      lunaState.readyForHandoff = true;
      lunaState.pendingSummary = String(out.summary || reply).trim();
    }
    renderLunaMessages(false);
  } catch (e) {
    setLunaStatus(e?.message || 'Luna is unavailable.');
    renderLunaMessages(false);
  } finally {
    lunaState.busy = false;
    if (sendBtn) sendBtn.disabled = false;
    syncLunaHandoffBar();
  }
}

async function lunaHandoff() {
  if (lunaState.busy || !lunaState.readyForHandoff) return;
  const { contactName, contactEmail } = readLunaContact();
  if (!contactName) {
    setLunaStatus('Enter your name before sending to Moshe.');
    document.getElementById('lunaContactName')?.focus();
    syncLunaHandoffBar();
    return;
  }
  if (!lunaEmailLooksOk(contactEmail)) {
    setLunaStatus('Enter a valid email before sending to Moshe.');
    document.getElementById('lunaContactEmail')?.focus();
    syncLunaHandoffBar();
    return;
  }
  lunaState.busy = true;
  setLunaStatus('');
  const btn = document.getElementById('lunaSendHandoff');
  if (btn) btn.disabled = true;
  renderLunaMessages(true);
  try {
    const out = await api('POST', '/support/luna/handoff', {
      messages: lunaState.messages.map((m) => ({ role: m.role, content: m.content })),
      summary: lunaState.pendingSummary,
      pageUrl: typeof location !== 'undefined' ? location.href : '',
      contactName,
      contactEmail,
    });
    const reply =
      String(out.reply || '').trim() ||
      'Thanks — I sent this to support. Moshe will follow up by email.';
    lunaState.messages.push({ role: 'assistant', content: reply });
    lunaState.readyForHandoff = false;
    lunaState.pendingSummary = '';
    renderLunaMessages(false);
  } catch (e) {
    setLunaStatus(e?.message || 'Unable to send the support handoff.');
    renderLunaMessages(false);
  } finally {
    lunaState.busy = false;
    if (btn) btn.disabled = false;
    syncLunaHandoffBar();
  }
}

function initLuna() {
  const fab = document.getElementById('lunaFab');
  const close = document.getElementById('lunaClose');
  const form = document.getElementById('lunaForm');
  const handoff = document.getElementById('lunaSendHandoff');
  const nameEl = document.getElementById('lunaContactName');
  const emailEl = document.getElementById('lunaContactEmail');
  if (!fab || fab.dataset.bound === '1') return;
  fab.dataset.bound = '1';
  fab.onclick = () => setLunaOpen(!lunaState.open);
  if (close) close.onclick = () => setLunaOpen(false);
  if (handoff) handoff.onclick = () => lunaHandoff();
  const onContactEdit = () => {
    setLunaStatus('');
    syncLunaHandoffBar();
  };
  if (nameEl) nameEl.addEventListener('input', onContactEdit);
  if (emailEl) emailEl.addEventListener('input', onContactEdit);
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const input = document.getElementById('lunaInput');
      const text = input?.value || '';
      if (input) input.value = '';
      lunaChat(text);
    };
  }
  setLunaOpen(lunaState.open);
}

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
  setLunaVisible(false);
}

async function showRole() {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    signOut('Your session has ended. Please sign in again.');
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
  initLuna();
  setLunaVisible(true);
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
