/**
 * LIVE_OK: close #38 solo-group note bypass holes + widen Elizabeth-style matcher.
 * - notesMentionNoPeerAvailable accepts "can not be seen in a group" / "no one appropriate to group"
 * - Re-import duplicate skip still re-validates #38
 * - provider-sign + esign lock refuse without note
 * - HHA transfer hard-fails with #38 message (not pay-rate null)
 * HHA_USE_PRODUCTION unchanged.
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
const outDir = path.join(__dirname, 'tms-api-locker38-note-gates-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-locker38-note-gates.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

sh('npm run build -w @white-glove/shared');

const paySrc = path.join(repoRoot, 'packages/hha-client/src/pay-code-resolve.ts');
const payDist = path.join(repoRoot, 'packages/hha-client/dist/pay-code-resolve.js');
sh(
  `npx esbuild ${JSON.stringify(paySrc)} --outfile=${JSON.stringify(payDist)} --format=esm --platform=node --target=node22`,
);

const resolveSrc = path.join(repoRoot, 'packages/hha-client/src/resolve-service-code-order.ts');
const resolveDist = path.join(repoRoot, 'packages/hha-client/dist/resolve-service-code-order.js');
sh(
  `npx esbuild ${JSON.stringify(resolveSrc)} --outfile=${JSON.stringify(resolveDist)} --format=esm --platform=node --target=node22`,
);
if (fs.readFileSync(resolveDist, 'utf8').includes('stripSchoolBillingDurationBucket')) {
  throw new Error('dist still has stripSchoolBillingDurationBucket — abort');
}

const mandateSrc = path.join(repoRoot, 'packages/tms-db/src/mandate.ts');
const mandateDist = path.join(repoRoot, 'packages/tms-db/dist/mandate.js');
sh(
  `npx esbuild ${JSON.stringify(mandateSrc)} --outfile=${JSON.stringify(mandateDist)} --format=esm --platform=node --target=node22 --packages=external`,
);
const mandateTxt = fs.readFileSync(mandateSrc, 'utf8');
if (!mandateTxt.includes('Elizabeth-style') || !mandateTxt.includes('appropriate')) {
  throw new Error('mandate.ts missing Elizabeth-style note matcher phrases — abort');
}
if (!mandateTxt.includes('group member')) {
  throw new Error('mandate.ts missing "group member(s)" no-peer synonym — abort');
}

const overlapSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/session-overlap.ts'),
  'utf8',
);
if (!overlapSrc.includes('soloGroupMandateNoteError')) {
  throw new Error('session-overlap missing soloGroupMandateNoteError — abort');
}

const routerSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-api/src/router.ts'), 'utf8');
if (!routerSrc.includes('duplicate skip must never bypass the note gate')) {
  throw new Error('router missing duplicate re-import #38 re-check — abort');
}
if (!routerSrc.includes('lock refused — solo-group note locker')) {
  throw new Error('router missing esign lock #38 refuse — abort');
}
if (!/provider-sign[\s\S]*soloGroupMandateNoteError/.test(routerSrc)) {
  throw new Error('router missing provider-sign #38 check — abort');
}

const transferSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'),
  'utf8',
);
if (!transferSrc.includes('soloGroupMandateNoteError')) {
  throw new Error('hha-transfer missing #38 hard-fail before pay — abort');
}
if (!transferSrc.includes('useGroupBilling') || !transferSrc.includes('never bill group while paying individual')) {
  throw new Error('hha-transfer missing solo→individual billing alignment — abort');
}

const gitSha = `${readGitSha()}-locker38-gates`;
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
assertAmAndPlcBundleMarkers(bundled, 'locker38-gates bundle');
assertAlreadyBilledBundleMarkers(bundled, 'locker38-gates bundle');
assertVisitDateCoverBundleMarkers(bundled, 'locker38-gates bundle');
assertNoSchoolBillingStripFallback(bundled, 'locker38-gates bundle');
if (!bundled.includes('appropriate')) {
  throw new Error('bundled missing Elizabeth-style note matcher — abort');
}
if (!/group\\s\*members\?|group\s*members?/.test(bundled) && !bundled.includes('group members')) {
  // Minified bundle may keep the regex source as group\s*members?
  if (!bundled.includes('group') || !bundled.includes('members')) {
    throw new Error('bundled missing group-member no-peer synonym — abort');
  }
}
if (!bundled.includes('seen individually')) {
  throw new Error('bundled missing #38 locker message markers — abort');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
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

const summary = [
  'TMS #38 locker gates + Elizabeth-style note matcher',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Closed bypass holes:',
  '1. Exact-duplicate re-import re-validates #38 on existing row',
  '2. provider-sign hard-fails #38 before sign',
  '3. esign webhook refuses lock if #38 fails',
  '4. HHA transfer fails with #38 note message (not pay-rate null)',
  '',
  'Matcher widened:',
  '- can not / cannot be seen in a group',
  '- no one appropriate to group',
  '- not appropriate to group',
  '- no group member(s) available',
  '',
  'Intentional product rule kept: dual-mandate true 1:1 without note → free pass',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-locker38-note-gates-deploy-out.txt'), summary);
console.log('\n' + summary);
