#!/usr/bin/env node
/**
 * npm run assets:manifest [-- <assets dir>]
 *
 * Deep-merges every partial manifest (client/public/assets/manifest.<family>.json) into
 * manifest.json, which is the one file the client loads (ASSETS.md section 7). Each asset
 * worker writes only its own partial; nobody edits manifest.json by hand.
 *
 * Sections are objects keyed by asset id. When two partials define the same id differently the
 * later file (alphabetical order) wins and a warning names both, so collisions are visible.
 * Output keys are sorted so the file is stable from run to run.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(process.argv[2] ?? join(root, 'client', 'public', 'assets'));
const SECTIONS = ['models', 'sprites', 'textures', 'music', 'sfx', 'voice'];

if (!existsSync(dir)) {
  console.log(`assets:manifest: ${dir} does not exist yet. Nothing to merge.`);
  process.exit(0);
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const owners = new Map();
let warnings = 0;

function merge(target, source, path, file) {
  for (const key of Object.keys(source)) {
    const here = path ? `${path}.${key}` : key;
    const value = source[key];
    if (isObject(value) && isObject(target[key])) {
      merge(target[key], value, here, file);
    } else {
      if (key in target && JSON.stringify(target[key]) !== JSON.stringify(value)) {
        console.warn(`warning: ${here} is defined by ${owners.get(here) ?? 'an earlier partial'} and again by ${file}; ${file} wins.`);
        warnings++;
      }
      target[key] = value;
      claim(here, value, file);
    }
  }
}

/** Remembers which partial defined every leaf under `path`, for the collision warning. */
function claim(path, value, file) {
  owners.set(path, file);
  if (isObject(value)) for (const key of Object.keys(value)) claim(`${path}.${key}`, value[key], file);
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
  return out;
}

const partials = readdirSync(dir)
  .filter((name) => /^manifest\..+\.json$/.test(name))
  .sort();

const manifest = {};
for (const section of SECTIONS) manifest[section] = {};
let failed = false;
for (const name of partials) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  } catch (err) {
    console.error(`error: ${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
    continue;
  }
  if (!isObject(data)) {
    console.error(`error: ${name} must be a JSON object with sections (${SECTIONS.join(', ')}).`);
    failed = true;
    continue;
  }
  for (const key of Object.keys(data)) {
    if (!SECTIONS.includes(key)) console.warn(`warning: ${name} has an unknown section "${key}" (kept as is).`);
  }
  merge(manifest, data, '', name);
}

if (failed) {
  console.error('assets:manifest: manifest.json was NOT written because of the errors above.');
  process.exit(1);
}

const out = {};
for (const section of SECTIONS) out[section] = sorted(manifest[section]);
for (const key of Object.keys(manifest).sort()) if (!(key in out)) out[key] = sorted(manifest[key]);
writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(out, null, 2)}\n`);

const counts = SECTIONS.map((s) => `${Object.keys(out[s]).length} ${s}`).join(', ');
console.log(`assets:manifest: merged ${partials.length} partial${partials.length === 1 ? '' : 's'} into manifest.json (${counts})${warnings ? `, ${warnings} warning(s)` : ''}.`);
