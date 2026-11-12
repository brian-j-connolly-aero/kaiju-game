/**
 * Draws the city: every structure as an instance of its archetype's mesh for its current
 * visual state, every prop as an instance of its kind, and the collapse of a structure as a
 * shower of tumbling chunks (ARCHITECTURE.md section 5). Draw calls stay flat no matter how
 * many buildings stand: one instanced mesh per archetype, state and material.
 */

import * as THREE from 'three';
import {
  archetypeDef,
  archetypeModelId,
  ARCHETYPES,
  hash32,
  PROP_KIND_IDS,
  PROP_KINDS,
  type ArchetypeDef,
  type CityData,
  type PropKindId,
  type Structure,
  type StructureClass,
} from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import type { CityMirror } from '../net/cityMirror';
import { propAlive, propWrecked } from '../net/cityMirror';
import type { LandmarkModel } from './landmarkPictures';
import { INSTANCE_SHADE, type Materials } from './materials';
import { archetypeGeometry, type ArchetypeGeometry, type ChunkBox } from './structureGeometry';

/** How dark a structure is drawn at a damage stage (the damaged model is darkened further as it nears collapse). */
export function shadeOf(stage: number): number {
  return stage === 1 ? 0.86 : stage === 2 ? 0.6 : 1;
}

/** Even-odd test of a point against a simple polygon. */
export function insidePolygon(x: number, z: number, polygon: readonly { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** A building model's tint entry from the manifest (docs/art/client-notes-city.md section 2). */
export interface ModelTint {
  /** The wall color the model was painted in. */
  base: string;
  /** Wall colors a copy may take. */
  colors: string[];
}

/**
 * The paint of structure `id`'s walls: `tone` is the color the walls show (one of the model's
 * colors, picked by the id, times the district's building tint), `paint` is the instance color
 * that turns the model's base wall color into it (tone / base per channel; above 1 is fine).
 * Without a tint entry the walls keep the model's own color, still times the district tint.
 */
export function wallPaint(tint: ModelTint | null, id: number, district: number): { tone: THREE.Color; paint: THREE.Color } {
  const d = new THREE.Color(district);
  if (!tint || tint.colors.length === 0) return { tone: new THREE.Color(0xffffff).multiply(d), paint: d.clone() };
  const base = new THREE.Color(tint.base);
  const tone = new THREE.Color(tint.colors[hash32(id, 91) % tint.colors.length]).multiply(d);
  const paint = new THREE.Color(tone.r / Math.max(base.r, 0.02), tone.g / Math.max(base.g, 0.02), tone.b / Math.max(base.b, 0.02));
  return { tone, paint };
}

/** Visual state index for a structure stage: 0 intact, 1 damaged (stages 1 and 2), 2 rubble. */
function stateOf(stage: number): number {
  return stage <= 0 ? 0 : stage >= 3 ? 2 : 1;
}

// A dozen saturated-but-light plaster tones (ASSETS.md section 2), grouped by what suits a class.
const TONES = {
  cream: 0xf3e3b3,
  salmon: 0xf2a48b,
  sky: 0xa8d4f0,
  mint: 0xa9e5c5,
  mustard: 0xe3c04f,
  brick: 0xc96a4a,
  slate: 0x8fa0b5,
  white: 0xf5f5f0,
  teal: 0x6fc7c2,
  lilac: 0xc9b5e8,
  peach: 0xf6c9a0,
  lime: 0xcfe8a0,
};
const CLASS_TONES: Record<StructureClass, number[]> = {
  house: [TONES.cream, TONES.salmon, TONES.mint, TONES.white, TONES.peach, TONES.lime, TONES.sky],
  shop: [TONES.mustard, TONES.salmon, TONES.sky, TONES.cream, TONES.lilac, TONES.mint],
  apartment: [TONES.cream, TONES.salmon, TONES.peach, TONES.sky, TONES.lilac, TONES.white],
  office: [TONES.slate, TONES.sky, TONES.white, TONES.teal, TONES.cream],
  tower: [TONES.teal, TONES.slate, TONES.sky, TONES.white],
  factory: [TONES.brick, TONES.slate, TONES.mustard, TONES.cream],
  bridge: [TONES.white],
  landmark: [TONES.white, TONES.cream],
};

/**
 * How a batch's instance color is used. `tint`: the city atlas with a wall mask; the instance
 * color is the wall paint and `instanceShade` darkens every face (a real model). `tone`: a box
 * stand-in, the instance color is tone times shade. `shade`: any other part, grey by shade.
 */
type PaintMode = 'tint' | 'tone' | 'shade';

interface StateMesh {
  mesh: THREE.InstancedMesh;
  mode: PaintMode;
  /** `tint` meshes: one shade per instance. */
  shade: THREE.InstancedBufferAttribute | null;
}

interface StateBatch {
  meshes: StateMesh[];
  /** Structure id of every instance. */
  ids: number[];
}

interface ArchetypeBatch {
  def: ArchetypeDef;
  geometry: ArchetypeGeometry;
  states: [StateBatch, StateBatch, StateBatch];
}

interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  w: number;
  h: number;
  d: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  r: number;
  g: number;
  b: number;
  /** The art's piece, drawn with the atlas; absent for a box stand-in's chunk. */
  piece: ChunkBox['mesh'];
  /** The art piece's own size (its bounds), which `w`, `h`, `d` stretch. */
  bw: number;
  bh: number;
  bd: number;
  /** The building's wall paint, for the piece's masked faces. */
  pr: number;
  pg: number;
  pb: number;
  age: number;
  /** Seconds after landing before it has sunk away. */
  rest: number;
  landed: boolean;
}

const MAX_CHUNKS = 480;
/** Triangles the falling art pieces may use together (the art keeps a piece to 30 or fewer). */
const MAX_PIECE_TRIANGLES = MAX_CHUNKS * 30;
/** Side of a prop grid cell, meters. */
const PROP_CELL = 110;
const GRAVITY = 26;

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export interface CollapseInfo {
  x: number;
  z: number;
  /** Rough radius and height of what fell, for dust and sound. */
  radius: number;
  height: number;
}

export class CityView {
  readonly group = new THREE.Group();
  private readonly city: CityData;
  private readonly batches = new Map<string, ArchetypeBatch>();
  /** Per structure: its batch, the state it is drawn in, its instance index there, and its tone. */
  private readonly slotBatch: ArchetypeBatch[] = [];
  private readonly slotState: Int8Array;
  private readonly slotIndex: Int32Array;
  private readonly stage: Uint8Array;
  /** Per structure: the color its walls show (the map and the chunks use it). */
  private readonly tone: THREE.Color[] = [];
  /** Per structure: the instance color of a real model's masked walls (paint / the model's base). */
  private readonly paint: THREE.Color[] = [];

  private readonly propMeshes = new Map<PropKindId, THREE.InstancedMesh[]>();
  private readonly propMatrix: THREE.Matrix4[] = [];
  private readonly propColor: THREE.Color[] = [];
  /** Per prop: 1 while it stands (drawn as itself). */
  private readonly propShown: Uint8Array;
  /** Per prop: 1 while its wreck lies there. */
  private readonly wreckShown: Uint8Array;
  private readonly wreckMeshes: THREE.InstancedMesh[] = [];

  private readonly chunkMesh: THREE.InstancedMesh;
  /** All falling art pieces in one buffer, rebuilt every frame: one draw call. */
  private readonly pieceMesh: THREE.Mesh;
  private readonly pieceGeometry: THREE.BufferGeometry;
  private readonly chunks: Chunk[] = [];
  private random = 12345;

  constructor(city: CityData, assets: AssetStore, materials: Materials) {
    this.city = city;
    this.slotState = new Int8Array(city.structures.length).fill(-1);
    this.slotIndex = new Int32Array(city.structures.length).fill(-1);
    this.stage = new Uint8Array(city.structures.length);
    this.propShown = new Uint8Array(city.props.length);
    this.wreckShown = new Uint8Array(city.props.length);

    this.buildStructures(assets, materials);
    this.buildProps(assets, materials);

    const chunkGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.chunkMesh = new THREE.InstancedMesh(chunkGeometry, new THREE.MeshLambertMaterial({ flatShading: true }), MAX_CHUNKS);
    this.chunkMesh.count = 0;
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.setColorAt(0, tmpColor.set(0xffffff));
    this.group.add(this.chunkMesh);

    const vertices = MAX_PIECE_TRIANGLES * 3;
    this.pieceGeometry = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['uv', 2], ['color', 4]] as const) {
      const attribute = new THREE.BufferAttribute(new Float32Array(vertices * size), size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      this.pieceGeometry.setAttribute(name, attribute);
    }
    this.pieceGeometry.setDrawRange(0, 0);
    this.pieceMesh = new THREE.Mesh(this.pieceGeometry, materials.cityAtlas);
    this.pieceMesh.frustumCulled = false;
    this.pieceMesh.visible = false;
    this.group.add(this.pieceMesh);
  }

  // --- structures ------------------------------------------------------------------------------

  private buildStructures(assets: AssetStore, materials: Materials): void {
    const counts = new Map<string, number>();
    for (const s of this.city.structures) counts.set(s.archetype, (counts.get(s.archetype) ?? 0) + 1);
    const known = new Set(ARCHETYPES.map((a) => a.id));
    for (const [id, count] of counts) {
      if (!known.has(id)) {
        console.warn(`render: structure archetype "${id}" is not defined; its ${count} structures are not drawn.`);
        continue;
      }
      const def = archetypeDef(id);
      const modelId = archetypeModelId(def);
      const geometry = archetypeGeometry(def, assets.hasModel(modelId) ? assets.model(modelId) : null);
      const states = geometry.states.map((parts) => {
        const meshes = parts.map((part): StateMesh => {
          const mode: PaintMode = part.material === 'building' ? 'tone' : part.material === 'city_atlas' ? 'tint' : 'shade';
          const material = part.material === 'building' ? materials.building : mode === 'tint' ? materials.cityTint : materials.byKind(part.material);
          // Each batch owns its geometry: a state may reuse another's (no damaged node), and the
          // per-instance shade lives on the geometry.
          const mesh = new THREE.InstancedMesh(mode === 'tint' ? part.geometry.clone() : part.geometry, material, count);
          mesh.count = 0;
          mesh.visible = false;
          mesh.frustumCulled = false;
          // Allocate the color buffer up front so every instance always has a color.
          mesh.setColorAt(0, tmpColor.set(0xffffff));
          let shade: THREE.InstancedBufferAttribute | null = null;
          if (mode === 'tint') {
            shade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
            mesh.geometry.setAttribute(INSTANCE_SHADE, shade);
          }
          this.group.add(mesh);
          return { mesh, mode, shade };
        });
        return { meshes, ids: [] } as StateBatch;
      }) as [StateBatch, StateBatch, StateBatch];
      this.batches.set(id, { def, geometry, states });
    }
    const districtTint = (x: number, z: number): number => {
      for (const d of this.city.districts) if (d.tint !== undefined && insidePolygon(x, z, d.polygon)) return d.tint;
      return 0xffffff;
    };
    for (const s of this.city.structures) {
      const batch = this.batches.get(s.archetype);
      if (!batch) continue;
      this.slotBatch[s.id] = batch;
      if (batch.geometry.procedural) {
        const tones = CLASS_TONES[s.cls] ?? CLASS_TONES.house;
        this.tone[s.id] = new THREE.Color(tones[hash32(s.id, 77) % tones.length]);
        this.paint[s.id] = this.tone[s.id];
      } else {
        // Landmarks are one-offs, modeled in their final colors (docs/CITY.md section 2).
        const tint = s.landmark === null ? assets.modelTint(archetypeModelId(batch.def)) : null;
        const { tone, paint } = wallPaint(tint, s.id, s.landmark === null ? districtTint(s.x, s.z) : 0xffffff);
        this.tone[s.id] = tone;
        this.paint[s.id] = paint;
      }
      this.place(s, 0);
    }
    this.flush();
  }

  private matrixFor(s: Structure, def: ArchetypeDef): THREE.Matrix4 {
    tmpQuat.setFromAxisAngle(Y_AXIS, s.yaw);
    // A structure normally has exactly its archetype's size; scale covers a generator that varies it.
    tmpScale.set((s.hx * 2) / def.footprint[0], s.height / def.height, (s.hz * 2) / def.footprint[1]);
    return tmpMatrix.compose(tmpPos.set(s.x, 0, s.z), tmpQuat, tmpScale);
  }

  /** Writes structure `id`'s color for `stage` into instance `index` of a state mesh. */
  private paintInstance(m: StateMesh, index: number, id: number, stage: number): void {
    const shade = shadeOf(stage);
    if (m.mode === 'tint') {
      m.mesh.setColorAt(index, this.paint[id]);
      if (m.shade) {
        m.shade.setX(index, shade);
        m.shade.needsUpdate = true;
      }
    } else if (m.mode === 'tone') {
      const tone = stage >= 3 ? tmpColor.set(0xffffff) : tmpColor.copy(this.tone[id]);
      m.mesh.setColorAt(index, tone.multiplyScalar(shade));
    } else {
      m.mesh.setColorAt(index, tmpColor.setScalar(shade));
    }
  }

  /** Adds structure `s` to the batch of the state for `stage`. */
  private place(s: Structure, stage: number): void {
    const batch = this.slotBatch[s.id];
    const state = stateOf(stage);
    const target = batch.states[state];
    const index = target.ids.length;
    target.ids.push(s.id);
    const matrix = this.matrixFor(s, batch.def);
    for (const m of target.meshes) {
      m.mesh.setMatrixAt(index, matrix);
      this.paintInstance(m, index, s.id, stage);
      this.dirty.add(m.mesh);
    }
    this.slotState[s.id] = state;
    this.slotIndex[s.id] = index;
    this.stage[s.id] = stage;
  }

  /** Removes structure `id` from the state batch it is in (the last instance fills the hole). */
  private remove(id: number): void {
    const batch = this.slotBatch[id];
    const state = this.slotState[id];
    if (!batch || state < 0) return;
    const from = batch.states[state];
    const index = this.slotIndex[id];
    const last = from.ids.length - 1;
    if (index !== last) {
      const moved = from.ids[last];
      for (const { mesh, shade } of from.meshes) {
        mesh.getMatrixAt(last, tmpMatrix);
        mesh.setMatrixAt(index, tmpMatrix);
        if (mesh.instanceColor) {
          mesh.getColorAt(last, tmpColor);
          mesh.setColorAt(index, tmpColor);
        }
        if (shade) {
          shade.setX(index, shade.getX(last));
          shade.needsUpdate = true;
        }
      }
      from.ids[index] = moved;
      this.slotIndex[moved] = index;
    }
    from.ids.pop();
    for (const m of from.meshes) this.dirty.add(m.mesh);
    this.slotState[id] = -1;
    this.slotIndex[id] = -1;
  }

  private readonly dirty = new Set<THREE.InstancedMesh>();

  /** Uploads what changed. Call once after a batch of setStage calls. */
  flush(): void {
    for (const batch of this.batches.values()) {
      for (const state of batch.states) {
        for (const { mesh } of state.meshes) {
          if (!this.dirty.has(mesh)) continue;
          mesh.count = state.ids.length;
          mesh.visible = state.ids.length > 0;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    this.dirty.clear();
  }

  /**
   * Shows a structure at a visual stage. With `effects`, a change to rubble sheds chunks and
   * the returned info says where and how big, for dust and sound.
   */
  setStage(id: number, stage: number, effects: boolean): CollapseInfo | null {
    const s = this.city.structures[id];
    const batch = this.slotBatch[id];
    if (!s || !batch) return null;
    const before = this.stage[id];
    if (before === stage) return null;
    if (stateOf(before) === stateOf(stage)) {
      // Same mesh, deeper damage: only the shade changes.
      const index = this.slotIndex[id];
      for (const m of batch.states[this.slotState[id]].meshes) {
        this.paintInstance(m, index, id, stage);
        this.dirty.add(m.mesh);
      }
      this.stage[id] = stage;
    } else {
      this.remove(id);
      this.place(s, stage);
    }
    if (!effects || stage <= before) return null;
    const info: CollapseInfo = { x: s.x, z: s.z, radius: Math.max(s.hx, s.hz), height: s.height };
    if (stage >= 3) this.shed(s, batch, 1);
    else this.shed(s, batch, stage === 2 ? 0.3 : 0.15);
    return info;
  }

  /** Redraws every structure and prop from the mirrored city (match start, reconnection). */
  syncFrom(mirror: CityMirror): void {
    for (const s of this.city.structures) this.setStage(s.id, mirror.structureStage[s.id], false);
    this.flush();
    for (const p of this.city.props) {
      this.setPropAlive(p.id, propAlive(mirror, p.id));
      this.setWreck(p.id, propWrecked(mirror, p.id));
    }
    this.flushProps();
    this.chunks.length = 0;
  }

  /** Puts the city back to pristine (the menu backdrop, a new match). */
  reset(): void {
    for (const s of this.city.structures) this.setStage(s.id, 0, false);
    this.flush();
    for (const p of this.city.props) {
      this.setPropAlive(p.id, true);
      this.setWreck(p.id, false);
    }
    this.flushProps();
    this.chunks.length = 0;
  }

  /** Every landmark drawn from its art file: its intact geometry (for the map's pictures). */
  landmarkModels(): LandmarkModel[] {
    const out: LandmarkModel[] = [];
    for (const batch of this.batches.values()) {
      if (batch.def.landmark === null || batch.geometry.procedural) continue;
      out.push({ id: batch.def.id, geometries: batch.geometry.states[0].map((p) => p.geometry) });
    }
    return out;
  }

  /** The color a structure's walls show (for chunks, the map). */
  toneOf(id: number): THREE.Color {
    return this.tone[id] ?? tmpColor.set(0xffffff);
  }

  // --- collapse chunks -------------------------------------------------------------------------

  private rand(): number {
    this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0;
    return this.random / 4294967296;
  }

  private shed(s: Structure, batch: ArchetypeBatch, fraction: number): void {
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    const tone = this.tone[s.id] ?? tmpColor.set(0xffffff);
    const paint = this.paint[s.id] ?? tone;
    const boxes = batch.geometry.chunks;
    const sx = (s.hx * 2) / batch.def.footprint[0];
    const sy = s.height / batch.def.height;
    const sz = (s.hz * 2) / batch.def.footprint[1];
    for (const c of boxes) {
      if (fraction < 1 && this.rand() > fraction) continue;
      this.addChunk(s, c, sx, sy, sz, cos, sin, tone, paint, fraction < 1);
    }
  }

  private addChunk(s: Structure, c: ChunkBox, sx: number, sy: number, sz: number, cos: number, sin: number, tone: THREE.Color, paint: THREE.Color, small: boolean): void {
    if (this.chunks.length >= MAX_CHUNKS) this.chunks.shift();
    const lx = c.x * sx;
    const lz = c.z * sz;
    // An art piece is drawn at its own size (a shed piece smaller); a box a little inside its bounds.
    const shrink = small ? 0.35 : c.mesh ? 1 : 0.92;
    const out = 2 + this.rand() * 4 + (small ? 4 : 0);
    const len = Math.hypot(lx, lz) || 1;
    const dirX = (lx / len) * cos + (lz / len) * sin;
    const dirZ = -(lx / len) * sin + (lz / len) * cos;
    const grey = 0.75 + this.rand() * 0.25;
    this.chunks.push({
      x: s.x + lx * cos + lz * sin,
      y: c.y * sy,
      z: s.z - lx * sin + lz * cos,
      vx: dirX * out,
      vy: small ? 3 + this.rand() * 5 : -this.rand() * 2,
      vz: dirZ * out,
      w: c.w * sx * shrink,
      h: c.h * sy * shrink,
      d: c.d * sz * shrink,
      rx: 0,
      ry: s.yaw,
      rz: 0,
      wx: (this.rand() - 0.5) * 2.2,
      wy: (this.rand() - 0.5) * 1.2,
      wz: (this.rand() - 0.5) * 2.2,
      r: (c.mesh ? 1 : tone.r) * grey,
      g: (c.mesh ? 1 : tone.g) * grey,
      b: (c.mesh ? 1 : tone.b) * grey,
      piece: c.mesh,
      bw: c.w || 1,
      bh: c.h || 1,
      bd: c.d || 1,
      pr: paint.r,
      pg: paint.g,
      pb: paint.b,
      age: -this.rand() * 0.25 * (c.y * sy > 20 ? 1 : 0.3),
      rest: 1.2 + this.rand() * 0.8,
      landed: false,
    });
  }

  /** Advances the falling chunks. Returns how many are still in the air or settling. */
  update(dt: number): number {
    const chunks = this.chunks;
    let n = 0;
    let vertices = 0;
    const capacity = MAX_PIECE_TRIANGLES * 3;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      c.age += dt;
      if (c.age < 0) {
        // Upper floors wait a beat before they follow the lower ones down.
      } else if (!c.landed) {
        c.vy -= GRAVITY * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.rx += c.wx * dt;
        c.ry += c.wy * dt;
        c.rz += c.wz * dt;
        const floor = Math.min(c.w, c.h, c.d) * 0.3;
        if (c.y <= floor) {
          c.y = floor;
          c.landed = true;
          c.age = 0;
        }
      } else {
        // Landed: sink into the rubble heap and vanish.
        c.y -= dt * (Math.min(c.w, c.h, c.d) * 0.6) * (c.age / c.rest);
        if (c.age > c.rest) {
          chunks[i] = chunks[chunks.length - 1];
          chunks.pop();
          i--;
          continue;
        }
      }
      tmpQuat.setFromEuler(tmpEuler.set(c.rx, c.ry, c.rz));
      if (c.piece) {
        if (vertices + c.piece.position.length / 3 > capacity) continue;
        // The piece's own size is in its vertices: scale only by the structure's stretch.
        tmpMatrix.compose(tmpPos.set(c.x, c.y, c.z), tmpQuat, tmpScale.set(c.w / c.bw, c.h / c.bh, c.d / c.bd));
        vertices = this.writePiece(c, tmpMatrix, vertices);
        continue;
      }
      tmpMatrix.compose(tmpPos.set(c.x, c.y, c.z), tmpQuat, tmpScale.set(c.w, c.h, c.d));
      this.chunkMesh.setMatrixAt(n, tmpMatrix);
      this.chunkMesh.setColorAt(n, tmpColor.setRGB(c.r, c.g, c.b));
      n++;
    }
    this.chunkMesh.count = n;
    this.chunkMesh.visible = n > 0;
    if (n > 0) {
      this.chunkMesh.instanceMatrix.needsUpdate = true;
      if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
    }
    this.pieceGeometry.setDrawRange(0, vertices);
    this.pieceMesh.visible = vertices > 0;
    if (vertices > 0) {
      for (const name of ['position', 'uv', 'color']) {
        const attribute = this.pieceGeometry.getAttribute(name) as THREE.BufferAttribute;
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, vertices * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    return chunks.length;
  }

  /** Copies a falling art piece, moved by `matrix`, into the shared buffer at `start`; returns the new end. */
  private writePiece(c: Chunk, matrix: THREE.Matrix4, start: number): number {
    const piece = c.piece;
    if (!piece) return start;
    const position = this.pieceGeometry.getAttribute('position').array as Float32Array;
    const uv = this.pieceGeometry.getAttribute('uv').array as Float32Array;
    const color = this.pieceGeometry.getAttribute('color').array as Float32Array;
    const e = matrix.elements;
    const count = piece.position.length / 3;
    for (let v = 0; v < count; v++) {
      const x = piece.position[v * 3];
      const y = piece.position[v * 3 + 1];
      const z = piece.position[v * 3 + 2];
      const o = (start + v) * 3;
      position[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      position[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      position[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      uv[(start + v) * 2] = piece.uv[v * 2];
      uv[(start + v) * 2 + 1] = piece.uv[v * 2 + 1];
      // The masked faces take the building's paint, as on the standing building.
      const a = piece.color[v * 4 + 3];
      const q = (start + v) * 4;
      color[q] = piece.color[v * 4] * (1 + (c.pr - 1) * a) * c.r;
      color[q + 1] = piece.color[v * 4 + 1] * (1 + (c.pg - 1) * a) * c.g;
      color[q + 2] = piece.color[v * 4 + 2] * (1 + (c.pb - 1) * a) * c.b;
      color[q + 3] = 1;
    }
    return start + count;
  }

  // --- props -----------------------------------------------------------------------------------

  /**
   * Props are small: past a few hundred meters they are a pixel or two, yet together they are
   * most of the city's triangles. So only the props in grid cells near the camera are in the
   * instance buffers; the buffers are repacked when the camera changes cell or a prop changes.
   */
  private buildProps(assets: AssetStore, materials: Materials): void {
    const counts = new Map<PropKindId, number>();
    let wrecks = 0;
    for (const p of this.city.props) {
      counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
      if (PROP_KINDS[p.kind]?.leavesWreck) wrecks++;
    }
    const tints = new Map<PropKindId, THREE.Color[]>();
    for (const kind of PROP_KIND_IDS) {
      const count = counts.get(kind) ?? 0;
      if (count === 0) continue;
      const modelId = `prop_${kind}`;
      const model = assets.model(modelId);
      const palette = assets.modelTints(modelId).map((c) => new THREE.Color(c));
      if (palette.length === 0 && model.procedural && PROP_KINDS[kind].tally === 'car' && kind !== 'car_taxi' && kind !== 'truck') {
        for (const c of [0xe0372f, 0x2f62c9, 0xf5f5f0, 0x3fa652, 0x8f6fd0, 0xf29b85, 0x2a9d8f, 0xaab2bc]) palette.push(new THREE.Color(c));
      }
      tints.set(kind, palette);
      const meshes: THREE.InstancedMesh[] = [];
      for (const node of model.nodes) {
        for (const part of node.parts) {
          const material = part.material === 'vcol' ? materials.paint : materials.byKind(part.material);
          const mesh = new THREE.InstancedMesh(part.geometry, material, count);
          mesh.frustumCulled = false;
          mesh.count = 0;
          mesh.setColorAt(0, tmpColor.set(0xffffff));
          this.group.add(mesh);
          meshes.push(mesh);
        }
      }
      this.propMeshes.set(kind, meshes);
    }
    const wreckModel = assets.model('prop_car_wreck');
    for (const node of wreckModel.nodes) {
      for (const part of node.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, materials.byKind(part.material), Math.max(1, wrecks));
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.group.add(mesh);
        this.wreckMeshes.push(mesh);
      }
    }
    const white = new THREE.Color(0xffffff);
    const cols = Math.ceil((this.city.half * 2) / PROP_CELL);
    this.propCols = cols;
    this.propCells = Array.from({ length: cols * cols }, () => [] as number[]);
    for (const p of this.city.props) {
      this.propMatrix[p.id] = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, p.yaw), new THREE.Vector3(1, 1, 1));
      const palette = tints.get(p.kind) ?? [];
      this.propColor[p.id] = palette.length > 0 ? palette[hash32(p.id, 5) % palette.length] : white;
      this.propShown[p.id] = 1;
      const cx = Math.min(cols - 1, Math.max(0, Math.floor((p.x + this.city.half) / PROP_CELL)));
      const cz = Math.min(cols - 1, Math.max(0, Math.floor((p.z + this.city.half) / PROP_CELL)));
      this.propCells[cz * cols + cx].push(p.id);
    }
    this.propsDirty = true;
  }

  setPropAlive(id: number, alive: boolean): void {
    if (id < 0 || id >= this.propShown.length) return;
    const value = alive ? 1 : 0;
    if (this.propShown[id] !== value) {
      this.propShown[id] = value;
      this.propsDirty = true;
    }
  }

  setWreck(id: number, present: boolean): void {
    if (id < 0 || id >= this.wreckShown.length) return;
    const value = present ? 1 : 0;
    if (this.wreckShown[id] !== value) {
      this.wreckShown[id] = value;
      this.propsDirty = true;
    }
  }

  private propsDirty = false;
  private propCols = 0;
  private propCells: number[][] = [];
  private propViewKey = '';

  /** Kept for callers that batch prop changes; the repack happens in `updateProps`. */
  flushProps(): void {
    // Nothing to do here: changes are picked up by the next updateProps.
  }

  /**
   * Repacks the prop instances around the camera when needed. `radius` is how far props are
   * drawn; the caller grows it with the camera's height.
   */
  updateProps(cameraX: number, cameraZ: number, radius: number): number {
    const cols = this.propCols;
    if (cols === 0) return 0;
    const half = this.city.half;
    const cx = Math.floor((cameraX + half) / PROP_CELL);
    const cz = Math.floor((cameraZ + half) / PROP_CELL);
    const reach = Math.ceil(radius / PROP_CELL);
    const key = `${cx},${cz},${reach}`;
    if (key === this.propViewKey && !this.propsDirty) return this.propsDrawn;
    this.propViewKey = key;
    this.propsDirty = false;

    const fill = new Map<THREE.InstancedMesh[], number>();
    for (const meshes of this.propMeshes.values()) fill.set(meshes, 0);
    let wreckCount = 0;
    let drawn = 0;
    const props = this.city.props;
    for (let z = Math.max(0, cz - reach); z <= Math.min(cols - 1, cz + reach); z++) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(cols - 1, cx + reach); x++) {
        // Skip the corners of the square so the drawn area is roughly round.
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz > (reach + 0.5) * (reach + 0.5)) continue;
        for (const id of this.propCells[z * cols + x]) {
          if (this.propShown[id] === 1) {
            const meshes = this.propMeshes.get(props[id].kind);
            if (!meshes) continue;
            const index = fill.get(meshes) ?? 0;
            for (const mesh of meshes) {
              mesh.setMatrixAt(index, this.propMatrix[id]);
              mesh.setColorAt(index, this.propColor[id]);
            }
            fill.set(meshes, index + 1);
            drawn++;
          } else if (this.wreckShown[id] === 1) {
            for (const mesh of this.wreckMeshes) mesh.setMatrixAt(wreckCount, this.propMatrix[id]);
            wreckCount++;
            drawn++;
          }
        }
      }
    }
    for (const [meshes, count] of fill) {
      for (const mesh of meshes) {
        mesh.count = count;
        mesh.visible = count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const mesh of this.wreckMeshes) {
      mesh.count = wreckCount;
      mesh.visible = wreckCount > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.propsDrawn = drawn;
    return drawn;
  }

  private propsDrawn = 0;
}
