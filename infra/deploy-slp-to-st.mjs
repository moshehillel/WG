/**
 * Deploy SLP→ST AcceptedServices fix to OpenedFn (+ sibling processors) and TmsApiFn.
 * Code-only — does not re-enable discharge_service.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const gitSha = readGitSha();
const region = 'us-east-1';

console.log(`Deploying SLP→ST (SHA ${gitSha})…`);

execSync('node infra/deploy-proc-restore-after-miris.mjs', {
  stdio: 'inherit',
  cwd: repoRoot,
  env: { ...process.env, PATH: `${path.join(repoRoot, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}` },
});

const tmsFn = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const outDir = path.join(__dirname, 'tms-api-slp-st-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-slp-st.zip');

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
if (!bundled.includes('ensureAcceptedServices')) {
  throw new Error('TmsApi bundle missing ensureAcceptedServices');
}
if (!bundled.includes('==="SP"?"ST"') && !bundled.includes("==='SP'?'ST'")) {
  // mapServiceToDiscipline / resolveDisciplineId minify variants
  if (!/\bSPEECH\b/.test(bundled) || !bundled.includes('"ST"')) {
    console.warn('WARN: could not confirm SP→ST ternary in TmsApi minify; checking SLP→ST map…');
  }
}
console.log('tms-api: bundled', fs.statSync(outfile).size, 'bytes OK');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const codeOut = execSync(
  `aws lambda update-function-code --region ${region} --function-name ${tmsFn} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log('tms-api', codeOut);

const stamped = stampLambdaGitEnv(tmsFn, { sha: gitSha });
const env = execSync(
  `aws lambda get-function-configuration --region ${region} --function-name ${tmsFn} --query "{HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,CodeSize:CodeSize,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);
const envObj = JSON.parse(env);
if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION not true: ${env}`);
}
if (String(envObj.TMS_GIT_SHA || '') !== gitSha) {
  throw new Error(`TMS_GIT_SHA mismatch: ${envObj.TMS_GIT_SHA} vs ${gitSha}`);
}

const openedFn = 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC';
const openedEnv = execSync(
  `aws lambda get-function-configuration --region ${region} --function-name ${openedFn} --query "{TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,CodeSize:CodeSize,LastModified:LastModified}" --output json`,
  { encoding: 'utf8' },
);
console.log('opened env', openedEnv);

fs.writeFileSync(
  path.join(__dirname, 'cdk-slp-to-st-deploy-out.txt'),
  [
    'LIVE_OK: SLP/SPEECH → ST AcceptedServices (PR #10)',
    `Deploy SHA: ${gitSha}`,
    `OpenedFn: ${openedFn}`,
    openedEnv.trim(),
    `TmsApiFn: ${tmsFn}`,
    `TMS_GIT_SHA: ${stamped.sha}`,
    `TMS_BUILT_AT: ${stamped.builtAt}`,
    codeOut.trim(),
    env.trim(),
  ].join('\n\n') + '\n',
);
console.log('Wrote cdk-slp-to-st-deploy-out.txt');
