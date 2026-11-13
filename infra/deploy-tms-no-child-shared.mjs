/**
 * LIVE: TmsApiFn code only.
 *  - Option 2: one shared "No Child" HHA patient (Program Id NCSHARED, TMS row
 *    "no-child-shared"); district contracts are added to it with AddPatientContract.
 *  - Option 3: weekProgressReport lists every active child at 0% with no sessions.
 * No env change except the git stamp. HHA_USE_PRODUCTION must stay true. No CDK.
 * CreatePatient coordinator 84898, team 10022046, branch 10090277 are unchanged.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';

process.env.AWS_NO_VERIFY_SSL = '1';
const aws = 'aws --no-verify-ssl';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const fn = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const gitSha = `${readGitSha()}-tms-no-child-shared-2026-11-11`;

const sh = (cmd, cwd = repoRoot) => execSync(cmd, { encoding: 'utf8', cwd, stdio: 'inherit' });
const getEnv = () =>
  JSON.parse(
    execSync(
      `${aws} lambda get-function-configuration --function-name ${fn} --query Environment.Variables --output json`,
      { encoding: 'utf8' },
    ),
  );

const before = getEnv();
if (before.HHA_USE_PRODUCTION !== 'true') throw new Error('HHA_USE_PRODUCTION is not true; refusing');

sh('npm run build -w @white-glove/shared');
sh('npm run build -w @white-glove/tms-db');

const outDir = path.join(__dirname, 'tms-api-no-child-shared-asset');
const stageDir = path.join(__dirname, '_zip_stage_no_child_shared');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-no-child-shared.zip');
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
for (const t of ['NCSHARED', 'no-child-shared', '10022046', '84898', 'WGCC Therapy Services, 10090277']) {
  if (!bundled.includes(t)) throw new Error(`bundle missing ${t}`);
}
fs.mkdirSync(stageDir, { recursive: true });
for (const f of fs.readdirSync(stageDir)) fs.unlinkSync(path.join(stageDir, f));
fs.copyFileSync(outfile, path.join(stageDir, 'index.mjs'));
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
sh(
  `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stageDir, 'index.mjs').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  __dirname,
);
console.log(
  execSync(
    `${aws} lambda update-function-code --function-name ${fn} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  ),
);
execSync(`${aws} lambda wait function-updated --function-name ${fn} --region us-east-1`, { stdio: 'inherit' });
stampLambdaGitEnv(fn, { sha: gitSha });

const after = getEnv();
const lost = Object.keys(before).filter((k) => !(k in after));
const changed = Object.keys(before).filter(
  (k) => k in after && before[k] !== after[k] && !/^TMS_(GIT_SHA|BUILT_AT)$/.test(k),
);
console.log({
  HHA_USE_PRODUCTION: after.HHA_USE_PRODUCTION,
  HHA_TMS_BRANCH_ID: after.HHA_TMS_BRANCH_ID,
  HHA_COORDINATOR_ID: after.HHA_COORDINATOR_ID,
  HHA_TEAM_ID: after.HHA_TEAM_ID,
  lost,
  changed,
});
if (after.HHA_USE_PRODUCTION !== 'true' || lost.length || changed.length) throw new Error('env verification failed');
