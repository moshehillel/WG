/**
 * LIVE: Frontline Log Type / note-embedded DOS + signature false positives.
 * - Dates inside Service Provided notes (e.g. "first attend date 9/15/26") no longer
 *   truncate the session before Provider Signature or invent phantom missed rows.
 * - Attendance prefers Log Type text before the colon.
 * - Signature accepts Patel-style NPI/License credential footers.
 * HHA_USE_PRODUCTION must stay true (unchanged).
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
const outDir = path.join(__dirname, 'tms-api-frontline-logtype-sign-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-frontline-logtype-sign.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const parseSrc = fs.readFileSync(path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'), 'utf8');
if (!parseSrc.includes('first attend date') || !parseSrc.includes('FRONTLINE_LOG_TYPE_LEAD_RE')) {
  throw new Error('session-parse missing Log Type / note-embedded DOS fix — abort');
}
const validateSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/session-upload-validate.ts'),
  'utf8',
);
if (!validateSrc.includes('Credential footer without a surviving')) {
  throw new Error('session-upload-validate missing credential-footer signature — abort');
}

sh('npm run build -w @white-glove/tms-db');

const gitSha = `${readGitSha()}-frontline-logtype-sign`;
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
assertAmAndPlcBundleMarkers(bundled, 'frontline-logtype-sign bundle');
assertAlreadyBilledBundleMarkers(bundled, 'frontline-logtype-sign bundle');
assertVisitDateCoverBundleMarkers(bundled, 'frontline-logtype-sign bundle');
assertNoSchoolBillingStripFallback(bundled, 'frontline-logtype-sign bundle');
// Minify strips comments; keep a runtime marker from the credential-footer signature path.
if (!bundled.includes('NPI#') || !bundled.includes('License#')) {
  throw new Error('bundled missing Frontline NPI/License signature markers — abort');
}
if (!bundled.includes('Service Provided') || !bundled.includes('Provider Not Available')) {
  throw new Error('bundled missing Frontline Log Type labels — abort');
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
  'TMS Frontline Log Type attendance + note-embedded DOS + signature footer',
  `Function: ${fnName}`,
  `SHA: ${gitSha}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
  '',
  'Fixed false positives (Patel Sep 3rd week report):',
  '1. "first attend/treatment … MM/DD/YY" inside Service Provided no longer invents missed rows',
  '2. Same bug no longer truncates slice before Provider Signature → unsigned false positives',
  '3. Log Type before colon drives attendance (Service Provided / Provider Not Available / …)',
  '4. Credential footer (NPI# + License# + stamp) counts as signed',
  '5. Copy-paste gate unchanged (Figueroa ≡ Duroseau remains a real flag)',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-frontline-logtype-sign-deploy-out.txt'), summary);
console.log('\n' + summary);
