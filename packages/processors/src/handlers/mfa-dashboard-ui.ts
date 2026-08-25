/** HTML ops dashboard (MFA + Test live report picker). Served by mfa-dashboard-api. */

export function renderDashboardHtml(options: {
  apiBase: string;
  key: string;
  consoleUrl?: string;
}): string {
  const { apiBase, key, consoleUrl = '' } = options;
  const keyJson = JSON.stringify(key);
  const apiJson = JSON.stringify(apiBase);
  const consoleJson = JSON.stringify(consoleUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>White Glove — Ops Dashboard</title>
<style>
:root{--bg:#0f172a;--card:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--accent:#0d9488;--warn:#f59e0b;--danger:#ef4444;--ok:#22c55e;--border:#334155}
*{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,system-ui,Segoe UI,sans-serif;background:linear-gradient(160deg,#0f172a,#134e4a 120%);color:var(--text);min-height:100vh}
main{max-width:52rem;margin:0 auto;padding:1.5rem}
h1{font-size:1.5rem;margin:0 0 .25rem}
.sub{color:var(--muted);margin:0 0 1.25rem;font-size:.95rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.1rem 1.25rem;margin-bottom:1rem}
.card h2{margin:0 0 .75rem;font-size:1.1rem}
.row{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center}
.btn{appearance:none;border:0;border-radius:8px;padding:.55rem 1rem;font-weight:600;cursor:pointer;font-size:.95rem}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--accent);color:#042f2e}
.btn-warn{background:var(--warn);color:#1c1917}
.btn-ghost{background:transparent;color:var(--text);border:1px solid var(--border)}
.badge{display:inline-block;padding:.15rem .5rem;border-radius:999px;font-size:.75rem;font-weight:600}
.badge-ok{background:#14532d;color:#bbf7d0}
.badge-bad{background:#7f1d1d;color:#fecaca}
.muted{color:var(--muted);font-size:.85rem}
label.report{display:grid;grid-template-columns:auto 1fr;gap:.35rem 0.75rem;align-items:start;padding:.65rem 0;border-top:1px solid var(--border)}
label.report:first-of-type{border-top:0}
label.report .dates{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;grid-column:2}
label.report input[type=checkbox]{margin-top:.35rem}
input[type=date]{background:#0f172a;border:1px solid var(--border);color:var(--text);border-radius:6px;padding:.3rem .45rem}
#livePanel{display:none}
#livePanel.open{display:block}
#msg{white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:.8rem;background:#0f172a;border-radius:8px;padding:.75rem;margin-top:.75rem;display:none}
#msg.show{display:block}
.warn-banner{background:#422006;border:1px solid #b45309;color:#fde68a;padding:.65rem .8rem;border-radius:8px;margin-bottom:.85rem;font-size:.9rem}
</style>
</head>
<body>
<main>
  <h1>White Glove ops</h1>
  <p class="sub">MFA renew · week stats · <strong>Test live</strong> (picker — does not enable nightly cron)</p>

  <section class="card" id="statusCard">
    <h2>HHA MFA status</h2>
    <div class="row" id="mfaStatus"><span class="muted">Loading…</span></div>
    <div class="row" style="margin-top:.75rem">
      <button class="btn btn-primary" type="button" id="btnMfaStart">Start MFA renew</button>
      <input id="otp" placeholder="OTP code" style="background:#0f172a;border:1px solid var(--border);color:var(--text);border-radius:6px;padding:.45rem .6rem;width:8rem"/>
      <button class="btn btn-ghost" type="button" id="btnMfaComplete">Complete</button>
    </div>
    <p class="muted" id="mfaSession" style="margin:.5rem 0 0"></p>
  </section>

  <section class="card">
    <h2>Pipeline</h2>
    <div class="row">
      <button class="btn btn-warn" type="button" id="btnTestLive">Test live</button>
      <a class="btn btn-ghost" id="lnkConsole" href="#" target="_blank" rel="noopener">Step Functions</a>
    </div>
    <div id="livePanel">
      <div class="warn-banner" style="margin-top:1rem">
        Live run: <code>dryRun=false</code>, <code>sandbox=false</code> — writes to production HHA.
        Only selected reports download. Nightly EventBridge schedules stay OFF.
      </div>
      <label class="report"><input type="checkbox" data-kind="opened_cases"/><span><strong>Gluck open</strong> <span class="muted">(Date of Intake)</span>
        <span class="dates">From <input type="date" data-from="opened_cases"/> To <input type="date" data-to="opened_cases"/></span></span></label>
      <label class="report"><input type="checkbox" data-kind="new_services"/><span><strong>New services</strong> <span class="muted">(Service Begin Date)</span>
        <span class="dates">From <input type="date" data-from="new_services"/> To <input type="date" data-to="new_services"/></span></span></label>
      <label class="report"><input type="checkbox" data-kind="closed_cases"/><span><strong>Gluck closure</strong> <span class="muted">(Closure Date)</span>
        <span class="dates">From <input type="date" data-from="closed_cases"/> To <input type="date" data-to="closed_cases"/></span></span></label>
      <label class="report"><input type="checkbox" data-kind="discharge_service"/><span><strong>Discharge service</strong> <span class="muted">(Service Discharge Date)</span>
        <span class="dates">From <input type="date" data-from="discharge_service"/> To <input type="date" data-to="discharge_service"/></span></span></label>
      <label class="report"><input type="checkbox" data-kind="verified_sessions" checked/><span><strong>API Report</strong> <span class="muted">(Verified Date — visits)</span>
        <span class="dates">From <input type="date" data-from="verified_sessions"/> To <input type="date" data-to="verified_sessions"/></span></span></label>
      <label class="report"><input type="checkbox" data-kind="caregiver_codes" checked/><span><strong>Caregiver codes</strong> <span class="muted">(reference — dates ignored)</span>
        <span class="dates muted">No date filter on this report</span></span></label>
      <div class="row" style="margin-top:1rem">
        <button class="btn btn-warn" type="button" id="btnStartLive">Start live run</button>
        <button class="btn btn-ghost" type="button" id="btnPresetSessions">Preset: sessions only</button>
      </div>
    </div>
    <div id="msg"></div>
  </section>

  <section class="card">
    <h2>Last week summary</h2>
    <div id="week" class="muted">Loading…</div>
  </section>
</main>
<script>
(function(){
  const KEY = ${keyJson};
  const API = ${apiJson};
  const CONSOLE = ${consoleJson};
  let sessionId = null;

  function qs(action){ return API + (API.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY) + '&action=' + action; }
  function show(msg, ok){ const el=document.getElementById('msg'); el.className='show'; el.style.color = ok===false ? 'var(--danger)' : 'var(--ok)'; el.textContent = typeof msg==='string'?msg:JSON.stringify(msg,null,2); }
  async function api(action, opts){
    const r = await fetch(qs(action), Object.assign({ headers: { 'content-type': 'application/json', 'x-dashboard-key': KEY, 'accept': 'application/json' } }, opts||{}));
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!r.ok) throw new Error(body.error || text || ('HTTP '+r.status));
    return body;
  }

  function iso(d){ return d.toISOString().slice(0,10); }
  function easternParts(d){
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(d);
    const g = t => Number(parts.find(p=>p.type===t).value);
    return {y:g('year'),m:g('month'),day:g('day')};
  }
  function easternDate(d){ const p=easternParts(d); return new Date(Date.UTC(p.y,p.m-1,p.day)); }
  function addDays(d,n){ const x=new Date(d.getTime()); x.setUTCDate(x.getUTCDate()+n); return x; }
  function tueMon(business){
    const dow = business.getUTCDay();
    const daysSinceTue = (dow + 5) % 7;
    const from = addDays(business, -daysSinceTue);
    return { from: iso(from), to: iso(addDays(from, 6)) };
  }
  function fillDefaults(){
    const today = easternDate(new Date());
    const todayIso = iso(today);
    const nsFrom = iso(addDays(today, -14));
    const sessions = tueMon(today);
    const map = {
      opened_cases: [todayIso, todayIso],
      closed_cases: [todayIso, todayIso],
      discharge_service: [todayIso, todayIso],
      new_services: [nsFrom, todayIso],
      verified_sessions: [sessions.from, sessions.to],
    };
    for (const [kind,[f,t]] of Object.entries(map)){
      const fromEl = document.querySelector('input[data-from="'+kind+'"]');
      const toEl = document.querySelector('input[data-to="'+kind+'"]');
      if (fromEl && !fromEl.value) fromEl.value = f;
      if (toEl && !toEl.value) toEl.value = t;
    }
  }

  document.getElementById('btnTestLive').onclick = () => {
    document.getElementById('livePanel').classList.toggle('open');
  };
  document.getElementById('btnPresetSessions').onclick = () => {
    document.querySelectorAll('input[data-kind]').forEach(cb => {
      cb.checked = cb.getAttribute('data-kind') === 'verified_sessions' || cb.getAttribute('data-kind') === 'caregiver_codes';
    });
  };

  document.getElementById('btnStartLive').onclick = async () => {
    try {
      const reportKinds = [];
      const dateRanges = {};
      document.querySelectorAll('input[data-kind]').forEach(cb => {
        if (!cb.checked) return;
        const kind = cb.getAttribute('data-kind');
        reportKinds.push(kind);
        const fromEl = document.querySelector('input[data-from="'+kind+'"]');
        const toEl = document.querySelector('input[data-to="'+kind+'"]');
        if (fromEl && toEl && fromEl.value && toEl.value) {
          dateRanges[kind] = { from: fromEl.value, to: toEl.value };
        }
      });
      if (!reportKinds.length) throw new Error('Select at least one report');
      const body = await api('startLiveRun', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'LIVE', reportKinds, dateRanges }),
      });
      show(body, true);
    } catch (e) { show(String(e.message||e), false); }
  };

  document.getElementById('btnMfaStart').onclick = async () => {
    try {
      const body = await api('start', { method: 'POST', body: '{}' });
      sessionId = body.sessionId || null;
      document.getElementById('mfaSession').textContent = sessionId ? ('Session: ' + sessionId) : JSON.stringify(body);
      show(body, true);
    } catch (e) { show(String(e.message||e), false); }
  };
  document.getElementById('btnMfaComplete').onclick = async () => {
    try {
      const otp = document.getElementById('otp').value.trim();
      if (!sessionId || !otp) throw new Error('Need MFA session + OTP');
      const body = await api('complete', { method: 'POST', body: JSON.stringify({ sessionId, otp }) });
      show(body, true);
      loadStatus();
    } catch (e) { show(String(e.message||e), false); }
  };

  async function loadStatus(){
    try {
      const s = await api('status');
      const ok = s.cookiesPresent || s.hasCookies || s.ok;
      document.getElementById('mfaStatus').innerHTML =
        '<span class="badge '+(ok?'badge-ok':'badge-bad')+'">'+(ok?'cookies OK':'needs MFA')+'</span>' +
        '<span class="muted">'+(s.message || s.status || '')+'</span>';
    } catch (e) {
      document.getElementById('mfaStatus').innerHTML = '<span class="badge badge-bad">error</span> <span class="muted">'+String(e.message||e)+'</span>';
    }
  }
  async function loadWeek(){
    try {
      const w = await api('weekSummary');
      document.getElementById('week').textContent = JSON.stringify({ window: w.window, counts: w.counts, runIds: w.runIds }, null, 2);
    } catch (e) {
      document.getElementById('week').textContent = String(e.message||e);
    }
  }

  if (CONSOLE) {
    const a = document.getElementById('lnkConsole');
    a.href = CONSOLE;
  } else {
    document.getElementById('lnkConsole').style.display = 'none';
  }
  fillDefaults();
  loadStatus();
  loadWeek();
})();
</script>
</body>
</html>`;
}