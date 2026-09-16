import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-program-bin-merge-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-program-bin-merge.zip');
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
// Minified may rename helpers; keep stable API response field names.
if (!bundled.includes('draftWeeks') || !bundled.includes('programType')) {
  throw new Error('Bundle missing draftWeeks/programType — aborting deploy');
}
console.log('bundle guard: draftWeeks + programType OK');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
// Zip only index.mjs (skip .map — Windows often locks the map after esbuild).
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

execSync(`aws lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,Handler:Handler,Runtime:Runtime,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

const envObj = JSON.parse(env);
if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION is not true after deploy: ${env}`);
}
const codeSize = Number(envObj.CodeSize || 0);
if (codeSize < 2_000_000) {
  throw new Error(`CodeSize too small after deploy: ${codeSize}`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-program-bin-merge-deploy-out.txt'),
  [
    'TMS: timesheet bins by program type only; merge signed+unsigned Carle Place drafts',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved',
    'LIVE_OK: HHA_USE_PRODUCTION=true, CodeSize>=2MB',
    '',
    'Changes:',
    '1. timesheetBinKeyForParts is programType only (signer/school no longer split bins)',
    '2. GET /weeks folds same program drafts; prefers provider-signed fragment',
    '3. Draft list dedupe key drops signerEmail',
    '4. Upload/session routing prefers programType scope over building schoolId',
    '5. FE copy + app.js?v=119',
  ].join('\n') + '\n',
);
console.log('LIVE_OK wrote cdk-tms-program-bin-merge-deploy-out.txt');
