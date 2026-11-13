/**
 * LIVE: Homeschooled / Home schooled / Home School caseload children may upload
 * onto the report district or school (session keeps that report school).
 * A real different school (Elmont vs Valley Stream) still conflicts.
 * Does NOT change HHA_USE_PRODUCTION. Does not create or change HHA visits.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';
import {
  assertAmAndPlcBundleMarkers,
  assertAlreadyBilledBundleMarkers,
  assertVisitDateCoverBundleMarkers,
  assertNoSchoolBillingStripFallback,
} from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-ticket-fixes-2026-11-05-asset');
const stageDir = path.join(__dirname, '_zip_stage_ticket_fixes_2026_11_05');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-ticket-fixes-2026-11-05.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const parseSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'), 'utf8');
if (!parseSrc.includes('isHomeschooledSchoolName')) {
  throw new Error('session-parse missing homeschooled school allowance — abort');
}
if (!parseSrc.includes('homeschooled|home schooled|homeschool|home school') || !parseSrc.includes('homebound|home bound')) {
  throw new Error('session-parse missing homeschooled/homebound label variants — abort');
}
const cpSrc = fs.readFileSync(path.join(repoRoot, 'packages/hha-client/src/create-patient-builder.ts'), 'utf8');
if (!cpSrc.includes('MRNumber') || !cpSrc.includes('formatMrNumber')) {
  throw new Error('create-patient-builder missing MRNumber / formatMrNumber — abort');
}
const soapSrc = fs.readFileSync(path.join(repoRoot, 'packages/hha-client/src/soap-adapter.ts'), 'utf8');
if (!soapSrc.includes('this.payRateCodeRows = undefined')) {
  throw new Error('soap-adapter missing payRateCodeRows = undefined reload path — abort');
}
const routerSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/router.ts'), 'utf8');
if (!routerSrc.includes('b.studentIds')) {
  throw new Error('router missing studentIds due-dates path — abort');
}
const reportsSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/reports.ts'), 'utf8');
if (!reportsSrc.includes('studentsNamedInDueNotes')) {
  throw new Error('dueDateReport missing per-child provider expansion — abort');
}


// 2026-11-05 source guards: ticket replies depend on these behaviors.
if (!routerSrc.includes('shouldNagDue({ completedAt: d.completedAt') || !routerSrc.includes('myStudentIds.has(childId)') || !routerSrc.includes('seenDueIds')) {
  throw new Error('router dueDatesForUser missing own-caseload / 14-day nag filter - abort');
}
if (!routerSrc.includes('excludeCompleted: true') || !routerSrc.includes("'District', 'Child', 'Provider'")) {
  throw new Error('router due-dates Excel export missing excludeCompleted / District column - abort');
}
if (!reportsSrc.includes('excludeCompleted') || !reportsSrc.includes('row.completedAt')) {
  throw new Error('reports.ts dueDateReport missing completed-hidden filter - abort');
}
const webSrc = fs.readFileSync(path.join(repoRoot, 'apps/tms-web/app.js'), 'utf8');
for (const m of ['3 \u00b7 Progress-report due dates', '2 \u00b7 School calendar', '1 \u00b7 Basic information', '<th>District</th><th>Child</th><th>Provider</th>']) {
  if (!webSrc.includes(m)) throw new Error('tms-web app.js missing ' + m + ' - abort');
}
console.log('2026-11-05 source guards OK');
sh('npm run build -w @white-glove/shared');
// hha-client tsc exits non-zero here (some ent-* sources exist only as prebuilt dist); it still emits.
// Tolerate that, then verify the emitted dist carries the new code.
try {
  sh('npm run build -w @white-glove/hha-client');
} catch (e) {
  console.warn('hha-client tsc reported errors (emit still ran); verifying dist...');
}
{
  const dist = (n) => fs.readFileSync(path.join(repoRoot, 'packages/hha-client/dist', n), 'utf8');
  if (!dist('soap-adapter.js').includes('this.payRateCodeRows = undefined')) {
    throw new Error('hha-client dist soap-adapter.js stale (no payRateCodeRows reload) — abort');
  }
  if (!dist('create-patient-builder.js').includes('MRNumber')) {
    throw new Error('hha-client dist create-patient-builder.js stale (no MRNumber) — abort');
  }
}
sh('npm run build -w @white-glove/tms-db');
{
  const reportsDist = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/dist/reports.js'), 'utf8');
  if (!reportsDist.includes('studentsNamedInDueNotes') || !reportsDist.includes('excludeCompleted')) {
    throw new Error('tms-db dist reports.js stale (no studentsNamedInDueNotes) — abort');
  }
}

const gitSha = `${readGitSha()}-ticket-fixes-2026-11-05`;
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/tms-api/src/handler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: true,
  outfile,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  define: { 'process.env.TMS_GIT_SHA': JSON.stringify(gitSha) },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

const bundled = fs.readFileSync(outfile, 'utf8');
assertAmAndPlcBundleMarkers(bundled, 'ticket-fixes bundle');
assertAlreadyBilledBundleMarkers(bundled, 'ticket-fixes bundle');
assertVisitDateCoverBundleMarkers(bundled, 'ticket-fixes bundle');
assertNoSchoolBillingStripFallback(bundled, 'ticket-fixes bundle');
for (const marker of ['homeschooled', 'homebound', 'MRNumber', 'payRateCodeRows', 'studentIds']) {
  if (!bundled.includes(marker)) {
    throw new Error('bundled missing marker ' + marker + ' — abort');
  }
}
if (!/payRateCodeRows\s*=\s*void 0/.test(bundled)) {
  throw new Error('bundled missing payRateCodeRows reload-on-miss (= void 0) — abort');
}
console.log('bundle markers OK: homeschooled homebound MRNumber payRateCodeRows=void 0 studentIds');
if (!bundled.includes("does not match child's school")) {
  throw new Error('bundled missing ordinary school-mismatch error — abort');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

fs.mkdirSync(stageDir, { recursive: true });
for (const f of fs.readdirSync(stageDir)) fs.unlinkSync(path.join(stageDir, f));
fs.copyFileSync(outfile, path.join(stageDir, 'index.mjs'));
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stageDir, 'index.mjs').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { cwd: __dirname },
);

const beforeEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
    { encoding: 'utf8' },
  ),
);
console.log('HHA env before:', beforeEnv);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${beforeEnv.HHA_USE_PRODUCTION}`);
}

const codeOut = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('code', codeOut.trim());
stampLambdaGitEnv(fnName, { sha: gitSha });

const afterEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT}" --output json`,
    { encoding: 'utf8' },
  ),
);

if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is not true after deploy: ${JSON.stringify(afterEnv)}`);
}

const summary = [
  'TMS ticket fixes 2026-11-05 (therapist due dates, district column, school editor tabs)',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION=true preserved (unchanged)',
  'No HHA visit created, cancelled, or changed',
  'Netlify not deployed',
  '',
  'Homeschooled / Home schooled / Home School + a real report district or school is allowed.',
  'The session keeps the report school. The child school stays Homeschooled.',
  'A different named school (Elmont vs Valley Stream) is still blocked.',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-ticket-fixes-2026-11-05-deploy-out.txt'), summary);
console.log('\n' + summary);



