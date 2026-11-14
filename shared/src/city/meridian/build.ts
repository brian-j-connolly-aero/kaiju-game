/**
 * Buildings for Port Meridian. In order: the bridge decks, the hand-placed landmarks, a row of
 * buildings along both sides of every street (each lot takes an archetype from the palette of
 * the patch it stands in), and last the yards behind (factories, campus halls, stacks).
 *
 * A building is only placed where it is clear of water, parks and plazas, of every street (far
 * enough back that a 9 m wide tank troop can drive it) and of every other building.
 */

import type { ArchetypeDef } from '../archetypes';
import { archetypeDef, archetypeSpecial } from '../archetypes';
import { createRng, hash32, rngFloat, rngRange, type Rng } from '../../math/rng';
import type { Vec2 } from '../../math/vec';
import type { Structure } from '../types';
import { toWorld } from './areas';
import { DIR_COS, DIR_QUARTER, DIR_SIN, DIR_YAW, nearestDir } from './dirs';
import { boxExtentX, boxExtentZ, boxesTouch, distSqPointBox, distSqPointSeg, distSqSegBox, len, pointInPolygon, quant, type Box } from './geo';
import { boxOnGround, type Ground } from './ground';
import { STAGES } from '../../defs/stages';
import { ANCHORS, BUILD_LIMIT, DOWNTOWN, LANDMARKS, PATCHES, type PatchSpec } from './layout';
import { INFILLS, PALETTES, type PaletteItem } from './palettes';
import type { RoadSpec } from './roadnet';
import { patchPolygon } from './streets';

/** A street of the finished network, as the builder needs it. */
export interface Street {
  id: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  spec: RoadSpec;
  /** Structure id of the deck for a bridge, else -1. */
  deck: number;
}

/** No wall comes closer to a street's center line than this (a tank troop is 18 m wide: 3 m to spare each side). */
const DRIVE_HALF = 12;
/** ...and never closer to its edge than this. */
const SIDEWALK = 3;
/** Buildings keep this far from water, parks and plazas. */
export const SHORE = 2.5;

const HASH_CELL = 40;

export function streetClearance(spec: RoadSpec): number {
  return Math.max(spec.width / 2 + SIDEWALK, DRIVE_HALF);
}

export interface PatchInfo {
  spec: PatchSpec;
  index: number;
  polygon: Vec2[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function patchInfos(): PatchInfo[] {
  return PATCHES.map((spec, index) => {
    const polygon = patchPolygon(spec);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of polygon) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    return { spec, index, polygon, minX, maxX, minZ, maxZ };
  });
}

/**
 * True when (x, z) lies in the stage 1 square of some neighborhood anchor (the same square
 * stageBounds gives). Only houses and shops may stand there: a hatchling cannot bring down
 * anything bigger, yet it would count toward the first mark of the bar.
 */
export function inStartSquare(half: number, x: number, z: number): boolean {
  const h = STAGES[0].boundsHalfSize;
  for (const a of ANCHORS) {
    const ax = -a.at[0];
    const az = a.at[1];
    const cx = ax < -half + h ? -half + h : ax > half - h ? half - h : ax;
    const cz = az < -half + h ? -half + h : az > half - h ? half - h : az;
    if (x >= cx - h && x <= cx + h && z >= cz - h && z <= cz + h) return true;
  }
  return false;
}

/**
 * True when (x, z) lies in the stage 2 square of some anchor: the same square stageBounds gives
 * (the stage 1 square slid toward downtown as far as it can while still holding it).
 */
export function inStageTwoSquare(half: number, x: number, z: number): boolean {
  const h1 = STAGES[0].boundsHalfSize;
  const h2 = STAGES[1].boundsHalfSize;
  const slack = h2 - h1 > 0 ? h2 - h1 : 0;
  const clampTo = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
  for (const a of ANCHORS) {
    const c1x = clampTo(-a.at[0], -half + h1, half - h1);
    const c1z = clampTo(a.at[1], -half + h1, half - h1);
    const cx = clampTo(c1x + clampTo(-DOWNTOWN[0] - c1x, -slack, slack), -half + h2, half - h2);
    const cz = clampTo(c1z + clampTo(DOWNTOWN[1] - c1z, -slack, slack), -half + h2, half - h2);
    if (x >= cx - h2 && x <= cx + h2 && z >= cz - h2 && z <= cz + h2) return true;
  }
  return false;
}

/** The patch a point lies in (the first in layout order), or null. */
export function patchAt(patches: readonly PatchInfo[], x: number, z: number): PatchInfo | null {
  for (const p of patches) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    if (p.spec.rect || pointInPolygon(x, z, p.polygon)) return p;
  }
  return null;
}

export interface Builder {
  g: Ground;
  half: number;
  cols: number;
  streets: Street[];
  streetCells: number[][];
  structures: Structure[];
  boxes: Box[];
  boxCells: number[][];
  /** Scratch for visiting each box once in a neighborhood query. */
  boxStamp: number[];
  patches: PatchInfo[];
  /** Footprints of the landmarks a juvenile can reach: no tall building stands within APRON of them. */
  aprons: Box[];
  stamp: number[];
  stampNow: number;
}

function cellOf(b: Builder, v: number): number {
  const c = Math.floor((v + b.half) / HASH_CELL);
  return c < 0 ? 0 : c >= b.cols ? b.cols - 1 : c;
}

export function createBuilder(g: Ground, streets: Street[]): Builder {
  const cols = Math.ceil((g.half * 2) / HASH_CELL);
  const streetCells: number[][] = [];
  const boxCells: number[][] = [];
  for (let i = 0; i < cols * cols; i++) {
    streetCells.push([]);
    boxCells.push([]);
  }
  const b: Builder = { g, half: g.half, cols, streets, streetCells, structures: [], boxes: [], boxCells, boxStamp: [], patches: patchInfos(), aprons: [], stamp: [], stampNow: 0 };
  // A street is listed in every cell a building near it could fall in.
  const reach = 26;
  for (const s of streets) {
    const c0 = cellOf(b, Math.min(s.ax, s.bx) - reach);
    const c1 = cellOf(b, Math.max(s.ax, s.bx) + reach);
    const r0 = cellOf(b, Math.min(s.az, s.bz) - reach);
    const r1 = cellOf(b, Math.max(s.az, s.bz) + reach);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) streetCells[r * cols + c].push(s.id);
    b.stamp.push(0);
  }
  return b;
}

/** True when the box keeps `extra` meters beyond the driving clearance from every street. */
export function clearOfStreets(b: Builder, box: Box, extra: number): boolean {
  const ex = boxExtentX(box);
  const ez = boxExtentZ(box);
  const c0 = cellOf(b, box.x - ex);
  const c1 = cellOf(b, box.x + ex);
  const r0 = cellOf(b, box.z - ez);
  const r1 = cellOf(b, box.z + ez);
  const now = ++b.stampNow;
  const reach = Math.sqrt(box.hx * box.hx + box.hz * box.hz);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const list = b.streetCells[r * b.cols + c];
      for (let k = 0; k < list.length; k++) {
        const id = list[k];
        if (b.stamp[id] === now) continue;
        b.stamp[id] = now;
        const s = b.streets[id];
        const need = streetClearance(s.spec) + extra;
        // Cheap first: a street further from the box's middle than its corner reach plus the clearance cannot matter.
        const far = need + reach;
        if (distSqPointSeg(box.x, box.z, s.ax, s.az, s.bx, s.bz) >= far * far) continue;
        if (distSqSegBox(s.ax, s.az, s.bx, s.bz, box) < need * need) return false;
      }
    }
  }
  return true;
}

export function clearOfBuildings(b: Builder, box: Box, gap: number): boolean {
  const ex = boxExtentX(box) + gap;
  const ez = boxExtentZ(box) + gap;
  const c0 = cellOf(b, box.x - ex);
  const c1 = cellOf(b, box.x + ex);
  const r0 = cellOf(b, box.z - ez);
  const r1 = cellOf(b, box.z + ez);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const id of b.boxCells[r * b.cols + c]) {
        if (boxesTouch(box, b.boxes[id], gap)) return false;
      }
    }
  }
  return true;
}

/** Adds a structure with the archetype's own size (or the given half extents, for bridge decks). */
export function addStructure(b: Builder, a: ArchetypeDef, box: Box): number {
  const id = b.structures.length;
  b.structures.push({
    id,
    archetype: a.id,
    x: box.x,
    z: box.z,
    hx: box.hx,
    hz: box.hz,
    yaw: DIR_YAW[box.dir],
    height: a.height,
    cls: a.cls,
    hp: a.hp,
    value: a.value,
    landmark: a.landmark,
    passable: a.passable,
  });
  b.boxes.push(box);
  b.boxStamp.push(0);
  const ex = boxExtentX(box);
  const ez = boxExtentZ(box);
  const c0 = cellOf(b, box.x - ex);
  const c1 = cellOf(b, box.x + ex);
  const r0 = cellOf(b, box.z - ez);
  const r1 = cellOf(b, box.z + ez);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) b.boxCells[r * b.cols + c].push(id);
  return id;
}

/**
 * The deck of every bridge, first, so their ids are small and stable. A deck is as long as its
 * street and at least as wide as the roadway plus a meter each side (the client stretches the
 * bridge model to the deck).
 */
export function buildDecks(b: Builder): void {
  for (const s of b.streets) {
    if (s.spec.kind !== 'bridge' || !s.spec.deck) continue;
    const a = archetypeDef(s.spec.deck);
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const box: Box = {
      x: quant((s.ax + s.bx) / 2),
      z: quant((s.az + s.bz) / 2),
      // Never narrower than the road it carries, with a meter of curb and railing each side.
      hx: quant(Math.max(a.footprint[0] / 2, s.spec.width / 2 + 1)),
      hz: quant(len(dx, dz) / 2),
      dir: nearestDir(dx, dz),
    };
    s.deck = addStructure(b, a, box);
  }
}

const FACE = { N: 0, W: 32, S: 64, E: 96 } as const;

export function buildLandmarks(b: Builder): void {
  for (const lm of LANDMARKS) {
    const a = archetypeDef(lm.archetype);
    const p = toWorld(lm.at);
    const box: Box = { x: p.x, z: p.z, hx: a.footprint[0] / 2, hz: a.footprint[1] / 2, dir: FACE[lm.face] };
    addStructure(b, a, box);
    if (inStageTwoSquare(b.half, p.x, p.z)) b.aprons.push(box);
  }
}

/**
 * A juvenile (18 m wide) goes for the landmarks in its square. A tall building it cannot
 * trample, standing closer to one than this, makes a notch the body wedges into: so none does.
 */
const APRON = 20;

/** True unless the box is a building a juvenile cannot trample standing within APRON of a reachable landmark. */
function clearOfAprons(b: Builder, box: Box, height: number): boolean {
  if (height <= TALL) return true;
  for (let i = 0; i < b.aprons.length; i++) if (boxesTouch(box, b.aprons[i], APRON)) return false;
  return true;
}

/** 0 far from downtown, 1 in the middle of it. */
function closeness(x: number, z: number, core: boolean): number {
  const d = len(x + DOWNTOWN[0], z - DOWNTOWN[1]);
  const c = core ? 1 - d / 300 : (650 - d) / 350;
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/** The archetypes of a palette, looked up once. */
const defsOf = new Map<readonly PaletteItem[], ArchetypeDef[]>();

function pick(items: readonly PaletteItem[], c: number, rng: Rng, maxWidth: number): ArchetypeDef | null {
  let defs = defsOf.get(items);
  if (!defs) {
    defs = items.map((it) => archetypeDef(it.a));
    defsOf.set(items, defs);
  }
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    if (defs[i].footprint[0] > maxWidth) continue;
    const it = items[i];
    total += it.far + ((it.near ?? it.far) - it.far) * c;
  }
  const roll = rngFloat(rng) * total;
  if (total <= 0) return null;
  let acc = 0;
  let last: ArchetypeDef | null = null;
  for (let i = 0; i < items.length; i++) {
    if (defs[i].footprint[0] > maxWidth) continue;
    const it = items[i];
    const w = it.far + ((it.near ?? it.far) - it.far) * c;
    if (w <= 0) continue;
    acc += w;
    last = defs[i];
    if (roll < acc) return last;
  }
  return last;
}

const scratchBox: Box = { x: 0, z: 0, hx: 0, hz: 0, dir: 0 };

/** Buildings a juvenile cannot trample stand this much further back, so the street stays wide enough for it to walk. */
export const TALL = 12;
export const TALL_SETBACK = 2.5;
/** ...and, placed in a yard, keep this far from each other (a juvenile is 18 m wide). */
const TALL_APART = 19.5;

/** A row of buildings along one side of one street. Each lot takes the palette of the patch it stands in. */
function frontSide(b: Builder, s: Street, side: number, seed: number): void {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l = len(dx, dz);
  if (l < 16) return;
  const ux = dx / l;
  const uz = dz / l;
  const nx = -uz * side;
  const nz = ux * side;
  const half = s.spec.width / 2;
  const rng = createRng(hash32(seed, 211, s.id, side + 1));
  const facing = nearestDir(-nx, -nz);
  const fx = DIR_SIN[facing];
  const fz = DIR_COS[facing];
  const clear = streetClearance(s.spec) + 0.5;
  let at = rngRange(rng, 1, 5);
  let run = 0;
  let blocked = 0;
  while (at < l - 4) {
    const px = s.ax + ux * at;
    const pz = s.az + uz * at;
    // Which patch is this lot in? Looked up a little way along and well back from the street.
    const patch = patchAt(b.patches, px + ux * 5 + nx * (half + 15), pz + uz * 5 + nz * (half + 15));
    if (!patch) {
      at += 12;
      continue;
    }
    const pal = PALETTES[patch.spec.palette];
    const keep = pal.keep * (patch.spec.keep ?? 1);
    const core = patch.spec.palette === 'core' || patch.spec.palette === 'bayfront';
    const gapScale = patch.spec.gap ?? 1;
    const gapMin = pal.gap[0] * gapScale;
    const a = pick(pal.items, Math.min(1, closeness(px, pz, core) + (patch.spec.near ?? 0)), rng, l - at + 3);
    const roll = rngFloat(rng);
    const gap = rngRange(rng, pal.gap[0], pal.gap[1]) * gapScale;
    if (!a) break;
    const w = a.footprint[0];
    const d = a.footprint[1];
    // (Downtown is outside every stage 2 square: no juvenile walks its streets, so the towers stand at the pavement.)
    const tall = a.height > TALL && !core ? TALL_SETBACK : 0;
    const front = clear + pal.setback + tall;
    const mx = px + ux * (w / 2) + nx * front;
    const mz = pz + uz * (w / 2) + nz * front;
    const box = scratchBox;
    box.x = quant(mx - fx * (d / 2));
    box.z = quant(mz - fz * (d / 2));
    box.hx = w / 2;
    box.hz = d / 2;
    box.dir = facing;
    const lowRise = a.cls === 'house' || a.cls === 'shop';
    const fits =
      (lowRise || !inStartSquare(b.half, box.x, box.z)) &&
      clearOfStreets(b, box, tall) &&
      clearOfAprons(b, box, a.height) &&
      boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT) &&
      clearOfBuildings(b, box, gapMin);
    if (!fits) {
      // Slide along and try again (the corner of a block, a park, the shore): a little at first, then in strides.
      at += blocked < 2 ? 4 : blocked < 4 ? 7 : 12;
      blocked++;
      continue;
    }
    blocked = 0;
    if (roll < keep) {
      addStructure(b, a, { x: box.x, z: box.z, hx: box.hx, hz: box.hz, dir: box.dir });
      run++;
    }
    at += w + gap;
    const rowEvery = patch.spec.rowEvery ?? pal.alleyEvery;
    if (rowEvery > 0 && run >= rowEvery) {
      at += (patch.spec.rowGap ?? pal.alley) - gap;
      run = 0;
    }
  }
}

/** Rows along every street: avenues first (they get the unbroken fronts), then the rest. */
export function buildFronts(b: Builder, seed: number): void {
  for (let pass = 0; pass < 2; pass++) {
    for (const s of b.streets) {
      if (!s.spec.lots || s.spec.kind === 'bridge') continue;
      if ((s.spec.kind === 'avenue') !== (pass === 0)) continue;
      frontSide(b, s, 1, seed);
      frontSide(b, s, -1, seed);
    }
  }
}

/** The yards: a loose grid of spots behind the street fronts. */
export function buildYards(b: Builder, seed: number): void {
  for (const patch of b.patches) {
    if (!patch.spec.infill) continue;
    const fill = INFILLS[patch.spec.infill];
    const rng = createRng(hash32(seed, 307, patch.index));
    for (let z = patch.minZ + fill.step / 2; z < patch.maxZ; z += fill.step) {
      for (let x = patch.minX + fill.step / 2; x < patch.maxX; x += fill.step) {
        const jx = rngRange(rng, -0.3, 0.3) * fill.step;
        const jz = rngRange(rng, -0.3, 0.3) * fill.step;
        const turn = rngFloat(rng);
        const roll = rngFloat(rng);
        const near = Math.min(1, closeness(x, z, false) + (patch.spec.near ?? 0));
        const a = pick(fill.items, near, rng, 1000);
        // Yards fill up toward downtown and thin out toward the edge of town.
        if (!a || roll >= fill.keep * (patch.spec.keep ?? 1) * (fill.gradient ? 0.4 + 0.6 * near : 1)) continue;
        const px = quant(x + jx);
        const pz = quant(z + jz);
        if (patchAt(b.patches, px, pz) !== patch) continue;
        if (a.cls !== 'house' && a.cls !== 'shop' && inStartSquare(b.half, px, pz)) continue;
        const box: Box = { x: px, z: pz, hx: a.footprint[0] / 2, hz: a.footprint[1] / 2, dir: turn < 0.5 ? 0 : 32 };
        if (!clearOfAprons(b, box, a.height)) continue;
        if (!boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT)) continue;
        if (!clearOfStreets(b, box, fill.offStreet - SIDEWALK)) continue;
        if (!clearOfBuildings(b, box, a.height > TALL ? Math.max(fill.gap, TALL_APART) : fill.gap)) continue;
        addStructure(b, a, box);
      }
    }
  }
}

/** A tank (radius 4 m) is deployed with this much clear ground round it (sim/spawn.ts), an infantry section (3 m) with this much. */
export const TANK_CLEAR = 4.75;
export const INFANTRY_CLEAR = 3.75;
/**
 * A troop of tanks (radius 9 m) is deployed with 9.75 m of clear ground round it and needs a
 * little over its own radius to drive. Troops exist only at the last stage, whose line is the
 * edge of the city, and the squads line up within some tens of meters of that line: so yards big
 * enough for a troop are opened only in a band this deep along the edge. Ground with less room
 * than TROOP_NEARLY cannot hide a spot a troop could be put on between two cells of the raster.
 */
export const TROOP_DEPLOY = 9.75;
export const TROOP_CLEAR = 9.25;
const TROOP_NEARLY = 8;
/** The troop's round looks at the buildings this far inside the band as well (unmarked ground beyond counts as open). */
const POCKET_BEYOND = 140;
export const TROOP_BAND = 200;
const POCKET_CELL = 2.5;
/** Smaller specks of enclosed ground than this many cells (about 19 m2) are left alone. */
const POCKET_MIN_CELLS = 3;
/** Ground that goes on for this many cells is not a yard: it is the open city. */
const POCKET_OPEN_CELLS = 1600;

// Cell codes of the pocket raster: the low two bits say what fits (0 a tank, 1 only infantry,
// 2 nothing), the flags say who can get out to the streets from there.
const FITS = 3;
const TIGHT = 1;
const WALL = 2;
const TANK_OPEN = 4;
const FOOT_OPEN = 8;
const IN_POCKET = 16;

interface PocketJob {
  b: Builder;
  n: number;
  cells: Uint8Array;
  queue: Int32Array;
  gone: Uint8Array;
  removed: number;
  /** Clear ground the bigger body of this job needs round its center, and the smaller one (the same number when there is only one). */
  roomy: number;
  tight: number;
  /** How many walls may go for one yard, and the smallest patch of enclosed ground (in cells) worth opening. */
  tries: number;
  least: number;
  /** Prefer a wall with other open ground behind it (a wide body gets through no other kind). */
  through: boolean;
}

/** Classes the cells near a box (flags are kept). */
function pocketMark(job: PocketJob, id: number): void {
  const { b, n, cells } = job;
  const half = b.half;
  const box = b.boxes[id];
  const c = DIR_COS[box.dir];
  const s = DIR_SIN[box.dir];
  const hx = box.hx;
  const hz = box.hz;
  const roomy = job.roomy;
  const ex = boxExtentX(box) + roomy;
  const ez = boxExtentZ(box) + roomy;
  const c0 = Math.max(0, Math.floor((box.x - ex + half) / POCKET_CELL));
  const c1 = Math.min(n - 1, Math.floor((box.x + ex + half) / POCKET_CELL));
  const r0 = Math.max(0, Math.floor((box.z - ez + half) / POCKET_CELL));
  const r1 = Math.min(n - 1, Math.floor((box.z + ez + half) / POCKET_CELL));
  const tankSq = roomy * roomy;
  const footSq = job.tight * job.tight;
  if (box.dir % DIR_QUARTER === 0) {
    // Square to the axes: the same test in whole eighths of a meter (every number here is one),
    // which costs the engine nothing to compute before it has warmed up.
    const turned = (box.dir / DIR_QUARTER) % 2 === 1;
    const ihx = Math.round((turned ? hz : hx) * 8);
    const ihz = Math.round((turned ? hx : hz) * 8);
    const bx = Math.round((box.x + half) * 8);
    const bz = Math.round((box.z + half) * 8);
    const step = POCKET_CELL * 8;
    const tank = roomy * 8;
    const foot = job.tight * 8;
    for (let r = r0; r <= r1; r++) {
      let lz = r * step + step / 2 - bz;
      if (lz < 0) lz = -lz;
      lz -= ihz;
      if (lz >= tank) continue;
      const oz = lz > 0 ? lz : 0;
      const row = r * n;
      for (let cc = c0; cc <= c1; cc++) {
        const v = cells[row + cc];
        if ((v & FITS) === WALL) continue;
        let lx = cc * step + step / 2 - bx;
        if (lx < 0) lx = -lx;
        lx -= ihx;
        if (lx >= tank) continue;
        const ox = lx > 0 ? lx : 0;
        const d = ox * ox + oz * oz;
        if (d < foot * foot) cells[row + cc] = (v & ~FITS) | WALL;
        else if (d < tank * tank) cells[row + cc] = (v & ~FITS) | TIGHT;
      }
    }
    return;
  }
  for (let r = r0; r <= r1; r++) {
    const z = -half + (r + 0.5) * POCKET_CELL - box.z;
    const row = r * n;
    for (let cc = c0; cc <= c1; cc++) {
      const v = cells[row + cc];
      if ((v & FITS) === WALL) continue;
      const x = -half + (cc + 0.5) * POCKET_CELL - box.x;
      const lx = Math.abs(x * c - z * s) - hx;
      const lz = Math.abs(x * s + z * c) - hz;
      if (lx >= roomy || lz >= roomy) continue;
      const ox = lx > 0 ? lx : 0;
      const oz = lz > 0 ? lz : 0;
      const d = ox * ox + oz * oz;
      if (d < footSq) cells[row + cc] = (v & ~FITS) | WALL;
      else if (d < tankSq) cells[row + cc] = (v & ~FITS) | TIGHT;
    }
  }
}

/**
 * Floods from queue[head..tail) through cells a body of class `fits` can stand on that are not
 * yet known to be open. Returns the new tail; negative when the ground turned out to be open
 * (it met ground flagged `open`, or went on for POCKET_OPEN_CELLS).
 */
function pocketFlood(job: PocketJob, head: number, tailIn: number, fits: number, open: number): number {
  const { n, cells, queue } = job;
  let tail = tailIn;
  for (let q = head; q < tail; q++) {
    const k = queue[q];
    const c = k % n;
    for (let side = 0; side < 4; side++) {
      const j = side === 0 ? (c + 1 < n ? k + 1 : -1) : side === 1 ? (c > 0 ? k - 1 : -1) : side === 2 ? (k + n < n * n ? k + n : -1) : k - n;
      if (j < 0) continue;
      const v = cells[j];
      if ((v & FITS) > fits || (v & IN_POCKET) !== 0) continue;
      if ((v & open) !== 0) return -tail;
      cells[j] = v | IN_POCKET;
      queue[tail++] = j;
      if (tail >= POCKET_OPEN_CELLS) return -tail;
    }
  }
  return tail;
}

/** Is there ground the bigger body can stand on next to this building that is not part of the yard being looked at? */
function pocketBehind(job: PocketJob, id: number): boolean {
  const { b, n, cells } = job;
  const half = b.half;
  const box = b.boxes[id];
  const pad = job.roomy + POCKET_CELL * 1.5;
  const ex = boxExtentX(box) + pad;
  const ez = boxExtentZ(box) + pad;
  const c0 = Math.max(0, Math.floor((box.x - ex + half) / POCKET_CELL));
  const c1 = Math.min(n - 1, Math.floor((box.x + ex + half) / POCKET_CELL));
  const r0 = Math.max(0, Math.floor((box.z - ez + half) / POCKET_CELL));
  const r1 = Math.min(n - 1, Math.floor((box.z + ez + half) / POCKET_CELL));
  for (let r = r0; r <= r1; r++) {
    for (let cc = c0; cc <= c1; cc++) {
      const v = cells[r * n + cc];
      if ((v & FITS) === 0 && (v & IN_POCKET) === 0) return true;
    }
  }
  return false;
}

/**
 * Looks at the ground from one cell: if it is an enclosed pocket for a body of class `fits`,
 * takes walls out (cheapest building first) until it is not. Either way the ground visited ends
 * up flagged `flag`.
 */
function pocketProbe(job: PocketJob, seed: number, fits: number, open: number, flag: number): void {
  const { b, n, cells, queue, gone } = job;
  const half = b.half;
  cells[seed] |= IN_POCKET;
  queue[0] = seed;
  let end = pocketFlood(job, 0, 1, fits, open);
  let isOpen = end < 0;
  if (isOpen) end = -end;
  const roomy = job.roomy;
  const near = roomy + POCKET_CELL * 1.5;
  for (let tries = 0; tries < job.tries && !isOpen && end >= job.least; tries++) {
    let best = -1;
    let bestThrough = false;
    for (let q = 0; q < end; q++) {
      const cellId = queue[q];
      const x = -half + ((cellId % n) + 0.5) * POCKET_CELL;
      const z = -half + (Math.floor(cellId / n) + 0.5) * POCKET_CELL;
      const c = cellOf(b, x);
      const r = cellOf(b, z);
      for (let rr = r - 1; rr <= r + 1; rr++) {
        for (let cc = c - 1; cc <= c + 1; cc++) {
          if (rr < 0 || cc < 0 || rr >= b.cols || cc >= b.cols) continue;
          const list = b.boxCells[rr * b.cols + cc];
          for (let i = 0; i < list.length; i++) {
            const id = list[i];
            const st = b.structures[id];
            // Bridge decks, landmarks and the special buildings (every start must keep its three) stay.
            if (gone[id] || st.passable || st.landmark !== null || archetypeSpecial(st.archetype) !== null) continue;
            if (id === best || distSqPointBox(x, z, b.boxes[id]) > near * near) continue;
            const through = job.through && pocketBehind(job, id);
            if (best >= 0 && bestThrough && !through) continue;
            const better = best < 0 || (through && !bestThrough);
            if (better || st.value < b.structures[best].value || (st.value === b.structures[best].value && id > best)) {
              best = id;
              bestThrough = through;
            }
          }
        }
      }
    }
    if (best < 0) break;
    gone[best] = 1;
    job.removed++;
    // Free the ground it stood on, except what its neighbors still cover.
    const box = b.boxes[best];
    const ex = boxExtentX(box) + roomy;
    const ez = boxExtentZ(box) + roomy;
    const c0 = Math.max(0, Math.floor((box.x - ex + half) / POCKET_CELL));
    const c1 = Math.min(n - 1, Math.floor((box.x + ex + half) / POCKET_CELL));
    const r0 = Math.max(0, Math.floor((box.z - ez + half) / POCKET_CELL));
    const r1 = Math.min(n - 1, Math.floor((box.z + ez + half) / POCKET_CELL));
    for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) cells[r * n + cc] &= ~FITS;
    const h0 = cellOf(b, box.x - ex - roomy);
    const h1 = cellOf(b, box.x + ex + roomy);
    const v0 = cellOf(b, box.z - ez - roomy);
    const v1 = cellOf(b, box.z + ez + roomy);
    const now = ++b.stampNow;
    for (let r = v0; r <= v1; r++) {
      for (let cc = h0; cc <= h1; cc++) {
        const list = b.boxCells[r * b.cols + cc];
        for (let i = 0; i < list.length; i++) {
          const id = list[i];
          if (gone[id] || b.structures[id].passable || b.boxStamp[id] === now) continue;
          b.boxStamp[id] = now;
          pocketMark(job, id);
        }
      }
    }
    // Flood on from the whole pocket through the gap.
    end = pocketFlood(job, 0, end, fits, open);
    isOpen = end < 0;
    if (isOpen) end = -end;
  }
  for (let q = 0; q < end; q++) cells[queue[q]] = (cells[queue[q]] & ~IN_POCKET) | flag;
}

/**
 * Probes the ground within reach of a building: every cell a tank can stand on that is not yet
 * known to be open, then every cell an infantry section can stand on. When a building had to go
 * for the infantry the tank check is repeated, in case the hole is a new trap for a tank.
 */
function pocketSweep(job: PocketJob, id: number): void {
  const { b, n, cells } = job;
  const half = b.half;
  const box = b.boxes[id];
  const pad = job.roomy + POCKET_CELL;
  const ex = boxExtentX(box) + pad;
  const ez = boxExtentZ(box) + pad;
  const c0 = Math.max(0, Math.floor((box.x - ex + half) / POCKET_CELL));
  const c1 = Math.min(n - 1, Math.floor((box.x + ex + half) / POCKET_CELL));
  const r0 = Math.max(0, Math.floor((box.z - ez + half) / POCKET_CELL));
  const r1 = Math.min(n - 1, Math.floor((box.z + ez + half) / POCKET_CELL));
  for (let pass = 0; pass < 2; pass++) {
    const before = job.removed;
    for (let r = r0; r <= r1; r++) {
      for (let cc = c0; cc <= c1; cc++) {
        const k = r * n + cc;
        const v = cells[k];
        if (v === 0) pocketProbe(job, k, 0, TANK_OPEN, TANK_OPEN | FOOT_OPEN);
        else if (v === TIGHT || v === FOOT_OPEN) {
          // Tight ground, or roomy ground only the infantry is known to get out of.
          if (v === TIGHT) pocketProbe(job, k, TIGHT, TANK_OPEN | FOOT_OPEN, FOOT_OPEN);
          else pocketProbe(job, k, 0, TANK_OPEN, TANK_OPEN | FOOT_OPEN);
        }
      }
    }
    if (job.removed === before) break;
  }
}

/** Could a troop be deployed anywhere in this cell of the raster? Measured exactly, at 16 points. */
function troopSpotIn(job: PocketJob, cc: number, r: number): boolean {
  const { b, gone } = job;
  const half = b.half;
  const reach = TROOP_DEPLOY;
  for (let i = 0; i < 4; i++) {
    const z = -half + (r + (i + 0.5) / 4) * POCKET_CELL;
    for (let j = 0; j < 4; j++) {
      const x = -half + (cc + (j + 0.5) / 4) * POCKET_CELL;
      let free = true;
      const h0 = cellOf(b, x - reach);
      const h1 = cellOf(b, x + reach);
      const v0 = cellOf(b, z - reach);
      const v1 = cellOf(b, z + reach);
      for (let rr = v0; rr <= v1 && free; rr++) {
        for (let hc = h0; hc <= h1 && free; hc++) {
          const list = b.boxCells[rr * b.cols + hc];
          for (let k = 0; k < list.length; k++) {
            const id = list[k];
            if (gone[id] || b.structures[id].passable) continue;
            if (distSqPointBox(x, z, b.boxes[id]) < reach * reach) {
              free = false;
              break;
            }
          }
        }
      }
      if (free) return true;
    }
  }
  return false;
}

/**
 * The troop's round: every cell of the band along the edge of the city. Roomy ground not yet
 * known to be open is probed like any yard. And since the raster knows the ground only at the
 * centers of its cells, while a patch just big enough to put a troop on can lie between them:
 * such a patch can only be in a cell that is nearly roomy and has no roomy cell beside it, so
 * those cells (there are few) are measured exactly, and one a troop could be put on is treated
 * as an enclosed yard of its own.
 */
function bandSweep(job: PocketJob, band: number): void {
  const { n, cells } = job;
  const deep = Math.ceil(band / POCKET_CELL);
  for (let r = 1; r < n - 1; r++) {
    const whole = r < deep || r >= n - deep;
    for (let cc = 1; cc < n - 1; cc++) {
      // Rows that are not in the band themselves: only their two ends are.
      if (!whole && cc === deep) cc = n - deep;
      const k = r * n + cc;
      const v = cells[k];
      if (v !== 0 && v !== TIGHT) continue;
      if (v === TIGHT) {
        let roomy = false;
        for (let dr = -1; dr <= 1 && !roomy; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if ((cells[k + dr * n + dc] & FITS) === 0) {
              roomy = true;
              break;
            }
          }
        }
        if (roomy || !troopSpotIn(job, cc, r)) continue;
        cells[k] = 0;
      }
      pocketProbe(job, k, 0, TANK_OPEN, TANK_OPEN | FOOT_OPEN);
    }
  }
}

/**
 * One round of yard opening for one or two sizes of body. `band` > 0 keeps it to the buildings
 * within that many meters of the edge of the city. Removed buildings are noted in `gone`.
 */
function runPockets(b: Builder, gone: Uint8Array, raster: Uint8Array, queue: Int32Array, roomy: number, tight: number, band: number): number {
  const half = b.half;
  const n = Math.ceil((half * 2) / POCKET_CELL);
  raster.fill(0);
  const job: PocketJob = {
    b,
    n,
    cells: raster,
    queue,
    gone,
    removed: 0,
    roomy,
    tight,
    tries: band > 0 ? 8 : 6,
    least: band > 0 ? 1 : POCKET_MIN_CELLS,
    through: band > 0,
  };
  const cells = job.cells;
  const count = b.structures.length;
  // The troop's round needs the buildings of the band and a good way beyond it, not the middle of the city.
  const inner = band > 0 ? half - band - POCKET_BEYOND : 0;
  for (let id = 0; id < count; id++) {
    if (b.structures[id].passable || gone[id]) continue;
    if (inner > 0 && Math.abs(b.boxes[id].x) < inner && Math.abs(b.boxes[id].z) < inner) continue;
    pocketMark(job, id);
  }
  // The streets are open ground by definition.
  for (const st of b.streets) {
    const l = len(st.bx - st.ax, st.bz - st.az);
    const steps = Math.max(1, Math.ceil(l / POCKET_CELL));
    for (let i = 0; i <= steps; i++) {
      const x = st.ax + ((st.bx - st.ax) * i) / steps;
      const z = st.az + ((st.bz - st.az) * i) / steps;
      const k = Math.floor((z + half) / POCKET_CELL) * n + Math.floor((x + half) / POCKET_CELL);
      if (k >= 0 && k < n * n && (cells[k] & FITS) === 0) cells[k] |= TANK_OPEN | FOOT_OPEN;
    }
  }
  if (band > 0) {
    // A wall taken out leaves new ground behind: look again until a round changes nothing.
    for (let round = 0; round < 4; round++) {
      const before = job.removed;
      bandSweep(job, band);
      if (job.removed === before) break;
    }
  } else {
    for (let id = 0; id < count; id++) {
      if (!b.structures[id].passable && !gone[id]) pocketSweep(job, id);
    }
  }
  return job.removed;
}

/**
 * Opens every enclosed yard. Squads are deployed wherever the stage bounds happen to run, on
 * any clear spot big enough for the unit, and a yard walled in by buildings would trap the
 * unit there for the whole stage. So, round every building: is the ground a tank can stand on
 * there connected to a street (or simply to a lot more open ground)? Where a patch of it (about
 * 20 m2 or more) is not, the cheapest building of its wall is taken out, and the next, until it
 * is. Then the same for the narrower ground an infantry section can stand on, checking again
 * that a hole made for the infantry is no new trap for a tank. Along the edge of the city, where
 * the last stage deploys its troops of tanks, the same is then done for a troop: there the wall
 * taken out is one with open ground behind it, since a troop needs a gap two houses wide.
 * Returns how many buildings were removed. Bridge decks, landmarks and the special buildings are
 * never removed.
 */
export function openPockets(b: Builder): number {
  const gone = new Uint8Array(b.structures.length);
  // One raster and one queue serve both rounds (allocated once: the first build is the one that counts).
  const n = Math.ceil((b.half * 2) / POCKET_CELL);
  const raster = new Uint8Array(n * n);
  const queue = new Int32Array(POCKET_OPEN_CELLS + 8);
  // The troop's round comes last: a house taken out for a tank leaves a hole a troop could be put in.
  let removed = runPockets(b, gone, raster, queue, TANK_CLEAR, INFANTRY_CLEAR, 0);
  removed += runPockets(b, gone, raster, queue, TROOP_CLEAR, TROOP_NEARLY, TROOP_BAND);
  if (removed === 0) return 0;
  // Rebuild the lists without the removed buildings (ids stay equal to indexes).
  const structures = b.structures;
  const boxes = b.boxes;
  b.structures = [];
  b.boxes = [];
  b.boxStamp = [];
  for (const cell of b.boxCells) cell.length = 0;
  for (let id = 0; id < structures.length; id++) {
    if (gone[id]) continue;
    addStructure(b, archetypeDef(structures[id].archetype), boxes[id]);
  }
  return removed;
}
