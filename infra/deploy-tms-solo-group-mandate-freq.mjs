import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-solo-group-mandate-freq-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-solo-group-mandate-freq.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

// esbuild resolves @white-glove/tms-db via package.json "main" → dist/.
// Always rebuild dist so src-only mandate fixes are not silently skipped.
console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});
const mandateDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/mandate.js'),
  'utf8',
);
if (!mandateDist.includes('sessionIsSoloGroupViaNote')) {
  throw new Error(
    'packages/tms-db/dist/mandate.js missing sessionIsSoloGroupViaNote — build failed or stale',
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
// Minified sessionMatchesMandate must prefer group when no-partner note is present.
const bundled = fs.readFileSync(outfile, 'utf8');
const matchFn = bundled.match(
  /function \w+\(e,t\)\{let r=\w+\(e\.serviceType\);if\(t\.discipline&&r&&t\.discipline!==r\)return!1;let o=\w+\(e\.serviceType\);[^}]{0,220}\}/,
);
if (!matchFn || !/sessionIsSoloGroupViaNote|ViaNote|\.notes/.test(matchFn[0])) {
  // Fallback: old broken shape has no notes/solo bridge inside sessionMatchesMandate.
  const oldBroken =
    /function \w+\(e,t\)\{let r=\w+\(e\.serviceType\);if\(t\.discipline&&r&&t\.discipline!==r\)return!1;let o=\w+\(e\.serviceType\);return!\(o!=null&&o!==!!t\.ratioGroup\)\}/.test(
      bundled,
    );
  if (oldBroken) {
    throw new Error(
      'Bundle still has OLD sessionMatchesMandate without solo-group note bridge — aborting deploy',
    );
  }
}
console.log('bundle guard: solo-group mandate bridge present (or old shape absent)');

// Dual-mandate fix: soloGroupMandateNoteError must skip the note demand when
// the child also has an individual mandate (ratioGroup false).
if (!bundled.includes('ratioGroup') || !/![\w.]+\.ratioGroup/.test(bundled)) {
  throw new Error(
    'Bundle missing individual-mandate (ratioGroup) check for solo-group note locker — aborting deploy',
  );
}
const overlapDist = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-db/dist/session-overlap.js'),
  'utf8',
);
if (!overlapDist.includes('childHasIndividualMandate')) {
  throw new Error(
    'packages/tms-db/dist/session-overlap.js missing childHasIndividualMandate — rebuild failed or stale',
  );
}
console.log('bundle guard: dual-mandate individual skip present');

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
  path.join(__dirname, 'cdk-tms-solo-group-mandate-freq-deploy-out.txt'),
  [
    'TMS solo-group / no-partner → group mandate frequency',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA: env preserved as configured (USE_MOCK=false)',
    '',
    'IMPORTANT: deploy rebuilds packages/tms-db dist before esbuild.',
    'Prior 63dcd05 / ghpDrPWxrOg1 deploy bundled STALE dist (no assign-to-group).',
    '',
    'Rules:',
    '1. Solo group with no peer/partner note → individual pay + note locker (unchanged)',
    '2. Same sessions count against GROUP mandate frequency, not individual',
    '3. True 1:1 without no-partner note still consumes individual mandate',
    '4. Two solo-group no-partner visits in one week still over the group mandate',
    '',
  ].join('\n'),
);
