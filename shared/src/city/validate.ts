/**
 * Sanity checks for generated city data and a checksum for comparing cities across machines.
 * Tests run `validateCity` on the shipped city; the city worker should keep it passing.
 */

import { obbBounds, obbVsObb } from '../math/geom';
import { hash32 } from '../math/rng';
import { archetypeDef, archetypeSpecial } from './archetypes';
import { stageBounds } from './bounds';
import { CITY_WEAPON_KINDS, PROP_KIND_IDS, SPECIAL_KINDS, type CityData } from './types';

/** The special buildings of a start stand this far from its anchor (DESIGN.md section 7). */
export const SPECIAL_ANCHOR_DIST: readonly [number, number] = [40, 120];
/** Every start has at least this many of each city weapon the generator places (the mast only comes from a fallen radio mast). */
export const START_WEAPONS_MIN = 3;

export interface ValidateOptions {
  /**
   * Check what every starting neighborhood must hold for phase 2 (default true): one of each
   * special building, wholly inside its stage 1 square and 40 to 120 m from the anchor, and a
   * handful of each city weapon. The old placeholder grid has neither (pass false for it).
   */
  specials?: boolean;
}

/** Returns a list of problems; empty when the city is well formed. */
export function validateCity(city: CityData, options: ValidateOptions = {}): string[] {
  const problems: string[] = [];
  const half = city.half;

  city.structures.forEach((s, i) => {
    if (s.id !== i) problems.push(`structure ${i}: id is ${s.id}`);
    const b = obbBounds(s);
    if (b.minX < -half || b.maxX > half || b.minZ < -half || b.maxZ > half) {
      problems.push(`structure ${i} (${s.archetype}): outside the city`);
    }
    if (!(s.hp > 0) || !(s.value >= 0) || !(s.height > 0) || !(s.hx > 0) || !(s.hz > 0)) {
      problems.push(`structure ${i} (${s.archetype}): bad hp, value, height or footprint`);
    }
    try {
      const a = archetypeDef(s.archetype);
      if (a.cls !== s.cls) problems.push(`structure ${i}: class ${s.cls} does not match archetype ${a.id}`);
    } catch {
      problems.push(`structure ${i}: unknown archetype "${s.archetype}"`);
    }
  });

  // Overlaps (sorted sweep along x keeps this fast for a few thousand structures).
  const order = city.structures.map((s) => ({ s, b: obbBounds(s) })).sort((p, q) => p.b.minX - q.b.minX);
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length && order[j].b.minX < order[i].b.maxX; j++) {
      if (order[i].b.maxZ <= order[j].b.minZ || order[j].b.maxZ <= order[i].b.minZ) continue;
      if (obbVsObb(order[i].s, order[j].s)) {
        problems.push(`structures ${order[i].s.id} and ${order[j].s.id} overlap`);
      }
    }
  }

  const kinds: readonly string[] = PROP_KIND_IDS;
  city.props.forEach((p, i) => {
    if (p.id !== i) problems.push(`prop ${i}: id is ${p.id}`);
    if (!kinds.includes(p.kind)) problems.push(`prop ${i}: unknown kind "${p.kind}"`);
    if (Math.abs(p.x) > half || Math.abs(p.z) > half) problems.push(`prop ${i}: outside the city`);
  });

  city.roads.nodes.forEach((n, i) => {
    if (n.id !== i) problems.push(`road node ${i}: id is ${n.id}`);
  });
  city.roads.edges.forEach((e, i) => {
    if (e.id !== i) problems.push(`road edge ${i}: id is ${e.id}`);
    if (!city.roads.nodes[e.a] || !city.roads.nodes[e.b]) problems.push(`road edge ${i}: missing node`);
    if (e.kind === 'bridge') {
      const deck = city.structures[e.bridge];
      if (!deck || !deck.passable) problems.push(`road edge ${i}: bridge deck ${e.bridge} is not a passable structure`);
    } else if (e.bridge !== -1) {
      problems.push(`road edge ${i}: only bridge edges carry a bridge structure`);
    }
  });

  city.areas.forEach((a, i) => {
    if (a.id !== i) problems.push(`area ${i}: id is ${a.id}`);
    if (a.polygon.length < 3) problems.push(`area ${i}: polygon needs at least 3 points`);
  });
  city.anchors.forEach((a, i) => {
    if (a.id !== i) problems.push(`anchor ${i}: id is ${a.id}`);
    if (Math.abs(a.x) > half || Math.abs(a.z) > half) problems.push(`anchor ${i}: outside the city`);
  });
  if (city.anchors.length < 8) problems.push(`only ${city.anchors.length} neighborhood anchors (need at least 8)`);
  if (options.specials ?? true) problems.push(...validateStarts(city));

  return problems;
}

/**
 * Phase 2's promise to every start (docs/ROADMAP.md): a power substation, a gas station and a
 * radio mast inside its stage 1 square, each 40 to 120 m from the anchor and at a different spot,
 * and a handful of each city weapon to pick up.
 */
function validateStarts(city: CityData): string[] {
  const problems: string[] = [];
  const weapons = CITY_WEAPON_KINDS.filter((k) => k !== 'mast');
  for (const a of city.anchors) {
    const b1 = stageBounds(city, a.id, 1);
    const spots: Array<{ x: number; z: number }> = [];
    for (const kind of SPECIAL_KINDS) {
      const here = city.structures.find((s) => {
        if (archetypeSpecial(s.archetype) !== kind) return false;
        const b = obbBounds(s);
        if (b.minX < b1.minX || b.maxX > b1.maxX || b.minZ < b1.minZ || b.maxZ > b1.maxZ) return false;
        const d = Math.hypot(s.x - a.x, s.z - a.z);
        return d >= SPECIAL_ANCHOR_DIST[0] && d <= SPECIAL_ANCHOR_DIST[1];
      });
      if (!here) {
        problems.push(`anchor ${a.id} (${a.name}): no ${kind} 40 to 120 m from it inside its stage 1 square`);
        continue;
      }
      if (spots.some((p) => p.x === here.x && p.z === here.z)) problems.push(`anchor ${a.id} (${a.name}): two special buildings on one spot`);
      spots.push({ x: here.x, z: here.z });
    }
    for (const kind of weapons) {
      let n = 0;
      for (const p of city.props) if (p.kind === kind && p.x >= b1.minX && p.x <= b1.maxX && p.z >= b1.minZ && p.z <= b1.maxZ) n++;
      if (n < START_WEAPONS_MIN) problems.push(`anchor ${a.id} (${a.name}): only ${n} ${kind} in its stage 1 square`);
    }
  }
  return problems;
}

/**
 * Checksum of everything the simulation depends on (structures and props, positions rounded to
 * millimeters). The server sends it in `welcome`; a client whose own city gives a different
 * number must not predict against it.
 */
export function cityChecksum(city: CityData): number {
  let h = hash32(city.structures.length, city.props.length);
  const mm = (v: number): number => Math.round(v * 1000);
  for (const s of city.structures) {
    h = hash32(h, mm(s.x), mm(s.z), mm(s.hx), mm(s.hz), mm(s.yaw), mm(s.height), mm(s.hp), mm(s.value), s.passable ? 1 : 0);
  }
  for (const p of city.props) {
    h = hash32(h, mm(p.x), mm(p.z), PROP_KIND_IDS.indexOf(p.kind));
  }
  return h;
}
