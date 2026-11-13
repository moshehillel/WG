/**
 * Deploy OpenedFn: PatientID-only GetPatientContracts reuse for AddPatientContract -74
 * (already-ACTIVE placement treated as idempotent success).
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const fnName = 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC';
const outDir = path.join(__dirname, 'proc-opened-74-reuse-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'proc-opened-74-reuse.zip');
const deployOut = path.join(__dirname, 'cdk-opened-74-reuse-deploy-out.txt');

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/processors/src/handlers/opened.ts')],
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
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

const bundled = fs.readFileSync(outfile, 'utf8');
const hasAll =
  bundled.includes('getPatientContractsAll') ||
  /GetPatientContracts[\s\S]{0,80}<PatientID>/.test(bundled) ||
  bundled.includes('PatientID-only');
// Minified may inline the PatientID-only call as `<PatientID>${...}</PatientID>` without VisitDate nearby.
const hasPatientIdOnlyCall =
  bundled.includes('getPatientContractsAll') ||
  (bundled.includes('GetPatientContracts') &&
    bundled.includes('placement overlaps') &&
    bundled.includes('findReusableContractPlacement') === false); // minified names differ

// Safer markers that survive minify:
const markers = {
  overlapMsg: /placement overlaps with an existing placement/i.test(bundled),
  patientIdTag: bundled.includes('<PatientID>'),
  addContract: bundled.includes('AddPatientContract'),
};
console.log('opened markers', {
  size: fs.statSync(outfile).size,
  ...markers,
  hasGetPatientContractsAllLiteral: bundled.includes('getPatientContractsAll'),
});
if (!markers.overlapMsg || !markers.addContract) {
  throw new Error('Opened bundle missing -74 overlap recovery / AddPatientContract');
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION}" --output json`,
  { encoding: 'utf8' },
);

const lines = [
  'OpenedFn: PatientID-only placement reuse for AddPatientContract -74 (already-ACTIVE → success)',
  `fn: ${fnName}`,
  out.trim(),
  env.trim(),
];
fs.writeFileSync(deployOut, lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`Wrote ${path.basename(deployOut)}`);
