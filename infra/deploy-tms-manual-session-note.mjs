import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-manual-session-note-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-manual-session-note.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

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
  sessionNoteKind: bundled.includes('session_note'),
  sessionNoteLabel: bundled.includes('Session note file'),
  filesSessionId: bundled.includes('sessionId'),
  lockerProviders: bundled.includes('tms/locker/providers/'),
  signNow: /signnow|SignNow|preferSignNow|PREFER_SIGNNOW/i.test(bundled),
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
  path.join(__dirname, 'cdk-tms-manual-session-note-deploy-out.txt'),
  [
    'TMS: admin manual session note + optional file attachment (no parse)',
    `Function: ${fnName}`,
    `TMS_GIT_SHA: ${stamped.sha}`,
    `TMS_BUILT_AT: ${stamped.builtAt}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved',
    '',
    'IMPORTANT: rebuilds packages/tms-db dist before esbuild (manual session note).',
    '',
    'Changes:',
    '1. POST /week/sessions accepts optional fileBase64 (doc/docx/pdf) — stores on locker only',
    '2. StoredFile.sessionId + kind session_note; POST /files accepts sessionId',
    '3. Provider file list includes session_note attachments',
    '4. Does NOT run session-parse on the attachment',
    '',
  ].join('\n') + '\n',
);
console.log('wrote infra/cdk-tms-manual-session-note-deploy-out.txt');
console.log('LIVE_OK CodeSize=', codeSize, 'SHA=', stamped.sha);
