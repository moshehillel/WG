/**
 * LIVE_OK: HHA SOAP dates always YYYY-MM-DD (MM/DD/YY included).
 * Bundles the live Fred Keller worktree (223ddfb+) — not the dirty sibling checkout.
 * HHA_USE_PRODUCTION unchanged.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv } from './deploy-stamp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dirtyRoot = path.join(__dirname, '..');
const repoRoot = 'C:\\Users\\Moshe\\Desktop\\custom-projects\\White-glove-keller-period';
const outDir = path.join(__dirname, 'tms-api-allxsd-date-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-allxsd-date.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const stampSuffix = 'allxsd-date';

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
  });
}

const dateSrc = fs.readFileSync(path.join(repoRoot, 'packages/hha-client/src/hha-time.ts'), 'utf8');
if (!dateSrc.includes('yearNum <= 69') || !dateSrc.includes('1900 + yearNum')) {
  throw new Error('worktree psDateToIso missing two-digit year window — abort');
}

const contractSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/shared/src/config/contract-map.ts'),
  'utf8',
);
if (!contractSrc.includes('normalizeContractName') || !contractSrc.includes('replace(/\\./g')) {
  throw new Error('worktree contract-map missing period-optional compare — abort');
}
if (contractSrc.includes('"Fred S Keller School"')) {
  throw new Error('worktree invented a Fred S Keller alias — abort');
}

const districtsSrc = path.join(dirtyRoot, 'packages/tms-db/src/districts.ts');
const districtsDest = path.join(repoRoot, 'packages/tms-db/src/districts.ts');
if (!fs.existsSync(districtsDest) && fs.existsSync(districtsSrc)) {
  fs.copyFileSync(districtsSrc, districtsDest);
}

function fallbackMissing(importer, spec) {
  if (!spec.startsWith('.')) return null;
  const fromDir = path.dirname(importer);
  const wanted = path.resolve(fromDir, spec);
  const local = [wanted, wanted.replace(/\.js$/, '.ts'), `${wanted}.ts`];
  if (local.some((p) => fs.existsSync(p) && fs.statSync(p).isFile())) return null;
  const rel = path.relative(repoRoot, wanted);
  if (rel.startsWith('..')) return null;
  const orig = path.join(dirtyRoot, rel);
  const tries = [orig, orig.replace(/\.js$/, '.ts'), orig.replace(/\.js$/, '.js')];
  const distRel = rel.replace(/[\\/]src[\\/]/, `${path.sep}dist${path.sep}`);
  const dist = path.join(dirtyRoot, distRel);
  tries.push(dist, dist.replace(/\.ts$/, '.js'), dist.replace(/\.js$/, '.js'));
  for (const candidate of tries) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: repoRoot }).trim();
const stamp = `${gitSha}-${stampSuffix}`;
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

const fallbackHits = [];
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
  define: { 'process.env.TMS_GIT_SHA': JSON.stringify(stamp) },
  alias: {
    '@white-glove/shared': path.join(repoRoot, 'packages/shared/src/index.ts'),
    '@white-glove/hha-client': path.join(repoRoot, 'packages/hha-client/src/index.ts'),
    '@white-glove/tms-db': path.join(repoRoot, 'packages/tms-db/src/index.ts'),
  },
  nodePaths: [path.join(dirtyRoot, 'node_modules')],
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
  plugins: [
    {
      name: 'fallback-missing-worktree-files',
      setup(build) {
        build.onResolve({ filter: /^\./ }, (args) => {
          const hit = fallbackMissing(args.importer, args.path);
          if (!hit) return null;
          fallbackHits.push(hit);
          return { path: hit };
        });
      },
    },
  ],
});

if (fallbackHits.some((p) => /hha-time|hha-transfer|soap-client|soap-adapter/.test(p))) {
  throw new Error(`date fix resolved from dirty tree: ${fallbackHits.join(', ')}`);
}

const bundled = fs.readFileSync(outfile, 'utf8');
if (!bundled.includes('d{4}|d{2}') && !bundled.includes('d{4}|\\d{2}')) {
  throw new Error('bundle missing two-digit year date pattern — abort');
}
if (!bundled.includes('Fred S. Keller School') || !bundled.includes('72817')) {
  throw new Error('bundle missing Fred S. Keller ContractID 72817 — abort');
}
if (!bundled.includes('PT Eval 97161 107')) {
  throw new Error('bundle lost live NYS billing alias — abort (wrong tree)');
}
if (bundled.includes('PT Eval 97162 107')) {
  throw new Error('bundle picked up uncommitted billing-alias rewrite — abort');
}
if (!bundled.includes('sessionIds')) {
  throw new Error('bundle missing targeted sessionIds retry — abort');
}
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', stamp);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const packCopy = outfile.replace(/\.mjs$/, '.pack.mjs');
const ps1 = path.join(__dirname, '.zip-allxsd-date.ps1');
fs.writeFileSync(
  ps1,
  `
$ErrorActionPreference = 'Stop'
$src = '${outfile.replace(/'/g, "''")}'
$copy = '${packCopy.replace(/'/g, "''")}'
$zipPath = '${zipPath.replace(/'/g, "''")}'
$in = [System.IO.File]::Open($src, 'Open', 'Read', 'ReadWrite')
try {
  $out = [System.IO.File]::Create($copy)
  try { $in.CopyTo($out) } finally { $out.Close() }
} finally { $in.Close() }
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $copy, 'index.mjs') | Out-Null
} finally { $zip.Dispose() }
`,
);
try {
  sh(`powershell -NoProfile -File "${ps1}"`, { cwd: __dirname });
} finally {
  try {
    fs.unlinkSync(ps1);
  } catch {
    /* ignore */
  }
}
if (!fs.existsSync(zipPath)) throw new Error(`Zip was not created: ${zipPath}`);

const beforeEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
    { encoding: 'utf8' },
  ),
);
console.log('HHA env before:', beforeEnv);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${beforeEnv.HHA_USE_PRODUCTION}`);
}

const codeOut = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('code', codeOut.trim());
stampLambdaGitEnv(fnName, { sha: stamp });

const afterEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT}" --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION changed to ${afterEnv.HHA_USE_PRODUCTION}`);
}

const summary = [
  'TMS HHA AllXsd dates YYYY-MM-DD (MM/DD/YY included)',
  `Function: ${fnName}`,
  `SHA: ${stamp}`,
  codeOut.trim(),
  `HHA before: ${JSON.stringify(beforeEnv)}`,
  `HHA after: ${JSON.stringify(afterEnv)}`,
  'HHA_USE_PRODUCTION left unchanged',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-allxsd-date-deploy-out.txt'), summary);
console.log('\n' + summary);
