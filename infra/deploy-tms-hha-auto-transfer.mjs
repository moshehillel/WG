/**
 * Deploy: Wednesday morning TMS→HHA auto-transfer (same path as admin Send to HHA).
 * - Rebuild shared + tms-db, bundle TmsApiFn
 * - Update Lambda code + timeout + TMS_HHA_AUTO_TRANSFER (does not flip HHA sandbox/prod)
 * - Ensure EventBridge rule WhiteGlove-TmsHhaAutoTransfer (Wed 11:00 UTC ≈ 7am ET EDT)
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-hha-auto-transfer-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-hha-auto-transfer.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const ruleName = 'WhiteGlove-TmsHhaAutoTransfer';
/** 11:00 UTC = 7:00 AM Eastern (EDT) / 6:00 AM Eastern (EST). */
const scheduleExpression = 'cron(0 11 ? * WED *)';

try {
  execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('shared build failed; continuing with existing dist');
}
try {
  execSync('npm run build -w @white-glove/tms-db', { stdio: 'inherit', cwd: repoRoot });
} catch {
  console.warn('tms-db build failed; continuing with existing dist');
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

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execFileSync(
  process.execPath,
  [
    '-e',
    `
const fs=require('fs'); const zlib=require('zlib'); const path=require('path');
const outfile=${JSON.stringify(outfile)};
const zipPath=${JSON.stringify(zipPath)};
const name=path.basename(outfile);
const data=fs.readFileSync(outfile);
const crcTable=(function(){let c,table=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}return table;})();
function crc32(buf){let c=0xffffffff;for(let i=0;i<buf.length;i++)c=crcTable[(c^buf[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
const crc=crc32(data); const comp=zlib.deflateRawSync(data);
function u16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n,0);return b;}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0,0);return b;}
const nameBuf=Buffer.from(name);
const local=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),u16(20),u16(0),u16(8),u16(0),u16(0),u32(crc),u32(comp.length),u32(data.length),u16(nameBuf.length),u16(0),nameBuf,comp]);
const central=Buffer.concat([Buffer.from([0x50,0x4b,0x01,0x02]),u16(20),u16(20),u16(0),u16(8),u16(0),u16(0),u32(crc),u32(comp.length),u32(data.length),u16(nameBuf.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(0),nameBuf]);
const end=Buffer.concat([Buffer.from([0x50,0x4b,0x05,0x06]),u16(0),u16(0),u16(1),u16(1),u32(central.length),u32(local.length),u16(0)]);
fs.writeFileSync(zipPath, Buffer.concat([local,central,end]));
`,
  ],
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const codeOut = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(codeOut);

execSync(`aws lambda wait function-updated --function-name ${fnName}`, {
  stdio: 'inherit',
});

const cfgRaw = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --output json`,
  { encoding: 'utf8' },
);
const cfg = JSON.parse(cfgRaw);
const vars = { ...(cfg.Environment?.Variables || {}) };
vars.TMS_HHA_AUTO_TRANSFER = 'true';
// Preserve existing HHA prod/sandbox flags — never flip here.
const envFile = path.join(__dirname, 'tmp-tms-hha-auto-transfer-env.json');
fs.writeFileSync(
  envFile,
  JSON.stringify({
    Variables: vars,
  }),
);

const cfgOut = execSync(
  `aws lambda update-function-configuration --function-name ${fnName} --timeout 600 --environment file://${envFile} --query "{Timeout:Timeout,HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_HHA_AUTO_TRANSFER:Environment.Variables.TMS_HHA_AUTO_TRANSFER}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(cfgOut);

const fnArn = String(cfg.FunctionArn || '').trim();
if (!fnArn) throw new Error('Missing FunctionArn');

const ruleOut = execSync(
  `aws events put-rule --name ${ruleName} --schedule-expression "${scheduleExpression}" --state ENABLED --description "Weekly TMS to HHA auto-transfer (Wed 11:00 UTC ~ 7am ET EDT)" --output json`,
  { encoding: 'utf8' },
);
console.log(ruleOut);

const stmtId = 'WhiteGlove-TmsHhaAutoTransfer-invoke';
try {
  execSync(
    `aws lambda remove-permission --function-name ${fnName} --statement-id ${stmtId}`,
    { stdio: 'pipe' },
  );
} catch {
  /* first deploy */
}
execSync(
  `aws lambda add-permission --function-name ${fnName} --statement-id ${stmtId} --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:${cfg.FunctionArn.split(':')[3]}:${cfg.FunctionArn.split(':')[4]}:rule/${ruleName}`,
  { stdio: 'inherit' },
);

const input = JSON.stringify({ tmsJob: 'hha-auto-transfer' });
const targetsFile = path.join(__dirname, 'tmp-tms-hha-auto-transfer-targets.json');
fs.writeFileSync(
  targetsFile,
  JSON.stringify([
    {
      Id: '1',
      Arn: fnArn,
      Input: input,
    },
  ]),
);
execSync(`aws events put-targets --rule ${ruleName} --targets file://${targetsFile}`, {
  stdio: 'inherit',
  cwd: __dirname,
});

const ruleDescribe = execSync(
  `aws events describe-rule --name ${ruleName} --output json`,
  { encoding: 'utf8' },
);
console.log(ruleDescribe);

fs.writeFileSync(
  path.join(__dirname, 'cdk-tms-hha-auto-transfer-deploy-out.txt'),
  [
    'Wednesday TMS→HHA auto-transfer',
    `Function: ${fnName}`,
    codeOut.trim(),
    cfgOut.trim(),
    `Schedule: EventBridge ${ruleName} ${scheduleExpression} ~ 7:00 AM Eastern (EDT) / 6:00 AM (EST)`,
    'Job: { "tmsJob": "hha-auto-transfer" }',
    'Selects: locked/signed weeks with eligible attended/makeup sessions not fully confirmed',
    'Manual: admin POST /weeks/:id/hha (Send to HHA) unchanged',
    'Pause: TMS_HHA_AUTO_TRANSFER=false',
    'HHA prod flags preserved (not flipped)',
    ruleDescribe.trim(),
    '',
  ].join('\n'),
);

for (const f of [envFile, targetsFile]) {
  try {
    fs.unlinkSync(f);
  } catch {
    /* ignore */
  }
}

console.log('deployed — see cdk-tms-hha-auto-transfer-deploy-out.txt');
