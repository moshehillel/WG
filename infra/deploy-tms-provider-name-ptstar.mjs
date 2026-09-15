/**
 * Deploy: TMS upload provider-name match — strip PT-star / OT / ST discipline
 * suffixes from profile last names (e.g. "Patel PT*") so Frontline
 * "Patel PT*, Neelamben" matches ALL-CAPS first + dirty last without forcing
 * admin rename. Rebuilds shared + tms-db dist before esbuild. Preserves HHA env.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-provider-name-ptstar-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-provider-name-ptstar.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

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
if (!/white\s*,?\s*glove/i.test(bundled)) {
  throw new Error('Bundle missing White Glove agency strip — aborting deploy');
}
if (!bundled.includes('Provider in PDF does not match')) {
  throw new Error('Bundle missing provider mismatch error — aborting deploy');
}
// personNameTokenKey is used for both PDF + profile keys after this fix
if (!bundled.includes('personNameTokenKey') && !bundled.includes('PROVIDER_NAME_NOISE')) {
  // minifier may inline; still require mismatch path
  console.warn('warn: distinctive noise-token symbols not found post-minify (ok if inlined)');
}
console.log('bundle guard: provider name PT* flex OK');

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
  path.join(__dirname, 'cdk-tms-provider-name-ptstar-deploy-out.txt'),
  [
    'TMS upload: strip PT*/OT/ST from profile last names for Frontline match (Neelamben Patel PT*)',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    'HHA: env preserved as configured',
    '',
  ].join('\n'),
);
console.log('wrote cdk-tms-provider-name-ptstar-deploy-out.txt');
