import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_EXPORT_PATH, archetypeExportText } from '../scripts/archetypeExport';
import { ARCHETYPES, PROP_KIND_IDS } from '../src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('archetype export for the art tools', () => {
  it('lists every archetype with id, footprint, height and class, and every prop kind', () => {
    const data = JSON.parse(archetypeExportText()) as {
      archetypes: Array<{ id: string; model: string; class: string; footprint: number[]; height: number; sizeClass: string }>;
      props: Array<{ id: string; model: string }>;
    };
    expect(data.archetypes.map((a) => a.id)).toEqual(ARCHETYPES.map((a) => a.id));
    for (const a of data.archetypes) {
      expect(a.footprint.length).toBe(2);
      expect(a.height).toBeGreaterThan(0);
      expect(typeof a.class).toBe('string');
      expect(a.model).toMatch(/^(bld|lm)_[a-z0-9_]+$/);
      expect(['small', 'medium', 'large', 'landmark']).toContain(a.sizeClass);
    }
    expect(data.props.map((p) => p.id)).toEqual([...PROP_KIND_IDS]);
    expect(data.props.every((p) => p.model === `prop_${p.id}`)).toBe(true);
  });

  it('is up to date on disk (if this fails, run: npm run export:defs)', () => {
    const file = resolve(repoRoot, ARCHETYPE_EXPORT_PATH);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(archetypeExportText());
  });
});
