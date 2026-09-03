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
  caseloadCsvText: '',
};

function mondayIso() {
  const d = new Date();
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
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

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'Could not reach the server. If you use NetFree, the app must use the /api proxy. Try refresh.',
    );
  }
  if (res.status === 401 && COGNITO_MODE) {
    signOut('Your sign in ended. Please sign in again.');
    throw new Error('Please sign in again.');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('pdf') ? await res.blob() : await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 207)) {
    const errList = Array.isArray(data.errors)
      ? data.errors.map((e) => (typeof e === 'string' ? e : e.message || e.problem || JSON.stringify(e))).filter(Boolean)
      : [];
    const base = String(data.error || data.message || '').trim();
    const details = errList.filter((e) => e && !base.includes(e)).join('; ');
    const msg =
      [base, details].filter(Boolean).join(' — ') ||
      res.statusText ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
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

function setStatus(msg, kind) {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.className = kind || '';
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

async function loadMissedOptions(studentId, selected) {
  const sel = document.getElementById('makeupOf');
  if (!sel) return;
  if (!studentId) {
    sel.innerHTML = '<option value="">Select missed session</option>';
    return;
  }
  try {
    const out = await api('GET', `/students/${studentId}/missed`);
    const missed = out.missed || [];
    sel.innerHTML = `<option value="">Select missed session</option>${missed.map((m) =>
      `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(m.dateOfService || m.id)}</option>`,
    ).join('')}`;
  } catch {
    sel.innerHTML = '<option value="">Select missed session</option>';
  }
}

function bindMakeupPickers() {
  const att = document.getElementById('att');
  const student = document.getElementById('studentId');
  const wrap = document.getElementById('makeupWrap');
  if (!att || !student || !wrap) return;
  const sync = () => {
    wrap.hidden = att.value !== 'makeup';
    if (att.value === 'makeup') loadMissedOptions(student.value);
  };
  att.onchange = sync;
  student.onchange = sync;
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

async function therapistHome() {
  let banner = '';
  let week = null;
  let sessions = [];
  let students = [];
  let errors = [];
  let warnings = [];
  let signerName = '';
  let signerEmail = '';
  let providerId = '';

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
    setStatus(e.message, 'err');
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
      <table>
        <tr><th>Date</th><th>Child</th><th>Time</th><th>Attendance</th><th>Flags</th><th>Notes</th></tr>
        ${sessions.map((s) => {
          const name = studentName(students, s.studentId);
          const time = [s.beginTime, s.endTime].filter(Boolean).join(' – ');
          const flags = s.aiFlags || [];
          const hard = Boolean(s.aiBlock);
          const rowClass = hard ? 'hard' : flags.length ? 'warn' : '';
          const pill = hard ? 'pill-err' : 'pill-warn';
          return `<tr class="${rowClass}"><td>${esc(s.dateOfService)}</td><td>${esc(name)}</td><td>${esc(time)}</td><td>${esc(s.attendance)}</td><td>${flags.length ? `<span class="${pill}">${esc(flags.join('; '))}</span>` : ''}</td><td>${esc(s.notes || '')}</td></tr>`;
        }).join('') || '<tr><td colspan="6">No sessions yet.</td></tr>'}
      </table>
    </div>

    ${locked ? `
    <div class="card">
      <p>This week is ${esc(weekApprovalLabel(status).title.toLowerCase())}. You cannot edit it.</p>
    </div>
    ` : `
    <div class="card">
      <h2>1. Upload weekly report</h2>
      <p>Choose your Frontline Related Service Session Notes PDF (text PDF, not a scan). The system reads the sessions for you.</p>
      <input id="pdfFile" type="file" accept="application/pdf,.pdf" />
      <button class="btn-primary big" id="upload">Read PDF</button>
      <p class="muted" id="uploadHint">If upload fails with “no readable text”, re-export/save as a text PDF from Frontline — image-only scans cannot be read.</p>
    </div>

    <div class="card">
      <h2>2. Add a session</h2>
      <p>Use this when you need to add or fix one visit by hand.</p>
      <div class="row">
        <label>Student
          <select id="studentId">${studentOptions(students)}</select>
        </label>
        <label>Date of service <input id="dos" placeholder="MM/DD/YYYY" /></label>
      </div>
      <div class="row">
        <label>Begin time <input id="beginTime" placeholder="9:00 am" /></label>
        <label>End time <input id="endTime" placeholder="9:30 am" /></label>
      </div>
      <div class="row">
        <label>Attendance
          <select id="att">
            <option value="attended">attended</option>
            <option value="missed">missed</option>
            <option value="makeup">makeup</option>
          </select>
        </label>
        <label id="makeupWrap" hidden>Makeup of missed
          <select id="makeupOf"><option value="">Select missed session</option></select>
        </label>
      </div>
      <label>Notes <textarea id="notes" rows="3"></textarea></label>
      <button type="button" class="btn big" id="add">Save session</button>
    </div>

    <div class="card">
      <h2>3. Send timesheet</h2>
      <p>We send it to the school signer on file${signerEmail ? `: ${esc(signerName || signerEmail)} &lt;${esc(signerEmail)}&gt;` : ''}.</p>
      <button class="btn-primary big" id="submit" ${canSend ? '' : 'disabled'}>Send timesheet</button>
      ${!canSend && !errors.length ? '<p class="muted">Add at least one session before sending.</p>' : ''}
    </div>
    `}
  `);

  document.getElementById('refreshHome').onclick = () => therapistHome();

  if (!locked) {
    bindMakeupPickers();

    document.getElementById('upload').onclick = async () => {
      const btn = document.getElementById('upload');
      try {
        const file = document.getElementById('pdfFile').files[0];
        if (!file) throw new Error('Choose your notes PDF first.');
        if (!providerId) throw new Error('Your provider profile is not linked yet. Ask the office for help.');
        btn.disabled = true;
        btn.textContent = 'Reading…';
        setStatus('Reading PDF…', '');
        const pdfBase64 = await fileToBase64(file);
        const out = await api('POST', '/week/upload-sessions', {
          weekStart: state.weekStart,
          providerId,
          pdfBase64,
        });
        state.weekId = out.week.id;
        setStatus(`Loaded ${out.parsed} session(s).`, out.warnings?.length ? '' : 'ok');
        await therapistHome();
      } catch (e) {
        const msg = e.message || 'Could not read this PDF.';
        setStatus(msg, 'err');
        const hint = document.getElementById('uploadHint');
        if (hint && /no readable text|Could not find any sessions|Over mandate/i.test(msg)) {
          hint.textContent = msg;
        }
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
        const studentId = document.getElementById('studentId').value;
        const dateOfService = document.getElementById('dos').value.trim();
        const notes = document.getElementById('notes').value.trim();
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
          notes,
        });
        setStatus('Session saved.', 'ok');
        await therapistHome();
      } catch (e) {
        setStatus(e.message, 'err');
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
        setStatus(out.message || 'Sent. Status is now Pending.', 'ok');
        await therapistHome();
      } catch (e) {
        setStatus(e.message, 'err');
      }
    };
  }
}

async function adminDash() {
  const d = await api('GET', '/dashboard');
  const listed = await api('GET', '/admin/weeks');
  const weeks = listed.weeks || [];
  view(`
    <div class="card">
      <h2>Dashboard</h2>
      <p>Timesheets — draft ${d.timesheet.draft} · submitted ${d.timesheet.submitted} · signed ${d.timesheet.signed} · locked ${d.timesheet.locked}</p>
      <p>HHA — pending ${d.hha.pending} · confirmed ${d.hha.confirmed} · failed ${d.hha.failed}</p>
      <p>Missing notes ${d.missingNotes} · overdue due dates ${d.overdueDueDates} · open alerts ${d.openAlerts}</p>
    </div>
    <div class="card">
      <h2>Weeks</h2>
      <table>
        <tr><th>Week</th><th>Provider</th><th>Sessions</th><th>Status</th><th>Signer</th><th>HHA</th><th></th></tr>
        ${weeks.map((w) => `<tr>
          <td>${esc(w.weekStart)}</td>
          <td>${esc(w.providerName)}</td>
          <td>${esc(w.sessionCount)}</td>
          <td>${esc(w.status)}</td>
          <td>${esc(w.signerName || w.signerEmail || '')}</td>
          <td>${esc(w.hhaStatus)}</td>
          <td>
            <button class="btn-primary" data-sign="${esc(w.id)}">Sign</button>
            <button class="btn" data-reopen="${esc(w.id)}">Reopen</button>
            <button class="btn" data-hha="${esc(w.id)}">Send to HHA</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="7">No weeks yet.</td></tr>'}
      </table>
    </div>
  `);
  document.getElementById('view').onclick = async (e) => {
    const sign = e.target.closest('[data-sign]');
    const reopen = e.target.closest('[data-reopen]');
    const hha = e.target.closest('[data-hha]');
    try {
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
        setStatus(`HHA transferred ${out.transferred}. ${out.errors?.join(' ') || ''}`, out.ok ? 'ok' : 'err');
        await adminDash();
      }
    } catch (err) {
      setStatus(err.message, 'err');
    }
  };
}

async function adminPeople() {
  const [usersOut, providersOut, schoolsOut] = await Promise.all([
    api('GET', '/admin/users'),
    api('GET', '/admin/providers'),
    api('GET', '/admin/schools'),
  ]);
  const users = usersOut.users || [];
  const providers = providersOut.providers || [];
  const schools = schoolsOut.schools || [];
  const therapists = users.filter((u) => u.role === 'therapist');
  const admins = users.filter((u) => u.role === 'admin');
  view(`
    <div class="card">
      <h2>Add admin</h2>
      <p class="muted">Invites another office login (Cognito Admin group). Only existing admins can do this.</p>
      <label>Email <input id="aemail" type="email" autocomplete="off" /></label>
      <label>Display name <input id="aname" placeholder="Optional" /></label>
      <button class="btn-primary big" id="createAdmin">Invite admin</button>
    </div>
    <div class="card">
      <h2>Admins</h2>
      <table>
        <tr><th>Name</th><th>Email</th><th></th></tr>
        ${admins.map((u) => {
          const self = state.email && u.email && state.email.toLowerCase() === String(u.email).toLowerCase();
          return `<tr>
            <td>${esc(u.displayName || '—')}</td>
            <td>${esc(u.email)}</td>
            <td>${
              self
                ? '—'
                : `<button type="button" class="btn" data-remove-admin="${esc(u.id)}">Remove</button>`
            }</td>
          </tr>`;
        }).join('') || '<tr><td colspan="3">None yet</td></tr>'}
      </table>
    </div>
    <div class="card">
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
        <label>Pay rate (optional) <input id="trate" type="number" step="0.01" placeholder="72" /></label>
      </div>
      <label>HHA caregiver code (optional) <input id="thha" /></label>
      <button class="btn-primary big" id="createTherapist">Create provider</button>
    </div>
    <div class="card">
      <h2>Providers</h2>
      <table>
        <tr><th>Name</th><th>Email</th><th>Provider id</th><th>Discipline</th></tr>
        ${therapists.map((u) => {
          const p = providers.find((x) => x.id === u.providerId) || providers.find((x) => x.userId === u.id);
          const name = p ? `${p.firstName} ${p.lastName}`.trim() : u.displayName;
          return `<tr>
            <td>${esc(name || '—')}</td>
            <td>${esc(u.email)}</td>
            <td>${esc(p?.id || u.providerId || '—')}</td>
            <td>${esc(p?.discipline || '—')}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="4">None yet</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h2>School signer</h2>
      <label>School <input id="sname" /></label>
      <label>Signer name <input id="signerName" /></label>
      <label>Signer email <input id="signerEmail" /></label>
      <button class="btn" id="school">Save school</button>
      <h3>Schools</h3>
      <table>
        <tr><th>School</th><th>Signer</th></tr>
        ${schools.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.signerName || s.signerEmail || '')}</td></tr>`).join('') || '<tr><td colspan="2">None</td></tr>'}
      </table>
      <h2>School due dates</h2>
      <p class="muted">One due date per school (progress / annual / reeval) applies to that school’s whole caseload — not per child.</p>
      <label>School
        <select id="dueSchool">${schoolOptions(schools)}</select>
      </label>
      <label>Kind
        <select id="dueKind"><option value="progress">progress</option><option value="annual">annual</option><option value="reeval">reeval</option></select>
      </label>
      <label>Due on (YYYY-MM-DD) <input id="dueOn" placeholder="2026-10-15" /></label>
      <button class="btn" id="duebtn">Save school due date</button>
    </div>
    <div class="card">
      <h2>Internal note</h2>
      <p class="muted">Hidden from the therapist.</p>
      <label>Provider
        <select id="npid">${providerOptions(providers)}</select>
      </label>
      <label>Note <textarea id="nbody" rows="3"></textarea></label>
      <button type="button" class="btn" id="nadd">Add note</button>
      <h3>Saved notes</h3>
      <table>
        <tr><th>When</th><th>Note</th></tr>
        <tbody id="notesList"><tr><td colspan="2">Pick a provider to see notes.</td></tr></tbody>
      </table>
    </div>
  `);
  const notesList = document.getElementById('notesList');
  const loadProviderNotes = async (providerId) => {
    if (!notesList) return;
    if (!providerId) {
      notesList.innerHTML = '<tr><td colspan="2">Pick a provider to see notes.</td></tr>';
      return;
    }
    notesList.innerHTML = '<tr><td colspan="2">Loading…</td></tr>';
    try {
      const out = await api('GET', `/admin/providers/${providerId}/notes`);
      const rows = out.notes || [];
      notesList.innerHTML = rows.length
        ? rows
            .slice()
            .reverse()
            .map((n) => `<tr><td>${esc((n.createdAt || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(n.body || '')}</td></tr>`)
            .join('')
        : '<tr><td colspan="2">No notes yet for this provider.</td></tr>';
    } catch (e) {
      notesList.innerHTML = `<tr><td colspan="2">${esc(e.message || 'Could not load notes.')}</td></tr>`;
    }
  };
  document.getElementById('npid').onchange = () => loadProviderNotes(document.getElementById('npid').value);
  loadProviderNotes(document.getElementById('npid').value);

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
      await adminPeople();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.querySelectorAll('[data-remove-admin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this admin? Their login will be deleted and they will disappear from this list.')) return;
        const id = btn.getAttribute('data-remove-admin');
        const out = await api('DELETE', `/admin/users/${id}`);
        setStatus(out.message || 'Admin removed.', 'ok');
        await adminPeople();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.getElementById('createTherapist').onclick = async () => {
    try {
      const rateRaw = document.getElementById('trate').value.trim();
      const out = await api('POST', '/admin/therapists', {
        email: document.getElementById('temail').value,
        firstName: document.getElementById('tfirst').value,
        lastName: document.getElementById('tlast').value,
        discipline: document.getElementById('tdisc').value,
        payRate: rateRaw === '' ? null : Number(rateRaw),
        hhaCaregiverCode: document.getElementById('thha').value,
        role: 'therapist',
      });
      setStatus(out.message || `Provider ready: ${out.user?.email} ↔ ${out.provider?.id}`, 'ok');
      await adminPeople();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('school').onclick = async () => {
    try {
      await api('POST', '/admin/schools', {
        name: document.getElementById('sname').value,
        signerName: document.getElementById('signerName').value,
        signerEmail: document.getElementById('signerEmail').value,
      });
      setStatus('School saved.', 'ok');
      await adminPeople();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('duebtn').onclick = async () => {
    try {
      const schoolId = document.getElementById('dueSchool').value;
      if (!schoolId) throw new Error('Pick a school.');
      await api('POST', '/admin/due-dates', {
        schoolId,
        kind: document.getElementById('dueKind').value,
        dueOn: document.getElementById('dueOn').value,
      });
      setStatus('School due date saved. Alerts stay until marked complete.', 'ok');
      document.getElementById('dueOn').value = '';
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('nadd').onclick = async () => {
    const btn = document.getElementById('nadd');
    try {
      const id = document.getElementById('npid').value;
      const text = document.getElementById('nbody').value.trim();
      if (!id) throw new Error('Pick a provider.');
      if (!text) throw new Error('Type a note first.');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const out = await api('POST', `/admin/providers/${id}/notes`, { body: text });
      document.getElementById('nbody').value = '';
      setStatus('Note saved (hidden from therapist).', 'ok');
      const rows = out.notes || [];
      if (notesList) {
        notesList.innerHTML = rows.length
          ? rows
              .slice()
              .reverse()
              .map((n) => `<tr><td>${esc((n.createdAt || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(n.body || '')}</td></tr>`)
              .join('')
          : '<tr><td colspan="2">No notes yet for this provider.</td></tr>';
      } else {
        await loadProviderNotes(id);
      }
    } catch (e) { setStatus(e.message, 'err'); }
    finally {
      btn.disabled = false;
      btn.textContent = 'Add note';
    }
  };
}

async function adminMandates() {
  const [studentsOut, providersOut, schoolsOut] = await Promise.all([
    api('GET', '/students'),
    api('GET', '/admin/providers'),
    api('GET', '/admin/schools'),
  ]);
  const students = studentsOut.students || [];
  const providers = providersOut.providers || [];
  const schools = schoolsOut.schools || [];
  const draft = state.mandateDraft;
  const student = draft?.student;
  const mandate = draft?.mandate;
  const preview = state.caseloadPreview;
  const previewRows = preview?.rows || [];
  const previewErrors = preview?.errors || [];
  const previewWarnings = preview?.warnings || [];
  view(`
    <div class="card">
      <h2>Import caseload</h2>
      <p><strong>This is how mandates are created.</strong> Each CSV row already has the mandate (service, ratio, Freq, Period, RS dates, school, student). Dual-service kids = multiple rows = multiple mandates. Weekly and school-day cycle are both supported. Upload the KU “Related Service Details by School” <strong>.csv</strong> (not PDF, not Excel). Preview first, then confirm.</p>
      <input id="caseloadFile" type="file" accept=".csv,text/csv" />
      <div class="row" style="margin-top:0.6rem">
        <button class="btn" id="caseloadPreviewBtn">Preview import</button>
        <button class="btn-primary" id="caseloadConfirmBtn" ${previewRows.length ? '' : 'disabled'}>Confirm import</button>
      </div>
      ${preview ? `
      <p style="margin-top:0.8rem">${previewRows.length} mandate row(s) · ${preview.createdStudents || 0} new students · ${preview.createdSchools || 0} new schools · ${preview.createdMandates || 0} new mandates</p>
      ${previewErrors.length ? `
      <div class="err-box caseload-issues">
        <strong>Errors (${previewErrors.length})</strong>
        <p class="muted" style="margin:0.35rem 0 0.5rem">One problem per row. Fix these in the CSV, then preview again. Valid rows in the table below can still be imported.</p>
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
        <tr><th>CSV row</th><th>Student</th><th>School</th><th>Service</th><th>Ratio</th><th>Freq</th><th>Provider</th></tr>
        ${(() => {
          const errRows = new Set(
            previewErrors.map((e) => Number(e.row ?? e.rowNumber)).filter((n) => Number.isFinite(n) && n > 0),
          );
          return previewRows.map((r) => {
            const badProv = r.providerName && !r.providerMatched;
            const badRow = errRows.has(Number(r.rowNumber));
            const cls = badRow ? 'row-err' : badProv ? 'row-warn' : '';
            return `<tr${cls ? ` class="${cls}"` : ''}>
              <td>${esc(String(r.rowNumber || ''))}</td>
              <td>${esc(r.firstName)} ${esc(r.lastName)}${r.grade ? ` <span class="muted">(gr ${esc(r.grade)})</span>` : ''}</td>
              <td>${esc(r.schoolName || '')}</td>
              <td>${esc(r.serviceType || r.discipline || '')}</td>
              <td>${r.ratioGroup ? 'Group' : 'Individual'}</td>
              <td>${esc(r.freqDisplay || '')}</td>
              <td>${esc(r.providerName || '')}${badProv ? ' <span class="err-inline">(unmatched)</span>' : ''}${badRow ? ' <span class="err-inline">(see Errors)</span>' : ''}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="7">No valid rows to import</td></tr>';
        })()}
      </table>` : ''}
    </div>
    <div class="card muted-card">
      <h2>Optional: one-off mandate PDF</h2>
      <p class="muted">Not how you load the caseload. Prefer <strong>Import caseload</strong> above — frequency and services come from the CSV. Use this only for a rare single-child exception.</p>
      <textarea id="mtext" rows="6" placeholder="Child's Name: De Oliveira Jack&#10;Service Type: PT School Group&#10;Mandate frequency: 2x/week"></textarea>
      <input id="mfile" type="file" accept="application/pdf,.pdf,text/plain" />
      <label>Assign provider
        <select id="parseProvider">${providerOptions(providers, mandate?.providerId)}</select>
      </label>
      <button class="btn" id="parse">Read mandate PDF (exception)</button>
    </div>
    ${student && mandate ? `
    <div class="card muted-card">
      <h2>Saved student + mandate (exception)</h2>
      <p class="muted">Fix fields here if needed. If the mandate changed on the caseload, re-import the CSV instead.</p>
      <div class="row">
        <label>First name <input id="sf" value="${esc(student.firstName || '')}" /></label>
        <label>Last name <input id="sl" value="${esc(student.lastName || '')}" /></label>
      </div>
      <div class="row">
        <label>Date of birth <input id="sdob" value="${esc(student.dob || '')}" /></label>
        <label>School
          <select id="sschool">${schoolOptions(schools, student.schoolId)}</select>
        </label>
      </div>
      <label>HHA patient id <input id="shha" value="${esc(student.hhaPatientId || '')}" /></label>
      <div class="row">
        <label>Frequency per week <input id="mfreq" value="${esc(mandate.frequencyPerWeek ?? '')}" /></label>
        <label>Service type <input id="msvc" value="${esc(mandate.serviceType || '')}" /></label>
      </div>
      <div class="row">
        <label>Discipline
          <select id="mdisc">
            <option value="PT"${mandate.discipline === 'PT' ? ' selected' : ''}>PT</option>
            <option value="OT"${mandate.discipline === 'OT' ? ' selected' : ''}>OT</option>
            <option value="SLP"${mandate.discipline === 'SLP' ? ' selected' : ''}>SLP</option>
          </select>
        </label>
        <label>Provider
          <select id="mprov">${providerOptions(providers, mandate.providerId)}</select>
        </label>
      </div>
      <div class="row">
        <label>Start on <input id="mstart" value="${esc(mandate.startOn || '')}" /></label>
        <label>End on <input id="mend" value="${esc(mandate.endOn || '')}" /></label>
      </div>
      <button class="btn-primary" id="saveMandate">Save corrections</button>
    </div>` : ''}
  `);

  async function readCaseloadFile() {
    const file = document.getElementById('caseloadFile').files[0];
    if (!file) throw new Error('Choose a CSV file first.');
    const name = file.name || '';
    if (/\.xlsx?$/i.test(name)) {
      throw new Error(
        'Excel .xls/.xlsx cannot be imported. In Excel: File → Save As → CSV (Comma delimited), then upload the .csv.',
      );
    }
    const csvText = await file.text();
    state.caseloadCsvText = csvText;
    return csvText;
  }

  document.getElementById('caseloadPreviewBtn').onclick = async () => {
    try {
      const csvText = await readCaseloadFile();
      const out = await api('POST', '/admin/caseloads/import', {
        csvText,
        dryRun: true,
        fileName: document.getElementById('caseloadFile').files[0]?.name || '',
      });
      state.caseloadPreview = out;
      const errN = (out.errors || []).length;
      setStatus(
        errN
          ? `Preview: ${out.rows?.length || 0} rows, ${errN} row error(s) shown in red.`
          : `Preview: ${out.rows?.length || 0} mandate row(s). Confirm to save.`,
        errN ? 'err' : 'ok',
      );
      await adminMandates();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('caseloadConfirmBtn').onclick = async () => {
    try {
      if (!state.caseloadCsvText) throw new Error('Preview a CSV first.');
      const out = await api('POST', '/admin/caseloads/import', {
        csvText: state.caseloadCsvText,
        confirm: true,
      });
      state.caseloadPreview = out;
      setStatus(
        `Imported ${out.createdMandates || 0} mandate(s), ${out.createdStudents || 0} student(s).`,
        'ok',
      );
      await adminMandates();
    } catch (e) { setStatus(e.message, 'err'); }
  };

  document.getElementById('parse').onclick = async () => {
    try {
      const file = document.getElementById('mfile').files[0];
      const pdfText = document.getElementById('mtext').value;
      const pdfBase64 = await fileToBase64(file);
      const out = await api('POST', '/admin/mandates/parse', {
        pdfText,
        pdfBase64,
        providerId: document.getElementById('parseProvider').value,
      });
      state.mandateDraft = { student: out.student, mandate: out.mandate };
      setStatus(`Saved ${out.student?.firstName || ''} ${out.student?.lastName || ''} · ${out.mandate?.frequencyPerWeek || '?'}x/week`, 'ok');
      await adminMandates();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  const saveBtn = document.getElementById('saveMandate');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      try {
        if (!student?.id || !mandate?.id) throw new Error('Parse a mandate first.');
        const stu = await api('POST', `/admin/students/${student.id}`, {
          firstName: document.getElementById('sf').value,
          lastName: document.getElementById('sl').value,
          dob: document.getElementById('sdob').value,
          schoolId: document.getElementById('sschool').value,
          hhaPatientId: document.getElementById('shha').value,
        });
        const man = await api('POST', `/admin/mandates/${mandate.id}`, {
          frequencyPerWeek: Number(document.getElementById('mfreq').value),
          serviceType: document.getElementById('msvc').value,
          discipline: document.getElementById('mdisc').value,
          providerId: document.getElementById('mprov').value,
          startOn: document.getElementById('mstart').value,
          endOn: document.getElementById('mend').value,
        });
        state.mandateDraft = { student: stu.student, mandate: man.mandate };
        setStatus('Corrections saved.', 'ok');
        await adminMandates();
      } catch (e) { setStatus(e.message, 'err'); }
    };
  }
}

async function adminReports() {
  const missing = await api('GET', '/admin/reports/missing-notes');
  const last = await api('GET', '/admin/reports/last-service');
  const dues = await api('GET', '/admin/reports/due-dates');
  view(`
    <div class="card">
      <h2>Missing notes</h2>
      <table>
        <tr><th>Child</th><th>Date</th><th>Week</th><th>Notes</th></tr>
        ${(missing.rows || []).map((r) => `<tr><td>${esc(r.studentName || r.studentId)}</td><td>${esc(r.date || r.dateOfService || '')}</td><td>${esc(r.weekId || '')}</td><td>${esc(r.notes || '')}</td></tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}
      </table>
      <h2>Last service date</h2>
      <table><tr><th>Child</th><th>Last DOS</th></tr>
      ${(last.rows || []).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.lastDos)}</td></tr>`).join('') || '<tr><td colspan="2">None</td></tr>'}
      </table>
      <h2>Progress / annual / reeval (by school)</h2>
      <table><tr><th>School</th><th>Kind</th><th>Due</th><th>Status</th><th></th></tr>
      ${(dues.rows || []).map((r) => `<tr><td>${esc(r.schoolName || r.schoolId)}</td><td>${esc(r.kind)}</td><td>${esc(r.dueOn)}</td><td>${esc(r.status)}</td><td>${r.completedAt ? '' : `<button class="btn" data-complete="${esc(r.id)}">Mark complete</button>`}</td></tr>`).join('') || '<tr><td colspan="5">None</td></tr>'}
      </table>
    </div>
  `);
  document.getElementById('view').onclick = async (e) => {
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
    <div class="card">
      <h2>Sign in</h2>
      <p>Use the email and password from your White Glove invite email.</p>
      <div id="loginErr" class="err-box" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
      <label>Email <input id="loginEmail" type="email" autocomplete="username" placeholder="you@example.com" /></label>
      <label>Password <input id="loginPassword" type="password" autocomplete="current-password" /></label>
      <button class="btn-primary big" id="loginBtn">Sign in</button>
      <p><button type="button" class="linkish" id="forgotPasswordBtn">Forgot password?</button></p>
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
    <div class="card">
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
    <div class="card">
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
    <div class="card">
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
      <div class="card">
        <h2>Change password</h2>
        <div class="err-box">Sign out and Sign in again, then you can change your password.</div>
        <button type="button" class="btn" id="changePwCancel">Back</button>
      </div>
    `);
    document.getElementById('changePwCancel').onclick = () => showRole();
    return;
  }
  view(`
    <div class="card">
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
  if (screen === 'people') adminPeople();
  if (screen === 'mandates') adminMandates();
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
