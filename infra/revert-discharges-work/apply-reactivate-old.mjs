/**
 * Reactivate OLD discharged placements only (no AddPatientContract).
 * Also inventories mistaken new placements created earlier today.
 *
 * Usage:
 *   $env:HHA_ALLOW_PRODUCTION='true'
 *   node infra/revert-discharges-work/apply-reactivate-old.mjs
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
const URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');
const OUT = path.join(repoRoot, 'infra', 'revert-discharges-work');
mkdirSync(OUT, { recursive: true });

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
    });
  }
  return out;
}

/** Known mistaken new placements created earlier this session (do not create more). */
const MISTAKEN_NEW = {
  '02891799': ['8596053'],
  '04725821': ['8596089'],
  '258271503': ['8596090'],
  '258272446': ['8596091'],
  '258270052': ['8596092'],
  P0800016094701: ['8596093'],
  '258270277': ['8596094'],
  '258270803': ['8596095'],
  '258267421': ['8596097'],
  // Solomon: none created
};

const TARGETS = [
  { name: 'Hooria Arshad', caseId: '02891799', patientId: '22854608', oldPlacementId: '6812439', source: 'discharge_service success' },
  { name: 'Helena Galeanocarvajal', caseId: '04725821', patientId: '23012434', oldPlacementId: '6897698', source: 'discharge_service success' },
  { name: 'Madison Oliver', caseId: '258271503', patientId: '25788276', oldPlacementId: '8300861', source: 'discharge_service success' },
  { name: 'Edmund Picciuto', caseId: '258272446', patientId: '26372249', oldPlacementId: '8522217', source: 'discharge_service success' },
  { name: 'Roy-Al Porter', caseId: '258270052', patientId: '24555059', oldPlacementId: '7909108', source: 'discharge_service success' },
  { name: 'Caleb Rolon', caseId: 'P0800016094701', patientId: '24301609', oldPlacementId: '7802393', source: 'discharge_service success' },
  { name: 'Martin Solomon', caseId: '06771684', patientId: '26367422', oldPlacementId: '8519959', source: 'discharge_service success' },
  { name: 'Michael Asunto', caseId: '258270277', patientId: '24617583', oldPlacementId: '7935330', source: 'meeting overlap' },
  { name: 'Fiona Downs', caseId: '258270803', patientId: '24865860', oldPlacementId: '8045831', source: 'meeting overlap' },
  { name: 'Karlandrew Navelgas', caseId: '258267421', patientId: '22680255', oldPlacementId: '6711683', source: 'meeting overlap' },
];

async function getContracts(patientId) {
  // PatientID-only returns discharged + active; ISO VisitDate often hides discharged.
  const r = await call('GetPatientContracts', `<PatientID>${esc(patientId)}</PatientID>`);
  return { result: r, placements: placements(r.xml) };
}

async function loadDischargeRefs() {
  const to = await call('GetPatientDischargeTo', '<Status>Active</Status>');
  const reasons = await call('GetContractDischargeReason', '<Status>Active</Status>');
  const toIds = [...to.xml.matchAll(/<(?:ID|DischargeToID)>(\d+)/gi)].map((m) => m[1]);
  const reasonIds = [...reasons.xml.matchAll(/<ReasonID>(\d+)/gi)].map((m) => m[1]);
  return {
    toId: toIds.find((id) => id !== '0') || toIds[0],
    reasonId: reasonIds[0],
    toSample: to.xml.replace(/\s+/g, ' ').slice(0, 300),
    reasonSample: reasons.xml.replace(/\s+/g, ' ').slice(0, 300),
  };
}

/**
 * Attempt to CLEAR discharge on an existing placement.
 * Per HHA docs: DischargeTo/Reason required only when DischargeDate is NOT blank,
 * so blank/nil should mean clear — but empty string faults XSD; try several shapes.
 */
async function clearOldDischarge(patientId, placementId, refs) {
  const variants = [
    {
      label: 'UpdateDischargeDate true + xsi:nil DischargeDate',
      xsi: true,
      xml: `<PatientContractInfo>
  <PatientID>${esc(patientId)}</PatientID>
  <PlacementID>${esc(placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate xsi:nil="true" />
  <DischargeNote>Revert mistaken discharge_service automation</DischargeNote>
</PatientContractInfo>`,
    },
    {
      label: 'UpdateDischargeDate true omit DischargeDate + note',
      xml: `<PatientContractInfo>
  <PatientID>${esc(patientId)}</PatientID>
  <PlacementID>${esc(placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeNote>Revert mistaken discharge_service automation</DischargeNote>
</PatientContractInfo>`,
    },
    {
      label: 'UpdateDischargeDate true omit date + reason/to ids',
      xml: `<PatientContractInfo>
  <PatientID>${esc(patientId)}</PatientID>
  <PlacementID>${esc(placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeToID>${esc(refs.toId || '0')}</DischargeToID>
  <DischargeReasonID>${esc(refs.reasonId || '0')}</DischargeReasonID>
  <DischargeNote>Revert mistaken discharge_service automation</DischargeNote>
</PatientContractInfo>`,
    },
    {
      label: 'UpdateDischargeDate true + xsi:nil + reason/to',
      xsi: true,
      xml: `<PatientContractInfo>
  <PatientID>${esc(patientId)}</PatientID>
  <PlacementID>${esc(placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate xsi:nil="true" />
  <DischargeToID>${esc(refs.toId || '0')}</DischargeToID>
  <DischargeReasonID>${esc(refs.reasonId || '0')}</DischargeReasonID>
  <DischargeNote>Revert mistaken discharge_service automation</DischargeNote>
</PatientContractInfo>`,
    },
    // Some vendors use 01/01/1900 or epoch as clear — already failed elsewhere; skip.
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

async function tryEntSpaClear(patientId, placementId) {
  // Best-effort ENT SPA if token present — UI can clear discharge date.
  const token = process.env.HHA_ENT_SPA_ACCESS_TOKEN;
  if (!token) return { attempted: false, reason: 'no_spa_token' };
  const endpoints = [
    {
      url: 'https://app.hhaexchange.com/api/ent/patients/contracts/discharge',
      body: { patientId: Number(patientId), placementId: Number(placementId), dischargeDate: null },
    },
    {
      url: 'https://app.hhaexchange.com/api/ent/patients/contracts/update',
      body: {
        patientId: Number(patientId),
        placementId: Number(placementId),
        clearDischargeDate: true,
      },
    },
  ];
  const tried = [];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(ep.body),
      });
      const text = await res.text();
      tried.push({
        url: ep.url,
        http: res.status,
        preview: text.slice(0, 200),
      });
      if (res.ok) return { attempted: true, ok: true, tried };
    } catch (e) {
      tried.push({ url: ep.url, error: String(e.message || e) });
    }
  }
  return { attempted: true, ok: false, tried };
}

const refs = await loadDischargeRefs();
console.log('Discharge refs', { toId: refs.toId, reasonId: refs.reasonId });

const results = [];
for (const t of TARGETS) {
  console.log(`\n=== ${t.name} old#${t.oldPlacementId} ===`);
  const { placements: pls } = await getContracts(t.patientId);
  const old = pls.find((p) => p.placementId === t.oldPlacementId);
  const mistakenNewIds = MISTAKEN_NEW[t.caseId] || [];
  const mistakenNew = pls.filter((p) => mistakenNewIds.includes(p.placementId));
  const otherActive = pls.filter((p) => !p.disc && !mistakenNewIds.includes(p.placementId));

  let outcome;
  let manualFollowUp = false;
  let clearAttempt;
  let entAttempt;

  if (!old) {
    outcome = 'old_placement_not_found';
    manualFollowUp = true;
  } else if (!old.disc) {
    outcome = 'old_already_active';
  } else {
    // Try SOAP clear
    clearAttempt = await clearOldDischarge(t.patientId, t.oldPlacementId, refs);
    const afterSoap = await getContracts(t.patientId);
    const oldAfter = afterSoap.placements.find((p) => p.placementId === t.oldPlacementId);
    if (oldAfter && !oldAfter.disc) {
      outcome = 'reactivated_via_UpdatePatientContract';
    } else {
      entAttempt = await tryEntSpaClear(t.patientId, t.oldPlacementId);
      const afterEnt = await getContracts(t.patientId);
      const oldAfterEnt = afterEnt.placements.find((p) => p.placementId === t.oldPlacementId);
      if (oldAfterEnt && !oldAfterEnt.disc) {
        outcome = 'reactivated_via_ENT_SPA';
      } else {
        outcome = 'reactivate_failed_api_cannot_clear_discharge';
        manualFollowUp = true;
      }
    }
  }

  const row = {
    ...t,
    outcome,
    manualFollowUp,
    oldPlacement: old,
    mistakenNewPlacementsCreatedEarlier: mistakenNew,
    otherActivePlacements: otherActive,
    clearAttempt,
    entAttempt,
    allPlacements: pls,
  };
  results.push(row);
  console.log(
    `→ ${outcome}`,
    old ? `old disc=${old.disc || 'ACTIVE'}` : 'old missing',
    mistakenNew.length ? `mistakenNew=${mistakenNew.map((p) => p.placementId + (p.disc ? '@' + p.disc : '@active')).join(',')}` : 'noMistakenNew',
  );
}

const summary = results.reduce((a, r) => {
  a[r.outcome] = (a[r.outcome] || 0) + 1;
  return a;
}, {});

const payload = {
  runAt: new Date().toISOString(),
  strategy:
    'REVERT only: UpdatePatientContract to clear DischargeDate on ORIGINAL placements. No AddPatientContract. Mistaken new placements from earlier session are documented, not created again.',
  dischargeRefs: { toId: refs.toId, reasonId: refs.reasonId },
  summary,
  results,
};

writeFileSync(path.join(OUT, 'reactivate-old-results.json'), JSON.stringify(payload, null, 2));

const md = [
  '# Mistaken discharge remediation — REACTIVATE OLD ONLY',
  '',
  payload.strategy,
  '',
  '| # | Patient | CaseId | HHA PatientID | Old placement | Old disc date | Reactivate outcome | Mistaken NEW placement (earlier) | Manual UI? |',
  '|---:|---|---|---|---|---|---|---|---|',
  ...results.map((r, i) => {
    const newPl =
      r.mistakenNewPlacementsCreatedEarlier?.map((p) => `#${p.placementId} ${p.disc ? 'disc ' + p.disc : 'ACTIVE'}`).join('; ') ||
      'none';
    return `| ${i + 1} | ${r.name} | \`${r.caseId}\` | ${r.patientId} | #${r.oldPlacementId} | ${r.oldPlacement?.disc || '(active/missing)'} | **${r.outcome}** | ${newPl} | ${r.manualFollowUp ? 'YES' : 'no'} |`;
  }),
  '',
  '## API note',
  '- HHA SOAP `UpdatePatientContract` accepts setting a discharge date, but **clearing** DischargeDate (empty / xsi:nil / omit) consistently fails (XSD fault or ErrorID -315).',
  '- Per HHA docs, DischargeToID/ReasonID are required only when DischargeDate is **not** blank — implying blank should clear, but the ASMX schema rejects empty dateTime.',
  '- **Manual HHA UI** (Patient → Contracts → Edit Discharge Date → clear/save) is the supported path when API clear fails.',
  '',
  '## Discharge pause',
  '- PR #3 merged: nightly `reportKinds` exclude `discharge_service` (do not re-enable).',
  '',
  `Generated: ${payload.runAt}`,
].join('\n');

writeFileSync(path.join(OUT, 'reactivate-old-results.md'), md);
console.log('\nSummary', summary);
console.log(md);
