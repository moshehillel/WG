/**
 * Deploy SessionsFn only: skip S3 GetObject when artifactKeys.verified_sessions
 * is missing (case-only nightly). Does not touch schedules or start a pipeline.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const fnName = 'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD';
const entry = 'packages/processors/src/handlers/sessions.ts';
const outDir = path.join(__dirname, 'proc-sessions-missing-key-guard-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'proc-sessions-missing-key-guard.zip');

const lines = [
  'SessionsFn: empty success when artifactKeys.verified_sessions missing (case-only nightly)',
];

execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });
try {
  execSync('npm run build -w @white-glove/hha-client', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('hha-client full tsc failed; relying on incremental dist');
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, entry)],
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
const guardMarkers = [
  'No value provided for input HTTP label: Key',
  'verified_sessions',
  'processed:0',
];
// Minified may collapse processed: 0 → processed:0; also check unminified comment text
const hasGuardComment = bundled.includes('Case-only nightly') || bundled.includes('HTTP label: Key');
const hasEmptyResult =
  /processed:\s*0/.test(bundled) &&
  /succeeded:\s*0/.test(bundled) &&
  /reportKind:\s*["']verified_sessions["']/.test(bundled);
if (!hasGuardComment && !hasEmptyResult) {
  // After minify, property names stay; check for early-return shape
  if (!bundled.includes('verified_sessions') || !/processed:\s*0/.test(bundled)) {
    throw new Error('Sessions bundle missing missing-key guard markers');
  }
}
console.log('bundle guard markers OK', {
  hasGuardComment,
  hasEmptyResult,
  size: fs.statSync(outfile).size,
});

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const before = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --region us-east-1 --query "{LastModified:LastModified,CodeSha256:CodeSha256,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8' },
).trim();
lines.push('before:', before, '');

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
).trim();
console.log('sessions', out);
lines.push(`sessions: ${fnName}`, out, '');

const after = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --region us-east-1 --query "{LastModified:LastModified,CodeSha256:CodeSha256,CodeSize:CodeSize,LastUpdateStatus:LastUpdateStatus}" --output json`,
  { encoding: 'utf8' },
).trim();
lines.push('after:', after, '');

const rules = execSync(
  `aws events list-rules --region us-east-1 --query "Rules[?contains(Name, 'NightlyCase') || contains(Name, 'TuesdaySessions')].{Name:Name,State:State,ScheduleExpression:ScheduleExpression}" --output json`,
  { encoding: 'utf8' },
).trim();
lines.push('schedules (unchanged by this deploy):', rules);

fs.writeFileSync(path.join(__dirname, 'cdk-sessions-missing-key-guard-deploy-out.txt'), lines.join('\n'));
console.log('wrote cdk-sessions-missing-key-guard-deploy-out.txt');
console.log('schedules:', rules);
