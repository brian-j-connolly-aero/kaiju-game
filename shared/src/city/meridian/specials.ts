/**
 * The special buildings of Port Meridian (docs/ROADMAP.md phases 2 and 3; DESIGN.md section 7):
 * power substations, gas stations and radio masts, each on a street front.
 *
 * - Every starting neighborhood gets one of each, 40 to 120 m from the anchor and wholly inside
 *   the stage 1 square, in three directions about 120 degrees apart (turned by the seed), so the
 *   hatchling has three milestones to chase between fights.
 * - Beyond the starting neighborhoods (phase 3), more along the way from every start to downtown
 *   and in the districts round downtown, so the juvenile and the titan meet one now and then too
 *   (layout.ts `SPECIAL_SITES`, the numbers a pacing pass may tune).
 *
 * They go in after the landmarks and before the street fronts, so the houses fill in around them,
 * and the yard opener (`openPockets`) never takes one out.
 *
 * Like the rest of the generator this uses only exact arithmetic (see generate.ts): directions
 * are table indexes or vectors made with Math.sqrt, coordinates are snapped to 1/8 m.
 */

import { hash32 } from '../../math/rng';
import { STAGES } from '../../defs/stages';
import { archetypeDef } from '../archetypes';
import type { Box } from './geo';
import { boxesTouch, boxExtentX, boxExtentZ, len } from './geo';
import { inStartSquare, TALL, type Builder } from './build';
import { DIR_COS, DIR_COUNT, DIR_SIN, turnDir } from './dirs';
import { ANCHORS, DOWNTOWN, SPECIAL_SITES } from './layout';
import { placeOnFront } from './lots';

/** The three special archetypes, in the order they are placed. */
export const SPECIAL_ARCHETYPE_IDS = ['substation_a', 'gasstation_a', 'radiomast_a'] as const;

/** How far from the anchor (its center) a start's own special building may stand. */
export const SPECIAL_MIN_DIST = 40;
export const SPECIAL_MAX_DIST = 120;
/** It stands at least this far inside the stage 1 square, so a hatchling can get all round it. */
const SQUARE_MARGIN = 8;
/** Two specials of one start stand at least this far apart (centers). */
const APART = 45;
/** Clear ground kept round a special building (other buildings come no closer). */
const GAP = 4;
/** Lots are tried every this many meters along a street. */
const STEP = 6;
/** The special's front stands this far behind the street clearance. */
const SETBACK = 1;
/** The preferred distance from the anchor; the score grows as a lot strays from it. */
const PREFER_DIST = 75;
/** Lots tried per special and anchor, best first (the expensive checks run in that order). */
const MAX_CANDIDATES = 400;
/** A special beyond the starts stands this far inside the stage 2 square of the start it is for. */
const SQUARE2_MARGIN = 8;
/** A radio mast beyond the starts (taller than a juvenile tramples) keeps this far from the landmarks' footprints at least: their 20 m apron. */
const MAST_APRON = 20;

/** The stage 1 square of an anchor (the same square `stageBounds` gives). */
function startSquare(half: number, ax: number, az: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const h = STAGES[0].boundsHalfSize;
  const cx = ax < -half + h ? -half + h : ax > half - h ? half - h : ax;
  const cz = az < -half + h ? -half + h : az > half - h ? half - h : az;
  return { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h };
}

/** The stage 2 square of an anchor (the same square `stageBounds` gives: the first slid toward downtown). */
function stageTwoSquare(half: number, ax: number, az: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const h1 = STAGES[0].boundsHalfSize;
  const h2 = STAGES[1].boundsHalfSize;
  const slack = h2 - h1 > 0 ? h2 - h1 : 0;
  const clampTo = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
  const c1x = clampTo(ax, -half + h1, half - h1);
  const c1z = clampTo(az, -half + h1, half - h1);
  const cx = clampTo(c1x + clampTo(-DOWNTOWN[0] - c1x, -slack, slack), -half + h2, half - h2);
  const cz = clampTo(c1z + clampTo(DOWNTOWN[1] - c1z, -slack, slack), -half + h2, half - h2);
  return { minX: cx - h2, maxX: cx + h2, minZ: cz - h2, maxZ: cz + h2 };
}

/** A number in [0, 1) that keeps two equal lots apart: from the search, the street's side and the meters along it (plain integer arithmetic, cheap enough for thousands of lots). */
function jitter(search: number, key: number, at: number): number {
  return (((search % 8191) * 7 + (key % 8191) * 13 + at * 29) % 8191) / 8191;
}

/** True when the whole box lies inside the rectangle, `margin` in from its edges. */
function boxInside(box: Box, r: { minX: number; maxX: number; minZ: number; maxZ: number }, margin: number): boolean {
  const ex = boxExtentX(box);
  const ez = boxExtentZ(box);
  return box.x - ex >= r.minX + margin && box.x + ex <= r.maxX - margin && box.z - ez >= r.minZ + margin && box.z + ez <= r.maxZ - margin;
}

/** True when some corner (or the middle) of the box lies in a start's stage 1 square. */
function touchesStartSquare(half: number, box: Box): boolean {
  const ex = boxExtentX(box);
  const ez = boxExtentZ(box);
  return (
    inStartSquare(half, box.x, box.z) ||
    inStartSquare(half, box.x - ex, box.z - ez) ||
    inStartSquare(half, box.x + ex, box.z - ez) ||
    inStartSquare(half, box.x - ex, box.z + ez) ||
    inStartSquare(half, box.x + ex, box.z + ez)
  );
}

/** A special building placed so far: where and which. */
interface Placed {
  box: Box;
  kind: number;
}

/**
 * Places the special buildings: the three of every anchor, then those beyond the starts.
 * Returns how many it placed (`validateCity` checks that every start has its three and every
 * stage 2 square one of each beyond its stage 1 square).
 */
export function buildSpecials(b: Builder, seed: number): number {
  const placed: Placed[] = [];
  buildStartSpecials(b, seed, placed);
  buildSpecialsBeyond(b, seed, placed);
  return placed.length;
}

/** The trio of every start, inside its stage 1 square. */
function buildStartSpecials(b: Builder, seed: number, placed: Placed[]): void {
  for (let ai = 0; ai < ANCHORS.length; ai++) {
    const ax = -ANCHORS[ai].at[0];
    const az = ANCHORS[ai].at[1];
    const sq = startSquare(b.half, ax, az);
    // Three directions a third of a turn apart, turned by the seed.
    const turn = hash32(seed, 907, ai) % DIR_COUNT;
    const mine: Box[] = [];
    for (let k = 0; k < SPECIAL_ARCHETYPE_IDS.length; k++) {
      const want = turnDir(turn, Math.round((k * DIR_COUNT) / 3));
      const wx = DIR_SIN[want];
      const wz = DIR_COS[want];
      const searchKey = hash32(seed, 911, ai, k);
      const box = placeOnFront(b, {
        a: archetypeDef(SPECIAL_ARCHETYPE_IDS[k]),
        cx: ax,
        cz: az,
        reach: SPECIAL_MAX_DIST,
        street: () => true,
        setback: SETBACK,
        step: STEP,
        score: (x, z, dist, key, at) => {
          if (dist < SPECIAL_MIN_DIST) return -1;
          // In the wanted direction if it can be, at about the preferred distance.
          const along = ((x - ax) * wx + (z - az) * wz) / dist;
          return (1 - along) * 2 + (dist > PREFER_DIST ? dist - PREFER_DIST : PREFER_DIST - dist) / 60 + jitter(searchKey, key, at) * 0.15;
        },
        accept: (box) => {
          if (!boxInside(box, sq, SQUARE_MARGIN)) return false;
          for (const other of mine) if (len(other.x - box.x, other.z - box.z) < APART) return false;
          return true;
        },
        gap: GAP,
        tries: MAX_CANDIDATES,
      });
      if (!box) continue;
      mine.push(box);
      placed.push({ box, kind: k });
    }
  }
}

/**
 * Phase 3: the specials beyond the starts (layout.ts `SPECIAL_SITES`). Along the way from every
 * anchor to downtown, one at each of `path`'s distances beyond its stage 1 square, kinds in turn;
 * then one at each of the `outer` points. A site whose kind already stands within `share` of its
 * point (from a neighbor's way) is left out. Each stands on a street front within `reach` of its
 * point, outside every stage 1 square, wholly inside the stage 2 square of its start (`outer`:
 * of some start), `landmarkGap` from every landmark and `apart` from every other special.
 */
function buildSpecialsBeyond(b: Builder, seed: number, placed: Placed[]): void {
  const sites = SPECIAL_SITES;
  const site = (x: number, z: number, kind: number, square: { minX: number; maxX: number; minZ: number; maxZ: number } | null, tag: number): void => {
    for (const p of placed) if (p.kind === kind && len(p.box.x - x, p.box.z - z) < sites.share) return;
    const a = archetypeDef(SPECIAL_ARCHETYPE_IDS[kind]);
    const tall = a.height > TALL;
    const reach = sites.reach;
    const searchKey = hash32(seed, 919, tag);
    const box = placeOnFront(b, {
      a,
      cx: x,
      cz: z,
      reach,
      street: () => true,
      setback: SETBACK,
      step: STEP,
      // (Not in a start's square: its own trio is enough there.)
      score: (lx, lz, d, key, at) => (inStartSquare(b.half, lx, lz) ? -1 : d / reach + jitter(searchKey, key, at) * 0.1),
      accept: (box) => {
        if (touchesStartSquare(b.half, box)) return false;
        if (square && !boxInside(box, square, SQUARE2_MARGIN)) return false;
        for (const p of placed) if (len(p.box.x - box.x, p.box.z - box.z) < sites.apart) return false;
        for (let i = 0; i < b.structures.length; i++) {
          const st = b.structures[i];
          if (st.landmark === null) continue;
          if (boxesTouch(box, b.boxes[i], sites.landmarkGap)) return false;
          if (tall && boxesTouch(box, b.boxes[i], MAST_APRON)) return false;
        }
        return true;
      },
      gap: GAP,
      tries: MAX_CANDIDATES,
    });
    if (box) placed.push({ box, kind });
  };
  for (let ai = 0; ai < ANCHORS.length; ai++) {
    const ax = -ANCHORS[ai].at[0];
    const az = ANCHORS[ai].at[1];
    const sq1 = startSquare(b.half, ax, az);
    const sq2 = stageTwoSquare(b.half, ax, az);
    // The straight way to downtown, and where it leaves the stage 1 square.
    const dx = -DOWNTOWN[0] - ax;
    const dz = DOWNTOWN[1] - az;
    const dl = len(dx, dz);
    const ux = dx / dl;
    const uz = dz / dl;
    const tx = ux > 0 ? (sq1.maxX - ax) / ux : ux < 0 ? (sq1.minX - ax) / ux : Infinity;
    const tz = uz > 0 ? (sq1.maxZ - az) / uz : uz < 0 ? (sq1.minZ - az) / uz : Infinity;
    const out = tx < tz ? tx : tz;
    for (let k = 0; k < sites.path.length; k++) {
      const t = out + sites.path[k];
      site(ax + ux * t, az + uz * t, (ai + k) % SPECIAL_ARCHETYPE_IDS.length, sq2, ai * 16 + k);
    }
  }
  for (let k = 0; k < sites.outer.length; k++) {
    const p = sites.outer[k];
    site(-p[0], p[1], k % SPECIAL_ARCHETYPE_IDS.length, null, 1000 + k);
  }
}
