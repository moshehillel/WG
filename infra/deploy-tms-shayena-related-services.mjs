/**
 * LIVE_OK: refresh locked-week programType when stamp has no HHA ContractID but
 * caseload students do (Related Services → Valley Stream SD 24), and fix
 * SearchCaregivers for multi-word "Last, First" surnames (Donaldson Fortune).
 * HHA_USE_PRODUCTION unchanged.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { assertAmPlcSchoolAnd401BundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-shayena-related-services-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-shayena-related-services.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
// hha-client full tsc is currently broken (missing ent-* sources). Compile only
// the caregiver name-order module into dist so the API bundle picks it up.
console.log('compiling hha-client hha-time.ts → dist…');
execSync(
  'npx esbuild packages/hha-client/src/hha-time.ts --outfile=packages/hha-client/dist/hha-time.js --format=esm --platform=node --packages=external',
  { cwd: repoRoot, stdio: 'inherit' },
);

const gitSha = execSync('git rev-parse --short HEAD', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
const buildTag = `${gitSha}-shayena-rs`;

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
    'process.env.TMS_GIT_SHA': JSON.stringify(buildTag),
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile, 'TMS_GIT_SHA=', buildTag);

const transferSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'),
  'utf8',
);
if (
  !transferSrc.includes('dominantProgramTypeForSessions') ||
  !transferSrc.includes('lookupContractId(liveProgram)') ||
  !transferSrc.includes('stamped programType forever')
) {
  throw new Error('hha-transfer.ts missing week programType refresh — aborting deploy');
}
const caregiverSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/hha-client/src/hha-time.ts'),
  'utf8',
);
if (
  !caregiverSrc.includes('Multi-word surnames') ||
  !caregiverSrc.includes('Donaldson Fortune') ||
  !caregiverSrc.includes('dedupeCaregiverNameAttempts')
) {
  throw new Error('hha-time.ts missing compound Last, First caregiver search — aborting deploy');
}

const bundled = fs.readFileSync(outfile, 'utf8');
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'shayena-related-services');
if (!bundled.includes('No HHA ContractID for program type')) {
  throw new Error('Bundle missing ContractID error text — aborting deploy');
}
if (!bundled.includes('Caregiver not found in HHA for provider')) {
  throw new Error('Bundle missing caregiver error text — aborting deploy');
}
console.log('bundle guard: Related Services program refresh + caregiver name orders OK');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  // NetFree MITM breaks default AWS CA verify on this machine.
  `aws --no-verify-ssl lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);
const summary = [
  'LIVE_OK: Shayena Related Services → VS24 week refresh + compound caregiver name',
  `Function: ${fnName}`,
  `TMS_GIT_SHA (build define): ${buildTag}`,
  out.trim(),
  'HHA_USE_PRODUCTION unchanged',
  '',
  'Changes:',
  '1. transferLockedWeek refreshes week.programType when stamp has no ContractID but students do',
  '2. caregiverSearchNameOrders keeps multi-word Last, First (Donaldson Fortune, Shayena)',
  '3. Data repair: WRITE=1 node infra/repair-shayena-related-services.mjs',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-shayena-related-services-deploy-out.txt'), summary + '\n');

console.log(
  JSON.stringify(
    {
      ok: true,
      fnName,
      buildTag,
      note: 'After deploy: run WRITE=1 node infra/repair-shayena-related-services.mjs then Retry HHA on Shayena weeks.',
    },
    null,
    2,
  ),
);
