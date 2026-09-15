import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-child-internal-notes-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-child-internal-notes.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
const reportsDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/reports.js'),
  'utf8',
);
if (!reportsDist.includes('notesForStudent') && !reportsDist.includes('subjectKind')) {
  // notesForStudent lives in memory-store; report rows include subjectKind.
  if (!reportsDist.includes('subjectKind')) {
    throw new Error(
      'packages/tms-db/dist/reports.js missing subjectKind — build failed or stale',
    );
  }
}
const storeDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/memory-store.js'),
  'utf8',
);
if (!storeDist.includes('notesForStudent')) {
  throw new Error(
    'packages/tms-db/dist/memory-store.js missing notesForStudent — build failed or stale',
  );
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
if (!bundled.includes('notesForStudent')) {
  throw new Error('Bundle missing notesForStudent — aborting deploy');
}
if (!bundled.includes('subjectKind')) {
  throw new Error('Bundle missing subjectKind on internal-notes report — aborting deploy');
}
console.log('bundle guard: child internal notes OK');

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

const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,Handler:Handler,Runtime:Runtime}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-child-internal-notes-deploy-out.txt'),
  [
    'TMS admin child Internal notes + report subject columns',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA: env preserved as configured (HHA_USE_PRODUCTION left as-is)',
    '',
    'Changes:',
    '1. POST/GET/PATCH/DELETE /admin/students/:id/notes',
    '2. Child detail includes notes + noteTagOptions',
    '3. Reports internal-notes includes child notes (On / Name columns)',
    '4. FE: Children → Internal notes (app.js?v=100)',
    '',
  ].join('\n'),
);
