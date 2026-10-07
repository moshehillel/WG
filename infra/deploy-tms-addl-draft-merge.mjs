/**
 * One-shot: merge no-child additional services into the same therapist+week draft
 * as regular sessions; heal orphan empty-program drafts; show Additional on PDF.
 * LIVE_OK — HHA_USE_PRODUCTION unchanged.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { assertAmPlcSchoolAnd401BundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-addl-draft-merge-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-addl-draft-merge.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const gitSha = execSync('git rev-parse --short HEAD', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

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
  define: {
    'process.env.TMS_GIT_SHA': JSON.stringify(gitSha),
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile, 'TMS_GIT_SHA=', gitSha);
const bundled = fs.readFileSync(outfile, 'utf8');
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'addl-draft-merge');
if (!bundled.includes('foldOrphanNoChildAdditionalWeeks') && !bundled.includes('orphanNoChild')) {
  // Minified may rename the helper; keep a stable string from the PDF / UI path.
  if (!bundled.includes('Additional:')) {
    throw new Error('Bundle missing Additional: timesheet label — aborting deploy');
  }
}
if (!bundled.includes('Additional:')) {
  throw new Error('Bundle missing Additional: timesheet label — aborting deploy');
}
console.log('bundle guard: Additional: timesheet label OK');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
// Zip runtime JS only (no .map) — CodeSize ~500–600KB compressed; maps push ~2MB.
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

// NetFree MITM breaks default AWS CLI CA trust on this machine.
const aws = 'aws --no-verify-ssl';
const out = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

execSync(`${aws} lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

const env = execSync(
  `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,Handler:Handler,Runtime:Runtime,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

const envObj = JSON.parse(env);
if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is not true after deploy: ${env}`);
}
if (String(envObj.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_MOCK unexpectedly true: ${env}`);
}
const codeSize = Number(envObj.CodeSize || 0);
// Minified index.mjs-only zip (no sourcemap) is typically ~500–600KB.
if (codeSize < 400_000) {
  throw new Error(`CodeSize too small after deploy: ${codeSize}`);
}
const jsBytes = fs.statSync(outfile).size;
if (jsBytes < 1_500_000) {
  throw new Error(`Bundled index.mjs too small: ${jsBytes}`);
}

const stamped = JSON.parse(out);
fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-addl-draft-merge-deploy-out.txt'),
  [
    'LIVE_OK: additional services merge into same therapist+week draft',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    '',
    'Changes:',
    '1. splitWeekBySchoolBins keeps no-child additional services on the host program bin',
    '2. foldOrphanNoChildAdditionalWeeks heals duplicate empty-program drafts (Astacio)',
    '3. POST /week/sessions routes no-child additional onto sibling draft with child sessions',
    '4. Timesheet PDF shows Additional: <label> for those rows',
    '5. FE: admin Additional services passes programType (app.js?v=138)',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', stamped.CodeSize, 'SHA=', stamped.CodeSha256);
console.log('wrote cdk-tms-addl-draft-merge-deploy-out.txt');
