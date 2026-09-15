import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-makeup-covered-date-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-makeup-covered-date.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const makeupDateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/makeup-date.js'),
  'utf8',
);
if (
  !makeupDateDist.includes('MAKEUP_COVERED_DATE_PREFIX') ||
  !makeupDateDist.includes('extractMakeupForDate') ||
  !/make.?up.?session/i.test(makeupDateDist)
) {
  throw new Error(
    'packages/tms-db/dist/makeup-date.js missing make-up session covered-date extract — build failed or stale',
  );
}

const gitSha = readGitSha();

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
const guards = {
  makeupCovered: bundled.includes('MAKEUP_COVERED_DATE_PREFIX') || /make.?up.?session/i.test(bundled),
  signNow: /signnow|SignNow|preferSignNow|PREFER_SIGNNOW/i.test(bundled),
  sessionNotes: /session-notes|sessionNotes|districtOptions/i.test(bundled),
  programBins:
    bundled.includes('timesheetBinKeyForParts') ||
    bundled.includes('normalizeProgramTypeKey') ||
    bundled.includes('siblingWeeks'),
};
for (const [k, ok] of Object.entries(guards)) {
  if (!ok) throw new Error(`Bundle missing ${k} marker — aborting deploy (possible stale/partial build)`);
}
console.log('bundle guards OK:', Object.keys(guards).join(', '));

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

const stamped = stampLambdaGitEnv(fnName, { sha: gitSha });

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,Handler:Handler,Runtime:Runtime,CodeSize:CodeSize,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

const envObj = JSON.parse(env);
if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION is not true after deploy: ${env}`);
}
const codeSize = Number(envObj.CodeSize || 0);
if (codeSize < 2_000_000) {
  throw new Error(
    `CodeSize ${codeSize} looks like DocuSign-era rollback (~1.97MB); expected ~2.05MB+`,
  );
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-makeup-covered-date-deploy-out.txt'),
  [
    'TMS: Frontline makeup covered-miss date (no phantom misses)',
    `Function: ${fnName}`,
    `TMS_GIT_SHA: ${stamped.sha}`,
    `TMS_BUILT_AT: ${stamped.builtAt}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved',
    '',
    'IMPORTANT: rebuilds packages/tms-db dist before esbuild (makeup covered date).',
    '',
    'Changes:',
    '1. Parse "make-up session MM/DD/YY" as the covered miss date',
    '2. Do not invent a separate missed session from that date in the makeup note',
    '3. Normalize notes with Make up for: DATE so resolveMakeup links correctly',
    '',
  ].join('\n') + '\n',
);
console.log('wrote infra/cdk-tms-makeup-covered-date-deploy-out.txt');
console.log('LIVE_OK CodeSize=', codeSize, 'SHA=', stamped.sha);
