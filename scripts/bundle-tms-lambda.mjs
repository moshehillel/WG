import esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'packages/tms-api/dist-lambda');
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'packages/tms-api/src/handler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(outDir, 'index.mjs'),
  minify: true,
  sourcemap: true,
  external: ['playwright', 'playwright-core', '@playwright/test'],
  mainFields: ['module', 'main'],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }));
console.log('Bundled', path.join(outDir, 'index.mjs'));
