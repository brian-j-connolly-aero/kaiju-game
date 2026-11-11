/**
 * Buildings for Port Meridian. In order: the bridge decks, the hand-placed landmarks, a row of
 * buildings along both sides of every street (each lot takes an archetype from the palette of
 * the patch it stands in), and last the yards behind (factories, campus halls, stacks).
 *
 * A building is only placed where it is clear of water, parks and plazas, of every street (far
 * enough back that a 9 m wide tank troop can drive it) and of every other building.
 */

import type { ArchetypeDef } from '../archetypes';
import { archetypeDef } from '../archetypes';
import { createRng, hash32, rngFloat, rngRange, type Rng } from '../../math/rng';
import type { Vec2 } from '../../math/vec';
import type { Structure } from '../types';
import { toWorld } from './areas';
import { DIR_COS, DIR_SIN, DIR_YAW, nearestDir } from './dirs';
import { boxExtentX, boxExtentZ, boxesTouch, distSqPointSeg, distSqSegBox, len, pointInPolygon, quant, type Box } from './geo';
import { boxOnGround, type Ground } from './ground';
import { BUILD_LIMIT, DOWNTOWN, LANDMARKS, PATCHES, type PatchSpec } from './layout';
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

/** No wall comes closer to a street's center line than this (a tank troop is 18 m wide). */
const DRIVE_HALF = 10.5;
/** ...and never closer to its edge than this. */
const SIDEWALK = 3;
/** Buildings keep this far from water, parks and plazas. */
const SHORE = 2.5;

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
  patches: PatchInfo[];
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
  const b: Builder = { g, half: g.half, cols, streets, streetCells, structures: [], boxes: [], boxCells, patches: patchInfos(), stamp: [], stampNow: 0 };
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
  const ex = boxExtentX(box);
  const ez = boxExtentZ(box);
  const c0 = cellOf(b, box.x - ex);
  const c1 = cellOf(b, box.x + ex);
  const r0 = cellOf(b, box.z - ez);
  const r1 = cellOf(b, box.z + ez);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) b.boxCells[r * b.cols + c].push(id);
  return id;
}

/** The deck of every bridge, first, so their ids are small and stable. */
export function buildDecks(b: Builder): void {
  for (const s of b.streets) {
    if (s.spec.kind !== 'bridge' || !s.spec.deck) continue;
    const a = archetypeDef(s.spec.deck);
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const box: Box = {
      x: quant((s.ax + s.bx) / 2),
      z: quant((s.az + s.bz) / 2),
      hx: a.footprint[0] / 2,
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
    addStructure(b, a, { x: p.x, z: p.z, hx: a.footprint[0] / 2, hz: a.footprint[1] / 2, dir: FACE[lm.face] });
  }
}

/** 0 far from downtown, 1 in the middle of it. */
function closeness(x: number, z: number, core: boolean): number {
  const d = len(x + DOWNTOWN[0], z - DOWNTOWN[1]);
  const c = core ? 1 - d / 300 : (650 - d) / 350;
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

function pick(items: readonly PaletteItem[], c: number, rng: Rng, maxWidth: number): ArchetypeDef | null {
  let total = 0;
  for (const it of items) {
    const a = archetypeDef(it.a);
    if (a.footprint[0] > maxWidth) continue;
    total += it.far + ((it.near ?? it.far) - it.far) * c;
  }
  const roll = rngFloat(rng) * total;
  if (total <= 0) return null;
  let acc = 0;
  let last: ArchetypeDef | null = null;
  for (const it of items) {
    const a = archetypeDef(it.a);
    if (a.footprint[0] > maxWidth) continue;
    const w = it.far + ((it.near ?? it.far) - it.far) * c;
    if (w <= 0) continue;
    acc += w;
    last = a;
    if (roll < acc) return a;
  }
  return last;
}

const scratchBox: Box = { x: 0, z: 0, hx: 0, hz: 0, dir: 0 };

/** Buildings a juvenile cannot trample stand this much further back, so the street stays wide enough for it to walk. */
const TALL = 12;
const TALL_SETBACK = 2.5;
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
      at += 6;
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
    const tall = a.height > TALL ? TALL_SETBACK : 0;
    const front = clear + pal.setback + tall;
    const mx = px + ux * (w / 2) + nx * front;
    const mz = pz + uz * (w / 2) + nz * front;
    const box = scratchBox;
    box.x = quant(mx - fx * (d / 2));
    box.z = quant(mz - fz * (d / 2));
    box.hx = w / 2;
    box.hz = d / 2;
    box.dir = facing;
    const fits =
      boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT) && clearOfStreets(b, box, tall) && clearOfBuildings(b, box, gapMin);
    if (!fits) {
      // Slide along a little and try again (the corner of a block, a park, the shore).
      at += blocked < 3 ? 2.5 : 5;
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
        if (!a || roll >= fill.keep * (patch.spec.keep ?? 1) * (0.4 + 0.6 * near)) continue;
        const px = quant(x + jx);
        const pz = quant(z + jz);
        if (patchAt(b.patches, px, pz) !== patch) continue;
        const box: Box = { x: px, z: pz, hx: a.footprint[0] / 2, hz: a.footprint[1] / 2, dir: turn < 0.5 ? 0 : 32 };
        if (!boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT)) continue;
        if (!clearOfStreets(b, box, fill.offStreet - SIDEWALK)) continue;
        if (!clearOfBuildings(b, box, a.height > TALL ? Math.max(fill.gap, TALL_APART) : fill.gap)) continue;
        addStructure(b, a, box);
      }
    }
  }
}
