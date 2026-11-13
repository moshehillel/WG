/**
 * Code deploy: Frontline "Student Not Available: Paid absence." → attendance
 * paid_absence with Session Start/End kept. Trains rules parser + Bedrock reader.
 * Does not change HHA_USE_PRODUCTION, coordinator ids, or create visits.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';

process.env.AWS_NO_VERIFY_SSL = '1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-paid-absence-reader-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-paid-absence-reader.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const parseSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/src/session-parse.ts'),
  'utf8',
);
if (!parseSrc.includes('PAID_ABSENCE_RE') || !parseSrc.includes("return 'paid_absence'")) {
  throw new Error('session-parse.ts missing paid_absence recognition — aborting');
}
if (!parseSrc.includes('paidAbsenceRow')) {
  throw new Error('session-parse.ts missing Frontline paid-absence clock keep — aborting');
}

const noteReadSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-api/src/note-read.ts'),
  'utf8',
);
if (!noteReadSrc.includes('paid_absence')) {
  throw new Error('note-read.ts missing paid_absence AI reader label — aborting');
}

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
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

console.log('bundled', outfile);
const bundled = fs.readFileSync(outfile, 'utf8');
if (!bundled.includes('paid_absence') || !bundled.includes('paid absence')) {
  throw new Error('Bundle missing paid_absence reader strings — aborting deploy');
}
console.log('bundle guard: paid absence reader OK');

const aws = 'aws --no-verify-ssl';
const envQuery =
  '{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,Handler:Handler,Runtime:Runtime}';
const envBefore = execSync(
  `${aws} lambda get-function-configuration --function-name ${fnName} --query "${envQuery}" --output json`,
  { encoding: 'utf8' },
);
console.log('env before', envBefore);
const before = JSON.parse(envBefore);
if (before.HHA_USE_PRODUCTION !== true && before.HHA_USE_PRODUCTION !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${before.HHA_USE_PRODUCTION}`);
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const out = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

stampLambdaGitEnv(fnName, { sha: readGitSha() });

const env = execSync(
  `${aws} lambda get-function-configuration --function-name ${fnName} --query "${envQuery}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);
const after = JSON.parse(env);
if (after.HHA_USE_PRODUCTION !== true && after.HHA_USE_PRODUCTION !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION changed: ${after.HHA_USE_PRODUCTION}`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-paid-absence-reader-deploy-out.txt'),
  [
    'TMS paid absence reader: Student Not Available: Paid absence. → paid_absence + times',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION left true; no visit or coordinator changes',
    '',
  ].join('\n'),
);
