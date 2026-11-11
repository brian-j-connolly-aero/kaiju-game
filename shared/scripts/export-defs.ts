/**
 * npm run export:defs
 *
 * Writes tools/art/data/archetypes.json: the structure archetypes and prop kinds the art tools
 * need to build one model per archetype at the right size (ASSETS.md section 3). The source of
 * truth is shared/src/city/archetypes.ts and props.ts; never edit the JSON by hand.
 *
 * Pass `--check` to verify the file on disk is up to date without writing (exit code 1 if not).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPE_EXPORT_PATH, archetypeExportText } from './archetypeExport';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outFile = resolve(repoRoot, ARCHETYPE_EXPORT_PATH);
const text = archetypeExportText();

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outFile, 'utf8');
  } catch {
    current = '';
  }
  if (current !== text) {
    console.error(`${ARCHETYPE_EXPORT_PATH} is out of date. Run: npm run export:defs`);
    process.exit(1);
  }
  console.log(`${ARCHETYPE_EXPORT_PATH} is up to date.`);
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, text);
  console.log(`Wrote ${ARCHETYPE_EXPORT_PATH}.`);
}
