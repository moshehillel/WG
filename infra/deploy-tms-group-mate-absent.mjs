import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-group-mate-absent-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-group-mate-absent.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

// esbuild resolves @white-glove/tms-db via package.json "main" → dist/.
console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const mandateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/mandate.js'),
  'utf8',
);
if (!mandateDist.includes('sessionMandateNoteContext')) {
  throw new Error(
    'packages/tms-db/dist/mandate.js missing sessionMandateNoteContext — build failed or stale',
  );
}
if (!mandateDist.includes('Reason from note')) {
  throw new Error('packages/tms-db/dist/mandate.js missing Reason from note — aborting');
}
if (!fs.readFileSync(path.join(repoRoot, 'packages/tms-db/dist/session-parse.js'), 'utf8').includes('clipSessionNotes')) {
  throw new Error('packages/tms-db/dist/session-parse.js missing clipSessionNotes — aborting');
}
if (!mandateDist.includes('group\\s*mates?') && !mandateDist.includes('group\\s*mates')) {
  // Bundled source may escape differently; also accept literal "group mate" patterns.
  if (!/group.?mates?/i.test(mandateDist)) {
    throw new Error(
      'packages/tms-db/dist/mandate.js missing group-mate peer-absent patterns — aborting',
    );
  }
}

const parseDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/session-parse.js'),
  'utf8',
);
if (!parseDist.includes('scrubPeerAbsentPhrases') && !parseDist.includes('notesMentionNoPeerAvailable')) {
  throw new Error(
    'packages/tms-db/dist/session-parse.js missing peer-absent attendance guard — aborting',
  );
}
console.log('dist guard: group-mate absent + mandate note context OK');

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
if (!bundled.includes('Reason from note') && !bundled.includes('no partner available')) {
  throw new Error('Bundle missing over-mandate note-context reason — aborting deploy');
}
if (!bundled.includes('clipSessionNotes') && !bundled.includes('If this session covers the group mandate')) {
  throw new Error('Bundle missing note-clip / dual-mandate group hint — aborting deploy');
}
if (!/group.?mate|groupmates\?/i.test(bundled)) {
  throw new Error('Bundle missing group-mate peer-absent patterns — aborting deploy');
}
console.log('bundle guard: group-mate absent + exact mandate reasons present');

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
  path.join(__dirname, 'cdk-tms-group-mate-absent-deploy-out.txt'),
  [
    'TMS group-mate absent → attended + exact over-mandate note reasons',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA: env preserved as configured (HHA_USE_PRODUCTION unchanged)',
    '',
    'IMPORTANT: deploy rebuilds packages/tms-db dist before esbuild.',
    '',
    'Rules:',
    '1. Service Provided + group mate/partner absent → attended (not missed)',
    '2. Same note matches solo-group / no partner available path',
    '3. Over-mandate messages include Reason from note: no partner available and/or makeup session',
    '4. True Student Absence / Frontline miss labels still missed',
    '',
  ].join('\n'),
);
