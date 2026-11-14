/**
 * Phase 3 (docs/ROADMAP.md: "more kinds of buildings, packed closer together where the match
 * starts"): the starting neighborhoods' own shops. Every start gets a firehouse, a roadside motel
 * and a diner (in that order, the biggest lot first), each on the front of a busier street (an
 * avenue: the beltway, the frame avenues, the ones that cross a start) wholly inside its stage 1
 * square, apart from each other and from the start's special buildings, about a hundred meters
 * from the anchor. Only where no avenue has room does one take a local street. The houses, the
 * bungalows and the duplexes come with the packed palettes (palettes.ts), the garages with the
 * back lanes (lanes.ts).
 *
 * Exact arithmetic only (see generate.ts).
 */

import { hash32 } from '../../math/rng';
import { STAGES } from '../../defs/stages';
import { archetypeDef, archetypeSpecial } from '../archetypes';
import type { Box } from './geo';
import { boxExtentX, boxExtentZ, len } from './geo';
import type { Builder, Street } from './build';
import { ANCHORS } from './layout';
import { placeOnFront } from './lots';

/** The start's shops, placed in this order. */
export const START_SHOP_IDS = ['firehouse_a', 'motel_a', 'diner_a'] as const;
/** The preferred distance from the anchor, meters; the score grows as a lot strays from it. */
const PREFER_DIST = 105;
/** No nearer the anchor than this (the green, and the special buildings' ring at 40 to 120 m), nor further than this. */
const MIN_DIST = 45;
const MAX_DIST = 175;
/** Middle to middle, at least this far from the start's special buildings and from each other. */
const APART = 40;
/** It stands this far inside the stage 1 square. */
const SQUARE_MARGIN = 4;
const GAP = 3;
/** A forecourt to park in, out front (and the beltway's row must keep inside BUILD_LIMIT). */
const SETBACK = 3;
const STEP = 6;
const MAX_CANDIDATES = 300;

/** A number in [0, 1) that keeps two equal lots apart (as specials.ts). */
function jitter(search: number, key: number, at: number): number {
  return (((search % 8191) * 7 + (key % 8191) * 13 + at * 29) % 8191) / 8191;
}

/** Places the firehouse, the motel and the diner of every start. Returns how many it placed. */
export function buildStartShops(b: Builder, seed: number): number {
  const h = STAGES[0].boundsHalfSize;
  let count = 0;
  for (let ai = 0; ai < ANCHORS.length; ai++) {
    const ax = -ANCHORS[ai].at[0];
    const az = ANCHORS[ai].at[1];
    const cx = ax < -b.half + h ? -b.half + h : ax > b.half - h ? b.half - h : ax;
    const cz = az < -b.half + h ? -b.half + h : az > b.half - h ? b.half - h : az;
    const sq = { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h };
    // What is already there to keep apart from: this start's special buildings, then its shops.
    const keepFrom: Box[] = [];
    for (let i = 0; i < b.structures.length; i++) {
      const s = b.structures[i];
      if (archetypeSpecial(s.archetype) !== null && s.x >= sq.minX && s.x <= sq.maxX && s.z >= sq.minZ && s.z <= sq.maxZ) keepFrom.push(b.boxes[i]);
    }
    for (let k = 0; k < START_SHOP_IDS.length; k++) {
      const a = archetypeDef(START_SHOP_IDS[k]);
      let box: Box | null = null;
      // The avenues first; a local street only when no avenue has room.
      const searchKey = hash32(seed, 931, ai, k);
      for (let pass = 0; pass < 2 && !box; pass++) {
        box = placeOnFront(b, {
          a,
          cx: ax,
          cz: az,
          reach: MAX_DIST,
          street: (s: Street) => (pass === 0 ? s.spec.kind === 'avenue' : true),
          setback: SETBACK,
          step: STEP,
          score: (x, z, d, key, at) => {
            if (d < MIN_DIST || x < sq.minX || x > sq.maxX || z < sq.minZ || z > sq.maxZ) return -1;
            return (d > PREFER_DIST ? d - PREFER_DIST : PREFER_DIST - d) / 60 + jitter(searchKey, key, at) * 0.6;
          },
          accept: (box) => {
            const ex = boxExtentX(box);
            const ez = boxExtentZ(box);
            if (box.x - ex < sq.minX + SQUARE_MARGIN || box.x + ex > sq.maxX - SQUARE_MARGIN) return false;
            if (box.z - ez < sq.minZ + SQUARE_MARGIN || box.z + ez > sq.maxZ - SQUARE_MARGIN) return false;
            for (const o of keepFrom) if (len(o.x - box.x, o.z - box.z) < APART) return false;
            return true;
          },
          gap: GAP,
          tries: MAX_CANDIDATES,
        });
      }
      if (!box) continue;
      keepFrom.push(box);
      count++;
    }
  }
  return count;
}
