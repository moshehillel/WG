/**
 * Reactivate-only probe/apply: clear DischargeDate on EXISTING placements.
 * Does NOT call AddPatientContract.
 *
 * Working variant (Solomon): UpdateDischargeDate=true + DischargeReasonID + DischargeNote
 * (no DischargeDate element). Fails with overlap if a newer placement already covers the period.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(path.join(repoRoot, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = (process.env.HHA_APP_KEY || '').replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const OUT = path.join(repoRoot, 'infra', 'revert-discharges-work');

if (String(process.env.HHA_ALLOW_PRODUCTION || '').toLowerCase() !== 'true') {
  console.error('Need HHA_ALLOW_PRODUCTION=true');
  process.exit(1);
}

async function call(method, inner = '') {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${APP}</AppName>
        <AppSecret>${SECRET}</AppSecret>
        <AppKey>${KEY}</AppKey>
      </Authentication>
      ${inner}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}/${method}"` },
    body,
  });
  const xml = await res.text();
  return {
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
    xml,
  };
}
const ok = (r) => r.status?.toLowerCase() === 'success' || r.eid === '0';

function parsePlacements(xml) {
  return [...xml.matchAll(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/g)].map((b) => ({
    placementId: b[0].match(/<PlacementID>([^<]*)/)?.[1],
    contractId: b[0].match(/<Contract>\s*<ID>(\d+)/)?.[1],
    serviceCodeId: b[0].match(/<ServiceCode>\s*<ID>(-?\d+)/)?.[1],
    startDate: b[0].match(/<ServiceStartDate>([^<]*)/)?.[1],
    dischargeDate: b[0].match(/<DischargeDate>([^<]*)/)?.[1] || '',
  }));
}

const TARGETS = [
  { name: 'Hooria Arshad', patientId: '22854608', expectedPlacementId: '6812439', newContractNote: '8596053 added earlier by mistake' },
  { name: 'Helena Galeanocarvajal', patientId: '23012434', expectedPlacementId: '6897698', newContractNote: '8596089 added earlier by mistake' },
  { name: 'Madison Oliver', patientId: '25788276', expectedPlacementId: '8300861', newContractNote: '8596090 added earlier by mistake' },
  { name: 'Edmund Picciuto', patientId: '26372249', expectedPlacementId: '8522217', newContractNote: '8596091 added earlier by mistake' },
  { name: 'Roy-Al Porter', patientId: '24555059', expectedPlacementId: '7909108', newContractNote: '8596092 added earlier by mistake' },
  { name: 'Caleb Rolon', patientId: '24301609', expectedPlacementId: '7802393', newContractNote: '8596093 added earlier by mistake' },
  { name: 'Martin Solomon', patientId: '26367422', expectedPlacementId: '8519959', newContractNote: null },
  { name: 'Michael Asunto', patientId: '24617583', expectedPlacementId: '7935330', newContractNote: '8596094 added earlier by mistake' },
  { name: 'Fiona Downs', patientId: '24865860', expectedPlacementId: '8045831', newContractNote: '8596095 added earlier by mistake' },
  { name: 'Karlandrew Navelgas', patientId: '22680255', expectedPlacementId: '6711683', newContractNote: '8596097 added earlier by mistake' },
];

const reasonCall = await call('GetContractDischargeReason', '<Status>Active</Status>');
const reasonId =
  [...reasonCall.xml.matchAll(/<ReasonID>(\d+)<\/ReasonID>/g)].map((m) => m[1])[0] || '';
const reasonDesc =
  reasonCall.xml.match(/<ReasonDescription>([^<]*)/)?.[1] || 'Revert mistaken auto discharge';

console.log({ APPLY, reasonId, endpoint: URL });

const results = [];
for (const t of TARGETS) {
  const hist = await call(
    'GetPatientContracts',
    `<PatientID>${t.patientId}</PatientID><VisitDate>2026-09-14</VisitDate>`,
  );
  const after = await call(
    'GetPatientContracts',
    `<PatientID>${t.patientId}</PatientID><VisitDate>2026-09-20</VisitDate>`,
  );
  const histP = ok(hist) ? parsePlacements(hist.xml) : [];
  const afterP = ok(after) ? parsePlacements(after.xml) : [];
  const old = histP.find((p) => p.placementId === t.expectedPlacementId) ||
    histP.find((p) => p.dischargeDate) ||
    afterP.find((p) => p.placementId === t.expectedPlacementId);
  const oldActive = old && !old.dischargeDate;
  const hasNewActive = afterP.some(
    (p) => p.placementId !== t.expectedPlacementId && !p.dischargeDate,
  );

  let status;
  let reactivate = null;
  if (oldActive) {
    status = 'old_contract_active';
  } else if (!old) {
    status = 'old_placement_not_found';
  } else if (!APPLY) {
    status = 'would_reactivate_old';
  } else {
    const r = await call(
      'UpdatePatientContract',
      `<PatientContractInfo>
  <PatientID>${t.patientId}</PatientID>
  <PlacementID>${old.placementId}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeReasonID>${reasonId}</DischargeReasonID>
  <DischargeNote>${reasonDesc}</DischargeNote>
</PatientContractInfo>`,
    );
    reactivate = { ok: ok(r), eid: r.eid, msg: r.msg, status: r.status };
    const verify = await call(
      'GetPatientContracts',
      `<PatientID>${t.patientId}</PatientID><VisitDate>2026-09-20</VisitDate>`,
    );
    const verifyP = ok(verify) ? parsePlacements(verify.xml) : [];
    const verifiedOld = verifyP.find((p) => p.placementId === old.placementId);
    const cleared = verifiedOld && !verifiedOld.dischargeDate;
    // Also check hist-as-of after for disc clear
    const verifyHist = await call(
      'GetPatientContracts',
      `<PatientID>${t.patientId}</PatientID><VisitDate>2026-09-14</VisitDate>`,
    );
    const vh = ok(verifyHist) ? parsePlacements(verifyHist.xml) : [];
    const vhOld = vh.find((p) => p.placementId === old.placementId);
    status =
      reactivate.ok && ((verifiedOld && !verifiedOld.dischargeDate) || (vhOld && !vhOld.dischargeDate))
        ? 'reactivated_old'
        : reactivate.ok
          ? 'reactivate_api_ok_unconfirmed'
          : hasNewActive
            ? 'reactivate_failed_overlap_has_new_contract'
            : 'reactivate_failed';
    reactivate.verifiedOld = verifiedOld || vhOld;
    reactivate.afterPlacements = verifyP;
  }

  const row = {
    name: t.name,
    patientId: t.patientId,
    expectedPlacementId: t.expectedPlacementId,
    oldPlacement: old,
    newContractNote: t.newContractNote,
    hasNewActive,
    status,
    reactivate,
    histPlacements: histP,
    afterPlacements: afterP,
  };
  console.log(`${t.name}: ${status}`);
  results.push(row);
}

mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, APPLY ? 'reactivate-apply-results.json' : 'reactivate-dry-run.json');
writeFileSync(outFile, JSON.stringify({ runAt: new Date().toISOString(), apply: APPLY, results }, null, 2));
console.log('Wrote', outFile);
const summary = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
console.log('Summary', summary);


