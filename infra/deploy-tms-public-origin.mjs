/**
 * Point TMS email links at https://tms.whiteglovecare.net.
 * Updates function code and only TMS_SPA_ORIGIN / TMS_CORS_ORIGIN.
 * Does not change HHA_USE_PRODUCTION, coordinator ids, or create visits.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-public-origin-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-public-origin.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const publicOrigin = 'https://tms.whiteglovecare.net';

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

const bundled = fs.readFileSync(outfile, 'utf8');
for (const needle of [publicOrigin, 'https://wgfront.netlify.app', 'https://whiteglovetms.netlify.app']) {
  if (!bundled.includes(needle)) throw new Error(`Bundle missing ${needle}`);
}
console.log('bundled', outfile);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const beforeEnvRaw = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query Environment.Variables --output json`,
  { encoding: 'utf8' },
);
const beforeEnv = JSON.parse(beforeEnvRaw);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error('Refusing deploy: HHA_USE_PRODUCTION is not true');
}
const beforeCoordinator = beforeEnv.HHA_COORDINATOR_ID;

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

execSync(`aws lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });

function originList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter((s) => s && s !== '*');
}

const cors = [
  publicOrigin,
  ...originList(beforeEnv.TMS_CORS_ORIGIN),
  'https://whiteglovetms.netlify.app',
  'https://wgfront.netlify.app',
];
const nextCors = [...new Set(cors)].join(',');
const next = { ...beforeEnv, TMS_SPA_ORIGIN: publicOrigin, TMS_CORS_ORIGIN: nextCors };
if (next.HHA_USE_PRODUCTION !== 'true') throw new Error('Refusing env update: HHA flag');
if (next.HHA_COORDINATOR_ID !== beforeCoordinator) throw new Error('Refusing env update: coordinator changed');
const changed = Object.keys(next).filter((key) => next[key] !== beforeEnv[key]);
const allowed = new Set(['TMS_SPA_ORIGIN', 'TMS_CORS_ORIGIN']);
if (changed.some((key) => !allowed.has(key))) {
  throw new Error(`Refusing env update; keys would change: ${changed.join(',')}`);
}

let envNote = 'TMS_SPA_ORIGIN and TMS_CORS_ORIGIN already set';
if (changed.length) {
  const envFile = path.join(outDir, 'env.json');
  fs.writeFileSync(envFile, JSON.stringify({ Variables: next }));
  try {
    execSync(
      `aws lambda update-function-configuration --function-name ${fnName} --environment file://${envFile.replace(/\\/g, '/')} --query LastModified --output text`,
      { encoding: 'utf8' },
    );
    execSync(`aws lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });
    envNote = `Updated ${changed.join(', ')}`;
  } finally {
    fs.unlinkSync(envFile);
  }
}

const afterEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query Environment.Variables --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') throw new Error('HHA_USE_PRODUCTION changed');
if (afterEnv.HHA_COORDINATOR_ID !== beforeCoordinator) throw new Error('HHA_COORDINATOR_ID changed');
if (afterEnv.TMS_SPA_ORIGIN !== publicOrigin) throw new Error(`TMS_SPA_ORIGIN is ${afterEnv.TMS_SPA_ORIGIN}`);

const urlConfig = JSON.parse(
  execSync(`aws lambda get-function-url-config --function-name ${fnName} --output json`, { encoding: 'utf8' }),
);
const allowOrigins = [
  ...new Set([publicOrigin, ...(urlConfig.Cors?.AllowOrigins || []).filter((o) => o && o !== '*')]),
];
const corsFile = path.join(outDir, 'url-cors.json');
fs.writeFileSync(
  corsFile,
  JSON.stringify({
    FunctionName: fnName,
    Cors: {
      AllowOrigins: allowOrigins,
      AllowMethods: urlConfig.Cors?.AllowMethods || ['*'],
      AllowHeaders: urlConfig.Cors?.AllowHeaders || [
        'content-type',
        'authorization',
        'x-tms-role',
        'x-tms-email',
      ],
      MaxAge: urlConfig.Cors?.MaxAge ?? 86400,
    },
  }),
);
try {
  execSync(
    `aws lambda update-function-url-config --cli-input-json file://${corsFile.replace(/\\/g, '/')} --query Cors.AllowOrigins --output json`,
    { stdio: 'inherit' },
  );
} finally {
  fs.unlinkSync(corsFile);
}
envNote += `; function URL origins: ${allowOrigins.join(',')}`;
const drifted = Object.keys(beforeEnv).filter(
  (key) => !allowed.has(key) && afterEnv[key] !== beforeEnv[key],
);
if (drifted.length) throw new Error(`Env drifted: ${drifted.join(',')}`);

const stamp = [
  'TMS public site https://tms.whiteglovecare.net',
  `Function: ${fnName}`,
  out.trim(),
  envNote,
  `TMS_SPA_ORIGIN: ${afterEnv.TMS_SPA_ORIGIN}`,
  `TMS_CORS_ORIGIN: ${afterEnv.TMS_CORS_ORIGIN}`,
  `HHA_USE_PRODUCTION: ${afterEnv.HHA_USE_PRODUCTION}`,
  `HHA_COORDINATOR_ID: ${afterEnv.HHA_COORDINATOR_ID}`,
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-public-origin-deploy-out.txt'), stamp);
console.log(stamp);
