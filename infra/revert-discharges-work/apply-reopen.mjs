import { readFileSync, writeFileSync } from 'node:fs';
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
process.env.HHA_ALLOW_PRODUCTION = 'true';

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
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
  return await res.text();
}

function placements(xml) {
  const out = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const id = block.match(/<PlacementID>([^<]*)/)?.[1];
    if (!id) continue;
    const dm = block.match(/<DischargeDate(?:\s*\/>|>([^<]*)<\/DischargeDate>)/i);
    out.push({
      placementId: id,
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

const TARGETS = [
  { name: 'Hooria Arshad', caseId: '02891799', patientId: '22854608', expectedPlacementId: '6812439', source: 'discharge_service success' },
  { name: 'Helena Galeanocarvajal', caseId: '04725821', patientId: '23012434', expectedPlacementId: '6897698', source: 'discharge_service success' },
  { name: 'Madison Oliver', caseId: '258271503', patientId: '25788276', expectedPlacementId: '8300861', source: 'discharge_service success' },
  { name: 'Edmund Picciuto', caseId: '258272446', patientId: '26372249', expectedPlacementId: '8522217', source: 'discharge_service success' },
  { name: 'Roy-Al Porter', caseId: '258270052', patientId: '24555059', expectedPlacementId: '7909108', source: 'discharge_service success' },
  { name: 'Caleb Rolon', caseId: 'P0800016094701', patientId: '24301609', expectedPlacementId: '7802393', source: 'discharge_service success' },
  { name: 'Martin Solomon', caseId: '06771684', patientId: '26367422', expectedPlacementId: '8519959', source: 'discharge_service success' },
  { name: 'Michael Asunto', caseId: '258270277', patientId: '24617583', expectedPlacementId: '7935330', source: 'meeting overlap' },
  { name: 'Fiona Downs', caseId: '258270803', patientId: '24865860', expectedPlacementId: '8045831', source: 'meeting overlap' },
  { name: 'Karlandrew Navelgas', caseId: '258267421', patientId: '22680255', expectedPlacementId: '6711683', source: 'meeting overlap' },
];

const results = [];
for (const t of TARGETS) {
  const xml = await call('GetPatientContracts', `<PatientID>${t.patientId}</PatientID>`);
  const pls = placements(xml);
  const expected = pls.find((p) => p.placementId === t.expectedPlacementId);
  const active = pls.filter((p) => !p.disc);
  const discharged = pls.filter((p) => p.disc);
  let outcome;
  let manualFollowUp = false;
  let note = '';
  if (expected && !expected.disc) {
    outcome = 'original_placement_active';
    note = `Expected placement #${expected.placementId} has no discharge date`;
  } else if (active.length) {
    outcome = 'restored_via_new_active_placement';
    note = `Original #${t.expectedPlacementId} still discharged (${expected?.disc || 'missing'}); active now: ${active
      .map((p) => `#${p.placementId} ${p.svcName || p.svc} start ${p.start}`)
      .join('; ')}`;
  } else if (expected?.disc) {
    outcome = 'still_discharged_only';
    note = `Only placement #${expected.placementId} disc ${expected.disc} — needs HHA UI clear or new placement`;
    manualFollowUp = true;
  } else if (!pls.length) {
    outcome = 'no_placements_returned';
    note = 'GetPatientContracts returned no placements';
    manualFollowUp = true;
  } else {
    outcome = 'unexpected_state';
    note = JSON.stringify(pls);
    manualFollowUp = true;
  }
  const row = {
    ...t,
    outcome,
    note,
    manualFollowUp,
    active,
    discharged,
    placements: pls,
  };
  results.push(row);
  console.log(`${t.name}: ${outcome} | ${note}`);
}

// For still_discharged_only: try AddPatientContract reopen with same contract/svc, start=today
const reopenAttempts = [];
for (const r of results.filter((x) => x.outcome === 'still_discharged_only')) {
  const disc = r.discharged[0] || r.placements[0];
  if (!disc?.contractId || !disc?.svc) {
    reopenAttempts.push({ name: r.name, status: 'skip_missing_contract_svc' });
    continue;
  }
  const start = '2026-09-16';
  const add = await call(
    'AddPatientContract',
    `<PatientContractInfo>
  <PatientID>${r.patientId}</PatientID>
  <ContractID>${disc.contractId}</ContractID>
  <StartDate>${start}</StartDate>
  <ServiceCodeID>${disc.svc}</ServiceCodeID>
</PatientContractInfo>`,
  );
  const status = add.match(/Status="([^"]+)"/)?.[1];
  const eid = add.match(/<ErrorID>([^<]*)/)?.[1];
  const msg = add.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '';
  const newPlacement = add.match(/<PlacementID>([^<]*)/)?.[1];
  const afterXml = await call('GetPatientContracts', `<PatientID>${r.patientId}</PatientID>`);
  const afterPls = placements(afterXml);
  const activeAfter = afterPls.filter((p) => !p.disc);
  const attempt = {
    name: r.name,
    patientId: r.patientId,
    contractId: disc.contractId,
    serviceCodeId: disc.svc,
    start,
    status,
    eid,
    msg,
    newPlacement,
    activeAfter,
  };
  reopenAttempts.push(attempt);
  console.log('REOPEN', r.name, attempt);
  if (activeAfter.length) {
    r.outcome = 'reopened_via_AddPatientContract';
    r.manualFollowUp = false;
    r.note = `Created active placement; original #${r.expectedPlacementId} remains historical disc. Active: ${activeAfter
      .map((p) => `#${p.placementId}`)
      .join(', ')}`;
    r.active = activeAfter;
    r.placements = afterPls;
  } else {
    r.outcome = 'reopen_failed_still_discharged';
    r.manualFollowUp = true;
    r.note = `AddPatientContract failed eid=${eid} msg=${msg}`;
  }
}

const summary = results.reduce((a, r) => {
  a[r.outcome] = (a[r.outcome] || 0) + 1;
  return a;
}, {});

const payload = {
  runAt: new Date().toISOString(),
  apply: true,
  strategy:
    'HHA UpdatePatientContract cannot clear DischargeDate via API (empty date = XSD fault). Restore = ensure an active placement exists (new AddPatientContract if needed). Original discharged placements remain as history.',
  summary,
  results,
  reopenAttempts,
};

writeFileSync(
  path.join(repoRoot, 'infra/revert-discharges-work/revert-apply-results.json'),
  JSON.stringify(payload, null, 2),
);

const md = [
  '# Mistaken discharge revert results (APPLY)',
  '',
  payload.strategy,
  '',
  '| # | Patient | CaseId | HHA PatientID | Original placement | Outcome | Active now | Manual UI? |',
  '|---:|---|---|---|---|---|---|---|',
  ...results.map((r, i) => {
    const active = r.active?.map((p) => `#${p.placementId} ${p.svcName || p.svc} @ ${p.start}`).join('; ') || '—';
    return `| ${i + 1} | ${r.name} | \`${r.caseId}\` | ${r.patientId} | #${r.expectedPlacementId} | **${r.outcome}** | ${active} | ${r.manualFollowUp ? 'YES' : 'no'} |`;
  }),
  '',
  `Generated: ${payload.runAt}`,
  '',
  '## Notes',
  '- Run `886d6a26-a989-a9d4-9e89-74f7a9bfeaef` discharge_service had **7 successes**; plus 3 meeting overlap kids = 10.',
  '- Clearing DischargeDate via SOAP is **not supported** (empty date invalid; nil → -315).',
  '- Discharge pause: PR #3 **merged** — nightly `reportKinds` exclude `discharge_service`.',
].join('\n');

writeFileSync(path.join(repoRoot, 'infra/revert-discharges-work/revert-apply-results.md'), md);
console.log('\nSummary', summary);
console.log(md);
