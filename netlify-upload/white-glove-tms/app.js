const API = localStorage.getItem('tmsApi') || 'http://127.0.0.1:8787';

const state = {
  role: 'therapist',
  weekId: '',
  weekStart: mondayIso(),
  last: null,
  mandateDraft: null,
};

function mondayIso() {
  const d = new Date();
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function headers() {
  return {
    'content-type': 'application/json',
    'x-tms-role': state.role,
    'x-tms-email': state.role === 'admin' ? 'admin@whiteglove.local' : 'therapist@whiteglove.local',
  };
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('pdf') ? await res.blob() : await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 207)) {
    const msg = data.error || data.errors?.join('; ') || res.statusText;
    throw new Error(msg);
  }
  return data;
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

async function therapistWeek() {
  let banner = '';
  let students = [];
  let weekBlock = '';
  try {
    const me = await api('GET', '/me');
    const dues = (me.dueDates || []).filter((d) => d.status !== 'done');
    const alerts = me.alerts || [];
    if (dues.length || alerts.length) {
      banner = `<div class="warn-box">${[...alerts.map((a) => a.body), ...dues.map((d) => `${d.kind} due ${d.dueOn} (${d.status})`)].map((t) => `<div>${esc(t)}</div>`).join('')}</div>`;
    }
  } catch {
    banner = '';
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
      state.weekId = data.week.id;
      const warnings = data.warnings || [];
      const errors = data.errors || [];
      const sessions = data.sessions || [];
      weekBlock = `
        <div class="card">
          <h3>Week status: ${esc(data.week.status)}</h3>
          ${errors.length ? `<div class="err-box">${errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
          ${warnings.length ? `<div class="warn-box">${warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
          <table>
            <tr><th>Date</th><th>Child</th><th>Time</th><th>Attendance</th><th>Notes</th></tr>
            ${sessions.map((s) => {
              const name = studentName(data.students || students, s.studentId);
              const time = [s.beginTime, s.endTime].filter(Boolean).join(' – ');
              return `<tr><td>${esc(s.dateOfService)}</td><td>${esc(name)}</td><td>${esc(time)}</td><td>${esc(s.attendance)}</td><td>${esc(s.notes || '')}</td></tr>`;
            }).join('') || '<tr><td colspan="5">No sessions yet.</td></tr>'}
          </table>
        </div>`;
    }
  } catch {
    weekBlock = '';
  }
  view(`
    <div class="card">
      <h2>This week</h2>
      ${banner}
      <p>Upload the service notes PDF, or add a row. Over-mandate is blocked. Under-mandate is a warning.</p>
      <label>Week starting (Monday)
        <input id="weekStart" value="${esc(state.weekStart)}" />
      </label>
      <button class="btn-primary big" id="ensure">Open this week</button>
    </div>
    ${weekBlock}
    <div class="card">
      <h3>Upload notes PDF or paste text</h3>
      <input id="pdfFile" type="file" accept="application/pdf,.pdf,text/plain" />
      <textarea id="pdfText" rows="8" placeholder="Student Name: ...&#10;09/01/2026 9:00 am 9:30 am Service Provided: ..."></textarea>
      <button class="btn big" id="upload">Read notes into this week</button>
    </div>
    <div class="card">
      <h3>Add one session</h3>
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
            <option>attended</option>
            <option>missed</option>
            <option>makeup</option>
          </select>
        </label>
        <label id="makeupWrap" hidden>Makeup of missed
          <select id="makeupOf"><option value="">Select missed session</option></select>
        </label>
      </div>
      <label>Notes <textarea id="notes" rows="3"></textarea></label>
      <button class="btn" id="add">Save session</button>
    </div>
  `);
  bindMakeupPickers();
  document.getElementById('ensure').onclick = async () => {
    try {
      state.weekStart = document.getElementById('weekStart').value;
      const me = await api('GET', '/me');
      const providerId = me.provider?.id;
      const out = await api('POST', '/week/ensure', { weekStart: state.weekStart, providerId });
      state.weekId = out.week.id;
      setStatus('Week open. Status: ' + out.week.status, 'ok');
      await therapistWeek();
    } catch (e) {
      setStatus(e.message, 'err');
    }
  };
  document.getElementById('upload').onclick = async () => {
    try {
      const me = await api('GET', '/me');
      const file = document.getElementById('pdfFile').files[0];
      const pdfText = document.getElementById('pdfText').value;
      const pdfBase64 = await fileToBase64(file);
      const out = await api('POST', '/week/upload-sessions', {
        weekStart: document.getElementById('weekStart').value,
        providerId: me.provider?.id,
        pdfText,
        pdfBase64,
      });
      state.weekId = out.week.id;
      state.weekStart = document.getElementById('weekStart').value;
      setStatus(`Loaded ${out.parsed} session(s). ${out.warnings?.length ? out.warnings.join(' ') : ''}`, out.warnings?.length ? '' : 'ok');
      await therapistWeek();
    } catch (e) {
      setStatus(e.message, 'err');
    }
  };
  document.getElementById('add').onclick = async () => {
    try {
      if (!state.weekId) throw new Error('Open the week first.');
      await api('POST', '/week/sessions', {
        weekId: state.weekId,
        studentId: document.getElementById('studentId').value,
        dateOfService: document.getElementById('dos').value,
        beginTime: document.getElementById('beginTime').value,
        endTime: document.getElementById('endTime').value,
        attendance: document.getElementById('att').value,
        makeupOfSessionId: document.getElementById('makeupOf').value,
        notes: document.getElementById('notes').value,
      });
      setStatus('Session saved.', 'ok');
      await therapistWeek();
    } catch (e) {
      setStatus(e.message, 'err');
    }
  };
}

async function therapistFix() {
  if (!state.weekId) {
    view('<div class="card">Open a week first.</div>');
    return;
  }
  const data = await api('GET', `/week?weekStart=${encodeURIComponent(state.weekStart)}`);
  const sessions = data.sessions || [];
  const errors = data.errors || [];
  const warnings = data.warnings || [];
  view(`
    <div class="card">
      <h2>Fix errors</h2>
      <p>Red = cannot send. Yellow = you can still send.</p>
      ${errors.length ? `<div class="err-box"><strong>Cannot send.</strong>${errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
      ${warnings.length ? `<div class="warn-box">${warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
      <table>
        <tr><th>Date</th><th>Child</th><th>Attendance</th><th>Flags</th><th>Notes</th></tr>
        ${sessions.map((s) => {
          const name = studentName(data.students, s.studentId);
          const flags = s.aiFlags || [];
          const rowClass = flags.length ? 'warn' : '';
          return `<tr class="${rowClass}">
            <td>${esc(s.dateOfService)}</td>
            <td>${esc(name)}</td>
            <td>${esc(s.attendance)}</td>
            <td>${flags.length ? `<span class="pill-warn">${esc(flags.join('; '))}</span>` : ''}</td>
            <td>
              <textarea data-notes="${esc(s.id)}" rows="2">${esc(s.notes || '')}</textarea>
              <button class="btn" data-save-notes="${esc(s.id)}" data-week="${esc(s.weekId)}">Save notes</button>
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="5">No sessions.</td></tr>'}
      </table>
      <p><button class="btn" id="screen">Screen notes</button></p>
    </div>
  `);
  document.getElementById('screen').onclick = async () => {
    try {
      for (const s of sessions) {
        if (s.attendance === 'missed') continue;
        await api('POST', `/sessions/${s.id}/ai-screen`, {});
      }
      setStatus('Notes screened. Warnings only — over-mandate is still a hard stop.', 'ok');
      therapistFix();
    } catch (e) {
      setStatus(e.message, 'err');
    }
  };
  document.getElementById('view').onclick = async (e) => {
    const btn = e.target.closest('[data-save-notes]');
    if (!btn) return;
    try {
      const id = btn.getAttribute('data-save-notes');
      const notes = document.querySelector(`[data-notes="${id}"]`)?.value || '';
      await api('POST', '/week/sessions', { id, weekId: btn.getAttribute('data-week') || state.weekId, notes });
      setStatus('Notes saved.', 'ok');
      therapistFix();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  };
}

async function therapistSend() {
  view(`
    <div class="card">
      <h2>Send timesheet</h2>
      <p>This emails the person entered as signer (not always the principal).</p>
      <label>Signer name <input id="signerName" /></label>
      <label>Signer email <input id="signerEmail" /></label>
      <button class="btn-primary big" id="submit">Submit week</button>
      <button class="btn big" id="pdf">Download timesheet PDF</button>
    </div>
  `);
  document.getElementById('submit').onclick = async () => {
    try {
      if (!state.weekId) throw new Error('Open a week first.');
      const out = await api('POST', `/weeks/${state.weekId}/submit`, {
        signerName: document.getElementById('signerName').value,
        signerEmail: document.getElementById('signerEmail').value,
      });
      state.last = out;
      setStatus(out.message || 'Submitted.', 'ok');
    } catch (e) {
      setStatus(e.message, 'err');
    }
  };
  document.getElementById('pdf').onclick = async () => {
    try {
      if (!state.weekId) throw new Error('Open a week first.');
      const res = await fetch(`${API}/weeks/${state.weekId}/timesheet`, { headers: headers() });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'timesheet.pdf';
      a.click();
    } catch (e) {
      setStatus(e.message, 'err');
    }
  };
}

function therapistDone() {
  const msg = state.last?.therapistMessage || state.last?.message || 'When the admin marks the timesheet signed, this week locks and you will be paid.';
  view(`<div class="card"><div class="ok-box">${esc(msg)}</div><p>You cannot edit a locked week. An admin can reopen it if something was wrong.</p></div>`);
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
  view(`
    <div class="card">
      <h2>People</h2>
      <h3>Logins</h3>
      <table>
        <tr><th>Name</th><th>Email</th><th>Role</th><th>Provider</th></tr>
        ${users.map((u) => {
          const p = providers.find((x) => x.id === u.providerId);
          const pname = p ? `${p.firstName} ${p.lastName}` : (u.providerId || '—');
          return `<tr><td>${esc(u.displayName)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(pname)}</td></tr>`;
        }).join('') || '<tr><td colspan="4">None</td></tr>'}
      </table>
      <h3>Providers</h3>
      <table>
        <tr><th>Name</th><th>Discipline</th><th>Pay rate</th></tr>
        ${providers.map((p) => `<tr><td>${esc(`${p.firstName} ${p.lastName}`)}</td><td>${esc(p.discipline)}</td><td>${esc(p.payRate ?? '')}</td></tr>`).join('') || '<tr><td colspan="3">None</td></tr>'}
      </table>
      <h3>Schools</h3>
      <table>
        <tr><th>School</th><th>Signer</th></tr>
        ${schools.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.signerName || s.signerEmail || '')}</td></tr>`).join('') || '<tr><td colspan="2">None</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h2>Create therapist login</h2>
      <label>Email <input id="email" /></label>
      <label>Name <input id="dname" /></label>
      <label>Link to provider
        <select id="inviteProvider">${providerOptions(providers)}</select>
      </label>
      <button class="btn-primary" id="invite">Create login</button>
    </div>
    <div class="card">
      <h2>School signer (entered, not always principal)</h2>
      <label>School <input id="sname" /></label>
      <label>Signer name <input id="signerName" /></label>
      <label>Signer email <input id="signerEmail" /></label>
      <button class="btn" id="school">Save school</button>
    </div>
    <div class="card">
      <h2>Provider + pay rate</h2>
      <div class="row">
        <label>First <input id="pf" /></label>
        <label>Last <input id="pl" /></label>
      </div>
      <div class="row">
        <label>Discipline
          <select id="disc"><option>PT</option><option>OT</option><option>SLP</option></select>
        </label>
        <label>Pay rate <input id="rate" value="72" /></label>
      </div>
      <label>Therapist email (creates or links login)
        <input id="pemail" placeholder="therapist@whiteglove.local" />
      </label>
      <button class="btn" id="prov">Save provider</button>
    </div>
    <div class="card">
      <h2>Internal provider note</h2>
      <label>Provider
        <select id="npid">${providerOptions(providers)}</select>
      </label>
      <label>Note <textarea id="nbody" rows="3"></textarea></label>
      <button class="btn" id="nadd">Add note</button>
    </div>
  `);
  document.getElementById('invite').onclick = async () => {
    try {
      await api('POST', '/admin/users', {
        email: document.getElementById('email').value,
        displayName: document.getElementById('dname').value,
        role: 'therapist',
        providerId: document.getElementById('inviteProvider').value,
      });
      setStatus('Therapist login created.', 'ok');
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
  document.getElementById('prov').onclick = async () => {
    try {
      const out = await api('POST', '/admin/providers', {
        firstName: document.getElementById('pf').value,
        lastName: document.getElementById('pl').value,
        discipline: document.getElementById('disc').value,
        payRate: Number(document.getElementById('rate').value),
        email: document.getElementById('pemail').value,
      });
      setStatus('Provider saved' + (out.user ? ` and linked to ${out.user.email}` : '') + '.', 'ok');
      await adminPeople();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('nadd').onclick = async () => {
    try {
      const id = document.getElementById('npid').value;
      if (!id) throw new Error('Pick a provider.');
      await api('POST', `/admin/providers/${id}/notes`, { body: document.getElementById('nbody').value });
      setStatus('Note saved (hidden from therapist).', 'ok');
    } catch (e) { setStatus(e.message, 'err'); }
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
  view(`
    <div class="card">
      <h2>Mandate PDF (parsed the first time, then saved)</h2>
      <textarea id="mtext" rows="10" placeholder="Child's Name: De Oliveira Jack&#10;Service Type: PT School Group&#10;Mandate frequency: 2x/week"></textarea>
      <input id="mfile" type="file" accept="application/pdf,.pdf,text/plain" />
      <label>Assign provider
        <select id="parseProvider">${providerOptions(providers, mandate?.providerId)}</select>
      </label>
      <button class="btn-primary big" id="parse">Read mandate PDF</button>
    </div>
    ${student && mandate ? `
    <div class="card">
      <h2>Saved student + mandate</h2>
      <p>Fix fields here. Re-upload the PDF if the mandate itself changed.</p>
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
    <div class="card">
      <h2>Due date (typed in)</h2>
      <label>Student
        <select id="sid">${studentOptions(students)}</select>
      </label>
      <label>Kind
        <select id="kind"><option>progress</option><option>annual</option><option>reeval</option></select>
      </label>
      <label>Due on (YYYY-MM-DD) <input id="due" /></label>
      <button class="btn" id="duebtn">Save due date</button>
    </div>
    <div class="card">
      <h2>Student locker file</h2>
      <label>Student
        <select id="fsid">${studentOptions(students)}</select>
      </label>
      <label>Label <input id="flabel" value="IEP / mandate PDF" /></label>
      <input id="ffile" type="file" accept="application/pdf,.pdf" />
      <button class="btn" id="filebtn">Attach to locker</button>
    </div>
  `);
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
  document.getElementById('duebtn').onclick = async () => {
    try {
      await api('POST', '/admin/due-dates', {
        studentId: document.getElementById('sid').value,
        kind: document.getElementById('kind').value,
        dueOn: document.getElementById('due').value,
      });
      setStatus('Due date saved. Alerts stay until marked complete.', 'ok');
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('filebtn').onclick = async () => {
    try {
      const file = document.getElementById('ffile').files[0];
      const pdfBase64 = await fileToBase64(file);
      await api('POST', '/files', {
        studentId: document.getElementById('fsid').value,
        label: document.getElementById('flabel').value,
        kind: 'locker',
        pdfBase64,
      });
      setStatus('File recorded on the student locker.', 'ok');
    } catch (e) { setStatus(e.message, 'err'); }
  };
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
      <h2>Progress / annual / reeval</h2>
      <table><tr><th>Child</th><th>Kind</th><th>Due</th><th>Status</th><th></th></tr>
      ${(dues.rows || []).map((r) => `<tr><td>${esc(r.studentName)}</td><td>${esc(r.kind)}</td><td>${esc(r.dueOn)}</td><td>${esc(r.status)}</td><td>${r.completedAt ? '' : `<button class="btn" data-complete="${esc(r.id)}">Mark complete</button>`}</td></tr>`).join('') || '<tr><td colspan="5">None</td></tr>'}
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

function showRole() {
  const admin = state.role === 'admin';
  document.getElementById('adminNav').hidden = !admin;
  document.getElementById('therapistNav').hidden = admin;
  document.getElementById('whoami').textContent = admin ? 'Admin' : 'Therapist';
  if (admin) adminDash();
  else therapistWeek();
}

document.getElementById('role').onchange = (e) => {
  state.role = e.target.value;
  showRole();
};

document.getElementById('therapistNav').onclick = (e) => {
  const btn = e.target.closest('[data-screen]');
  if (!btn) return;
  document.querySelectorAll('#therapistNav .nav').forEach((b) => b.classList.toggle('on', b === btn));
  const screen = btn.getAttribute('data-screen');
  if (screen === 'week') therapistWeek();
  if (screen === 'fix') therapistFix();
  if (screen === 'send') therapistSend();
  if (screen === 'done') therapistDone();
};

document.getElementById('adminNav').onclick = (e) => {
  const btn = e.target.closest('[data-admin]');
  if (!btn) return;
  document.querySelectorAll('#adminNav .nav').forEach((b) => b.classList.toggle('on', b === btn));
  const screen = btn.getAttribute('data-admin');
  if (screen === 'dash') adminDash();
  if (screen === 'people') adminPeople();
  if (screen === 'mandates') adminMandates();
  if (screen === 'reports') adminReports();
};

showRole();
