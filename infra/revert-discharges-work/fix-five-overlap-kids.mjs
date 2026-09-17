/**
 * Fix the five new_services placement-overlap kids:
 * 1) Live inventory (GetPatientContracts PatientID-only = all statuses)
 * 2) If mistaken NEW #8596xxx still ACTIVE → DISCHARGE via UpdatePatientContract
 * 3) If OLD still discharged → try clear DischargeDate (no AddPatientContract)
 *
 * Usage (PowerShell):
 *   $env:HHA_ALLOW_PRODUCTION='true'
 *   node infra/revert-discharges-work/fix-five-overlap-kids.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}
if (String(process.env.HHA_ALLOW_PRODUCTION || '').toLowerCase() !== 'true') {
  console.error('Set HHA_ALLOW_PRODUCTION=true');
  process.exit(1);
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = process.env.HHA_BASE_URL || 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');
const OUT = path.join(repoRoot, 'infra', 'revert-discharges-work');
mkdirSync(OUT, { recursive: true });

const TODAY = new Date().toISOString().slice(0, 10); // UTC date for discharge stamp
const DISCHARGE_NOTE = 'Ops cleanup: discharge mistaken duplicate placement from new_services overlap remediation';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(method, inner, { xsi } = {}) {
  const xsiDecl = xsi ? ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' : '';
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"${xsiDecl}><soap:Body>
<${method} xmlns="${NS}"><Authentication><AppName>${esc(APP)}</AppName><AppSecret>${esc(SECRET)}</AppSecret><AppKey>${esc(KEY)}</AppKey></Authentication>${inner}</${method}>
</soap:Body></soap:Envelope>`;
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/${method}"`,
    },
    body,
  });
  const xml = await res.text();
  return {
    http: res.status,
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '',
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}

function ok(r) {
  return r.status?.toLowerCase() === 'success' || r.eid === '0';
}

function placements(xml) {
  const out = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const placementId = block.match(/<PlacementID>([^<]*)/)?.[1];
    if (!placementId) continue;
    const dm = block.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i);
    out.push({
      placementId,
      contractId: block.match(/<Contract>\s*<ID>(\d+)/i)?.[1],
      contractName: block.match(/<Contract>[\s\S]*?<Name>([^<]*)/i)?.[1],
      svc: block.match(/<ServiceCode>\s*<ID>(\d+)/i)?.[1],
      svcName: block.match(/<ServiceCode>[\s\S]*?<Name>([^<]*)/i)?.[1],
      start: block.match(/<ServiceStartDate>([^<]*)/)?.[1],
      disc: (dm?.[1] ?? '').trim(),
      active: !(dm?.[1] ?? '').trim(),
    });
  }
  return out;
}

function summarizePlacements(pls) {
  return (pls || []).map((p) => ({
    placementId: p.placementId,
    state: p.disc ? `DISCHARGED ${p.disc}` : 'ACTIVE',
    start: p.start,
    svc: p.svcName || p.svc,
    contract: p.contractName || p.contractId,
  }));
}

const TARGETS = [
  {
    name: 'Edmund Picciuto',
    caseId: '258272446',
    patientId: '26372249',
    oldPlacementId: '8522217',
    newPlacementId: '8596091',
    searchHints: [
      { first: 'EDMUND', last: 'PICCIUTO' },
      { first: 'Edmund', last: 'Picciuto' },
      { admission: '258272446' },
      { mr: '258272446' },
    ],
  },
  {
    name: 'Fiona Downs',
    caseId: '258270803',
    patientId: '24865860',
    oldPlacementId: '8045831',
    newPlacementId: '8596095',
  },
  {
    name: 'Helena Galeanocarvajal',
    caseId: '04725821',
    patientId: '23012434',
    oldPlacementId: '6897698',
    newPlacementId: '8596089',
    altCaseIds: ['4725821'],
  },
  {
    name: 'Hooria Arshad',
    caseId: '02891799',
    patientId: '22854608',
    oldPlacementId: '6812439',
    newPlacementId: '8596053',
    altCaseIds: ['2891799'],
  },
  {
    name: 'Karlandrew Navelgas',
    caseId: '258267421',
    patientId: '22680255',
    oldPlacementId: '6711683',
    newPlacementId: '8596097',
  },
];

async function loadDischargeRefs() {
  const to = await call('GetPatientDischargeTo', '<Status>Active</Status>');
  const reasons = await call('GetContractDischargeReason', '<Status>Active</Status>');
  const toIds = [
    ...to.xml.matchAll(/<(?:ID|DischargeToID|PatientDischargeToID)>(\d+)/gi),
  ].map((m) => m[1]);
  const reasonIds = [...reasons.xml.matchAll(/<ReasonID>(\d+)/gi)].map((m) => m[1]);
  const envTo = process.env.HHA_DISCHARGE_TO_ID?.trim();
  const envReason = process.env.HHA_DISCHARGE_REASON_ID?.trim();
  return {
    // 341 = Admin Discharge (known-good for this agency)
    toId: envTo || toIds.find((id) => id !== '0') || toIds[0] || '341',
    reasonId: envReason || reasonIds[0] || '36883',
  };
}

async function getContracts(patientId) {
  // PatientID-only returns discharged + active (VisitDate often hides discharged).
  const r = await call('GetPatientContracts', `<PatientID>${esc(patientId)}</PatientID>`);
  return { result: r, placements: placements(r.xml) };
}

async function searchPatient(t) {
  const attempts = [];
  const filters = [];
  if (t.searchHints) {
    for (const h of t.searchHints) {
      if (h.first || h.last) {
        filters.push({
          how: `name ${h.first} ${h.last}`,
          xml: `<FirstName>${esc(h.first || '')}</FirstName><LastName>${esc(h.last || '')}</LastName><Status>All</Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN>`,
        });
      }
      if (h.admission) {
        filters.push({
          how: `admission ${h.admission}`,
          xml: `<FirstName></FirstName><LastName></LastName><Status>All</Status><PhoneNumber></PhoneNumber><AdmissionID>${esc(h.admission)}</AdmissionID><MRNumber></MRNumber><SSN></SSN>`,
        });
      }
      if (h.mr) {
        filters.push({
          how: `mr ${h.mr}`,
          xml: `<FirstName></FirstName><LastName></LastName><Status>All</Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber>${esc(h.mr)}</MRNumber><SSN></SSN>`,
        });
      }
    }
  }
  const nameParts = t.name.split(/\s+/);
  const first = nameParts[0];
  const last = nameParts.slice(1).join(' ');
  filters.push({
    how: `name Status=All ${t.name}`,
    xml: `<FirstName>${esc(first)}</FirstName><LastName>${esc(last)}</LastName><Status>All</Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber></MRNumber><SSN></SSN>`,
  });
  for (const cid of [t.caseId, ...(t.altCaseIds || [])]) {
    filters.push({
      how: `admission Status=All ${cid}`,
      xml: `<FirstName></FirstName><LastName></LastName><Status>All</Status><PhoneNumber></PhoneNumber><AdmissionID>${esc(cid)}</AdmissionID><MRNumber></MRNumber><SSN></SSN>`,
    });
    filters.push({
      how: `mr Status=All ${cid}`,
      xml: `<FirstName></FirstName><LastName></LastName><Status>All</Status><PhoneNumber></PhoneNumber><AdmissionID></AdmissionID><MRNumber>${esc(cid)}</MRNumber><SSN></SSN>`,
    });
  }

  for (const f of filters) {
    const r = await call('SearchPatients', `<SearchFilters>${f.xml}</SearchFilters>`);
    const ids = [...new Set([...r.xml.matchAll(/<PatientID>(\d+)/g)].map((m) => m[1]))];
    attempts.push({ how: f.how, ok: ok(r), eid: r.eid, msg: r.msg, ids });
    if (ids.length === 1) return { patientId: ids[0], attempts };
    if (ids.length > 1) return { patientId: null, ambiguous: ids, attempts };
  }
  return { patientId: null, attempts };
}

async function dischargePlacement(patientId, placementId, refs) {
  const xml = `<PatientContractInfo>
  <PatientID>${esc(patientId)}</PatientID>
  <PlacementID>${esc(placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>${esc(TODAY)}</DischargeDate>
  <DischargeToID>${esc(refs.toId || '0')}</DischargeToID>
  <DischargeReasonID>${esc(refs.reasonId || '0')}</DischargeReasonID>
  <DischargeNote>${esc(DISCHARGE_NOTE)}</DischargeNote>
</PatientContractInfo>`;
  const r = await call('UpdatePatientContract', xml);
  return { ok: ok(r), eid: r.eid, msg: r.msg, status: r.status, http: r.http, fault: r.fault };
}

/**
 * Try to clear DischargeDate on OLD placement.
 * Prefer variants that previously got past -315 once NEW is gone (Solomon-style).
 */
async function tryReactivateOld(patientId, placementId, refs) {
  const variants = [
    {
      label: 'Solomon-style: UpdateDischargeDate true + reason + note (omit date)',
      xml: `<PatientContractInfo>
  <PatientID>${esc(patientId)}</PatientID>
  <PlacementID>${esc(placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeReasonID>${esc(refs.reasonId || '0')}</DischargeReasonID>
  <DischargeNote>Revert mistaken auto discharge — reactivate original placement</DischargeNote>
</PatientContractInfo>`,
    },
    {
      label: 'UpdateDischargeDate true + reason/to (omit date)',
      xml: `<PatientContractInfo>
  <PatientID>${esc(patientId)}</PatientID>
  <PlacementID>${esc(placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeToID>${esc(refs.toId || '0')}</DischargeToID>
  <DischargeReasonID>${esc(refs.reasonId || '0')}</DischargeReasonID>
  <DischargeNote>Revert mistaken auto discharge — reactivate original placement</DischargeNote>
</PatientContractInfo>`,
    },
    {
      label: 'xsi:nil DischargeDate + reason/to',
      xsi: true,
      xml: `<PatientContractInfo>
  <PatientID>${esc(patientId)}</PatientID>
  <PlacementID>${esc(placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate xsi:nil="true" />
  <DischargeToID>${esc(refs.toId || '0')}</DischargeToID>
  <DischargeReasonID>${esc(refs.reasonId || '0')}</DischargeReasonID>
  <DischargeNote>Revert mistaken auto discharge — reactivate original placement</DischargeNote>
</PatientContractInfo>`,
    },
  ];

  const tried = [];
  for (const v of variants) {
    const r = await call('UpdatePatientContract', v.xml, { xsi: v.xsi });
    tried.push({
      label: v.label,
      ok: ok(r),
      eid: r.eid,
      msg: r.msg,
      fault: r.fault,
      status: r.status,
      http: r.http,
    });
    if (ok(r)) return { ok: true, variant: v.label, tried };
  }
  return { ok: false, tried };
}

const refs = await loadDischargeRefs();
console.log('Discharge refs', refs, 'TODAY', TODAY);

const results = [];
for (const t of TARGETS) {
  console.log(`\n=== ${t.name} old#${t.oldPlacementId} new#${t.newPlacementId} ===`);
  const row = {
    name: t.name,
    caseId: t.caseId,
    seededPatientId: t.patientId,
    oldPlacementId: t.oldPlacementId,
    newPlacementId: t.newPlacementId,
    resolvedPatientId: null,
    search: null,
    before: null,
    actions: {},
    after: null,
    outcome: null,
    needsUi: false,
    notes: [],
  };

  // Resolve patient: try seeded ID contracts first; if -56 / empty, search Status=All
  let patientId = t.patientId;
  let beforePack = await getContracts(patientId);
  if (!ok(beforePack.result) || beforePack.result.eid === '-56' || !beforePack.placements.length) {
    row.notes.push(
      `seeded PatientID ${patientId} contracts eid=${beforePack.result.eid} msg=${beforePack.result.msg} count=${beforePack.placements.length}`,
    );
    const found = await searchPatient(t);
    row.search = found;
    if (found.patientId) {
      patientId = found.patientId;
      beforePack = await getContracts(patientId);
      row.notes.push(`resolved via search → PatientID ${patientId}`);
    } else if (found.ambiguous) {
      row.outcome = 'ambiguous_patient';
      row.needsUi = true;
      row.notes.push(`ambiguous PatientIDs: ${found.ambiguous.join(',')}`);
      results.push(row);
      console.log('→ ambiguous', found.ambiguous);
      continue;
    } else {
      // Still try seeded even if empty — keep before state
      row.notes.push('search Status=All found no PatientID');
    }
  }

  row.resolvedPatientId = patientId;
  const beforePls = beforePack.placements;
  const oldBefore = beforePls.find((p) => p.placementId === t.oldPlacementId) || null;
  const newBefore = beforePls.find((p) => p.placementId === t.newPlacementId) || null;
  row.before = {
    contractsOk: ok(beforePack.result),
    eid: beforePack.result.eid,
    msg: beforePack.result.msg,
    placements: summarizePlacements(beforePls),
    old: oldBefore
      ? { placementId: oldBefore.placementId, state: oldBefore.disc ? `DISCHARGED ${oldBefore.disc}` : 'ACTIVE' }
      : null,
    new: newBefore
      ? { placementId: newBefore.placementId, state: newBefore.disc ? `DISCHARGED ${newBefore.disc}` : 'ACTIVE' }
      : null,
  };

  console.log(
    'BEFORE',
    summarizePlacements(beforePls)
      .map((p) => `#${p.placementId}:${p.state}`)
      .join(' | ') || '(none)',
  );

  if (!beforePls.length && !ok(beforePack.result)) {
    row.outcome = 'patient_or_contracts_unavailable';
    row.needsUi = true;
    results.push(row);
    console.log('→ unavailable');
    continue;
  }

  // Step 2: discharge mistaken NEW if still ACTIVE
  if (newBefore && newBefore.active) {
    console.log(`Discharging NEW #${t.newPlacementId} as of ${TODAY}...`);
    const disc = await dischargePlacement(patientId, t.newPlacementId, refs);
    row.actions.dischargeNew = disc;
    console.log(' dischargeNew', disc.ok ? 'OK' : `FAIL eid=${disc.eid} ${disc.msg}`);
    if (!disc.ok) row.notes.push(`discharge NEW failed: ${disc.eid} ${disc.msg || disc.fault}`);
  } else if (newBefore && !newBefore.active) {
    row.actions.dischargeNew = { skipped: true, reason: `already discharged ${newBefore.disc}` };
    row.notes.push(`NEW #${t.newPlacementId} already discharged ${newBefore.disc}`);
  } else {
    row.actions.dischargeNew = { skipped: true, reason: 'NEW placement not in contract list' };
    row.notes.push(`NEW #${t.newPlacementId} not found on patient (already gone or wrong PatientID)`);
  }

  // Refresh mid-state after possible discharge
  let midPack = await getContracts(patientId);
  let oldMid = midPack.placements.find((p) => p.placementId === t.oldPlacementId) || null;
  let newMid = midPack.placements.find((p) => p.placementId === t.newPlacementId) || null;

  // Step 3: reactivate OLD if still discharged
  if (oldMid && oldMid.active) {
    row.actions.reactivateOld = { skipped: true, reason: 'old already ACTIVE' };
    row.notes.push(`OLD #${t.oldPlacementId} already ACTIVE`);
  } else if (oldMid && !oldMid.active) {
    console.log(`Trying reactivate OLD #${t.oldPlacementId}...`);
    const react = await tryReactivateOld(patientId, t.oldPlacementId, refs);
    row.actions.reactivateOld = react;
    console.log(' reactivateOld', react.ok ? `OK via ${react.variant}` : 'FAIL (API cannot clear)');
    if (!react.ok) {
      row.needsUi = true;
      row.notes.push(
        `API cannot clear DischargeDate on OLD #${t.oldPlacementId} — manual HHA UI required`,
      );
    }
  } else {
    row.actions.reactivateOld = { skipped: true, reason: 'OLD placement not found' };
    row.needsUi = true;
    row.notes.push(`OLD #${t.oldPlacementId} not found — manual UI lookup required`);
  }

  // After verify
  const afterPack = await getContracts(patientId);
  const afterPls = afterPack.placements;
  const oldAfter = afterPls.find((p) => p.placementId === t.oldPlacementId) || null;
  const newAfter = afterPls.find((p) => p.placementId === t.newPlacementId) || null;
  row.after = {
    placements: summarizePlacements(afterPls),
    old: oldAfter
      ? { placementId: oldAfter.placementId, state: oldAfter.disc ? `DISCHARGED ${oldAfter.disc}` : 'ACTIVE' }
      : null,
    new: newAfter
      ? { placementId: newAfter.placementId, state: newAfter.disc ? `DISCHARGED ${newAfter.disc}` : 'ACTIVE' }
      : null,
  };

  const newClean =
    !newAfter || !newAfter.active || row.actions.dischargeNew?.skipped;
  const oldOk = oldAfter && oldAfter.active;
  if (oldOk && (newClean || (newAfter && !newAfter.active))) {
    row.outcome = 'fixed_old_active_new_cleared';
    row.needsUi = false;
  } else if (oldOk && newAfter?.active) {
    row.outcome = 'old_active_but_new_still_active';
    row.needsUi = true;
  } else if (!oldOk && newAfter && !newAfter.active) {
    row.outcome = 'new_discharged_old_still_needs_ui_reactivate';
    row.needsUi = true;
  } else if (!oldOk && !newAfter) {
    row.outcome = oldMid?.active
      ? 'old_active_new_absent'
      : 'new_absent_old_still_needs_ui_reactivate';
    row.needsUi = !oldOk;
  } else if (!oldOk && newAfter?.active) {
    row.outcome = 'new_still_active_old_still_discharged';
    row.needsUi = true;
  } else {
    row.outcome = 'partial_or_unexpected';
    row.needsUi = true;
  }

  console.log(
    'AFTER',
    summarizePlacements(afterPls)
      .map((p) => `#${p.placementId}:${p.state}`)
      .join(' | ') || '(none)',
  );
  console.log(`→ ${row.outcome} needsUi=${row.needsUi}`);
  results.push(row);
}

const summary = results.reduce((a, r) => {
  a[r.outcome] = (a[r.outcome] || 0) + 1;
  return a;
}, {});

const payload = {
  runAt: new Date().toISOString(),
  strategy:
    'For the five overlap kids: discharge mistaken NEW #8596xxx if ACTIVE; try reactivate OLD if discharged. No AddPatientContract. No discharge_service re-enable.',
  dischargeRefs: refs,
  dischargeDateUsed: TODAY,
  summary,
  results,
};

writeFileSync(path.join(OUT, 'fix-five-overlap-results.json'), JSON.stringify(payload, null, 2));

const md = [
  '# Fix five overlap kids — discharge NEW, reactivate OLD',
  '',
  payload.strategy,
  '',
  `| Run | ${payload.runAt} |`,
  `| Discharge date stamped on NEW | ${TODAY} |`,
  '',
  '| # | Patient | CaseId | PatientID | Before OLD | Before NEW | Discharged NEW? | Reactivate OLD? | After OLD | After NEW | Outcome | UI? |',
  '|---:|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map((r, i) => {
    const discNew = r.actions?.dischargeNew;
    const discNewTxt = discNew?.skipped
      ? `skip (${discNew.reason})`
      : discNew?.ok
        ? 'YES'
        : discNew
          ? `FAIL ${discNew.eid}`
          : '—';
    const react = r.actions?.reactivateOld;
    const reactTxt = react?.skipped
      ? `skip (${react.reason})`
      : react?.ok
        ? `YES (${react.variant})`
        : react
          ? 'FAIL (API)'
          : '—';
    return `| ${i + 1} | ${r.name} | \`${r.caseId}\` | ${r.resolvedPatientId || r.seededPatientId} | ${r.before?.old?.state || 'missing'} | ${r.before?.new?.state || 'missing'} | ${discNewTxt} | ${reactTxt} | ${r.after?.old?.state || 'missing'} | ${r.after?.new?.state || 'missing'} | **${r.outcome}** | ${r.needsUi ? 'YES' : 'no'} |`;
  }),
  '',
  '## Notes',
  ...results.flatMap((r) =>
    (r.notes || []).map((n) => `- **${r.name}:** ${n}`),
  ),
  '',
  '## Summary counts',
  '```',
  JSON.stringify(summary, null, 2),
  '```',
  '',
  'Artifacts: `fix-five-overlap-results.json`, `fix-five-overlap-kids.mjs`',
].join('\n');

writeFileSync(path.join(OUT, 'fix-five-overlap-results.md'), md);
console.log('\n===== SUMMARY =====');
console.log(JSON.stringify(summary, null, 2));
console.log(md);
