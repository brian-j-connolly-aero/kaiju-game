/**
 * Structure archetypes: the catalogue of building shapes the city is made of. One model per
 * archetype (`bld_<id>.glb`, or `lm_<id>.glb` for landmarks); `npm run export:defs` writes this
 * list to tools/art/data/archetypes.json for the art tools.
 *
 * This is a small starter set that covers every structure class. The city worker extends it
 * (more variety, the full landmark list) without changing the schema. Ids are stable: art files
 * are named after them.
 *
 * Tuning notes (starting values): hp is set against the kaiju's structure damage per stage
 * (swipe 40 / 300 / 2000), so a house takes about two hatchling swipes, a mid-rise three
 * juvenile swipes and a tower three titan swipes. Value grows with volume.
 */

import type { StructureClass } from '../defs/ids';
import type { ZoneTag } from './types';

export interface ArchetypeDef {
  id: string;
  cls: StructureClass;
  /** Full footprint in meters: [width along local X, depth along local Z]. The front faces local +Z. */
  footprint: readonly [number, number];
  height: number;
  hp: number;
  value: number;
  /** Districts this archetype belongs in. */
  zones: readonly ZoneTag[];
  /** Display name when this is a unique named landmark, otherwise null. */
  landmark: string | null;
  /** True for bridge decks (never block movement). */
  passable: boolean;
}

function building(
  id: string,
  cls: StructureClass,
  width: number,
  depth: number,
  height: number,
  hp: number,
  value: number,
  zones: readonly ZoneTag[],
): ArchetypeDef {
  return { id, cls, footprint: [width, depth], height, hp, value, zones, landmark: null, passable: false };
}

function landmark(
  id: string,
  name: string,
  width: number,
  depth: number,
  height: number,
  hp: number,
  value: number,
  zones: readonly ZoneTag[],
): ArchetypeDef {
  return { id, cls: 'landmark', footprint: [width, depth], height, hp, value, zones, landmark: name, passable: false };
}

export const ARCHETYPES: readonly ArchetypeDef[] = [
  // Houses: the hatchling's targets (taller than its 3.5 m trample limit, so it must swipe them).
  building('house_a', 'house', 9, 10, 6, 80, 8, ['suburb', 'oldtown']),
  building('house_b', 'house', 11, 9, 7, 90, 9, ['suburb', 'temple']),
  building('house_c', 'house', 8, 8, 5, 70, 7, ['suburb', 'boardwalk', 'harbor']),
  building('rowhouse_a', 'house', 7, 11, 9, 110, 10, ['oldtown', 'university']),

  // Shops: low commercial, trampled by the juvenile (12 m limit).
  building('shop_a', 'shop', 11, 10, 5, 120, 12, ['suburb', 'oldtown', 'boardwalk']),
  building('shop_b', 'shop', 14, 11, 8, 160, 16, ['oldtown', 'harbor', 'university']),
  building('shop_c', 'shop', 12, 12, 10, 200, 20, ['downtown', 'oldtown']),

  // Apartments: mid-rise blocks.
  building('apartment_a', 'apartment', 18, 14, 20, 700, 60, ['oldtown', 'suburb', 'university']),
  building('apartment_b', 'apartment', 16, 16, 28, 900, 80, ['oldtown', 'downtown', 'boardwalk']),
  building('apartment_c', 'apartment', 24, 14, 36, 1100, 100, ['downtown', 'harbor']),

  // Offices.
  building('office_a', 'office', 20, 20, 42, 1400, 140, ['downtown', 'university']),
  building('office_b', 'office', 24, 18, 55, 1800, 180, ['downtown']),
  building('office_c', 'office', 22, 22, 68, 2200, 230, ['downtown']),

  // Towers: taller than the titan's 70 m trample limit, so it wades through them.
  building('tower_a', 'tower', 26, 26, 95, 4500, 380, ['downtown']),
  building('tower_b', 'tower', 30, 30, 130, 6000, 520, ['downtown']),
  building('tower_c', 'tower', 28, 28, 165, 7500, 680, ['downtown']),

  // Industry.
  building('factory_a', 'factory', 36, 24, 14, 1000, 90, ['industrial', 'harbor']),
  building('factory_b', 'factory', 44, 30, 18, 1400, 130, ['industrial']),
  building('warehouse_a', 'factory', 30, 20, 11, 600, 55, ['industrial', 'harbor']),

  // Bridge deck: 16 m wide roadway spanning the river (depth is the span).
  { id: 'bridge_a', cls: 'bridge', footprint: [16, 74], height: 8, hp: 1500, value: 150, zones: [], landmark: null, passable: true },

  // Landmark stand-ins. The city worker replaces these with the full named set (DESIGN.md section 7).
  landmark('meridian_tower', 'Meridian Tower', 36, 36, 220, 12000, 1500, ['downtown']),
  landmark('city_hall', 'City Hall', 50, 40, 45, 5000, 900, ['downtown', 'oldtown']),
];

const BY_ID = new Map<string, ArchetypeDef>(ARCHETYPES.map((a) => [a.id, a]));

export function archetypeDef(id: string): ArchetypeDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`archetype "${id}" is not defined`);
  return def;
}

/** Model id in the asset manifest for an archetype. */
export function archetypeModelId(def: ArchetypeDef): string {
  return def.landmark !== null ? `lm_${def.id}` : `bld_${def.id}`;
}

/** Art size bucket (triangle budgets in ASSETS.md section 3). */
export function archetypeSizeClass(def: ArchetypeDef): 'small' | 'medium' | 'large' | 'landmark' {
  if (def.landmark !== null) return 'landmark';
  const volume = def.footprint[0] * def.footprint[1] * def.height;
  if (volume < 2500) return 'small';
  if (volume < 30000) return 'medium';
  return 'large';
}
