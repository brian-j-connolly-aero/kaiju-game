/**
 * The street network of Port Meridian: first the hand-drawn arterials (with their bridges and
 * the ford), then each district's own pattern grown inside it: a lattice that can be regular,
 * crooked or curving, or rings and spokes round a center. New streets join the older ones they
 * run into. A last pass removes stray dead ends and anything cut off from the rest.
 */

import { createRng, hash32, rngChance, rngFloat, rngRange, type Rng } from '../../math/rng';
import type { Vec2 } from '../../math/vec';
import { rectPolygon, toWorld } from './areas';
import { DIR_COS, DIR_COUNT, DIR_SIN } from './dirs';
import { len, pointInPolygon, quant } from './geo';
import { G_WATER, groundAt, landAround, stripOnGround, type Ground } from './ground';
import { PATCHES, STREETS, type LatticeSpec, type PatchSpec, type PolarSpec, type StreetSpec } from './layout';
import {
  addSegment,
  createRoadNet,
  degree,
  distSqToStreets,
  killEdge,
  rayToStreet,
  type RoadNet,
  type RoadSpec,
} from './roadnet';

/** A bridge deck to build: between two junctions of the network. */
export interface BridgePiece {
  nodeA: number;
  nodeB: number;
  deck: string;
}

export interface StreetPlan {
  net: RoadNet;
  bridges: BridgePiece[];
}

/** A new street keeps this far from older streets it does not join (center to center). */
const KEEP_OFF = 34;
/** A crossing needs plain land this far around it. */
const NODE_LAND = 12;
/** Street edges keep this far from water, parks and plazas. */
const STRIP_MARGIN = 3;
/** Decks reach this far onto each bank. */
const BRIDGE_LANDING = 5;

export function patchPolygon(p: PatchSpec): Vec2[] {
  if (p.rect) return rectPolygon(p.rect);
  return (p.poly ?? []).map(toWorld);
}

function arterialSpec(s: StreetSpec): RoadSpec {
  return {
    name: s.name,
    width: s.width,
    kind: s.kind,
    lots: s.lots ?? true,
    cars: s.cars ?? (s.kind === 'avenue' ? 1.2 : 2),
    ford: s.ford ?? false,
    deck: null,
    arterial: true,
    stub: false,
    patch: -1,
  };
}

/** Lays one piece of an arterial, with a bridge in it when a bridge point lies on the piece. */
function layArterialPiece(plan: StreetPlan, g: Ground, s: StreetSpec, spec: RoadSpec, a: Vec2, b: Vec2): void {
  const net = plan.net;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = len(dx, dz);
  const ux = dx / l;
  const uz = dz / l;
  // Bridges on this piece, as distances along it, nearest first.
  const cuts: Array<{ from: number; to: number; deck: string }> = [];
  for (const br of s.bridges ?? []) {
    const p = toWorld(br.at);
    const along = (p.x - a.x) * ux + (p.z - a.z) * uz;
    const off = (p.x - a.x) * -uz + (p.z - a.z) * ux;
    if (along <= 0 || along >= l || off > 1 || off < -1) continue;
    // Walk out from the point to both banks.
    const bank = (dir: number): number => {
      let t = along;
      let dry = 0;
      while (dry < 2 && t > 0 && t < l) {
        t += dir * 0.5;
        dry = groundAt(g, a.x + ux * t, a.z + uz * t) === G_WATER ? 0 : dry + 1;
      }
      return t + dir * BRIDGE_LANDING;
    };
    const from = Math.max(1, bank(-1));
    const to = Math.min(l - 1, bank(1));
    let at = cuts.length;
    while (at > 0 && cuts[at - 1].from > from) at--;
    cuts.splice(at, 0, { from, to, deck: br.deck });
  }
  let at = 0;
  for (const c of cuts) {
    const p0x = quant(a.x + ux * c.from);
    const p0z = quant(a.z + uz * c.from);
    const p1x = quant(a.x + ux * c.to);
    const p1z = quant(a.z + uz * c.to);
    addSegment(net, a.x + ux * at, a.z + uz * at, p0x, p0z, spec);
    const deckSpec: RoadSpec = { ...spec, kind: 'bridge', lots: false, cars: 0, deck: c.deck };
    const chain = addSegment(net, p0x, p0z, p1x, p1z, deckSpec);
    plan.bridges.push({ nodeA: chain[0], nodeB: chain[chain.length - 1], deck: c.deck });
    at = c.to;
  }
  addSegment(net, a.x + ux * at, a.z + uz * at, b.x, b.z, spec);
}

function layArterials(plan: StreetPlan, g: Ground): void {
  for (const s of STREETS) {
    const spec = arterialSpec(s);
    const pts = s.pts.map(toWorld);
    for (let i = 0; i + 1 < pts.length; i++) layArterialPiece(plan, g, s, spec, pts[i], pts[i + 1]);
  }
}

interface Crossing {
  x: number;
  z: number;
  ok: boolean;
}

/** State shared by the two patterns while one patch is laid. */
interface PatchJob {
  net: RoadNet;
  g: Ground;
  index: number;
  region: Vec2[];
  spec: RoadSpec;
  joinLen: number;
}

function crossingOk(job: PatchJob, x: number, z: number): boolean {
  if (!pointInPolygon(x, z, job.region)) return false;
  if (!landAround(job.g, x, z, NODE_LAND)) return false;
  return distSqToStreets(job.net, x, z, KEEP_OFF + 4, job.index) >= KEEP_OFF * KEEP_OFF;
}

/** Lays a piece of street; returns its two junctions when it is one plain piece (nothing crossed), else null. */
function lay(job: PatchJob, a: Crossing, b: Crossing): [number, number] | null {
  if (!stripOnGround(job.g, a.x, a.z, b.x, b.z, job.spec.width / 2, STRIP_MARGIN, false)) return null;
  const chain = addSegment(job.net, a.x, a.z, b.x, b.z, job.spec);
  return chain.length === 2 ? [chain[0], chain[1]] : null;
}

/** A piece that may be thinned out afterwards, with the roll that decides it. */
interface Thinnable {
  a: number;
  b: number;
  roll: number;
  drop: number;
}

/**
 * Thins a pattern: takes out the pieces whose roll says so, but only while both ends keep at
 * least two other streets, so thinning never leaves a dead end or a lone corner.
 */
function thin(net: RoadNet, pieces: readonly Thinnable[]): void {
  for (const p of pieces) {
    if (p.roll >= p.drop) continue;
    if (degree(net, p.a) < 3 || degree(net, p.b) < 3) continue;
    for (const id of net.nodes[p.a].edges) {
      const e = net.edges[id];
      if ((e.a === p.a && e.b === p.b) || (e.a === p.b && e.b === p.a)) {
        killEdge(net, id);
        break;
      }
    }
  }
}

/** From a good crossing, reaches along (dx, dz) for an older street and joins it. */
function join(job: PatchJob, from: Crossing, dx: number, dz: number): void {
  const l = len(dx, dz);
  if (l === 0) return;
  const ux = dx / l;
  const uz = dz / l;
  const d = rayToStreet(job.net, from.x, from.z, ux, uz, job.joinLen, job.index);
  if (d < 10) return;
  const tx = from.x + ux * d;
  const tz = from.z + uz * d;
  // The last few meters are the older street's own ground (its verge may be a promenade).
  const short = Math.max(0, d - 14);
  if (!stripOnGround(job.g, from.x, from.z, from.x + ux * short, from.z + uz * short, job.spec.width / 2, STRIP_MARGIN, false)) return;
  addSegment(job.net, from.x, from.z, tx, tz, job.spec);
}

function layLattice(job: PatchJob, s: LatticeSpec, rng: Rng): void {
  const ul = len(s.u[0], s.u[1]);
  // In map coordinates u = (e, n) and v is u turned a quarter left; in world x = -east.
  const ux = -s.u[0] / ul;
  const uz = s.u[1] / ul;
  const vx = s.u[1] / ul;
  const vz = s.u[0] / ul;
  const ox = -s.origin[0];
  const oz = s.origin[1];
  const nu = s.us.length;
  const nv = s.vs.length;
  const jitter = s.jitter ?? 0;
  const wave = s.wave ?? 0;
  const grid: Crossing[][] = [];
  for (let j = 0; j < nv; j++) {
    const row: Crossing[] = [];
    let drift = 0;
    for (let i = 0; i < nu; i++) {
      if (wave > 0) {
        drift += rngRange(rng, -wave, wave);
        if (drift > wave * 2) drift = wave * 2;
        if (drift < -wave * 2) drift = -wave * 2;
      }
      const a = s.us[i] + (jitter > 0 ? rngRange(rng, -jitter, jitter) : 0);
      const b = s.vs[j] + drift + (jitter > 0 ? rngRange(rng, -jitter, jitter) : 0);
      const x = quant(ox + ux * a + vx * b);
      const z = quant(oz + uz * a + vz * b);
      row.push({ x, z, ok: false });
    }
    grid.push(row);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) grid[j][i].ok = crossingOk(job, grid[j][i].x, grid[j][i].z);

  const dropU = s.dropU ?? 0;
  const dropV = s.dropV ?? 0;
  const laid: Array<[Crossing, Crossing]> = [];
  const pieces: Thinnable[] = [];
  // Lines along u.
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const c = grid[j][i];
      const roll = rngFloat(rng);
      if (!c.ok) continue;
      const prev = i > 0 ? grid[j][i - 1] : null;
      const next = i + 1 < nu ? grid[j][i + 1] : null;
      if (!prev || !prev.ok) join(job, c, prev ? prev.x - c.x : -ux, prev ? prev.z - c.z : -uz);
      if (next && next.ok) {
        const ends = lay(job, c, next);
        if (ends) pieces.push({ a: ends[0], b: ends[1], roll, drop: dropU });
        if (roll >= dropU) laid.push([c, next]);
      } else {
        join(job, c, next ? next.x - c.x : ux, next ? next.z - c.z : uz);
      }
    }
  }
  // Lines along v.
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const c = grid[j][i];
      const roll = rngFloat(rng);
      if (!c.ok) continue;
      const prev = j > 0 ? grid[j - 1][i] : null;
      const next = j + 1 < nv ? grid[j + 1][i] : null;
      if (!prev || !prev.ok) join(job, c, prev ? prev.x - c.x : -vx, prev ? prev.z - c.z : -vz);
      if (next && next.ok) {
        const ends = lay(job, c, next);
        if (ends) pieces.push({ a: ends[0], b: ends[1], roll, drop: dropV });
      } else {
        join(job, c, next ? next.x - c.x : vx, next ? next.z - c.z : vz);
      }
    }
  }
  thin(job.net, pieces);
  // Closes: a short dead end off the middle of a long piece, into the block.
  const closes = s.closes ?? 0;
  if (closes > 0) {
    const stub: RoadSpec = { ...job.spec, stub: true, cars: 1 };
    for (const [a, b] of laid) {
      const roll = rngFloat(rng);
      const side = rngChance(rng, 0.5) ? 1 : -1;
      if (roll >= closes) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = len(dx, dz);
      if (l < 64) continue;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const px = (-dz / l) * side;
      const pz = (dx / l) * side;
      const ex = quant(mx + px * 36);
      const ez = quant(mz + pz * 36);
      if (!pointInPolygon(ex, ez, job.region) || !landAround(job.g, ex, ez, NODE_LAND)) continue;
      // Clear of every other street at its head and half way along.
      if (distSqToStreets(job.net, ex, ez, 40, -2) < 30 * 30) continue;
      if (!stripOnGround(job.g, mx, mz, ex, ez, job.spec.width / 2, STRIP_MARGIN, false)) continue;
      addSegment(job.net, mx, mz, ex, ez, stub);
    }
  }
}

function layPolar(job: PatchJob, s: PolarSpec, rng: Rng): void {
  const cx = -s.center[0];
  const cz = s.center[1];
  const rings: Crossing[][] = [];
  for (const ring of s.rings) {
    const step = DIR_COUNT / ring.n;
    const row: Crossing[] = [];
    for (let m = 0; m < ring.n; m++) {
      const x = quant(cx + DIR_SIN[m * step] * ring.r);
      const z = quant(cz + DIR_COS[m * step] * ring.r);
      row.push({ x, z, ok: false });
    }
    rings.push(row);
  }
  for (const row of rings) for (const c of row) c.ok = crossingOk(job, c.x, c.z);
  const dropRing = s.dropRing ?? 0;
  const pieces: Thinnable[] = [];
  for (let k = 0; k < rings.length; k++) {
    const ring = s.rings[k];
    const row = rings[k];
    const step = DIR_COUNT / ring.n;
    // Round the ring.
    for (let m = 0; m < ring.n; m++) {
      const c = row[m];
      const next = row[(m + 1) % ring.n];
      const prev = row[(m + ring.n - 1) % ring.n];
      const roll = rngFloat(rng);
      if (!c.ok) continue;
      if (!prev.ok) join(job, c, prev.x - c.x, prev.z - c.z);
      if (next.ok) {
        const ends = lay(job, c, next);
        if (ends) pieces.push({ a: ends[0], b: ends[1], roll, drop: dropRing });
      } else {
        join(job, c, next.x - c.x, next.z - c.z);
      }
    }
    // Spokes outward.
    const outer = k + 1 < rings.length ? s.rings[k + 1] : null;
    const from = ring.spokeFrom ?? 0;
    for (let m = 0; m < ring.n; m++) {
      if ((m - from + ring.n) % ring.spokeEvery !== 0) continue;
      const c = row[m];
      if (!c.ok) continue;
      const dir = m * step;
      let target: Crossing | null = null;
      if (outer) {
        const ostep = DIR_COUNT / outer.n;
        if (dir % ostep === 0) target = rings[k + 1][dir / ostep];
      }
      if (target && target.ok) lay(job, c, target);
      else join(job, c, DIR_SIN[dir], DIR_COS[dir]);
    }
  }
  thin(job.net, pieces);
}

function layPatches(plan: StreetPlan, g: Ground, seed: number): void {
  PATCHES.forEach((patch, index) => {
    const s = patch.streets;
    if (!s) return;
    const spec: RoadSpec = {
      name: patch.name,
      width: s.width ?? 11,
      kind: 'street',
      lots: true,
      cars: s.cars ?? 2.2,
      ford: false,
      deck: null,
      arterial: false,
      stub: false,
      patch: index,
    };
    const job: PatchJob = { net: plan.net, g, index, region: patchPolygon(patch), spec, joinLen: s.joinLen ?? 130 };
    const rng = createRng(hash32(seed, 101, index));
    if (s.type === 'lattice') layLattice(job, s, rng);
    else layPolar(job, s, rng);
  });
}

/** Removes generated dead ends (closes and arterials may end where they like) and cut-off pieces. */
function tidy(net: RoadNet): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let n = 0; n < net.nodes.length; n++) {
      if (degree(net, n) !== 1) continue;
      const id = net.nodes[n].edges[0];
      const spec = net.edges[id].spec;
      if (spec.arterial || spec.stub) continue;
      killEdge(net, id);
      changed = true;
    }
  }
  // Keep what can be reached from the first arterial.
  const seen = new Uint8Array(net.nodes.length);
  const start = net.edges.findIndex((e) => e.alive);
  if (start < 0) return;
  const queue = [net.edges[start].a];
  seen[queue[0]] = 1;
  for (let q = 0; q < queue.length; q++) {
    for (const id of net.nodes[queue[q]].edges) {
      const e = net.edges[id];
      const other = e.a === queue[q] ? e.b : e.a;
      if (seen[other]) continue;
      seen[other] = 1;
      queue.push(other);
    }
  }
  for (let id = 0; id < net.edges.length; id++) {
    const e = net.edges[id];
    if (e.alive && !seen[e.a]) killEdge(net, id);
  }
}

export function planStreets(g: Ground, seed: number): StreetPlan {
  const plan: StreetPlan = { net: createRoadNet(g.half), bridges: [] };
  layArterials(plan, g);
  layPatches(plan, g, seed);
  tidy(plan.net);
  return plan;
}
