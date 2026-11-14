/**
 * Structure archetypes: the catalogue of building shapes the city is made of. One model per
 * archetype (`bld_<id>.glb`, or `lm_<id>.glb` for landmarks); `npm run export:defs` writes this
 * list to tools/art/data/archetypes.json for the art tools.
 *
 * The first 22 entries are the starter set the placeholder city is built from; the entries after
 * them were appended for Port Meridian (docs/CITY.md describes every one for the artists). The
 * list is append-only and ids are stable: art files are named after them, and the client draws
 * one instanced batch per archetype and damage state, so the whole list is capped at 40.
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

  // --- Port Meridian (docs/CITY.md). Everything below was appended for the handcrafted city; the
  // placeholder generator never picks these, so its output does not change. -----------------------

  // Harbor and industry: round tanks, gantry cranes on the quay, container stacks in the yards.
  // The stack is the one low piece (a juvenile walks through it), so it is cheap.
  building('tank_a', 'factory', 18, 18, 14, 800, 60, ['industrial', 'harbor']),
  building('crane_a', 'factory', 16, 26, 46, 900, 70, ['harbor']),
  building('container_a', 'factory', 13, 26, 8, 250, 14, ['harbor', 'industrial']),
  // A long hall with a pitched roof: lecture halls round the university quads, cloisters and
  // pilgrim halls on Temple Hill.
  building('campus_a', 'office', 44, 16, 16, 900, 85, ['university', 'temple']),
  // Boardwalk: a striped seaside pavilion (arcade, bandstand, bathhouse).
  building('pavilion_a', 'shop', 16, 12, 7, 140, 14, ['boardwalk']),
  // Temple Hill: a small tiered shrine.
  building('shrine_a', 'shop', 10, 10, 11, 150, 14, ['temple', 'oldtown']),

  // The Grand Harbor Bridge at the river mouth: a 22 m roadway under tall trusses. Taller than a
  // juvenile can trample, so it survives stage 2 unless it is attacked on purpose.
  { id: 'bridge_b', cls: 'bridge', footprint: [22, 110], height: 36, hp: 4000, value: 400, zones: [], landmark: null, passable: true },

  // Named landmarks, one of each. Those over 70 m (the wheel, the power station, the mast) are
  // not trampled even by the titan; the rest fall to its feet.
  landmark('tidewater_cathedral', 'Tidewater Cathedral', 40, 72, 58, 6000, 900, ['oldtown']),
  landmark('anchor_field', 'Anchor Field', 150, 120, 30, 14000, 1200, ['boardwalk']),
  landmark('tidewheel', 'The Tidewheel', 64, 14, 76, 2500, 500, ['boardwalk']),
  landmark('halcyon_observatory', 'Halcyon Observatory', 40, 40, 24, 3000, 500, ['university']),
  landmark('farewell_light', 'Farewell Light', 12, 12, 48, 1500, 350, ['harbor']),
  landmark('kiln_point_power', 'Kiln Point Power Station', 110, 70, 82, 12000, 1300, ['industrial']),
  landmark('sevenfold_temple', 'Sevenfold Temple', 44, 44, 52, 4000, 700, ['temple']),
  landmark('grand_station', 'Grand Meridian Station', 110, 50, 40, 7000, 900, ['downtown']),
  landmark('signal_mast', 'Signal Hill Mast', 16, 16, 160, 3000, 500, ['suburb']),
  landmark('gasworks', 'Number Three Gasworks', 56, 56, 44, 4000, 600, ['industrial']),
  landmark('founders_clock', 'Founders Clock Tower', 12, 12, 62, 2000, 400, ['university']),
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
