/**
 * One-shot: compile pay-code-resolve (Group→AM fallback), bundle TMS, LIVE_OK.
 * Prefer deploy-tms-am-pay-plc-cover.mjs when also shipping cover-date / -74.
 * This script still asserts BOTH marker sets so it cannot wipe plc-cover.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';
import { assertAmAndPlcBundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const mainSrc = path.join(repoRoot, 'packages/hha-client/src/pay-code-resolve.ts');
const distPay = path.join(repoRoot, 'packages/hha-client/dist/pay-code-resolve.js');
const outDir = path.join(__dirname, 'tms-api-am-group-paycode-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-am-group-paycode.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

const srcTxt = fs.readFileSync(mainSrc, 'utf8');
if (!srcTxt.includes('firstExact') || !srcTxt.includes('AM ${stDisc}')) {
  throw new Error('main pay-code-resolve missing Group→AM fallback');
}
execSync(
  `npx esbuild ${JSON.stringify(mainSrc)} --outfile=${JSON.stringify(distPay)} --format=esm --platform=node --target=node22`,
  { cwd: repoRoot, stdio: 'inherit' },
);
const distTxt = fs.readFileSync(distPay, 'utf8');
if (!distTxt.includes('`AM ${')) {
  throw new Error('dist pay-code-resolve missing AM templates');
}
console.log('dist AM Group fallback OK', distPay, fs.statSync(distPay).size);

// WIP branch: router imports districts helpers that dist/index forgot to re-export.
const tmsDbIndex = path.join(repoRoot, 'packages/tms-db/dist/index.js');
const tmsDbIndexTxt = fs.readFileSync(tmsDbIndex, 'utf8');
if (!tmsDbIndexTxt.includes("from './districts.js'") && fs.existsSync(path.join(repoRoot, 'packages/tms-db/dist/districts.js'))) {
  fs.writeFileSync(tmsDbIndex, tmsDbIndexTxt.replace(
    /\/\/# sourceMappingURL=index\.js\.map\s*$/,
    "export * from './districts.js';\n//# sourceMappingURL=index.js.map\n",
  ));
  if (!fs.readFileSync(tmsDbIndex, 'utf8').includes("from './districts.js'")) {
    fs.appendFileSync(tmsDbIndex, "\nexport * from './districts.js';\n");
  }
  console.log('patched tms-db dist/index.js to re-export districts');
}

const gitSha = `${readGitSha()}-am-pay`;
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
// Minify renames firstExact; keep AM template + GROUP string markers.
// Also require plc-cover markers so this one-shot cannot wipe cover-date/-74.
assertAmAndPlcBundleMarkers(bundled, 'am-pay bundle');
console.log('bundled', outfile, 'bytes', bundled.length, 'SHA', gitSha);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
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

const stamped = stampLambdaGitEnv(fnName, { sha: gitSha });
const env = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,CodeSize:CodeSize,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);
const envObj = JSON.parse(env);
if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION not true: ${env}`);
}
// Lambda CodeSize is zip size (~0.5MB); uncompressed bundle is ~1.8MB.
if (Number(envObj.CodeSize || 0) < 400_000) {
  throw new Error(`CodeSize too small: ${envObj.CodeSize}`);
}
if (String(envObj.TMS_GIT_SHA || '') !== gitSha) {
  throw new Error(`TMS_GIT_SHA mismatch: ${envObj.TMS_GIT_SHA} vs ${gitSha}`);
}

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-am-group-paycode-deploy-out.txt'),
  [
    'LIVE_OK: Group pay-code → AM {Disc} $rate fallback (all rates/disciplines)',
    `Function: ${fnName}`,
    `TMS_GIT_SHA: ${stamped.sha}`,
    `TMS_BUILT_AT: ${stamped.builtAt}`,
    `BundleBytes: ${bundled.length} (zip CodeSize ${envObj.CodeSize} — compressed; AM templates present)`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved',
    'LIVE_OK: HHA_USE_PRODUCTION=true, AM Group fallback in bundle, SHA stamped',
    'Rename: {Disc} Group $Y → prefer Group / AM Group, else AM {Disc} $Y',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', envObj.CodeSize, 'SHA=', stamped.sha);
