/**
 * generatePortMeridian(seed): the one city of the game, as the same CityData the rest of the
 * code already uses. The hand-made plan is layout.ts; everything else here grows from it.
 *
 * IDENTICAL ON EVERY MACHINE. The server and every browser build this city from code and
 * compare a checksum, so nothing in this folder may call Math.sin, cos, tan, atan2, pow, exp,
 * log, hypot or any other function whose last bit can differ between JavaScript engines, nor
 * use the `**` operator. Only + - * /, Math.sqrt, floor, ceil, round, abs, min, max, the seeded
 * generator from math/rng.ts and the literal heading table in dirs.ts. Loops run over arrays in
 * index order; final coordinates are snapped to 1/8 m and headings to the table.
 * shared/test/meridian.test.ts scans these files for the forbidden names.
 */

import { hash32 } from '../../math/rng';
import type { Vec2 } from '../../math/vec';
import { CITY_HALF, CITY_SEED, PROP_KIND_IDS, type CityData, type District, type NeighborhoodAnchor, type RoadEdge, type RoadNode } from '../types';
import { buildAreas, buildRiver, toWorld } from './areas';
import { buildDecks, buildFronts, buildLandmarks, buildYards, createBuilder, openPockets, type Street } from './build';
import { furnish } from './furnish';
import { buildGround } from './ground';
import { ANCHORS, DISTRICT_TINTS, DISTRICTS, DOWNTOWN } from './layout';
import { planStreets } from './streets';

export function generatePortMeridian(seed: number = CITY_SEED): CityData {
  const areas = buildAreas();
  const river = buildRiver();
  const ground = buildGround(areas, CITY_HALF);

  // --- Streets ---------------------------------------------------------------------------------
  const plan = planStreets(ground, seed);
  const net = plan.net;
  const nodeId = new Int32Array(net.nodes.length).fill(-1);
  const nodes: RoadNode[] = [];
  for (let i = 0; i < net.nodes.length; i++) {
    if (net.nodes[i].edges.length === 0) continue;
    nodeId[i] = nodes.length;
    nodes.push({ id: nodes.length, x: net.nodes[i].x, z: net.nodes[i].z });
  }
  const streets: Street[] = [];
  for (const e of net.edges) {
    if (!e.alive) continue;
    const a = net.nodes[e.a];
    const b = net.nodes[e.b];
    streets.push({ id: streets.length, ax: a.x, az: a.z, bx: b.x, bz: b.z, spec: e.spec, deck: -1 });
  }
  const liveEdges = net.edges.filter((e) => e.alive);

  // --- Structures ------------------------------------------------------------------------------
  const builder = createBuilder(ground, streets);
  buildDecks(builder);
  buildLandmarks(builder);
  buildFronts(builder, seed);
  buildYards(builder, seed);
  openPockets(builder);

  const edges: RoadEdge[] = streets.map((s, i) => ({
    id: i,
    a: nodeId[liveEdges[i].a],
    b: nodeId[liveEdges[i].b],
    width: s.spec.width,
    kind: s.spec.kind,
    bridge: s.deck,
  }));

  // --- Props -----------------------------------------------------------------------------------
  const nodeStreets: number[][] = nodes.map(() => []);
  for (const e of edges) {
    nodeStreets[e.a].push(e.id);
    nodeStreets[e.b].push(e.id);
  }
  const nodePoints: Vec2[] = nodes.map((n) => ({ x: n.x, z: n.z }));
  const props = furnish(builder, nodePoints, nodeStreets, areas, river, seed);

  // --- Districts, anchors ----------------------------------------------------------------------
  const districts: District[] = DISTRICTS.map((d, id) => ({ id, zone: d.zone, name: d.name, polygon: d.poly.map(toWorld), tint: DISTRICT_TINTS[d.name] ?? 0xffffff }));
  const anchors: NeighborhoodAnchor[] = ANCHORS.map((a, id) => ({ id, name: a.name, x: -a.at[0], z: a.at[1] }));

  return {
    seed,
    half: CITY_HALF,
    structures: builder.structures,
    props,
    roads: { nodes, edges },
    areas,
    districts,
    anchors,
    downtown: { x: -DOWNTOWN[0], z: DOWNTOWN[1] },
  };
}

/**
 * A checksum of the WHOLE city: what cityChecksum covers (structures and props) plus the streets,
 * the areas, the districts and the anchors, all to the millimeter. Server and browser must agree
 * on this number too (shared/test/meridian.test.ts, and the browser check in docs/CITY.md).
 */
export function meridianChecksum(city: CityData): number {
  const mm = (v: number): number => Math.round(v * 1000);
  let h = hash32(city.structures.length, city.props.length, city.roads.nodes.length, city.roads.edges.length, city.areas.length);
  for (const s of city.structures) {
    h = hash32(h, mm(s.x), mm(s.z), mm(s.hx), mm(s.hz), mm(s.yaw), mm(s.height), mm(s.hp), mm(s.value), s.passable ? 1 : 0, s.archetype.length);
  }
  for (const p of city.props) h = hash32(h, mm(p.x), mm(p.z), mm(p.yaw), PROP_KIND_IDS.indexOf(p.kind));
  for (const n of city.roads.nodes) h = hash32(h, mm(n.x), mm(n.z));
  for (const e of city.roads.edges) h = hash32(h, e.a, e.b, mm(e.width), e.kind.length, e.bridge);
  for (const a of city.areas) {
    h = hash32(h, a.kind.length, a.polygon.length);
    for (const p of a.polygon) h = hash32(h, mm(p.x), mm(p.z));
  }
  for (const d of city.districts) {
    h = hash32(h, d.zone.length, d.polygon.length, d.tint ?? 0xffffff);
    for (const p of d.polygon) h = hash32(h, mm(p.x), mm(p.z));
  }
  for (const a of city.anchors) h = hash32(h, mm(a.x), mm(a.z));
  return hash32(h, mm(city.downtown.x), mm(city.downtown.z));
}
