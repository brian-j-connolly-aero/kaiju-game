/**
 * Builds the street network as a planar graph. Streets are added one straight piece at a time;
 * the builder finds where a new piece meets what is already there and makes a junction: at an
 * existing junction when one is near, in the middle of a street (splitting it) otherwise. The
 * order in which pieces are added is fixed by the layout data, and every decision is made with
 * plain arithmetic, so the same network comes out on every machine.
 */

import { distSqPointSeg, quant, segSeg, type SegHit } from './geo';

export type RoadKind = 'street' | 'avenue' | 'bridge';

/** What every piece of one street shares. */
export interface RoadSpec {
  name: string;
  width: number;
  kind: RoadKind;
  /** Buildings may front this street. */
  lots: boolean;
  /** Parked cars per 100 m of curb, each side. */
  cars: number;
  /** A crossing through the shallow river: no deck, no lots, no props. */
  ford: boolean;
  /** Archetype of the deck for a bridge piece. */
  deck: string | null;
  /** A hand-drawn arterial (kept even when it ends in a dead end). */
  arterial: boolean;
  /** A short close (cul-de-sac): a dead end on purpose. */
  stub: boolean;
  /** Patch the street was generated for, or -1. */
  patch: number;
}

export interface NetNode {
  x: number;
  z: number;
  /** Edge ids that touch it (alive ones only once compacted). */
  edges: number[];
}

export interface NetEdge {
  a: number;
  b: number;
  spec: RoadSpec;
  alive: boolean;
}

/** Side of a hash cell, meters. */
const CELL = 55;
/** A new end closer than this to a junction uses that junction. */
export const MERGE = 9;
/** A new end closer than this to the middle of a street joins it there. */
const SNAP = 7;

export interface RoadNet {
  half: number;
  cols: number;
  nodes: NetNode[];
  edges: NetEdge[];
  cellEdges: number[][];
  cellNodes: number[][];
  stamp: number[];
  stampNow: number;
}

export function createRoadNet(half: number): RoadNet {
  const cols = Math.ceil((half * 2) / CELL);
  const cellEdges: number[][] = [];
  const cellNodes: number[][] = [];
  for (let i = 0; i < cols * cols; i++) {
    cellEdges.push([]);
    cellNodes.push([]);
  }
  return { half, cols, nodes: [], edges: [], cellEdges, cellNodes, stamp: [], stampNow: 0 };
}

function cellOf(net: RoadNet, v: number): number {
  const c = Math.floor((v + net.half) / CELL);
  return c < 0 ? 0 : c >= net.cols ? net.cols - 1 : c;
}

export function addNode(net: RoadNet, x: number, z: number): number {
  const id = net.nodes.length;
  const qx = quant(x);
  const qz = quant(z);
  net.nodes.push({ x: qx, z: qz, edges: [] });
  net.cellNodes[cellOf(net, qz) * net.cols + cellOf(net, qx)].push(id);
  return id;
}

/** The node nearest to (x, z) within `radius`, or -1. Ties go to the lower id. */
export function findNode(net: RoadNet, x: number, z: number, radius: number): number {
  const c0 = cellOf(net, x - radius);
  const c1 = cellOf(net, x + radius);
  const r0 = cellOf(net, z - radius);
  const r1 = cellOf(net, z + radius);
  let best = -1;
  let bestD = radius * radius;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const id of net.cellNodes[r * net.cols + c]) {
        const n = net.nodes[id];
        const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
        if (d < bestD || (d === bestD && best >= 0 && id < best)) {
          bestD = d;
          best = id;
        }
      }
    }
  }
  return best;
}

function registerEdge(net: RoadNet, id: number): void {
  const e = net.edges[id];
  const a = net.nodes[e.a];
  const b = net.nodes[e.b];
  const c0 = cellOf(net, Math.min(a.x, b.x) - 1);
  const c1 = cellOf(net, Math.max(a.x, b.x) + 1);
  const r0 = cellOf(net, Math.min(a.z, b.z) - 1);
  const r1 = cellOf(net, Math.max(a.z, b.z) + 1);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) net.cellEdges[r * net.cols + c].push(id);
}

export function linked(net: RoadNet, a: number, b: number): boolean {
  for (const id of net.nodes[a].edges) {
    const e = net.edges[id];
    if (e.alive && (e.a === b || e.b === b)) return true;
  }
  return false;
}

/** Adds an edge between two existing nodes (nothing when they are the same or already joined). */
export function linkNodes(net: RoadNet, a: number, b: number, spec: RoadSpec): number {
  if (a === b || linked(net, a, b)) return -1;
  const id = net.edges.length;
  net.edges.push({ a, b, spec, alive: true });
  net.stamp.push(0);
  net.nodes[a].edges.push(id);
  net.nodes[b].edges.push(id);
  registerEdge(net, id);
  return id;
}

export function killEdge(net: RoadNet, id: number): void {
  const e = net.edges[id];
  if (!e.alive) return;
  e.alive = false;
  const drop = (list: number[]): void => {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
  };
  drop(net.nodes[e.a].edges);
  drop(net.nodes[e.b].edges);
}

/** Splits an edge at a new node placed at (x, z); returns the node. */
export function splitEdge(net: RoadNet, id: number, x: number, z: number): number {
  const e = net.edges[id];
  const n = addNode(net, x, z);
  killEdge(net, id);
  linkNodes(net, e.a, n, e.spec);
  linkNodes(net, n, e.b, e.spec);
  return n;
}

/** Ids of live edges whose hash cells touch the rectangle; each once, ascending by first sight. */
export function edgesNear(net: RoadNet, x0: number, z0: number, x1: number, z1: number, out: number[]): number[] {
  out.length = 0;
  const now = ++net.stampNow;
  const c0 = cellOf(net, Math.min(x0, x1));
  const c1 = cellOf(net, Math.max(x0, x1));
  const r0 = cellOf(net, Math.min(z0, z1));
  const r1 = cellOf(net, Math.max(z0, z1));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const id of net.cellEdges[r * net.cols + c]) {
        if (net.stamp[id] === now || !net.edges[id].alive) continue;
        net.stamp[id] = now;
        out.push(id);
      }
    }
  }
  return out;
}

const near: number[] = [];
const hit: SegHit = { t: 0, u: 0 };

/**
 * The junction for a street end at (x, z): an existing node within MERGE, else a new node
 * splitting a street that passes within SNAP (never a bridge), else a new free node.
 */
export function endNode(net: RoadNet, x: number, z: number): number {
  const found = findNode(net, x, z, MERGE);
  if (found >= 0) return found;
  edgesNear(net, x - SNAP, z - SNAP, x + SNAP, z + SNAP, near);
  let best = -1;
  let bestD = SNAP * SNAP;
  for (const id of near) {
    const e = net.edges[id];
    if (e.spec.kind === 'bridge') continue;
    const a = net.nodes[e.a];
    const b = net.nodes[e.b];
    const d = distSqPointSeg(x, z, a.x, a.z, b.x, b.z);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  if (best >= 0) {
    const e = net.edges[best];
    const a = net.nodes[e.a];
    const b = net.nodes[e.b];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
    return splitEdge(net, best, a.x + dx * t, a.z + dz * t);
  }
  return addNode(net, x, z);
}

interface Crossing {
  t: number;
  node: number;
}

/**
 * Adds the straight street a..b. Its ends join what is there (see endNode); wherever it crosses
 * an existing street a junction is made. Returns the ids of the nodes along it, in order.
 */
export function addSegment(net: RoadNet, ax: number, az: number, bx: number, bz: number, spec: RoadSpec): number[] {
  const na = endNode(net, ax, az);
  const nb = endNode(net, bx, bz);
  if (na === nb) return [na];
  const A = net.nodes[na];
  const B = net.nodes[nb];
  const crossings: Crossing[] = [];
  edgesNear(net, A.x, A.z, B.x, B.z, near);
  // Splitting changes the edge list, so first collect, then split.
  const found: Array<{ edge: number; t: number; u: number }> = [];
  for (const id of near) {
    const e = net.edges[id];
    if (e.a === na || e.b === na || e.a === nb || e.b === nb) continue;
    const p = net.nodes[e.a];
    const q = net.nodes[e.b];
    if (!segSeg(A.x, A.z, B.x, B.z, p.x, p.z, q.x, q.z, hit)) continue;
    found.push({ edge: id, t: hit.t, u: hit.u });
  }
  for (const f of found) {
    const e = net.edges[f.edge];
    if (!e.alive) continue;
    const x = A.x + (B.x - A.x) * f.t;
    const z = A.z + (B.z - A.z) * f.t;
    let node = findNode(net, x, z, MERGE);
    if (node < 0) {
      if (e.spec.kind === 'bridge') continue;
      node = splitEdge(net, f.edge, x, z);
    }
    if (node === na || node === nb) continue;
    let known = false;
    for (const c of crossings) if (c.node === node) known = true;
    if (!known) crossings.push({ t: f.t, node });
  }
  // Order along the new street; equal parameters keep the order they were found in.
  for (let i = 1; i < crossings.length; i++) {
    const c = crossings[i];
    let j = i - 1;
    while (j >= 0 && crossings[j].t > c.t) {
      crossings[j + 1] = crossings[j];
      j--;
    }
    crossings[j + 1] = c;
  }
  const chain = [na];
  for (const c of crossings) chain.push(c.node);
  chain.push(nb);
  for (let i = 0; i + 1 < chain.length; i++) linkNodes(net, chain[i], chain[i + 1], spec);
  return chain;
}

/**
 * Where a ray from (ax, az) along the unit direction (ux, uz) first meets a live street that
 * does not belong to patch `own`, within `maxLen`. Returns the distance, or -1. Bridges and
 * fords do not count.
 */
export function rayToStreet(net: RoadNet, ax: number, az: number, ux: number, uz: number, maxLen: number, own: number): number {
  const bx = ax + ux * maxLen;
  const bz = az + uz * maxLen;
  edgesNear(net, ax, az, bx, bz, near);
  let best = -1;
  for (const id of near) {
    const e = net.edges[id];
    if (e.spec.patch === own || e.spec.kind === 'bridge' || e.spec.ford) continue;
    const p = net.nodes[e.a];
    const q = net.nodes[e.b];
    if (!segSeg(ax, az, bx, bz, p.x, p.z, q.x, q.z, hit)) continue;
    const d = hit.t * maxLen;
    if (best < 0 || d < best) best = d;
  }
  return best;
}

/**
 * Squared distance from a point to the nearest live street within `reach` that does not belong
 * to patch `own` (pass -2 to count every street). Fords do not count: a street may end at one.
 * Infinity when none is near.
 */
export function distSqToStreets(net: RoadNet, x: number, z: number, reach: number, own: number): number {
  edgesNear(net, x - reach, z - reach, x + reach, z + reach, near);
  let best = Infinity;
  for (const id of near) {
    const e = net.edges[id];
    if (e.spec.patch === own || e.spec.ford) continue;
    const p = net.nodes[e.a];
    const q = net.nodes[e.b];
    const d = distSqPointSeg(x, z, p.x, p.z, q.x, q.z);
    if (d < best) best = d;
  }
  return best;
}

export function degree(net: RoadNet, node: number): number {
  return net.nodes[node].edges.length;
}
