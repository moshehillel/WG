import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'apps/tms-web');
const dest = path.join(root, '..', 'white-glove-tms-web');

const files = [
  'index.html',
  'app.js',
  'styles.css',
  'build-config.mjs',
  'netlify.toml',
  'favicon.svg',
  'wg-logo.png',
  'luna-robot.webp',
  'tms-atmosphere-therapy.webp',
  'tms-atmosphere-school.webp',
];

const dirs = ['vendor'];

if (!existsSync(dest)) {
  console.error(`Frontend repo not found: ${dest}`);
  console.error('Create it first, or clone white-glove-tms-web next to White-glove.');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const file of files) {
  cpSync(path.join(src, file), path.join(dest, file));
}
for (const dir of dirs) {
  const from = path.join(src, dir);
  if (!existsSync(from)) continue;
  cpSync(from, path.join(dest, dir), { recursive: true });
}
console.log(`Synced ${files.length} files + ${dirs.length} dirs to ${dest}`);
console.log('Commit and push white-glove-tms-web to trigger Netlify.');
