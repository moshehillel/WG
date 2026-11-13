/**
 * LIVE: TmsApiFn only. Sets HHA_TMS_BRANCH_ID=10090277 (WGCC Therapy Services,
 * the branch on existing therapy charts; Moshe directed 2026-11-11) and deploys
 * current code. Merges env (nothing else changed). HHA_USE_PRODUCTION must stay true.
 * No CDK, no schedule changes.
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
const BRANCH = '10090277';
const gitSha = `${readGitSha()}-tms-therapy-branch-2026-11-11`;

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

const outDir = path.join(__dirname, 'tms-api-therapy-branch-asset');
const stageDir = path.join(__dirname, '_zip_stage_therapy-branch');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-therapy-branch.zip');
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
for (const t of ['10022046', '84898', 'WGCC Therapy Services, 10090277']) {
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

// Merge branch into the CURRENT env (after stamp), preserving everything else.
const cfg = getEnv();
cfg.HHA_CREATE_PATIENT_CHANNEL = 'tms';
cfg.HHA_TMS_BRANCH_ID = BRANCH;
delete cfg.HHA_BRANCH_ID;
const envPath = path.join(__dirname, '_tmp-tms-therapy-branch-env.json');
fs.writeFileSync(envPath, JSON.stringify({ Variables: cfg }));
sh(
  `${aws} lambda update-function-configuration --function-name ${fn} --environment file://${envPath} --region us-east-1 --query "LastModified" --output text`,
  __dirname,
);
execSync(`${aws} lambda wait function-updated --function-name ${fn} --region us-east-1`, { stdio: 'inherit' });
fs.unlinkSync(envPath);

const after = getEnv();
const lost = Object.keys(before).filter((k) => !(k in after) && k !== 'HHA_BRANCH_ID');
const changed = Object.keys(before).filter(
  (k) => k in after && before[k] !== after[k] && !/^TMS_(GIT_SHA|BUILT_AT)$/.test(k),
);
console.log({
  HHA_USE_PRODUCTION: after.HHA_USE_PRODUCTION,
  HHA_TMS_BRANCH_ID: after.HHA_TMS_BRANCH_ID,
  HHA_CREATE_PATIENT_CHANNEL: after.HHA_CREATE_PATIENT_CHANNEL,
  HHA_COORDINATOR_ID: after.HHA_COORDINATOR_ID,
  HHA_TEAM_ID: after.HHA_TEAM_ID,
  lost,
  changed,
});
if (after.HHA_USE_PRODUCTION !== 'true' || lost.length || changed.length) throw new Error('env verification failed');
