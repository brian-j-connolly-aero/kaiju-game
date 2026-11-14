/**
 * Geometry for one structure archetype in its three visual states (intact, damaged, rubble).
 *
 * When the art file for the archetype exists (`bld_<id>.glb` / `lm_<id>.glb` with nodes
 * `intact`, `damaged`, `rubble`, `chunk_NN`: docs/ASSETS.md section 3) its meshes are used.
 * Without it each state is a painted box: walls that repeat a window tile once per storey, a
 * roof, a cracked and scorched version, and a low grey heap. A real model's collapse pieces are
 * kept as meshes (`ChunkBox.mesh`); a box stand-in's are plain boxes.
 *
 * Rubble stays (docs/ROADMAP.md phase 2): a building that collapses where it stands is a mound
 * half its height (RUBBLE_RULES, the same shape the simulation's shots and sight meet), so the
 * rubble state is built here from the building's own collapse pieces, piled up and tilted, in
 * its own paint: a heap of that building, not a grey box. A building that falls over lies on its
 * side as its damaged model (`fall`), with the art's low rubble left on its footprint (`base`).
 */

import * as THREE from 'three';
import { RUBBLE_RULES, type ArchetypeDef } from '@mb/shared';
import type { MaterialKind, RigModel } from '../assets/rigModel';
import { box, boxOn, merge, paint } from '../assets/procedural/geo';
import { sequence } from '../assets/procedural/textures';

export type StatePartMaterial = MaterialKind | 'building';

export interface StatePart {
  geometry: THREE.BufferGeometry;
  material: StatePartMaterial;
}

export interface ChunkBox {
  /** Center in the structure's local space. */
  x: number;
  y: number;
  z: number;
  /** Full size. */
  w: number;
  h: number;
  d: number;
  /** The art's own piece (centered on the chunk's center, unindexed); absent on box stand-ins. */
  mesh?: ChunkMesh;
}

/** A collapse piece's triangles as flat arrays, ready to be transformed into the falling-chunk buffer. */
export interface ChunkMesh {
  /** x, y, z per vertex, three vertices per triangle, centered on the chunk's center. */
  position: Float32Array;
  /** u, v per vertex (glTF convention, into the city atlas). */
  uv: Float32Array;
  /** r, g, b, a per vertex: a = 1 on faces that take the building's tint. */
  color: Float32Array;
}

export interface ArchetypeGeometry {
  /** Parts for the states intact, damaged, rubble (the rubble a mound: `moundHeight`). */
  states: [StatePart[], StatePart[], StatePart[]];
  chunks: ChunkBox[];
  /** True when built from boxes (the instance color then carries the building's tone). */
  procedural: boolean;
  /** What tips over and then lies on its side when the structure falls over (its damaged model; a mast's lattice below its top). */
  fall: StatePart[];
  /** What stays on the footprint of a structure that fell over: the art's low rubble. */
  base: StatePart[];
  /**
   * A radio mast's top section (the art's `top` node, in its own frame: the origin on the mast's
   * axis where it breaks off), drawn tumbling while the mast falls; null for everything else.
   */
  top: { parts: StatePart[]; at: THREE.Vector3 } | null;
}

/** How tall the mound of a collapsed structure of this archetype is (meters): the simulation's `srubble` (city/spatialIndex.ts). */
export function moundHeight(def: Pick<ArchetypeDef, 'height' | 'passable'>): number {
  return def.passable ? 0 : Math.min(RUBBLE_RULES.maxHeight, def.height * RUBBLE_RULES.heightShare);
}

const WINDOW_WIDTH = 12;
const STOREY_HEIGHT = 14;
const WALL_UV = 0.02;

/** A box whose walls repeat the window tile and whose top and bottom are plain. */
function windowBox(w: number, h: number, d: number, y0: number, wall: THREE.ColorRepresentation, roof: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y0 + h / 2, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const position = g.getAttribute('position') as THREE.BufferAttribute;
  const normal = g.getAttribute('normal') as THREE.BufferAttribute;
  const color = new Float32Array(position.count * 4);
  const wallColor = new THREE.Color(wall);
  const roofColor = new THREE.Color(roof);
  for (let i = 0; i < position.count; i++) {
    const ny = normal.getY(i);
    const c = Math.abs(ny) > 0.5 ? roofColor : wallColor;
    color[i * 4] = c.r;
    color[i * 4 + 1] = c.g;
    color[i * 4 + 2] = c.b;
    color[i * 4 + 3] = 1;
    if (Math.abs(ny) > 0.5) {
      uv.setXY(i, WALL_UV, WALL_UV);
    } else {
      const along = Math.abs(normal.getX(i)) > 0.5 ? d : w;
      // Whole tiles only, so windows are never cut in half at a corner.
      const tilesX = Math.max(1, Math.round(along / WINDOW_WIDTH));
      const tilesY = Math.max(0.5, Math.round((h / STOREY_HEIGHT) * 2) / 2);
      uv.setXY(i, uv.getX(i) * tilesX, uv.getY(i) * tilesY);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 4));
  return g;
}

/** Plain geometry (no windows): texture coordinates parked on the wall-colored corner of the tile. */
function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, WALL_UV, WALL_UV);
  return g;
}

function gableRoof(w: number, d: number, y0: number, rise: number, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  // A triangular prism along the longer side.
  const alongX = w >= d;
  const hw = w / 2 + 0.3;
  const hd = d / 2 + 0.3;
  const verts: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => {
    verts.push(...a, ...b, ...c);
  };
  if (alongX) {
    const r0 = [-hw, y0 + rise, 0];
    const r1 = [hw, y0 + rise, 0];
    const a = [-hw, y0, hd];
    const b = [hw, y0, hd];
    const c = [hw, y0, -hd];
    const e = [-hw, y0, -hd];
    tri(a, b, r1);
    tri(a, r1, r0);
    tri(c, e, r0);
    tri(c, r0, r1);
    tri(e, a, r0);
    tri(b, c, r1);
  } else {
    const r0 = [0, y0 + rise, -hd];
    const r1 = [0, y0 + rise, hd];
    const a = [hw, y0, -hd];
    const b = [hw, y0, hd];
    const c = [-hw, y0, hd];
    const e = [-hw, y0, -hd];
    tri(a, r0, r1);
    tri(a, r1, b);
    tri(c, r1, r0);
    tri(c, r0, e);
    tri(e, r0, a);
    tri(b, r1, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((verts.length / 3) * 2).fill(WALL_UV), 2));
  g.computeVertexNormals();
  return paint(g, color);
}

const RUBBLE = [0x8d8d94, 0x9a9aa1, 0x7b7b82, 0xa6a6ac];
const SCORCH = 0x3b3632;

function proceduralStates(def: ArchetypeDef): ArchetypeGeometry {
  const [w, d] = def.footprint;
  const h = def.height;
  const next = sequence(def.id.length * 131 + Math.round(h * 7) + Math.round(w * 3));
  const roofTone = 0.62;
  const roofColor = new THREE.Color(roofTone, roofTone, roofTone);

  let intact: THREE.BufferGeometry[];
  let damaged: THREE.BufferGeometry[];
  if (def.cls === 'bridge') {
    // A roadway slab near the ground with tall side trusses: units drive over the slab.
    const rail = 0x9aa3b0;
    const deck = [plain(boxOn(w, 0.5, d, 0x2b3040, 0, 0, 0))];
    const sides = (scale: number): THREE.BufferGeometry[] => [
      plain(boxOn(0.9, h * scale, d, rail, w / 2 - 0.45, 0.5, 0)),
      plain(boxOn(0.9, h * scale, d, rail, -w / 2 + 0.45, 0.5, 0)),
      plain(boxOn(w, 0.8, 1.2, rail, 0, 0.5 + h * scale - 0.8, d / 2 - 0.6)),
      plain(boxOn(w, 0.8, 1.2, rail, 0, 0.5 + h * scale - 0.8, -d / 2 + 0.6)),
    ];
    intact = [...deck, ...sides(1)];
    damaged = [...deck, ...sides(0.55), plain(boxOn(w * 0.5, 0.3, d * 0.2, SCORCH, w * 0.1, 0.5, d * 0.15))];
  } else {
    const white = 0xffffff;
    const body = windowBox(w, h, d, 0, white, roofColor);
    intact = [body];
    if (def.cls === 'house') {
      intact.push(gableRoof(w, d, h, Math.min(3, h * 0.45), 0xc8573b));
    } else if (def.cls === 'tower' || def.cls === 'office' || def.cls === 'landmark') {
      intact.push(plain(boxOn(w * 0.45, Math.max(2, h * 0.05), d * 0.45, new THREE.Color(0.8, 0.8, 0.8), 0, h, 0)));
      if (def.cls !== 'office') intact.push(plain(boxOn(0.8, h * 0.12, 0.8, 0xd7263d, 0, h + Math.max(2, h * 0.05), 0)));
    } else if (def.cls === 'factory') {
      intact.push(plain(boxOn(w * 0.12, h * 0.6, w * 0.12, 0x9a5a48, w * 0.3, h, d * 0.2)));
      intact.push(plain(boxOn(w * 0.12, h * 0.45, w * 0.12, 0x9a5a48, w * 0.1, h, d * 0.2)));
    } else if (def.cls === 'shop') {
      intact.push(plain(boxOn(w * 1.02, 0.7, 1.2, 0xe0372f, 0, Math.min(3.2, h * 0.5), d / 2 + 0.5)));
    }

    // Damaged: the same silhouette with a bite out of the top, scorch marks and holes.
    const cut = h * 0.82;
    damaged = [
      windowBox(w, cut, d, 0, new THREE.Color(0.9, 0.9, 0.9), new THREE.Color(0.3, 0.28, 0.27)),
      plain(boxOn(w * 0.55, h - cut, d * 0.6, new THREE.Color(0.8, 0.8, 0.8), -w * 0.2, cut, d * 0.15)),
    ];
    for (let i = 0; i < 4; i++) {
      const onX = i % 2 === 0;
      const sign = i < 2 ? 1 : -1;
      const sw = (onX ? d : w) * (0.18 + next() * 0.2);
      const sh = h * (0.12 + next() * 0.18);
      const along = ((onX ? d : w) - sw) * (next() - 0.5);
      const y = h * (0.15 + next() * 0.5);
      damaged.push(
        plain(onX ? box(0.4, sh, sw, SCORCH, sign * (w / 2), y, along) : box(sw, sh, 0.4, SCORCH, along, y, sign * (d / 2))),
      );
    }
  }

  // Rubble: a grey heap inside the footprint, as tall as the mound the simulation counts (a low
  // one for a bridge deck, which leaves none).
  const heapOf = (heap: number): THREE.BufferGeometry => {
    const parts: THREE.BufferGeometry[] = [plain(boxOn(w * 0.96, heap * 0.35, d * 0.96, RUBBLE[0], 0, 0, 0))];
    for (let i = 0; i < 5; i++) {
      const rw = w * (0.2 + next() * 0.3);
      const rd = d * (0.2 + next() * 0.3);
      const g = boxOn(rw, heap * (0.5 + next() * 0.5), rd, RUBBLE[1 + (i % 3)], (w - rw) * (next() - 0.5), 0, (d - rd) * (next() - 0.5));
      parts.push(plain(g));
    }
    return merge(parts);
  };
  const low = Math.min(2.2, Math.max(0.5, h * 0.12));
  const mound = moundHeight(def);
  const base: StatePart[] = [{ geometry: heapOf(low), material: 'building' }];
  const damagedParts: StatePart[] = [{ geometry: merge(damaged), material: 'building' }];

  return {
    states: [[{ geometry: merge(intact), material: 'building' }], damagedParts, mound > 0 ? [{ geometry: heapOf(mound), material: 'building' }] : base],
    chunks: proceduralChunks(w, h, d),
    procedural: true,
    fall: damagedParts,
    base,
    top: null,
  };
}

function proceduralChunks(w: number, h: number, d: number): ChunkBox[] {
  const nx = w > 30 ? 3 : 2;
  const nz = d > 30 ? 3 : 2;
  const ny = Math.max(1, Math.min(4, Math.round(h / 14)));
  const chunks: ChunkBox[] = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        chunks.push({
          x: (ix + 0.5) * (w / nx) - w / 2,
          y: (iy + 0.5) * (h / ny),
          z: (iz + 0.5) * (d / nz) - d / 2,
          w: w / nx,
          h: h / ny,
          d: d / nz,
        });
      }
    }
  }
  return chunks;
}

/** Bakes a node's rest position into copies of its parts, so the state sits where the art put it. */
function partsOfNode(model: RigModel, index: number): StatePart[] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = index; i >= 0; i = model.nodes[i].parent) {
    x += model.nodes[i].position.x;
    y += model.nodes[i].position.y;
    z += model.nodes[i].position.z;
  }
  return model.nodes[index].parts.map((part) => {
    const geometry = x === 0 && y === 0 && z === 0 ? part.geometry : part.geometry.clone().translate(x, y, z);
    return { geometry, material: part.material };
  });
}

/** Flattens a chunk's geometries into unindexed arrays centered on `center`. */
export function chunkMesh(geometries: THREE.BufferGeometry[], center: THREE.Vector3): ChunkMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  for (const source of geometries) {
    const g = source.index ? source.toNonIndexed() : source;
    const position = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const color = g.getAttribute('color');
    for (let v = 0; v < position.count; v++) {
      positions.push(position.getX(v) - center.x, position.getY(v) - center.y, position.getZ(v) - center.z);
      uvs.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0);
      if (color) colors.push(color.getX(v), color.getY(v), color.getZ(v), color.itemSize >= 4 ? color.getW(v) : 0);
      else colors.push(1, 1, 1, 0);
    }
  }
  return { position: new Float32Array(positions), uv: new Float32Array(uvs), color: new Float32Array(colors) };
}

/** A small seeded generator from a string (the archetype id), so every client piles a mound the same way. */
function seeded(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return sequence(h >>> 0);
}

const pileMatrix = new THREE.Matrix4();
const pileQuat = new THREE.Quaternion();
const pileEuler = new THREE.Euler();
const pilePos = new THREE.Vector3();
const pileScale = new THREE.Vector3();

/**
 * The mound a collapsed building leaves (docs/ROADMAP.md phase 2, "rubble stays"), piled from its
 * own collapse pieces: each piece keeps its place over the footprint, pulled in a little the
 * higher it stood, squashed toward the pile's height and tilted; the pile is then scaled to
 * stand exactly `height` meters high (the simulation's mound, which stops shots and sight). The
 * pieces keep their atlas coordinates and their wall mask, so the heap shows the building's own
 * walls, windows and roof in its own paint. Null when there are no art pieces or no mound.
 */
export function moundGeometry(chunks: readonly ChunkBox[], def: Pick<ArchetypeDef, 'id' | 'footprint' | 'height'>, height: number): THREE.BufferGeometry | null {
  const pieces = chunks.filter((c) => c.mesh).sort((a, b) => a.y - b.y);
  if (pieces.length === 0 || !(height > 0)) return null;
  const [w, d] = def.footprint;
  const h = Math.max(0.5, def.height);
  const next = seeded(def.id);
  // A piece of a tall building is squashed hard (its 20 m floors become a 6 m slab of the heap).
  const squash = Math.min(0.9, Math.max(0.28, (height / h) * 1.25));
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  for (const c of pieces) {
    const mesh = c.mesh as ChunkMesh;
    const t = Math.min(1, Math.max(0, c.y / h));
    const pull = 1 - 0.32 * t;
    pilePos.set(c.x * pull + (next() - 0.5) * w * 0.14, t * height * 0.85, c.z * pull + (next() - 0.5) * d * 0.14);
    // Tilted up to about 32 degrees either way, turned a little: broken, but never far enough to stick out of the heap.
    pileQuat.setFromEuler(pileEuler.set((next() - 0.5) * 1.1, (next() - 0.5) * 0.6, (next() - 0.5) * 1.1));
    pileMatrix.compose(pilePos, pileQuat, pileScale.set(0.86 + next() * 0.1, squash, 0.86 + next() * 0.1));
    const e = pileMatrix.elements;
    const count = mesh.position.length / 3;
    for (let v = 0; v < count; v++) {
      const x = mesh.position[v * 3];
      const y = mesh.position[v * 3 + 1];
      const z = mesh.position[v * 3 + 2];
      positions.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      uvs.push(mesh.uv[v * 2], mesh.uv[v * 2 + 1]);
      colors.push(mesh.color[v * 4], mesh.color[v * 4 + 1], mesh.color[v * 4 + 2], mesh.color[v * 4 + 3]);
    }
  }
  // Exactly the mound's height (pieces under the ground are hidden by it), and no wider than the
  // footprint and a little spill.
  let top = 0;
  let spillX = 0;
  let spillZ = 0;
  for (let i = 0; i < positions.length; i += 3) {
    top = Math.max(top, positions[i + 1]);
    spillX = Math.max(spillX, Math.abs(positions[i]));
    spillZ = Math.max(spillZ, Math.abs(positions[i + 2]));
  }
  const sy = top > 0 ? height / top : 1;
  const sx = spillX > (w / 2) * 1.08 ? ((w / 2) * 1.08) / spillX : 1;
  const sz = spillZ > (d / 2) * 1.08 ? ((d / 2) * 1.08) / spillZ : 1;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= sx;
    positions[i + 1] *= sy;
    positions[i + 2] *= sz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  g.computeVertexNormals();
  return g;
}

/**
 * One geometry from several atlas parts (unindexed: position, texture coordinates, color with
 * the wall mask in its alpha), so a mound and the art's rubble under it are one draw call.
 */
export function mergeAtlasParts(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  for (const source of parts) {
    const g = source.index ? source.toNonIndexed() : source;
    const position = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const color = g.getAttribute('color');
    for (let v = 0; v < position.count; v++) {
      positions.push(position.getX(v), position.getY(v), position.getZ(v));
      uvs.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0);
      if (color) colors.push(color.getX(v), color.getY(v), color.getZ(v), color.itemSize >= 4 ? color.getW(v) : 0);
      else colors.push(1, 1, 1, 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  out.computeVertexNormals();
  return out;
}

/**
 * The triangles of `source` that lie within `radius` of the vertical axis through (ax, az), cut
 * off at height `cut` (what is above it is dropped, edges crossing it end on it; texture
 * coordinates and colors follow). The radio mast's lattice without its top: what falls over.
 */
export function latticeBelow(source: THREE.BufferGeometry, ax: number, az: number, radius: number, cut: number): THREE.BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source;
  const position = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const color = g.getAttribute('color');
  const colorSize = color ? color.itemSize : 0;
  const out = { position: [] as number[], uv: [] as number[], color: [] as number[] };
  // One vertex as a flat record: x y z u v r g b a.
  const vertex = (i: number): number[] => [
    position.getX(i),
    position.getY(i),
    position.getZ(i),
    uv ? uv.getX(i) : 0,
    uv ? uv.getY(i) : 0,
    color ? color.getX(i) : 1,
    color ? color.getY(i) : 1,
    color ? color.getZ(i) : 1,
    color && colorSize >= 4 ? color.getW(i) : 1,
  ];
  const emit = (v: number[]): void => {
    out.position.push(v[0], v[1], v[2]);
    out.uv.push(v[3], v[4]);
    out.color.push(v[5], v[6], v[7], v[8]);
  };
  const lerp = (a: number[], b: number[]): number[] => {
    const t = (cut - a[1]) / (b[1] - a[1]);
    return a.map((x, k) => x + (b[k] - x) * t);
  };
  for (let i = 0; i + 2 < position.count; i += 3) {
    const tri = [vertex(i), vertex(i + 1), vertex(i + 2)];
    if (tri.some((v) => Math.hypot(v[0] - ax, v[2] - az) > radius)) continue;
    // Clip the triangle to y <= cut (Sutherland-Hodgman against one plane), then fan it.
    const poly: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const aIn = a[1] <= cut;
      const bIn = b[1] <= cut;
      if (aIn) poly.push(a);
      if (aIn !== bIn) poly.push(lerp(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      emit(poly[0]);
      emit(poly[k]);
      emit(poly[k + 1]);
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  result.setAttribute('color', new THREE.Float32BufferAttribute(out.color, 4));
  result.computeVertexNormals();
  return result;
}

function fromModel(model: RigModel, def: ArchetypeDef): ArchetypeGeometry | null {
  const find = (name: string): number => model.nodes.findIndex((n) => n.name === name);
  const intactIndex = find('intact');
  if (intactIndex < 0) return null;
  const intact = partsOfNode(model, intactIndex);
  if (intact.length === 0) return null;
  const damagedIndex = find('damaged');
  const rubbleIndex = find('rubble');
  const damaged = damagedIndex >= 0 ? partsOfNode(model, damagedIndex) : intact;
  const fallback = proceduralStates(def);
  const rubble = rubbleIndex >= 0 ? partsOfNode(model, rubbleIndex) : fallback.base;

  // Collapse pieces: the art's own meshes, kept centered on their own middle.
  const chunks: ChunkBox[] = [];
  model.nodes.forEach((node, i) => {
    if (!/^chunk_\d+$/.test(node.name)) return;
    const parts = partsOfNode(model, i);
    const bounds = new THREE.Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
    }
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const atlasParts = parts.filter((p) => p.material === 'city_atlas');
    const mesh = atlasParts.length > 0 ? chunkMesh(atlasParts.map((p) => p.geometry), center) : undefined;
    chunks.push({ x: center.x, y: center.y, z: center.z, w: size.x, h: size.y, d: size.z, mesh });
  });

  // The mound: the building's own pieces piled half its height, on the art's low rubble (a
  // bridge deck keeps the art's rubble alone).
  const pile = moundGeometry(chunks, def, moundHeight(def));
  const atlasRubble = rubble.filter((p) => p.material === 'city_atlas');
  const mound: StatePart[] = pile
    ? [{ geometry: mergeAtlasParts([pile, ...atlasRubble.map((p) => p.geometry)]), material: 'city_atlas' }, ...rubble.filter((p) => p.material !== 'city_atlas')]
    : rubble;

  // A radio mast: only its lattice falls (the pad and the hut stay with the stump), and without
  // the top section, which tumbles on its own and lands as a city weapon (docs/ASSETS.md section 3).
  const topIndex = find('top');
  let top: ArchetypeGeometry['top'] = null;
  let fall: StatePart[] = damaged.length > 0 ? damaged : intact;
  if (topIndex >= 0 && model.nodes[topIndex].parts.length > 0) {
    const node = model.nodes[topIndex];
    const at = new THREE.Vector3();
    for (let i = topIndex; i >= 0; i = model.nodes[i].parent) at.add(model.nodes[i].position);
    let reach = 0;
    for (const part of node.parts) {
      const p = part.geometry.getAttribute('position');
      for (let v = 0; v < p.count; v++) reach = Math.max(reach, Math.hypot(p.getX(v), p.getZ(v)));
    }
    top = { parts: node.parts.map((p) => ({ geometry: p.geometry, material: p.material })), at };
    const radius = Math.max(1.2, reach * 2.5);
    fall = intact.map((p) => ({ geometry: latticeBelow(p.geometry, at.x, at.z, radius, at.y), material: p.material }));
  }
  return {
    states: [intact, damaged.length > 0 ? damaged : intact, mound],
    chunks: chunks.length > 0 ? chunks : fallback.chunks,
    procedural: false,
    fall,
    base: rubble,
    top,
  };
}

/** Geometry for an archetype: from its art file when `model` is given and usable, else boxes. */
export function archetypeGeometry(def: ArchetypeDef, model: RigModel | null): ArchetypeGeometry {
  if (model) {
    const real = fromModel(model, def);
    if (real) return real;
    console.warn(`render: model for archetype "${def.id}" has no "intact" node; drawing boxes.`);
  }
  return proceduralStates(def);
}
