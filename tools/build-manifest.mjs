#!/usr/bin/env node
/**
 * npm run assets:manifest [-- <assets dir>] [--check] [--quiet]
 *
 * Builds client/public/assets/manifest.json, the one file the client's AssetStore loads
 * (docs/ASSETS.md section 7). Three steps:
 *
 *   1. Merge. Every partial manifest (manifest.<family>.json, written by one art or audio
 *      worker each) is deep-merged, in alphabetical order. When two partials define the same
 *      entry differently the later file wins and a warning names both.
 *   2. Scan. UI art has no partial: every .svg and .png in ui/ becomes an entry of the "ui"
 *      section ({ "<name>": { "file": "ui/<name>.<ext>" } }), so the client knows which icons
 *      exist without asking the server for files that are not there.
 *   3. Verify. An entry whose file is missing on disk is left out of manifest.json and reported.
 *      The client then draws its procedural fallback for that asset instead of requesting a
 *      file that would come back as "not found". Audio entries need at least one of
 *      .ogg / .mp3; a sound effect keeps the variants that exist.
 *
 * The output is sorted, so the file is stable from run to run. `--check` writes nothing and
 * exits 1 when manifest.json is stale. Never edit manifest.json by hand.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SECTIONS = ['models', 'sprites', 'textures', 'music', 'sfx', 'voice', 'ui'];
const AUDIO_EXTENSIONS = ['.ogg', '.mp3'];
const UI_EXTENSIONS = ['.svg', '.png'];

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
  return out;
}

/**
 * Deep-merges partial manifests. `partials` is a list of { name, data } in the order they
 * apply. Returns { manifest, warnings }.
 */
export function mergePartials(partials) {
  const manifest = {};
  const warnings = [];
  const owners = new Map();
  for (const section of SECTIONS) manifest[section] = {};

  const claim = (path, value, file) => {
    owners.set(path, file);
    if (isObject(value)) for (const key of Object.keys(value)) claim(`${path}.${key}`, value[key], file);
  };
  const merge = (target, source, path, file) => {
    for (const key of Object.keys(source)) {
      const here = path ? `${path}.${key}` : key;
      const value = source[key];
      if (isObject(value) && isObject(target[key])) {
        merge(target[key], value, here, file);
      } else {
        if (key in target && JSON.stringify(target[key]) !== JSON.stringify(value)) {
          warnings.push(`${here} is defined by ${owners.get(here) ?? 'an earlier partial'} and again by ${file}; ${file} wins.`);
        }
        target[key] = value;
        claim(here, value, file);
      }
    }
  };

  for (const { name, data } of partials) {
    for (const key of Object.keys(data)) {
      if (!SECTIONS.includes(key)) warnings.push(`${name} has an unknown section "${key}" (kept as is).`);
    }
    merge(manifest, data, '', name);
  }
  return { manifest, warnings };
}

/** Adds every icon and portrait found in `<dir>/ui` to the manifest's "ui" section. */
export function scanUi(dir, manifest) {
  const uiDir = join(dir, 'ui');
  if (!existsSync(uiDir)) return 0;
  let added = 0;
  // .svg first so that, when both exist for one name, the vector version wins.
  const names = readdirSync(uiDir).sort((a, b) => {
    const ea = UI_EXTENSIONS.indexOf(extname(a).toLowerCase());
    const eb = UI_EXTENSIONS.indexOf(extname(b).toLowerCase());
    return ea - eb || a.localeCompare(b);
  });
  for (const name of names) {
    const ext = extname(name).toLowerCase();
    if (!UI_EXTENSIONS.includes(ext)) continue;
    const id = name.slice(0, -ext.length);
    if (manifest.ui[id]) continue;
    manifest.ui[id] = { file: `ui/${name}` };
    added++;
  }
  return added;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function audioExists(dir, base) {
  return typeof base === 'string' && AUDIO_EXTENSIONS.some((ext) => isFile(join(dir, base + ext)));
}

/**
 * Removes entries whose files are not on disk. Returns the list of problems, one line each.
 * Mutates `manifest`.
 */
export function verifyFiles(dir, manifest) {
  const missing = [];
  const dropUnless = (section, check) => {
    const entries = manifest[section];
    if (!isObject(entries)) return;
    for (const id of Object.keys(entries)) {
      const problem = isObject(entries[id]) ? check(entries[id], id) : 'is not an object';
      if (problem) {
        missing.push(`${section}.${id}: ${problem}`);
        delete entries[id];
      }
    }
  };
  const fileCheck = (entry) =>
    typeof entry.file === 'string' && isFile(join(dir, entry.file)) ? null : `file "${entry.file}" does not exist`;

  dropUnless('models', fileCheck);
  dropUnless('sprites', fileCheck);
  dropUnless('textures', fileCheck);
  dropUnless('ui', fileCheck);
  dropUnless('music', (entry) => (audioExists(dir, entry.base) ? null : `no .ogg or .mp3 for "${entry.base}"`));
  dropUnless('voice', (entry) => (audioExists(dir, entry.base) ? null : `no .ogg or .mp3 for "${entry.base}"`));
  dropUnless('sfx', (entry, id) => {
    const variants = Array.isArray(entry.variants) ? entry.variants : [];
    const present = variants.filter((v) => audioExists(dir, v));
    for (const v of variants) if (!present.includes(v)) missing.push(`sfx.${id}: variant "${v}" has no .ogg or .mp3 (left out)`);
    if (present.length === 0) return 'none of its variants exist';
    entry.variants = present;
    return null;
  });
  return missing;
}

/** Runs the whole build for one assets folder. Returns { text, counts, warnings, missing, errors }. */
export function buildManifest(dir) {
  const errors = [];
  const partials = [];
  const names = readdirSync(dir)
    .filter((name) => /^manifest\..+\.json$/.test(name))
    .sort();
  for (const name of names) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (err) {
      errors.push(`${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!isObject(data)) {
      errors.push(`${name} must be a JSON object with sections (${SECTIONS.join(', ')}).`);
      continue;
    }
    partials.push({ name, data });
  }
  const { manifest, warnings } = mergePartials(partials);
  scanUi(dir, manifest);
  const missing = verifyFiles(dir, manifest);

  const out = {};
  for (const section of SECTIONS) out[section] = sorted(manifest[section]);
  for (const key of Object.keys(manifest).sort()) if (!(key in out)) out[key] = sorted(manifest[key]);
  const counts = SECTIONS.map((s) => `${Object.keys(out[s]).length} ${s}`).join(', ');
  return { text: `${JSON.stringify(out, null, 2)}\n`, counts, partials: names.length, warnings, missing, errors };
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const dir = resolve(positional[0] ?? join(root, 'client', 'public', 'assets'));
  const quiet = flags.has('--quiet');
  const check = flags.has('--check');

  if (!existsSync(dir)) {
    console.log(`assets:manifest: ${dir} does not exist yet. Nothing to merge.`);
    return 0;
  }
  const result = buildManifest(dir);
  for (const e of result.errors) console.error(`error: ${e}`);
  if (result.errors.length > 0) {
    console.error('assets:manifest: manifest.json was NOT written because of the errors above.');
    return 1;
  }
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  if (!quiet) for (const m of result.missing) console.warn(`missing: ${m}`);

  const target = join(dir, 'manifest.json');
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  const stale = current !== result.text;
  if (check) {
    console.log(`assets:manifest: manifest.json is ${stale ? 'STALE (run npm run assets:manifest)' : 'up to date'} (${result.counts}).`);
    return stale ? 1 : 0;
  }
  if (stale) writeFileSync(target, result.text);
  const notes = [
    result.warnings.length ? `${result.warnings.length} warning(s)` : '',
    result.missing.length ? `${result.missing.length} entr${result.missing.length === 1 ? 'y' : 'ies'} without files left out` : '',
  ].filter(Boolean);
  console.log(
    `assets:manifest: merged ${result.partials} partial${result.partials === 1 ? '' : 's'} into manifest.json (${result.counts})` +
      `${notes.length ? `; ${notes.join(', ')}` : ''}${stale ? '' : '; unchanged'}.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
