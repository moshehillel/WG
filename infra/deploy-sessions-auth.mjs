/**
 * Deploy API Report sessions auth (CreatePatientAuthorization + AuthorizationID on CreateSchedule).
 * Lambda code update ONLY — does not touch EventBridge. Re-disables schedules after deploy.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const sessionsNames = execSync(
  `aws lambda list-functions --region us-east-1 --query "Functions[?contains(FunctionName, 'SessionsFn')].FunctionName" --output text`,
  { encoding: 'utf8' },
)
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const fnName =
  sessionsNames.find((n) => n.includes('SessionsFn37158A11')) ?? sessionsNames[0];
if (!fnName) throw new Error('SessionsFn not found');

const outDir = path.join(__dirname, 'proc-sessions-auth-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'proc-sessions-auth.zip');

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/processors/src/handlers/sessions.ts')],
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
if (!bundled.includes('AuthorizationID') && !bundled.includes('ensureSessionAuthorization') && !bundled.includes('API-')) {
  // Minified may still keep AuthorizationID string from schedule-builder
  if (!bundled.includes('AuthorizationID')) {
    throw new Error('Sessions bundle missing AuthorizationID / session auth markers');
  }
}
console.log(`bundled ${fs.statSync(outfile).size} bytes hasAuthId=${bundled.includes('AuthorizationID')}`);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(fnName, out.trim());

const rules = [
  'WhiteGloveStack-NightlyCaseReportsSchedule20498DCD-BuDJo8jy9dRx',
  'WhiteGloveStack-TuesdaySessionsScheduleC5134705-0uEUJoPO4wcQ',
  'WhiteGloveStack-TmsDueNagRule49708B69-wW1MPrUYdhZ8',
  'WhiteGloveStack-TmsHhaErrorDigestRule7EC0D6ED-gksVbviFOmnb',
  'WhiteGlove-TmsHhaAutoTransfer',
];
for (const name of rules) {
  execSync(`aws events disable-rule --name "${name}"`, { stdio: 'inherit' });
}
const status = execSync(
  `aws events list-rules --query "Rules[?contains(Name, 'WhiteGlove') || contains(Name, 'Nightly') || contains(Name, 'Tuesday') || contains(Name, 'Tms')].[Name,State]" --output table`,
  { encoding: 'utf8' },
);
console.log(status);

fs.writeFileSync(
  path.join(__dirname, 'cdk-sessions-auth-deploy-out.txt'),
  [`Sessions auth deploy ${new Date().toISOString()}`, fnName, out.trim(), status].join('\n') + '\n',
);
console.log('Wrote cdk-sessions-auth-deploy-out.txt — schedules force-DISABLED after lambda update');
