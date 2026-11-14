/**
 * The special buildings of Port Meridian (docs/ROADMAP.md phase 2; DESIGN.md section 7): every
 * starting neighborhood gets a power substation, a gas station and a radio mast, each on a street
 * front 40 to 120 m from the anchor and inside the stage 1 square, in three directions about 120
 * degrees apart (turned by the seed), so the hatchling has three milestones to chase between
 * fights. They go in after the landmarks and before the street fronts, so the houses fill in
 * around them, and the yard opener (`openPockets`) never takes one out.
 *
 * Like the rest of the generator this uses only exact arithmetic (see generate.ts): directions
 * are table indexes, coordinates are snapped to 1/8 m.
 */

import { hash32 } from '../../math/rng';
import { STAGES } from '../../defs/stages';
import { archetypeDef } from '../archetypes';
import type { Box } from './geo';
import { boxExtentX, boxExtentZ, len, quant } from './geo';
import { boxOnGround } from './ground';
import { addStructure, clearOfBuildings, clearOfStreets, SHORE, streetClearance, TALL, TALL_SETBACK, type Builder } from './build';
import { DIR_COS, DIR_COUNT, DIR_SIN, nearestDir, turnDir } from './dirs';
import { ANCHORS, BUILD_LIMIT } from './layout';

/** The three special archetypes, in the order they are placed. */
export const SPECIAL_ARCHETYPE_IDS = ['substation_a', 'gasstation_a', 'radiomast_a'] as const;

/** How far from the anchor (its center) a special building may stand. */
export const SPECIAL_MIN_DIST = 40;
export const SPECIAL_MAX_DIST = 120;
/** It stands at least this far inside the stage 1 square, so a hatchling can get all round it. */
const SQUARE_MARGIN = 8;
/** Two specials of one start stand at least this far apart (centers). */
const APART = 45;
/** Clear ground kept round a special building (other buildings come no closer). */
const GAP = 4;
/** Lots are tried every this many meters along a street. */
const STEP = 3;
/** The special's front stands this far behind the street clearance. */
const SETBACK = 1;
/** The preferred distance from the anchor; the score grows as a lot strays from it. */
const PREFER_DIST = 75;
/** Lots tried per special and anchor, best first (the expensive checks run in that order). */
const MAX_CANDIDATES = 400;

/** Candidate lots of one special at one start, as parallel arrays (no garbage: there are thousands). */
let lotX: Float64Array = new Float64Array(4096);
let lotZ: Float64Array = new Float64Array(4096);
let lotScore: Float64Array = new Float64Array(4096);
let lotDir: Int32Array = new Int32Array(4096);
let lotCount = 0;

function pushLot(x: number, z: number, dir: number, score: number): void {
  if (lotCount === lotX.length) {
    const grow = (a: Float64Array): Float64Array => {
      const b = new Float64Array(a.length * 2);
      b.set(a);
      return b;
    };
    lotX = grow(lotX);
    lotZ = grow(lotZ);
    lotScore = grow(lotScore);
    const d = new Int32Array(lotDir.length * 2);
    d.set(lotDir);
    lotDir = d;
  }
  lotX[lotCount] = x;
  lotZ[lotCount] = z;
  lotDir[lotCount] = dir;
  lotScore[lotCount] = score;
  lotCount++;
}

const box: Box = { x: 0, z: 0, hx: 0, hz: 0, dir: 0 };

/** The stage 1 square of an anchor (the same square `stageBounds` gives). */
function startSquare(half: number, ax: number, az: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const h = STAGES[0].boundsHalfSize;
  const cx = ax < -half + h ? -half + h : ax > half - h ? half - h : ax;
  const cz = az < -half + h ? -half + h : az > half - h ? half - h : az;
  return { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h };
}

/** A pseudo-random number in [0, 1) from integers (the jitter that keeps two equal lots apart). */
function jitter(...parts: number[]): number {
  return hash32(...parts) / 4294967296;
}

/**
 * Places the three special buildings of every anchor. Returns how many it placed (three per
 * anchor when every start has room, which `validateCity` checks).
 */
export function buildSpecials(b: Builder, seed: number): number {
  let placed = 0;
  for (let ai = 0; ai < ANCHORS.length; ai++) {
    const ax = -ANCHORS[ai].at[0];
    const az = ANCHORS[ai].at[1];
    const sq = startSquare(b.half, ax, az);
    // Three directions a third of a turn apart, turned by the seed.
    const turn = hash32(seed, 907, ai) % DIR_COUNT;
    const mine: Box[] = [];
    for (let k = 0; k < SPECIAL_ARCHETYPE_IDS.length; k++) {
      const a = archetypeDef(SPECIAL_ARCHETYPE_IDS[k]);
      const want = turnDir(turn, Math.round((k * DIR_COUNT) / 3));
      const wx = DIR_SIN[want];
      const wz = DIR_COS[want];
      const w = a.footprint[0];
      const d = a.footprint[1];
      const tall = a.height > TALL ? TALL_SETBACK : 0;
      lotCount = 0;
      for (const s of b.streets) {
        if (!s.spec.lots || s.spec.kind === 'bridge' || s.spec.ford) continue;
        // Only the streets that run through (or close to) the square.
        if (Math.max(s.ax, s.bx) < sq.minX - 30 || Math.min(s.ax, s.bx) > sq.maxX + 30) continue;
        if (Math.max(s.az, s.bz) < sq.minZ - 30 || Math.min(s.az, s.bz) > sq.maxZ + 30) continue;
        const dx = s.bx - s.ax;
        const dz = s.bz - s.az;
        const l = len(dx, dz);
        if (l < w + 4) continue;
        const ux = dx / l;
        const uz = dz / l;
        const front = streetClearance(s.spec) + 0.5 + SETBACK + tall;
        for (let side = -1; side <= 1; side += 2) {
          const nx = -uz * side;
          const nz = ux * side;
          const facing = nearestDir(-nx, -nz);
          const fx = DIR_SIN[facing];
          const fz = DIR_COS[facing];
          for (let at = 2; at <= l - w - 2; at += STEP) {
            const mx = s.ax + ux * (at + w / 2) + nx * front;
            const mz = s.az + uz * (at + w / 2) + nz * front;
            const x = quant(mx - fx * (d / 2));
            const z = quant(mz - fz * (d / 2));
            const ox = x - ax;
            const oz = z - az;
            const dist = len(ox, oz);
            if (dist < SPECIAL_MIN_DIST || dist > SPECIAL_MAX_DIST) continue;
            // In the wanted direction if it can be, at about the preferred distance.
            const along = (ox * wx + oz * wz) / dist;
            const score = (1 - along) * 2 + (dist > PREFER_DIST ? dist - PREFER_DIST : PREFER_DIST - dist) / 60 + jitter(seed, 911, ai, k, s.id, side + 1, at) * 0.15;
            pushLot(x, z, facing, score);
          }
        }
      }
      // Best first: each try takes the best lot not tried yet (ties by position; no engine sort).
      const tries = Math.min(lotCount, MAX_CANDIDATES);
      for (let i = 0; i < tries; i++) {
        let bi = -1;
        for (let j = 0; j < lotCount; j++) {
          const sc = lotScore[j];
          if (sc < 0) continue;
          if (bi < 0) {
            bi = j;
            continue;
          }
          const bs = lotScore[bi];
          if (sc < bs || (sc === bs && (lotX[j] < lotX[bi] || (lotX[j] === lotX[bi] && lotZ[j] < lotZ[bi])))) bi = j;
        }
        if (bi < 0) break;
        // Tried: scores are never negative otherwise.
        lotScore[bi] = -1;
        box.x = lotX[bi];
        box.z = lotZ[bi];
        box.hx = w / 2;
        box.hz = d / 2;
        box.dir = lotDir[bi];
        const ex = boxExtentX(box);
        const ez = boxExtentZ(box);
        if (box.x - ex < sq.minX + SQUARE_MARGIN || box.x + ex > sq.maxX - SQUARE_MARGIN) continue;
        if (box.z - ez < sq.minZ + SQUARE_MARGIN || box.z + ez > sq.maxZ - SQUARE_MARGIN) continue;
        let near = false;
        for (const other of mine) if (len(other.x - box.x, other.z - box.z) < APART) near = true;
        if (near) continue;
        if (!clearOfStreets(b, box, tall)) continue;
        if (!boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT)) continue;
        if (!clearOfBuildings(b, box, GAP)) continue;
        const placedBox: Box = { x: box.x, z: box.z, hx: box.hx, hz: box.hz, dir: box.dir };
        addStructure(b, a, placedBox);
        mine.push(placedBox);
        placed++;
        break;
      }
    }
  }
  return placed;
}
