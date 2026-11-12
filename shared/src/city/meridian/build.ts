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
import { boxExtentX, boxExtentZ, boxesTouch, distSqPointBox, distSqPointSeg, distSqSegBox, len, pointInPolygon, quant, type Box } from './geo';
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

/** No wall comes closer to a street's center line than this (a tank troop is 18 m wide: 3 m to spare each side). */
const DRIVE_HALF = 12;
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
  /** Scratch for visiting each box once in a neighborhood query. */
  boxStamp: number[];
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
  const b: Builder = { g, half: g.half, cols, streets, streetCells, structures: [], boxes: [], boxCells, boxStamp: [], patches: patchInfos(), stamp: [], stampNow: 0 };
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
      clearOfStreets(b, box, tall) && boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT) && clearOfBuildings(b, box, gapMin);
    if (!fits) {
      // Slide along and try again (the corner of a block, a park, the shore): a little at first, then in strides.
      at += blocked < 2 ? 3 : blocked < 5 ? 6 : 10;
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
        const box: Box = { x: px, z: pz, hx: a.footprint[0] / 2, hz: a.footprint[1] / 2, dir: turn < 0.5 ? 0 : 32 };
        if (!boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT)) continue;
        if (!clearOfStreets(b, box, fill.offStreet - SIDEWALK)) continue;
        if (!clearOfBuildings(b, box, a.height > TALL ? Math.max(fill.gap, TALL_APART) : fill.gap)) continue;
        addStructure(b, a, box);
      }
    }
  }
}

/** A tank (radius 4 m) is deployed with this much clear ground round it (sim/spawn.ts). */
const POCKET_CLEAR = 4.75;
const POCKET_CELL = 2;
/** Smaller specks of unreached ground than this many cells are left alone. */
const POCKET_MIN_CELLS = 3;

/**
 * Opens every enclosed yard. Squads are deployed wherever the stage bounds happen to run, on any
 * clear spot big enough for the unit; a yard walled in by buildings would trap a tank there for
 * the whole stage. So: flood the ground a tank can stand on from the streets, and wherever a
 * patch of it (12 m2 or more) is left unreached, take out the cheapest building of its wall and
 * flood on from there, until it joins the rest. Returns how many buildings were removed. Bridge
 * decks and landmarks are never removed.
 */
export function openPockets(b: Builder): number {
  const half = b.half;
  const n = Math.ceil((half * 2) / POCKET_CELL);
  // 0 free, 1 too close to a wall for a tank, 2 reached from the streets, 3 in the pocket at hand.
  const cells = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  const gone = new Uint8Array(b.structures.length);
  const reach = POCKET_CLEAR;
  const reachSq = reach * reach;
  const mark = (id: number): void => {
    const box = b.boxes[id];
    const c = DIR_COS[box.dir];
    const s = DIR_SIN[box.dir];
    const hx = box.hx;
    const hz = box.hz;
    const ex = boxExtentX(box) + reach;
    const ez = boxExtentZ(box) + reach;
    const c0 = Math.max(0, Math.floor((box.x - ex + half) / POCKET_CELL));
    const c1 = Math.min(n - 1, Math.floor((box.x + ex + half) / POCKET_CELL));
    const r0 = Math.max(0, Math.floor((box.z - ez + half) / POCKET_CELL));
    const r1 = Math.min(n - 1, Math.floor((box.z + ez + half) / POCKET_CELL));
    for (let r = r0; r <= r1; r++) {
      const z = -half + (r + 0.5) * POCKET_CELL - box.z;
      const row = r * n;
      for (let cc = c0; cc <= c1; cc++) {
        if (cells[row + cc] === 1) continue;
        const x = -half + (cc + 0.5) * POCKET_CELL - box.x;
        const lx = Math.abs(x * c - z * s) - hx;
        const lz = Math.abs(x * s + z * c) - hz;
        if (lx >= reach || lz >= reach) continue;
        if (lx <= 0 || lz <= 0 || lx * lx + lz * lz < reachSq) cells[row + cc] = 1;
      }
    }
  };
  for (let id = 0; id < b.structures.length; id++) if (!b.structures[id].passable) mark(id);

  /** Floods free cells from queue[head..tail) with `tag`; returns the new tail, negated when it met reached ground. */
  const flood = (head: number, tailIn: number, tag: number): number => {
    let tail = tailIn;
    let met = false;
    for (let q = head; q < tail; q++) {
      const k = queue[q];
      const c = k % n;
      if (c + 1 < n) {
        const v = cells[k + 1];
        if (v === 0) {
          cells[k + 1] = tag;
          queue[tail++] = k + 1;
        } else if (v === 2 && tag !== 2) met = true;
      }
      if (c > 0) {
        const v = cells[k - 1];
        if (v === 0) {
          cells[k - 1] = tag;
          queue[tail++] = k - 1;
        } else if (v === 2 && tag !== 2) met = true;
      }
      if (k + n < n * n) {
        const v = cells[k + n];
        if (v === 0) {
          cells[k + n] = tag;
          queue[tail++] = k + n;
        } else if (v === 2 && tag !== 2) met = true;
      }
      if (k >= n) {
        const v = cells[k - n];
        if (v === 0) {
          cells[k - n] = tag;
          queue[tail++] = k - n;
        } else if (v === 2 && tag !== 2) met = true;
      }
    }
    return met ? -tail : tail;
  };

  // Flood from the streets, a whole run of free cells at a time (most of the city is open ground).
  let top = 0;
  for (const st of b.streets) {
    const l = len(st.bx - st.ax, st.bz - st.az);
    const steps = Math.max(1, Math.ceil(l / POCKET_CELL));
    for (let i = 0; i <= steps; i++) {
      const x = st.ax + ((st.bx - st.ax) * i) / steps;
      const z = st.az + ((st.bz - st.az) * i) / steps;
      const k = Math.floor((z + half) / POCKET_CELL) * n + Math.floor((x + half) / POCKET_CELL);
      if (k >= 0 && k < n * n && cells[k] === 0 && top < queue.length) queue[top++] = k;
    }
  }
  while (top > 0) {
    const k = queue[--top];
    if (cells[k] !== 0) continue;
    const row = k - (k % n);
    let x0 = k;
    while (x0 > row && cells[x0 - 1] === 0) x0--;
    let x1 = k;
    while (x1 + 1 < row + n && cells[x1 + 1] === 0) x1++;
    for (let x = x0; x <= x1; x++) cells[x] = 2;
    for (let side = -1; side <= 1; side += 2) {
      const base = row + side * n;
      if (base < 0 || base >= n * n) continue;
      const shift = base - row;
      let open = false;
      for (let x = x0; x <= x1; x++) {
        const free = cells[x + shift] === 0;
        if (free && !open && top < queue.length) queue[top++] = x + shift;
        open = free;
      }
    }
  }

  let removed = 0;
  const near = reach + POCKET_CELL * 1.5;
  for (let k = 0; k < n * n; k++) {
    if (cells[k] !== 0) continue;
    cells[k] = 3;
    queue[0] = k;
    let end = flood(0, 1, 3);
    let joined = end < 0;
    if (joined) end = -end;
    // Take walls out, cheapest first, until the pocket runs into ground that is already reached.
    for (let tries = 0; tries < 6 && !joined && end >= POCKET_MIN_CELLS; tries++) {
      let best = -1;
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
              if (gone[id] || st.passable || st.landmark !== null) continue;
              if (distSqPointBox(x, z, b.boxes[id]) > near * near) continue;
              if (best < 0 || st.value < b.structures[best].value || (st.value === b.structures[best].value && id > best)) best = id;
            }
          }
        }
      }
      if (best < 0) break;
      gone[best] = 1;
      removed++;
      // Free the ground it stood on, except what its neighbors still cover.
      const box = b.boxes[best];
      const ex = boxExtentX(box) + reach;
      const ez = boxExtentZ(box) + reach;
      const c0 = Math.max(0, Math.floor((box.x - ex + half) / POCKET_CELL));
      const c1 = Math.min(n - 1, Math.floor((box.x + ex + half) / POCKET_CELL));
      const r0 = Math.max(0, Math.floor((box.z - ez + half) / POCKET_CELL));
      const r1 = Math.min(n - 1, Math.floor((box.z + ez + half) / POCKET_CELL));
      for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) if (cells[r * n + cc] === 1) cells[r * n + cc] = 0;
      const h0 = cellOf(b, box.x - ex - reach);
      const h1 = cellOf(b, box.x + ex + reach);
      const v0 = cellOf(b, box.z - ez - reach);
      const v1 = cellOf(b, box.z + ez + reach);
      const now = ++b.stampNow;
      for (let r = v0; r <= v1; r++) {
        for (let cc = h0; cc <= h1; cc++) {
          const list = b.boxCells[r * b.cols + cc];
          for (let i = 0; i < list.length; i++) {
            const id = list[i];
            if (gone[id] || b.structures[id].passable || b.boxStamp[id] === now) continue;
            b.boxStamp[id] = now;
            mark(id);
          }
        }
      }
      // Flood on from the whole pocket through the gap.
      end = flood(0, end, 3);
      joined = end < 0;
      if (joined) end = -end;
    }
    // Whatever happened, this ground is dealt with.
    for (let q = 0; q < end; q++) cells[queue[q]] = 2;
  }
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
