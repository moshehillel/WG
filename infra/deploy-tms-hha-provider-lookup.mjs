/**
 * Deploy: HHA caregiver lookup — strip commas/punctuation, case/name-order match,
 * prefer + persist provider.hhaCaregiverCode (HHA CaregiverID).
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-hha-provider-lookup-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-hha-provider-lookup.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

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
// Prefer Node zlib zip to avoid PowerShell Compress-Archive file locks on Windows.
const { execFileSync } = await import('node:child_process');
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
  path.join(__dirname, 'cdk-tms-hha-provider-lookup-deploy-out.txt'),
  [
    'HHA provider lookup — comma/punctuation normalize, First/Last swap, save hhaCaregiverCode',
    `Function: ${fnName}`,
    out.trim(),
    env.trim(),
    '',
  ].join('\n'),
);
