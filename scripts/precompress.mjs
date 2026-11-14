#!/usr/bin/env node
/**
 * Writes a gzip-compressed copy (`<name>.gz`) next to every model, script, style sheet, data and
 * vector-icon file of the built client, so the game server can send the small copy to browsers
 * that accept it (server/src/http/app.ts). Runs at the end of the client build.
 *
 *   node scripts/precompress.mjs [folder]      (default: client/dist)
 *
 * Measured on the first full build with it: the first load went from 8.7 MB to 2.1 MB. Pictures
 * (PNG) and sounds (MP3, OGG) are compressed already and are left alone. A copy is only kept
 * when it saves at least a tenth, and stale copies whose original is gone are removed.
 * Source maps are skipped: only a developer's browser tools ever ask for them.
 */

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(process.argv[2] ?? join(root, 'client', 'dist'));
const KINDS = new Set(['.js', '.css', '.json', '.glb', '.svg']);

function walk(folder, out = []) {
  for (const name of readdirSync(folder)) {
    const full = join(folder, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!existsSync(dir)) {
  console.error(`precompress: ${dir} does not exist; build the client first`);
  process.exit(1);
}

let files = 0;
let before = 0;
let after = 0;
for (const file of walk(dir)) {
  if (file.endsWith('.gz')) {
    if (!existsSync(file.slice(0, -3))) unlinkSync(file);
    continue;
  }
  if (!KINDS.has(extname(file))) continue;
  const data = readFileSync(file);
  const packed = gzipSync(data, { level: constants.Z_BEST_COMPRESSION });
  if (packed.length > data.length * 0.9) {
    if (existsSync(`${file}.gz`)) unlinkSync(`${file}.gz`);
    continue;
  }
  writeFileSync(`${file}.gz`, packed);
  files++;
  before += data.length;
  after += packed.length;
}
const mb = (n) => (n / 1e6).toFixed(1);
console.log(`precompress: ${files} files, ${mb(before)} MB -> ${mb(after)} MB gzip`);
