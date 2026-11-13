/**
 * Deploy ParseFn only: copy Extended Mandate CSV columns onto parsed opened rows
 * (extendedMandateTimes / extendedMandateFrequency) so OpenedFn resolveAuthMandate
 * sees them. Code update only — does not touch env, discharge_service, or SLP→ST.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const region = process.env.AWS_REGION || 'us-east-1';

const outDir = path.join(__dirname, 'proc-parse-extended-mandate-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'proc-parse-extended-mandate.zip');
const deployOut = path.join(__dirname, 'cdk-parse-extended-mandate-deploy-out.txt');

function aws(cmd) {
  return execSync(`aws ${cmd} --region ${region}`, {
    encoding: 'utf8',
    cwd: __dirname,
  });
}

const fnName = aws(
  `lambda list-functions --query "Functions[?starts_with(FunctionName, 'WhiteGloveStack-ParseFn')].FunctionName | [0]" --output text`,
).trim();
if (!fnName || fnName === 'None') {
  throw new Error('Could not resolve WhiteGloveStack-ParseFn');
}

const before = aws(
  `lambda get-function-configuration --function-name ${fnName} --query "{LastModified:LastModified,CodeSha256:CodeSha256,CodeSize:CodeSize}" --output json`,
).trim();
console.log('before', before);

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/processors/src/handlers/parse.ts')],
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
const markers = {
  timesPerExtended: bundled.includes('times_per_extended_mandate'),
  extendedFrequency: bundled.includes('extended_mandate_frequency'),
  extendedTimesAlt: bundled.includes('extended_mandate_times'),
  noSlpRewrite: !/SLP\s*→\s*ST|slp.?to.?st/i.test(bundled),
};
console.log('parse markers', { size: fs.statSync(outfile).size, ...markers });
if (!markers.timesPerExtended || !markers.extendedFrequency) {
  throw new Error('Parse bundle missing extended mandate header mapping');
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const mapFile = outfile + '.map';
const zipInputs = [outfile, ...(fs.existsSync(mapFile) ? [mapFile] : [])]
  .map((p) => `'${p.replace(/'/g, "''")}'`)
  .join(', ');
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path ${zipInputs} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const out = aws(
  `lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
).trim();

for (let i = 0; i < 30; i++) {
  const status = aws(
    `lambda get-function-configuration --function-name ${fnName} --query LastUpdateStatus --output text`,
  ).trim();
  if (status === 'Successful') break;
  if (status === 'Failed') throw new Error(`ParseFn update failed: ${status}`);
  execSync('powershell -NoProfile -Command "Start-Sleep -Seconds 2"');
}

const after = aws(
  `lambda get-function --function-name ${fnName} --query "{CodeSha256:Configuration.CodeSha256,LastModified:Configuration.LastModified,CodeSize:Configuration.CodeSize,LastUpdateStatus:Configuration.LastUpdateStatus,Location:Code.Location}" --output json`,
);
const meta = JSON.parse(after);
const liveZip = path.join(__dirname, 'proc-parse-extended-mandate-live.zip');
execSync(
  `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${String(meta.Location).replace(/'/g, "''")}' -OutFile '${liveZip.replace(/'/g, "''")}'"`,
  { stdio: 'inherit' },
);
const liveDir = path.join(__dirname, 'proc-parse-extended-mandate-live');
fs.rmSync(liveDir, { recursive: true, force: true });
fs.mkdirSync(liveDir, { recursive: true });
execSync(
  `powershell -NoProfile -Command "Expand-Archive -Path '${liveZip.replace(/'/g, "''")}' -DestinationPath '${liveDir.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
const liveBundle = fs.readFileSync(path.join(liveDir, 'index.mjs'), 'utf8');
const liveHas =
  liveBundle.includes('times_per_extended_mandate') &&
  liveBundle.includes('extended_mandate_frequency');
if (!liveHas) {
  throw new Error('Live ParseFn bundle missing extended mandate field mapping');
}

const lines = [
  'ParseFn: copy Extended Mandate columns onto parsed rows',
  `fn: ${fnName}`,
  `before: ${before}`,
  `update: ${out}`,
  `live CodeSha256: ${meta.CodeSha256}`,
  `live LastModified: ${meta.LastModified}`,
  `live LastUpdateStatus: ${meta.LastUpdateStatus}`,
  `live bundle has times_per_extended_mandate + extended_mandate_frequency: ${liveHas}`,
];
fs.writeFileSync(deployOut, lines.join('\n') + '\n');
console.log(lines.join('\n'));
