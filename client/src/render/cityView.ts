/**
 * Draws the city: every structure as an instance of its archetype's mesh for its current
 * visual state, every prop as an instance of its kind, and the collapse of a structure as a
 * shower of tumbling chunks (ARCHITECTURE.md section 5). Draw calls stay flat no matter how
 * many buildings stand: one instanced mesh per archetype, state and material.
 *
 * Phase 2 (docs/ROADMAP.md, "rubble stays", "monster weight"):
 * - the rubble state is a mound half the building's height, piled from its own pieces
 *   (structureGeometry.ts `moundGeometry`), the shape the simulation's shots and sight meet;
 * - a building that falls over (the `structureFall` event, or the city state of a late joiner)
 *   tips over the edge of its footprint for two seconds and then lies on its side where the
 *   simulation's `fallenBox` is, half sunk into the ground, with the art's low rubble left on its
 *   footprint; these batches are made the first time an archetype falls;
 * - a radio mast's lattice falls without its top section, which tumbles on its own and is then
 *   the loose `mast` city weapon;
 * - standing buildings sway when the monster stomps near them (`wobble`), props hop at its
 *   footsteps (`hop`), and city weapons lying loose (dropped, or a mast's top) are drawn with the
 *   props (`setLoose`).
 */

import * as THREE from 'three';
import {
  archetypeDef,
  archetypeModelId,
  ARCHETYPES,
  CITY_WEAPON_KINDS,
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
import { archetypeGeometry, type ArchetypeGeometry, type ChunkBox, type StatePart } from './structureGeometry';

/**
 * How dark a structure is drawn at a damage stage (the damaged model is darkened further as it
 * nears collapse). Rubble is a little dusty: its mound is the building's own walls (phase 2).
 */
export function shadeOf(stage: number): number {
  return stage === 1 ? 0.86 : stage === 2 ? 0.6 : stage >= 3 ? 0.8 : 1;
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

/** Visual state index for a structure stage: 0 intact, 1 damaged (stages 1 and 2), 2 rubble. 3 is fallen over (set apart from the stage). */
function stateOf(stage: number): number {
  return stage <= 0 ? 0 : stage >= 3 ? 2 : 1;
}
const FALLEN = 3;

/**
 * The world matrix of a structure that is falling (or lies fallen) toward the side whose outward
 * direction is (dirX, dirZ): turned `angle` radians (pi / 2 lying) about the edge of its footprint
 * on that side, whose middle is (pivotX, pivotZ), and lowered `sink` meters. `structure` is its
 * standing matrix. Exported for tests.
 */
export function fallMatrix(structure: THREE.Matrix4, pivotX: number, pivotZ: number, dirX: number, dirZ: number, angle: number, sink: number, out: THREE.Matrix4): THREE.Matrix4 {
  // Turning the up axis toward the fall: about the horizontal axis (dirZ, 0, -dirX).
  fallAxis.set(dirZ, 0, -dirX).normalize();
  fallTurn.makeRotationAxis(fallAxis, angle);
  out.makeTranslation(-pivotX, 0, -pivotZ).premultiply(fallTurn);
  out.premultiply(fallMove.makeTranslation(pivotX, -sink, pivotZ));
  return out.multiply(structure);
}
const fallAxis = new THREE.Vector3();
const fallTurn = new THREE.Matrix4();
const fallMove = new THREE.Matrix4();

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

/** Where a mesh of a state batch is drawn: on the structure (`body`), or lying where it fell (`lying`). */
type MeshRole = 'body' | 'lying';

interface StateMesh {
  mesh: THREE.InstancedMesh;
  mode: PaintMode;
  /** `tint` meshes: one shade per instance. */
  shade: THREE.InstancedBufferAttribute | null;
  role: MeshRole;
}

interface StateBatch {
  meshes: StateMesh[];
  /** Structure id of every instance. */
  ids: number[];
}

interface ArchetypeBatch {
  def: ArchetypeDef;
  geometry: ArchetypeGeometry;
  /** How many structures of this archetype the city has (every batch's capacity). */
  count: number;
  states: [StateBatch, StateBatch, StateBatch];
  /** Fallen over: what lies on its side and the low rubble on its footprint. Made at the first fall. */
  fallen: StateBatch | null;
  /** A radio mast's top section while it tumbles (made with `fallen` when the art has one). */
  tops: StateMesh[] | null;
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

/** A structure tipping over (or lying): which way, and how far through its fall it is. */
interface Fall {
  id: number;
  dirX: number;
  dirZ: number;
  pivotX: number;
  pivotZ: number;
  /** How far it sinks into the ground once it lies (meters): half its thickness, or a mast's lattice down to its legs. */
  sink: number;
  /** Seconds since it began to fall, and how long the fall takes. */
  t: number;
  duration: number;
  landed: boolean;
}

/** A standing building swaying after a stomp: a short damped sway about its base. */
interface Wobble {
  id: number;
  /** Seconds since it was pushed (negative: the shock has not reached it yet). */
  t: number;
  /** Largest lean, radians. */
  amp: number;
  /** Sways per second. */
  freq: number;
  /** The push's direction on the ground (unit). */
  dirX: number;
  dirZ: number;
}

/** A prop jolted by a footstep or a stomp: it hops (cars, small things) or sways (trees, poles). */
interface Hop {
  id: number;
  /** Its wreck hops, not the prop. */
  wreck: boolean;
  t: number;
  duration: number;
  /** Highest point of the hop (meters); 0 for a sway. */
  height: number;
  /** Largest tilt (radians) and its axis on the ground (unit). */
  tilt: number;
  axisX: number;
  axisZ: number;
  sway: boolean;
}

/** A city weapon lying loose (dropped from the hand, or a fallen mast's top): drawn with the props. */
export interface LooseShown {
  id: number;
  prop: PropKindId;
  x: number;
  z: number;
  yaw: number;
}

const MAX_CHUNKS = 480;
/** Triangles the falling art pieces may use together (the art keeps a piece to 30 or fewer). */
const MAX_PIECE_TRIANGLES = MAX_CHUNKS * 30;
/** Side of a prop grid cell, meters. */
const PROP_CELL = 110;
const GRAVITY = 26;
/** Room for loose city weapons in each city weapon kind's prop batch. */
const LOOSE_ROOM = 12;
/** Gravity of a hopping prop (stiffer than real: a hop must read in a few frames). */
const HOP_GRAVITY = 24;
/** Props hopping or swaying at once (the oldest stops first). */
const MAX_HOPS = 260;
/** Buildings swaying at once. */
const MAX_WOBBLES = 160;

const tmpMatrix = new THREE.Matrix4();
const tmpMatrix2 = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpQuat2 = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpColor = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

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
  private readonly materials: Materials;
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
  /** Structures falling or lying fallen, by id. */
  private readonly falls = new Map<number, Fall>();
  private readonly wobbles = new Map<number, Wobble>();

  private readonly propMeshes = new Map<PropKindId, THREE.InstancedMesh[]>();
  private readonly propMatrix: THREE.Matrix4[] = [];
  private readonly propColor: THREE.Color[] = [];
  /** Per prop: 1 while it stands (drawn as itself). */
  private readonly propShown: Uint8Array;
  /** Per prop: 1 while its wreck lies there. */
  private readonly wreckShown: Uint8Array;
  private readonly wreckMeshes: THREE.InstancedMesh[] = [];
  /** Per prop: its instance in its kind's (or the wrecks') buffers since the last repack, or -1. */
  private readonly propSlot: Int32Array;
  private readonly hops = new Map<number, Hop>();
  private readonly loose = new Map<number, LooseShown>();

  private readonly chunkMesh: THREE.InstancedMesh;
  /** All falling art pieces in one buffer, rebuilt every frame: one draw call. */
  private readonly pieceMesh: THREE.Mesh;
  private readonly pieceGeometry: THREE.BufferGeometry;
  private readonly chunks: Chunk[] = [];
  private random = 12345;

  constructor(city: CityData, assets: AssetStore, materials: Materials) {
    this.city = city;
    this.materials = materials;
    this.slotState = new Int8Array(city.structures.length).fill(-1);
    this.slotIndex = new Int32Array(city.structures.length).fill(-1);
    this.stage = new Uint8Array(city.structures.length);
    this.propShown = new Uint8Array(city.props.length);
    this.wreckShown = new Uint8Array(city.props.length);
    this.propSlot = new Int32Array(city.props.length).fill(-1);

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

  /** One instanced mesh of a state batch for `count` structures. */
  private stateMesh(part: StatePart, count: number, role: MeshRole): StateMesh {
    const materials = this.materials;
    const mode: PaintMode = part.material === 'building' ? 'tone' : part.material === 'city_atlas' ? 'tint' : 'shade';
    const material = part.material === 'building' ? materials.building : mode === 'tint' ? materials.cityTint : materials.byKind(part.material);
    // Each batch owns its geometry: a state may reuse another's (no damaged node), and the
    // per-instance shade lives on the geometry.
    const mesh = new THREE.InstancedMesh(mode === 'tint' ? part.geometry.clone() : part.geometry, material, Math.max(1, count));
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    // Allocate the color buffer up front so every instance always has a color.
    mesh.setColorAt(0, tmpColor.set(0xffffff));
    let shade: THREE.InstancedBufferAttribute | null = null;
    if (mode === 'tint') {
      shade = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count)).fill(1), 1);
      mesh.geometry.setAttribute(INSTANCE_SHADE, shade);
    }
    this.group.add(mesh);
    return { mesh, mode, shade, role };
  }

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
      const states = geometry.states.map((parts) => ({ meshes: parts.map((part) => this.stateMesh(part, count, 'body')), ids: [] }) as StateBatch) as [
        StateBatch,
        StateBatch,
        StateBatch,
      ];
      this.batches.set(id, { def, geometry, count, states, fallen: null, tops: null });
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

  /** The fallen batch of an archetype, made the first time one of its structures falls over. */
  private fallenBatch(batch: ArchetypeBatch): StateBatch {
    if (!batch.fallen) {
      const lying = batch.geometry.fall.map((part) => this.stateMesh(part, batch.count, 'lying'));
      const base = batch.geometry.base.map((part) => this.stateMesh(part, batch.count, 'body'));
      batch.fallen = { meshes: [...lying, ...base], ids: [] };
      if (batch.geometry.top) batch.tops = batch.geometry.top.parts.map((part) => this.stateMesh(part, batch.count, 'lying'));
    }
    return batch.fallen;
  }

  private stateBatch(batch: ArchetypeBatch, state: number): StateBatch {
    return state === FALLEN ? this.fallenBatch(batch) : batch.states[state];
  }

  private matrixFor(s: Structure, def: ArchetypeDef): THREE.Matrix4 {
    return this.standingMatrix(s, def, tmpMatrix);
  }

  private standingMatrix(s: Structure, def: ArchetypeDef, out: THREE.Matrix4): THREE.Matrix4 {
    tmpQuat.setFromAxisAngle(Y_AXIS, s.yaw);
    // A structure normally has exactly its archetype's size; scale covers a generator that varies it.
    tmpScale.set((s.hx * 2) / def.footprint[0], s.height / def.height, (s.hz * 2) / def.footprint[1]);
    return out.compose(tmpPos.set(s.x, 0, s.z), tmpQuat, tmpScale);
  }

  /** Where a falling (or fallen) structure's lying meshes are drawn now. */
  private lyingMatrix(s: Structure, def: ArchetypeDef, fall: Fall, out: THREE.Matrix4): THREE.Matrix4 {
    const u = fall.landed ? 1 : Math.min(1, fall.t / Math.max(0.01, fall.duration));
    // It topples: slow to start, fastest as it meets the ground.
    const angle = (Math.PI / 2) * u * u;
    const standing = this.standingMatrix(s, def, tmpMatrix2);
    return fallMatrix(standing, fall.pivotX, fall.pivotZ, fall.dirX, fall.dirZ, angle, fall.sink * (1 - Math.cos(angle)), out);
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

  /** Adds structure `s` to the batch of the state for `stage` (fallen over, if it lies fallen). */
  private place(s: Structure, stage: number): void {
    const batch = this.slotBatch[s.id];
    const fall = this.falls.get(s.id);
    const state = fall && stage >= 3 ? FALLEN : stateOf(stage);
    const target = this.stateBatch(batch, state);
    const index = target.ids.length;
    target.ids.push(s.id);
    const matrix = this.matrixFor(s, batch.def);
    const lying = fall && state === FALLEN ? this.lyingMatrix(s, batch.def, fall, new THREE.Matrix4()) : null;
    for (const m of target.meshes) {
      m.mesh.setMatrixAt(index, lying && m.role === 'lying' ? lying : matrix);
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
    const from = this.stateBatch(batch, state);
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
      const all = batch.fallen ? [...batch.states, batch.fallen] : batch.states;
      for (const state of all) {
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
    if (stage < 3 && this.falls.has(id)) {
      // Standing again (a new match from the same view): it no longer lies anywhere.
      this.remove(id);
      this.falls.delete(id);
      this.place(s, stage);
    } else if (stateOf(before) === stateOf(stage)) {
      // Same mesh, deeper damage: only the shade changes.
      const index = this.slotIndex[id];
      for (const m of this.stateBatch(batch, this.slotState[id]).meshes) {
        this.paintInstance(m, index, id, stage);
        this.dirty.add(m.mesh);
      }
      this.stage[id] = stage;
    } else {
      this.remove(id);
      this.place(s, stage);
    }
    if (stage >= 3) this.wobbles.delete(id);
    if (!effects || stage <= before) return null;
    if (stage >= 3) this.shed(s, batch, 1);
    else this.shed(s, batch, stage === 2 ? 0.3 : 0.15);
    return this.infoOf(id);
  }

  /**
   * Sheds a structure's collapse pieces where it stands (it went to rubble and did not fall
   * over: the renderer waits for the end of the tick's events to know). Returns where, for dust.
   */
  collapse(id: number): CollapseInfo | null {
    const s = this.city.structures[id];
    const batch = this.slotBatch[id];
    if (!s || !batch || this.falls.has(id)) return null;
    this.shed(s, batch, 1);
    return this.infoOf(id);
  }

  /** Where a structure stands and how big it is, for dust and sound. */
  infoOf(id: number): CollapseInfo | null {
    const s = this.city.structures[id];
    return s ? { x: s.x, z: s.z, radius: Math.max(s.hx, s.hz), height: s.height } : null;
  }

  /** Redraws every structure and prop from the mirrored city (match start, reconnection). */
  syncFrom(mirror: CityMirror): void {
    const fell = mirror.query.structureFall;
    for (const s of this.city.structures) {
      const side = fell[s.id];
      if (side > 0 && mirror.structureStage[s.id] >= 3) {
        this.setStage(s.id, 3, false);
        this.setFallen(s.id, side - 1, 0);
      } else {
        if (this.falls.has(s.id)) this.unfall(s.id);
        this.setStage(s.id, mirror.structureStage[s.id], false);
      }
    }
    this.wobbles.clear();
    this.flush();
    for (const p of this.city.props) {
      this.setPropAlive(p.id, propAlive(mirror, p.id));
      this.setWreck(p.id, propWrecked(mirror, p.id));
    }
    this.loose.clear();
    for (const o of mirror.loose.values()) this.loose.set(o.id, { ...o });
    this.hops.clear();
    this.propsDirty = true;
    this.flushProps();
    this.chunks.length = 0;
  }

  /** Puts the city back to pristine (the menu backdrop, a new match). */
  reset(): void {
    for (const id of [...this.falls.keys()]) this.unfall(id);
    for (const s of this.city.structures) this.setStage(s.id, 0, false);
    this.wobbles.clear();
    this.flush();
    for (const p of this.city.props) {
      this.setPropAlive(p.id, true);
      this.setWreck(p.id, false);
    }
    this.loose.clear();
    this.hops.clear();
    this.propsDirty = true;
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

  /** The visual stage a structure is drawn at (0 intact to 3 rubble; a fallen one is rubble). */
  stageOf(id: number): number {
    return this.stage[id] ?? 0;
  }

  /** The color a structure's walls show (for chunks, the map). */
  toneOf(id: number): THREE.Color {
    return this.tone[id] ?? tmpColor.set(0xffffff);
  }

  /** The archetype geometry a structure is drawn with (its effect anchors, its top), or null. */
  geometryOf(id: number): ArchetypeGeometry | null {
    return this.slotBatch[id]?.geometry ?? null;
  }

  // --- falling over ----------------------------------------------------------------------------

  /**
   * Lays structure `id` over toward `side` (FallSide: 0 its own +X, 1 +Z, 2 -X, 3 -Z), turning
   * about the edge of its footprint on that side. `duration` > 0 shows the fall (seconds, the
   * `structureFall` event's); 0 puts it straight down where it lies (a late joiner, a backlog).
   * It must be rubble (stage 3) already or become it: until then it is drawn standing.
   */
  setFallen(id: number, side: number, duration: number): void {
    const s = this.city.structures[id];
    const batch = this.slotBatch[id];
    if (!s || !batch) return;
    const existing = this.falls.get(id);
    if (existing && (duration > 0 || existing.landed)) {
      if (duration <= 0) existing.landed = true;
      this.refreshFall(id);
      return;
    }
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const k = side & 3;
    // The structure's own +X in the world is (cos, -sin), its +Z (sin, cos) (city/spatialIndex.ts fallSideDir).
    const dirX = k === 0 ? c : k === 1 ? sn : k === 2 ? -c : -sn;
    const dirZ = k === 0 ? -sn : k === 1 ? c : k === 2 ? sn : -c;
    const along = (k & 1) === 0 ? s.hx : s.hz;
    const top = batch.geometry.top;
    // Half sunk: what shows is half its thickness, the height of the simulation's mound. A mast's
    // lattice is thin: it comes down onto its legs instead.
    let sink = along;
    if (top) {
      let reach = 0;
      for (const part of top.parts) {
        part.geometry.computeBoundingBox();
        const b = part.geometry.boundingBox;
        if (b) reach = Math.max(reach, -b.min.x, b.max.x, -b.min.z, b.max.z);
      }
      sink = Math.max(0, along - reach * (s.height / batch.def.height));
    }
    const fall: Fall = { id, dirX, dirZ, pivotX: s.x + dirX * along, pivotZ: s.z + dirZ * along, sink, t: 0, duration, landed: duration <= 0 };
    this.remove(id);
    this.falls.set(id, fall);
    this.wobbles.delete(id);
    this.place(s, Math.max(3, this.stage[id]));
    this.flush();
  }

  /** The fall has landed (the `structureFall` event 'landed'): it lies where it lies. */
  land(id: number): void {
    const fall = this.falls.get(id);
    if (!fall || fall.landed) return;
    fall.landed = true;
    this.refreshFall(id);
  }

  /** Whether structure `id` is falling or lies fallen. */
  fallen(id: number): boolean {
    return this.falls.has(id);
  }

  /** How many structures are falling or lie fallen (the debug view, the playtests). */
  get lying(): number {
    return this.falls.size;
  }

  /**
   * The point of a falling structure's top section (a radio mast's break) and of its far end, in
   * the world, for effects; false when it is not falling.
   */
  fallPoint(id: number, height: number, out: THREE.Vector3): boolean {
    const fall = this.falls.get(id);
    const s = this.city.structures[id];
    const batch = this.slotBatch[id];
    if (!fall || !s || !batch) return false;
    this.lyingMatrix(s, batch.def, fall, tmpMatrix);
    out.set(0, (height * batch.def.height) / Math.max(0.01, s.height), 0).applyMatrix4(tmpMatrix);
    return true;
  }

  private unfall(id: number): void {
    const s = this.city.structures[id];
    if (!s || !this.falls.has(id)) return;
    this.remove(id);
    this.falls.delete(id);
    this.place(s, this.stage[id]);
  }

  /** Rewrites a falling structure's lying meshes (and a mast's top) for where it is in its fall. */
  private refreshFall(id: number): void {
    const fall = this.falls.get(id);
    const s = this.city.structures[id];
    const batch = this.slotBatch[id];
    if (!fall || !s || !batch || this.slotState[id] !== FALLEN) return;
    const target = this.fallenBatch(batch);
    const index = this.slotIndex[id];
    this.lyingMatrix(s, batch.def, fall, tmpMatrix);
    for (const m of target.meshes) {
      if (m.role !== 'lying') continue;
      m.mesh.setMatrixAt(index, tmpMatrix);
      m.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Draws the radio masts' tops tumbling from the masts falling now. */
  private updateTops(): void {
    for (const batch of this.batches.values()) {
      if (!batch.tops || !batch.geometry.top) continue;
      let n = 0;
      const top = batch.geometry.top;
      for (const fall of this.falls.values()) {
        if (fall.landed || this.slotBatch[fall.id] !== batch) continue;
        const s = this.city.structures[fall.id];
        const u = Math.min(1, fall.t / Math.max(0.01, fall.duration));
        // The section rides on the falling lattice, then whips over ahead of it as it snaps off
        // and comes down flat with it.
        const angle = (Math.PI / 2) * u * u;
        const whip = u > 0.55 ? Math.sin((Math.PI * (u - 0.55)) / 0.45) * 0.3 : 0;
        this.lyingMatrix(s, batch.def, fall, tmpMatrix);
        tmpPos.copy(top.at).applyMatrix4(tmpMatrix);
        tmpAxis.set(fall.dirZ, 0, -fall.dirX).normalize();
        tmpQuat.setFromAxisAngle(tmpAxis, angle + whip);
        tmpQuat2.setFromAxisAngle(Y_AXIS, s.yaw);
        tmpQuat.multiply(tmpQuat2);
        tmpScale.set((s.hx * 2) / batch.def.footprint[0], s.height / batch.def.height, (s.hz * 2) / batch.def.footprint[1]);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        for (const m of batch.tops) {
          m.mesh.setMatrixAt(n, tmpMatrix);
          this.paintInstance(m, n, fall.id, 3);
        }
        n++;
      }
      for (const m of batch.tops) {
        m.mesh.count = n;
        m.mesh.visible = n > 0;
        if (n > 0) {
          m.mesh.instanceMatrix.needsUpdate = true;
          if (m.mesh.instanceColor) m.mesh.instanceColor.needsUpdate = true;
          if (m.shade) m.shade.needsUpdate = true;
        }
      }
    }
  }

  // --- swaying -----------------------------------------------------------------------------------

  /**
   * A stomp's shock reaches a standing building: it sways about its base, `amp` radians at most,
   * away from (dirX, dirZ) first, starting `delay` seconds from now. A building already swaying
   * harder keeps its sway.
   */
  wobble(id: number, amp: number, dirX: number, dirZ: number, delay = 0): void {
    const s = this.city.structures[id];
    if (!s || this.stage[id] >= 3 || this.falls.has(id) || !(amp > 0)) return;
    const current = this.wobbles.get(id);
    if (current && current.t < 0.6 && current.amp >= amp) return;
    if (!current && this.wobbles.size >= MAX_WOBBLES) return;
    const len = Math.hypot(dirX, dirZ) || 1;
    // Tall buildings sway slower.
    const freq = Math.min(2.6, Math.max(1, 2.8 - s.height / 50));
    this.wobbles.set(id, { id, t: -delay, amp, freq, dirX: dirX / len, dirZ: dirZ / len });
  }

  /** How many buildings are swaying now (tests, the debug view). */
  get swaying(): number {
    return this.wobbles.size;
  }

  private updateWobbles(dt: number): void {
    if (this.wobbles.size === 0) return;
    for (const w of this.wobbles.values()) {
      w.t += dt;
      const s = this.city.structures[w.id];
      const batch = this.slotBatch[w.id];
      const state = this.slotState[w.id];
      if (w.t < 0) continue;
      const done = w.t > 2.2 || !s || !batch || state < 0 || state >= 2;
      // A damped sway: a quick lean away from the shock, then back and forth, dying out.
      const lean = done ? 0 : w.amp * Math.exp(-w.t * 2.6) * Math.sin(w.t * w.freq * Math.PI * 2);
      if (s && batch && state >= 0 && state < 2) {
        const standing = this.standingMatrix(s, batch.def, tmpMatrix2);
        tmpAxis.set(w.dirZ, 0, -w.dirX);
        tmpMatrix.makeTranslation(-s.x, 0, -s.z).premultiply(fallTurn.makeRotationAxis(tmpAxis, lean));
        tmpMatrix.premultiply(fallMove.makeTranslation(s.x, 0, s.z)).multiply(standing);
        const index = this.slotIndex[w.id];
        for (const m of batch.states[state].meshes) {
          m.mesh.setMatrixAt(index, tmpMatrix);
          m.mesh.instanceMatrix.needsUpdate = true;
        }
      }
      if (done) this.wobbles.delete(w.id);
    }
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

  /**
   * Advances the falling chunks, the buildings falling over and swaying, and the masts' tops.
   * Returns how many chunks are still in the air or settling.
   */
  update(dt: number): number {
    for (const fall of this.falls.values()) {
      if (fall.landed) continue;
      fall.t += dt;
      // The event says when it lands; the picture never goes past lying flat meanwhile.
      this.refreshFall(fall.id);
    }
    this.updateTops();
    this.updateWobbles(dt);
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
    const weapons: readonly string[] = CITY_WEAPON_KINDS;
    const tints = new Map<PropKindId, THREE.Color[]>();
    for (const kind of PROP_KIND_IDS) {
      // City weapons may also lie loose where the city never placed one (a fallen mast's top).
      const count = (counts.get(kind) ?? 0) + (weapons.includes(kind) ? LOOSE_ROOM : 0);
      if (count === 0) continue;
      const modelId = `prop_${kind}`;
      const model = assets.model(modelId);
      const palette = assets.modelTints(modelId).map((c) => new THREE.Color(c));
      if (palette.length === 0 && model.procedural && PROP_KINDS[kind].tally === 'car' && kind !== 'car_taxi' && kind !== 'truck') {
        for (const c of [0xe0372f, 0x2f62c9, 0xf5f5f0, 0x3fa652, 0x8f6fd0, 0xf29b85, 0x2a9d8f, 0xaab2bc]) palette.push(new THREE.Color(c));
      }
      tints.set(kind, palette);
      const meshes: THREE.InstancedMesh[] = [];
      // (A city weapon's `grip` node is an empty: it has no parts.)
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

  /**
   * A city weapon lying loose (`looseProp` 'down': dropped, or a fallen mast's top) or no longer
   * (`looseProp` 'gone', picked up: `kaijuHeld` with source 'loose'). `o` null removes `id`.
   */
  setLoose(id: number, o: LooseShown | null): void {
    if (o) this.loose.set(id, { ...o });
    else if (!this.loose.delete(id)) return;
    this.propsDirty = true;
  }

  /** The city weapons lying loose now. */
  looseShown(): IterableIterator<LooseShown> {
    return this.loose.values();
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
   * Repacks the prop instances around the camera when needed, then moves the props that hop or
   * sway. `radius` is how far props are drawn; the caller grows it with the camera's height.
   */
  updateProps(cameraX: number, cameraZ: number, radius: number, dt = 0): number {
    const cols = this.propCols;
    if (cols === 0) return 0;
    const half = this.city.half;
    const cx = Math.floor((cameraX + half) / PROP_CELL);
    const cz = Math.floor((cameraZ + half) / PROP_CELL);
    const reach = Math.ceil(radius / PROP_CELL);
    const key = `${cx},${cz},${reach}`;
    if (key !== this.propViewKey || this.propsDirty) {
      this.propViewKey = key;
      this.propsDirty = false;
      this.repack(cx, cz, reach);
    }
    this.updateHops(dt);
    return this.propsDrawn;
  }

  private repack(cx: number, cz: number, reach: number): void {
    const cols = this.propCols;
    const fill = new Map<THREE.InstancedMesh[], number>();
    for (const meshes of this.propMeshes.values()) fill.set(meshes, 0);
    let wreckCount = 0;
    let drawn = 0;
    const props = this.city.props;
    this.propSlot.fill(-1);
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
            this.propSlot[id] = index;
            drawn++;
          } else if (this.wreckShown[id] === 1) {
            for (const mesh of this.wreckMeshes) mesh.setMatrixAt(wreckCount, this.propMatrix[id]);
            this.propSlot[id] = wreckCount;
            wreckCount++;
            drawn++;
          }
        }
      }
    }
    // Loose city weapons: few, so always drawn.
    const white = tmpColor.set(0xffffff);
    for (const o of this.loose.values()) {
      const meshes = this.propMeshes.get(o.prop);
      if (!meshes) continue;
      const index = fill.get(meshes) ?? 0;
      if (index >= (meshes[0]?.instanceMatrix.count ?? 0)) continue;
      tmpMatrix.compose(tmpPos.set(o.x, 0, o.z), tmpQuat.setFromAxisAngle(Y_AXIS, o.yaw), ONE);
      for (const mesh of meshes) {
        mesh.setMatrixAt(index, tmpMatrix);
        mesh.setColorAt(index, white);
      }
      fill.set(meshes, index + 1);
      drawn++;
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
  }

  private propsDrawn = 0;

  // --- props jolted by the monster's weight ------------------------------------------------------

  /**
   * A footstep or a stomp at (x, z): the props within `radius` meters hop (cars, small things)
   * up to `height` meters at the middle, or sway (trees, lamps, poles), less the farther out.
   * Returns how many were jolted.
   */
  hop(x: number, z: number, radius: number, height: number): number {
    const cols = this.propCols;
    if (cols === 0 || !(radius > 0) || !(height > 0)) return 0;
    const half = this.city.half;
    const props = this.city.props;
    const x0 = Math.max(0, Math.floor((x - radius + half) / PROP_CELL));
    const x1 = Math.min(cols - 1, Math.floor((x + radius + half) / PROP_CELL));
    const z0 = Math.max(0, Math.floor((z - radius + half) / PROP_CELL));
    const z1 = Math.min(cols - 1, Math.floor((z + radius + half) / PROP_CELL));
    let n = 0;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const id of this.propCells[cz * cols + cx]) {
          const shown = this.propShown[id] === 1;
          const wreck = !shown && this.wreckShown[id] === 1;
          if (!shown && !wreck) continue;
          const p = props[id];
          const dx = p.x - x;
          const dz = p.z - z;
          const d = Math.hypot(dx, dz);
          if (d > radius) continue;
          const falloff = Math.pow(1 - d / radius, 1.5);
          const def = PROP_KINDS[p.kind];
          const sway = !wreck && def.tally !== 'car' && def.height > 3;
          const h = height * falloff * (0.75 + this.rand() * 0.5);
          if (h < 0.02) continue;
          const current = this.hops.get(id);
          if (current && current.t < current.duration * 0.5 && (sway ? current.tilt : current.height) >= (sway ? 0.12 * falloff : h)) continue;
          // Enough is moving already: the ones in the air land first.
          if (!current && this.hops.size >= MAX_HOPS) continue;
          const len = d || 1;
          // Tilted away from the footfall: about the horizontal axis across the push.
          const axisX = dz / len;
          const axisZ = -dx / len;
          const v0 = Math.sqrt(2 * HOP_GRAVITY * h);
          this.hops.set(id, {
            id,
            wreck,
            t: 0,
            duration: sway ? 1.4 : (2 * v0) / HOP_GRAVITY,
            height: sway ? 0 : h,
            tilt: sway ? Math.min(0.14, 0.05 + height * 0.04) * falloff : Math.min(0.5, h * 0.25) * (this.rand() < 0.5 ? -1 : 1),
            axisX,
            axisZ,
            sway,
          });
          n++;
        }
      }
    }
    return n;
  }

  /** How many props are hopping or swaying now (tests, the debug view). */
  get hopping(): number {
    return this.hops.size;
  }

  private updateHops(dt: number): void {
    if (this.hops.size === 0) return;
    const props = this.city.props;
    const touched = new Set<THREE.InstancedMesh[]>();
    for (const hop of this.hops.values()) {
      hop.t += dt;
      const p = props[hop.id];
      const done = hop.t >= hop.duration;
      const slot = this.propSlot[hop.id];
      const meshes = hop.wreck ? this.wreckMeshes : this.propMeshes.get(p.kind);
      if (done) this.hops.delete(hop.id);
      if (slot < 0 || !meshes || (hop.wreck ? this.wreckShown[hop.id] !== 1 : this.propShown[hop.id] !== 1)) continue;
      let y = 0;
      let tilt = 0;
      if (!done) {
        const u = hop.t / hop.duration;
        if (hop.sway) {
          tilt = hop.tilt * Math.exp(-hop.t * 3) * Math.sin(hop.t * Math.PI * 2 * 1.8);
        } else {
          y = hop.height * 4 * u * (1 - u);
          tilt = hop.tilt * Math.sin(Math.PI * u);
        }
      }
      tmpQuat.setFromAxisAngle(tmpAxis.set(hop.axisX, 0, hop.axisZ), tilt);
      tmpQuat.multiply(tmpQuat2.setFromAxisAngle(Y_AXIS, p.yaw));
      tmpMatrix.compose(tmpPos.set(p.x, y, p.z), tmpQuat, ONE);
      for (const mesh of meshes) mesh.setMatrixAt(slot, tmpMatrix);
      touched.add(meshes);
    }
    for (const meshes of touched) for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
