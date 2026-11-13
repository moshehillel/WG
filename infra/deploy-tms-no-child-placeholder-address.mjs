/**
 * One-shot: no-child additional services use a placeholder address when no school address exists.
 * LIVE_OK — HHA_USE_PRODUCTION unchanged.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';
import { assertAmPlcSchoolAnd401BundleMarkers } from './deploy-tms-hha-bundle-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-no-child-placeholder-address-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-no-child-placeholder-address.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

process.env.AWS_NO_VERIFY_SSL = '1';
const aws = 'aws --no-verify-ssl';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const gitSha = `${readGitSha()}-no-child-addr`;

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
assertAmPlcSchoolAnd401BundleMarkers(bundled, 'no-child-placeholder-address');
if (!bundled.includes('createPatient')) {
  throw new Error('Bundle missing createPatient — aborting deploy');
}
if (bundled.includes('No school address for program type')) {
  throw new Error('Bundle still blocks no-child patients that lack a school address — aborting deploy');
}
if (!bundled.includes('1 Placeholder St') || !bundled.includes('10001')) {
  throw new Error('Bundle missing no-child placeholder address — aborting deploy');
}
if (!bundled.includes('needed to create a no-child patient')) {
  throw new Error('Bundle missing no-child contract guard — aborting deploy');
}
console.log('bundle guard: no-child placeholder address + HHA markers OK');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const beforeEnv = JSON.parse(
  execSync(
    `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA}" --output json`,
    { encoding: 'utf8' },
  ),
);
console.log('HHA env before:', beforeEnv);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${beforeEnv.HHA_USE_PRODUCTION}`);
}

const out = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);
execSync(`${aws} lambda wait function-updated --function-name ${fnName}`, {
  stdio: 'inherit',
  cwd: __dirname,
});
stampLambdaGitEnv(fnName, { sha: gitSha });

const env = execSync(
  `${aws} lambda get-function-configuration --function-name ${fnName} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,Handler:Handler,Runtime:Runtime,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);

const envObj = JSON.parse(env);
if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_PRODUCTION is not true after deploy: ${env}`);
}
if (String(envObj.HHA_USE_MOCK || '').toLowerCase() === 'true') {
  throw new Error(`LIVE_OK failed: HHA_USE_MOCK unexpectedly true: ${env}`);
}
const codeSize = Number(envObj.CodeSize || 0);
if (codeSize < 400_000) {
  throw new Error(`CodeSize ${codeSize} looks truncated — abort`);
}

const stamped = JSON.parse(out);
fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-no-child-placeholder-address-deploy-out.txt'),
  [
    'LIVE_OK: no-child patients use a placeholder address when no school address exists',
    `Function: ${fnName}`,
    `TMS_GIT_SHA (build define): ${gitSha}`,
    out.trim(),
    env.trim(),
    'HHA_USE_PRODUCTION=true preserved (unchanged)',
    '',
    'Changes:',
    '1. Send to HHA no longer stops when the week has no school address',
    '2. The new "no child" patient gets 1 Placeholder St, New York, NY 10001',
    '3. A real school address is still used when the week or a child on that program has one',
    '4. School records and real children are not overwritten',
    '',
  ].join('\n') + '\n',
);
console.log('LIVE_OK CodeSize=', stamped.CodeSize, 'SHA=', stamped.CodeSha256);
console.log('wrote cdk-tms-no-child-placeholder-address-deploy-out.txt');
