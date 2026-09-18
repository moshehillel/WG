/**
 * Production READ-ONLY probe: custom fields + field-visit data not visible in sandbox.
 * No Create/Update/Confirm. Writes docs/field-visit-prod-readonly-results.json
 *
 * Usage: npm run prod:field-visits-readonly -w @white-glove/hha-client
 * Required on prod (narrow scope — no bulk patient/caregiver search):
 *   HHA_PROBE_PATIENT_ID=123 HHA_PROBE_CAREGIVER_ID=456
 * Optional visit: HHA_PROBE_VISIT_ID=789
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const PROD_URL = 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const OFFICE_ID = Number(process.env.HHA_OFFICE_ID ?? 1025);
const today = new Date().toISOString().slice(0, 10);

loadEnv(path.join(repoRoot, '.env'));
await loadSecrets();

const APP = required('HHA_APP_NAME');
const SECRET = required('HHA_APP_SECRET');
const KEY = required('HHA_APP_KEY').replace(/\s+/g, '');

const CUSTOM_HINTS =
  /custom|due|supervis|recert|competenc|diabet|school|others|field visit|fns|boe|annual/i;

const results = {
  testedAt: new Date().toISOString(),
  endpoint: PROD_URL,
  readOnly: true,
  methods: {},
  discoveries: {},
};

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function loadSecrets() {
  if (process.env.HHA_APP_NAME && process.env.HHA_APP_SECRET && process.env.HHA_APP_KEY) return;
  const region = process.env.AWS_REGION ?? 'us-east-1';
  let arn = process.env.HHA_SECRET_ARN;
  if (!arn) {
    try {
      const { execSync } = await import('node:child_process');
      arn = execSync(
        `aws cloudformation describe-stacks --stack-name WhiteGloveStack --region ${region} --query "Stacks[0].Outputs[?OutputKey=='HhaSecretArn'].OutputValue" --output text`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      if (!arn || arn === 'None') arn = undefined;
    } catch {
      /* no aws */
    }
  }
  if (!arn) return;
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );
  const res = await new SecretsManagerClient({ region }).send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  if (!res.SecretString) return;
  const p = JSON.parse(res.SecretString);
  if (p.appName) process.env.HHA_APP_NAME = p.appName;
  if (p.appSecret) process.env.HHA_APP_SECRET = p.appSecret;
  if (p.appKey) process.env.HHA_APP_KEY = p.appKey;
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
  const res = await fetch(PROD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/${method}"`,
    },
    body,
  });
  const xml = await res.text();
  const status = xml.match(/Status="([^"]+)"/i)?.[1];
  const eid = xml.match(/<ErrorID>([^<]*)/)?.[1];
  const msg = xml.match(/<ErrorMessage>([^<]*)/)?.[1] ?? '';
  const ok = status?.toLowerCase() === 'success' || eid === '0';
  return { ok, eid, msg, xml };
}

function record(name, r, notes) {
  results.methods[name] = { ok: r.ok, errorId: r.eid, errorMessage: r.msg, notes };
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name} eid=${r.eid ?? '-'} ${r.msg}${notes ? ` | ${notes}` : ''}`);
  return r;
}

function collectTags(xml) {
  const tags = new Set();
  for (const m of xml.matchAll(/<([A-Za-z][A-Za-z0-9_]*)>/g)) tags.add(m[1]);
  return [...tags].sort();
}

function hintTags(tags) {
  return tags.filter((t) => CUSTOM_HINTS.test(t));
}

function extractCompliance(xml) {
  const out = [];
  for (const m of xml.matchAll(
    /<CaregiverOtherComplianceInfo>[\s\S]*?<OtherComplianceID>(\d+)<\/OtherComplianceID>[\s\S]*?<ComplianceName>([^<]*)<\/ComplianceName>[\s\S]*?<\/CaregiverOtherComplianceInfo>/gi,
  )) {
    out.push({ id: Number(m[1]), name: m[2] });
  }
  return out;
}

function findByName(list, pattern) {
  return list.filter((x) => pattern.test(x.name));
}

async function main() {
  console.log(`Prod read-only custom-field probe\n${PROD_URL}\n`);

  const patientId = process.env.HHA_PROBE_PATIENT_ID
    ? Number(process.env.HHA_PROBE_PATIENT_ID)
    : undefined;
  const caregiverId = process.env.HHA_PROBE_CAREGIVER_ID
    ? Number(process.env.HHA_PROBE_CAREGIVER_ID)
    : undefined;
  if (!patientId || !caregiverId) {
    throw new Error(
      'Production probe requires HHA_PROBE_PATIENT_ID and HHA_PROBE_CAREGIVER_ID (single-record scope). No bulk SearchPatients/SearchCaregivers on prod.',
    );
  }

  record('GetOffices', await call('GetOffices', ''));

  const oc = record(
    'GetCaregiverOtherCompliance(catalog)',
    await call('GetCaregiverOtherCompliance', `<OfficeID>${OFFICE_ID}</OfficeID>`),
    'full compliance catalog',
  );
  const complianceCatalog = extractCompliance(oc.xml);
  results.discoveries.complianceCatalog = complianceCatalog;
  results.discoveries.schoolSupervisionCandidates = findByName(
    complianceCatalog,
    /school|supervis|3 month|boe/i,
  );
  results.discoveries.annualCompetency = complianceCatalog.find((x) =>
    /annual competenc/i.test(x.name),
  );

  {
    const demo = record(
      `GetPatientDemographics(${patientId})`,
      await call('GetPatientDemographics', `<PatientInfo><ID>${patientId}</ID></PatientInfo>`),
    );
    const demoTags = collectTags(demo.xml);
    results.discoveries.patientDemographicsTags = demoTags;
    results.discoveries.patientDemographicsHintTags = hintTags(demoTags);
    results.discoveries.patientDemographicsHasCustomDueFields =
      results.discoveries.patientDemographicsHintTags.length > 0;

    const clinical = record(
      `GetPatientClinicalInfo(${patientId})`,
      await call('GetPatientClinicalInfo', `<PatientID>${patientId}</PatientID>`),
    );
    const clinicalTags = collectTags(clinical.xml);
    results.discoveries.patientClinicalTags = clinicalTags;
    results.discoveries.patientClinicalHintTags = hintTags(clinicalTags);
    results.discoveries.nursingVisitsDue = clinical.xml.match(/<NursingVisitsDue>([^<]*)/)?.[1];
    results.discoveries.mdVisitDue = clinical.xml.match(/<MDVisitDue>([^<]*)/)?.[1];

    record(
      `GetPatientContracts(${patientId})`,
      await call(
        'GetPatientContracts',
        `<PatientID>${patientId}</PatientID><VisitDate>${today}</VisitDate>`,
      ),
    );
  }

  {
    const cg = record(
      `GetCaregiverDemographics(${caregiverId})`,
      await call('GetCaregiverDemographics', `<CaregiverInfo><ID>${caregiverId}</ID></CaregiverInfo>`),
    );
    const cgTags = collectTags(cg.xml);
    results.discoveries.caregiverDemographicsTags = cgTags;
    results.discoveries.caregiverDemographicsHintTags = hintTags(cgTags);

    record(
      `GetCaregiverMedicalResults(${caregiverId})`,
      await call(
        'GetCaregiverMedicalResults',
        `<OfficeID>${OFFICE_ID}</OfficeID><CaregiverID>${caregiverId}</CaregiverID>`,
      ),
    );

    const ocr = record(
      `GetCaregiverOtherComplianceResults(${caregiverId})`,
      await call(
        'GetCaregiverOtherComplianceResults',
        `<OfficeID>${OFFICE_ID}</OfficeID><CaregiverID>${caregiverId}</CaregiverID>`,
      ),
    );
    results.discoveries.caregiverOtherComplianceValues = extractCompliance(ocr.xml);
  }

  {
    const visitId = process.env.HHA_PROBE_VISIT_ID
      ? Number(process.env.HHA_PROBE_VISIT_ID)
      : undefined;
    if (visitId) {
      const vi = record(
        `GetVisitInfoV2(${visitId})`,
        await call('GetVisitInfoV2', `<VisitInfo><ID>${visitId}</ID></VisitInfo>`),
      );
      results.discoveries.visitDocFlags = {
        visitId,
        timesheetRequired: vi.xml.match(/<TimesheetRequired>([^<]*)/)?.[1] ?? null,
        timesheetApproved: vi.xml.match(/<TimesheetApproved>([^<]*)/)?.[1] ?? null,
      };
    }
  }

  mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
  const out = path.join(repoRoot, 'docs', 'field-visit-prod-readonly-results.json');
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${out}`);
  console.log('\nCustom-field hint tags in patient demographics:', results.discoveries.patientDemographicsHintTags ?? []);
  console.log('School supervision catalog matches:', results.discoveries.schoolSupervisionCandidates ?? []);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
