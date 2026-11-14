/**
 * Procedural stand-ins for every model in docs/ASSETS.md section 3, built from colored boxes
 * with the same node names, pivots, size and facing (+Z) as the art contract asks of the real
 * files. The game runs on these until a .glb lands, and they keep working as the fallback when
 * a file is missing or fails to load.
 */

import * as THREE from 'three';
import { kaijuKindDef, PROP_KINDS, type KaijuKindId, type PropKindId, type StageId } from '@mb/shared';
import { computeRigBounds, type RigModel, type RigNode, type RigPart } from '../rigModel';
import { bar, blob, box, boxOn, cone, merge, relativeTo } from './geo';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

interface NodeSpec {
  name: string;
  parent: string | null;
  /** Pivot in model space. */
  pivot: THREE.Vector3;
  /** Geometry in model space, by material. */
  vcol?: THREE.BufferGeometry[];
  glow?: THREE.BufferGeometry[];
}

function build(id: string, specs: NodeSpec[]): RigModel {
  const index = new Map<string, number>();
  const pivots: THREE.Vector3[] = [];
  const nodes: RigNode[] = [];
  for (const spec of specs) {
    const parent = spec.parent === null ? -1 : (index.get(spec.parent) ?? -1);
    const parentPivot = parent >= 0 ? pivots[parent] : V(0, 0, 0);
    const parts: RigPart[] = [];
    if (spec.vcol && spec.vcol.length > 0) parts.push({ geometry: relativeTo(merge(spec.vcol), spec.pivot), material: 'vcol' });
    if (spec.glow && spec.glow.length > 0) parts.push({ geometry: relativeTo(merge(spec.glow), spec.pivot), material: 'glow' });
    index.set(spec.name, nodes.length);
    pivots.push(spec.pivot);
    nodes.push({
      name: spec.name,
      parent,
      position: spec.pivot.clone().sub(parentPivot),
      quaternion: new THREE.Quaternion(),
      parts,
    });
  }
  return { id, nodes, bounds: computeRigBounds(nodes), procedural: true };
}

function single(id: string, vcol: THREE.BufferGeometry[], glow: THREE.BufferGeometry[] = []): RigModel {
  return build(id, [{ name: id, parent: null, pivot: V(0, 0, 0), vcol, glow }]);
}

// --- kaiju -------------------------------------------------------------------------------------

const KAIJU_COLORS: Record<KaijuKindId, { body: number; dark: number; belly: number }> = {
  lizard: { body: 0xd9641e, dark: 0x9c3d12, belly: 0xf1dfb0 },
  crab: { body: 0xc8242c, dark: 0x7d1218, belly: 0xf0c9a0 },
  burrower: { body: 0xc9962e, dark: 0x5d3a36, belly: 0xe8d3a0 },
  moth: { body: 0xe9a23a, dark: 0xd4588a, belly: 0xfbe9c7 },
};
const BONE = 0xf2ead8;
const EYE = 0xffe45c;
const WEAK = 0x7dfcff;

/**
 * A box lizard with the full node tree of ASSETS.md section 3. Pivot positions are those of
 * the hatchling art (4.5 m tall), scaled to the requested height.
 */
function kaijuModel(id: string, kind: KaijuKindId, height: number): RigModel {
  const s = height / 4.5;
  const c = KAIJU_COLORS[kind] ?? KAIJU_COLORS.lizard;
  const P = (x: number, y: number, z: number): THREE.Vector3 => V(x * s, y * s, z * s);
  const B = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.BufferGeometry =>
    box(w * s, h * s, d * s, color, x * s, y * s, z * s);
  const R = (a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, color: number): THREE.BufferGeometry => bar(a, b, w * s, d * s, color);

  const specs: NodeSpec[] = [];
  specs.push({ name: 'root', parent: null, pivot: P(0, 0, 0) });
  specs.push({ name: 'hips', parent: 'root', pivot: P(0, 1.72, -0.29), vcol: [B(1.7, 0.95, 1.5, c.body, 0, 1.75, -0.3)] });

  const tail = [P(0, 1.64, -0.68), P(0, 1.36, -1.3), P(0, 1.07, -1.9), P(0, 0.81, -2.45), P(0, 0.63, -2.94), P(0, 0.5, -3.5)];
  for (let i = 0; i < 5; i++) {
    const w = 1.1 - i * 0.18;
    specs.push({
      name: `tail_${i + 1}`,
      parent: i === 0 ? 'hips' : `tail_${i}`,
      pivot: tail[i],
      vcol: [R(tail[i], tail[i + 1], w, w * 0.9, i % 2 === 0 ? c.body : c.dark)],
    });
  }

  for (const side of [1, -1]) {
    const L = side === 1 ? 'L' : 'R';
    const hip = P(0.73 * side, 1.67, -0.31);
    const knee = P(1.12 * side, 1.05, 0.31);
    const ankle = P(1.12 * side, 0.45, -0.21);
    specs.push({ name: `leg_${L}`, parent: 'hips', pivot: hip, vcol: [R(hip, knee, 0.75, 0.85, c.body)] });
    specs.push({ name: `shin_${L}`, parent: `leg_${L}`, pivot: knee, vcol: [R(knee, ankle, 0.55, 0.6, c.dark)] });
    specs.push({
      name: `foot_${L}`,
      parent: `shin_${L}`,
      pivot: ankle,
      vcol: [
        B(0.85, 0.42, 1.5, c.body, 1.12 * side, 0.21, 0.25),
        B(0.2, 0.2, 0.35, BONE, (1.12 - 0.28) * side, 0.12, 1.1),
        B(0.2, 0.2, 0.35, BONE, 1.12 * side, 0.12, 1.15),
        B(0.2, 0.2, 0.35, BONE, (1.12 + 0.28) * side, 0.12, 1.1),
      ],
    });
  }

  specs.push({
    name: 'torso',
    parent: 'hips',
    pivot: P(0, 1.9, -0.23),
    vcol: [B(2.2, 1.7, 1.7, c.body, 0, 2.7, 0.15), B(1.5, 1.3, 0.25, c.belly, 0, 2.55, 1.05)],
  });

  for (const side of [1, -1]) {
    const L = side === 1 ? 'L' : 'R';
    const shoulder = P(1.28 * side, 3.13, 0.6);
    const elbow = P(1.69 * side, 2.37, 0.31);
    const wrist = P(1.61 * side, 1.8, 1.22);
    specs.push({ name: `arm_${L}`, parent: 'torso', pivot: shoulder, vcol: [R(shoulder, elbow, 0.5, 0.55, c.body)] });
    specs.push({ name: `forearm_${L}`, parent: `arm_${L}`, pivot: elbow, vcol: [R(elbow, wrist, 0.42, 0.45, c.dark)] });
    specs.push({
      name: `hand_${L}`,
      parent: `forearm_${L}`,
      pivot: wrist,
      vcol: [
        B(0.55, 0.4, 0.55, c.body, 1.61 * side, 1.62, 1.4),
        B(0.14, 0.14, 0.5, BONE, (1.61 - 0.2) * side, 1.5, 1.85),
        B(0.14, 0.14, 0.55, BONE, 1.61 * side, 1.5, 1.9),
        B(0.14, 0.14, 0.5, BONE, (1.61 + 0.2) * side, 1.5, 1.85),
      ],
    });
    if (side === -1) specs.push({ name: 'hold', parent: 'hand_R', pivot: P(-1.6, 1.25, 1.33) });
  }

  specs.push({ name: 'neck', parent: 'torso', pivot: P(0, 3.18, 0.18), vcol: [B(1.0, 0.75, 0.9, c.body, 0, 3.3, 0.35)] });
  specs.push({
    name: 'head',
    parent: 'neck',
    pivot: P(0, 3.36, 0.29),
    vcol: [
      B(1.35, 0.85, 1.25, c.body, 0, 3.62, 0.85),
      // The snout sits low enough to stay out of the middle of the first-person view.
      B(1.05, 0.5, 1.15, c.body, 0, 3.47, 1.95),
      B(0.16, 0.16, 0.16, c.dark, 0.3, 3.76, 2.4),
      B(0.16, 0.16, 0.16, c.dark, -0.3, 3.76, 2.4),
      B(0.3, 0.45, 0.5, c.dark, 0.45, 4.2, 0.55),
      B(0.3, 0.45, 0.5, c.dark, -0.45, 4.2, 0.55),
    ],
    glow: [B(0.1, 0.2, 0.3, EYE, 0.69, 3.8, 1.25), B(0.1, 0.2, 0.3, EYE, -0.69, 3.8, 1.25)],
  });
  specs.push({ name: 'cam_fp', parent: 'head', pivot: P(0, 4.1, 1.68) });
  specs.push({
    name: 'jaw',
    parent: 'head',
    pivot: P(0, 3.07, 0.32),
    vcol: [B(1.0, 0.26, 1.95, c.belly, 0, 3.06, 1.45), B(0.9, 0.12, 0.3, BONE, 0, 3.22, 2.3)],
  });
  specs.push({ name: 'mouth', parent: 'head', pivot: P(0, 2.9, 2.5) });
  specs.push({
    name: 'spines',
    parent: 'torso',
    pivot: P(0, 2.81, 0.09),
    vcol: [B(0.22, 0.6, 0.5, c.dark, 0, 3.75, -0.1), B(0.22, 0.75, 0.5, c.dark, 0, 3.6, -0.75), B(0.2, 0.5, 0.45, c.dark, 0, 3.2, -1.25)],
  });
  specs.push({ name: 'weak_point', parent: 'torso', pivot: P(0, 2.09, 0.82), glow: [B(0.7, 0.7, 0.2, WEAK, 0, 2.2, 1.2)] });
  return build(id, specs);
}

function cocoonModel(id: string, egg: boolean): RigModel {
  const shell = egg ? 0xf3e9cf : 0x8a5a3c;
  const glow = egg ? 0xffb347 : 0xff7a1a;
  return build(id, [
    { name: id, parent: null, pivot: V(0, 0, 0), vcol: [blob(egg ? 0.38 : 0.46, 0.5, egg ? 0.38 : 0.47, shell, 0, 0.5, 0, 1)] },
    {
      name: egg ? 'egg_glow' : 'cocoon_glow',
      parent: id,
      pivot: V(0, 0, 0),
      glow: [box(0.06, 0.5, 0.02, glow, 0.1, 0.5, egg ? 0.37 : 0.46), box(0.05, 0.35, 0.02, glow, -0.14, 0.42, egg ? 0.35 : 0.44)],
    },
  ]);
}

// --- army --------------------------------------------------------------------------------------

const OLIVE = 0x6b7a3a;
const OLIVE_DARK = 0x4a5628;
const CYAN = 0x1ec8e0;
const TRACK = 0x2a2c30;

function tankModel(id: string): RigModel {
  return build(id, [
    {
      name: 'hull',
      parent: null,
      pivot: V(0, 0, 0),
      vcol: [boxOn(3.0, 0.95, 6.4, OLIVE, 0, 0.55, 0), boxOn(2.6, 0.3, 1.6, OLIVE_DARK, 0, 1.4, -2.2)],
      glow: [box(3.04, 0.16, 1.2, CYAN, 0, 1.2, 1.4)],
    },
    { name: 'track_L', parent: 'hull', pivot: V(1.46, 0.54, 0), vcol: [box(0.9, 1.08, 6.9, TRACK, 1.46, 0.54, 0)] },
    { name: 'track_R', parent: 'hull', pivot: V(-1.46, 0.54, 0), vcol: [box(0.9, 1.08, 6.9, TRACK, -1.46, 0.54, 0)] },
    { name: 'turret', parent: 'hull', pivot: V(0, 1.68, -0.1), vcol: [boxOn(2.3, 0.85, 2.9, OLIVE, 0, 1.55, -0.1), boxOn(0.7, 0.3, 0.7, OLIVE_DARK, 0.5, 2.4, -0.6)] },
    { name: 'barrel', parent: 'turret', pivot: V(0, 1.94, 1.2), vcol: [box(0.28, 0.28, 3.7, OLIVE_DARK, 0, 1.94, 3.05)] },
    { name: 'muzzle', parent: 'barrel', pivot: V(0, 1.94, 4.9) },
  ]);
}

function tankWreckModel(id: string): RigModel {
  const turret = boxOn(2.3, 0.8, 2.8, 0x2b2622, 0, 0, 0);
  turret.rotateZ(0.35);
  turret.rotateY(0.6);
  turret.translate(1.5, 0.9, -0.6);
  return single(id, [boxOn(3.0, 0.85, 6.2, 0x35302b, 0, 0.3, 0), box(0.9, 0.9, 6.6, 0x1c1b1a, 1.5, 0.45, 0), box(0.9, 0.7, 5.2, 0x1c1b1a, -1.5, 0.35, 0.4), turret]);
}

function projectileModel(id: string): RigModel {
  if (id === 'proj_rocket') return single(id, [box(0.24, 0.24, 1.0, 0xc8ccd2, 0, 0, -0.1), box(0.2, 0.2, 0.25, 0xd7263d, 0, 0, 0.5)]);
  if (id === 'proj_arty') return single(id, [box(0.34, 0.3, 1.2, 0x4b5320, 0, 0, -0.1), box(0.24, 0.22, 0.35, 0x2a2c30, 0, 0, 0.6)]);
  return single(id, [box(0.2, 0.18, 0.9, 0x3a3d42, 0, 0, 0)]);
}

// --- props -------------------------------------------------------------------------------------

const GLASS = 0x8fd3e8;
const TIRE = 0x1d1e21;

function carModel(id: string, w: number, h: number, len: number, paintColor: number, cabin: [number, number]): RigModel {
  const bodyH = h * 0.5;
  return single(id, [
    boxOn(w, bodyH, len, paintColor, 0, 0.3, 0, 1),
    boxOn(w * 0.86, h - bodyH - 0.3, len * (cabin[1] - cabin[0]), GLASS, 0, 0.3 + bodyH, len * ((cabin[0] + cabin[1]) / 2 - 0.5), 0),
    box(w + 0.06, 0.6, 0.7, TIRE, 0, 0.3, len * 0.3, 0),
    box(w + 0.06, 0.6, 0.7, TIRE, 0, 0.3, -len * 0.3, 0),
  ]);
}

function propModel(id: string, kind: PropKindId): RigModel {
  const def = PROP_KINDS[kind];
  const h = def.height;
  switch (kind) {
    case 'car_sedan':
      return carModel(id, 1.9, h, 4.4, 0xf5f5f0, [0.25, 0.7]);
    case 'car_taxi':
      return carModel(id, 1.9, h, 4.4, 0xf2c21b, [0.25, 0.7]);
    case 'car_van':
      return carModel(id, 2.0, h, 5.0, 0xf5f5f0, [0.15, 0.95]);
    case 'bus':
      return carModel(id, 2.6, h, 11.9, 0xf5f5f0, [0.04, 0.97]);
    case 'truck':
      return single(id, [
        boxOn(2.5, h - 0.5, 6.2, 0xe8e4d8, 0, 0.5, -1.3, 1),
        boxOn(2.4, h * 0.72, 2.2, 0xd7263d, 0, 0.4, 3.2, 0),
        box(2.56, 0.8, 0.9, TIRE, 0, 0.4, 3.0, 0),
        box(2.56, 0.8, 0.9, TIRE, 0, 0.4, -3.2, 0),
      ]);
    case 'kiosk':
      return single(id, [boxOn(2.4, h - 0.5, 2.4, 0xf3e3b3, 0, 0, 0), boxOn(3.0, 0.5, 3.0, 0xd7263d, 0, h - 0.5, 0), box(1.6, 0.9, 0.1, GLASS, 0, 1.6, 1.22)]);
    case 'tree_a':
      return single(id, [boxOn(0.5, h * 0.4, 0.5, 0x6b4a2b, 0, 0, 0), blob(def.radius * 1.5, h * 0.36, def.radius * 1.5, 0x3fa652, 0, h * 0.68, 0, 0)]);
    case 'tree_b':
      return single(id, [boxOn(0.5, h * 0.3, 0.5, 0x5a3d22, 0, 0, 0), cone(def.radius * 1.5, h * 0.75, 6, 0x2f8a48, 0, h * 0.25, 0)]);
    case 'lamp':
      return single(id, [boxOn(0.16, h, 0.16, 0x4a4f58, 0, 0, 0), box(0.9, 0.14, 0.2, 0x4a4f58, 0.4, h, 0)], [box(0.4, 0.1, 0.26, 0xfff2b0, 0.65, h - 0.1, 0)]);
    case 'trafficlight':
      return single(id, [boxOn(0.16, h, 0.16, 0x33373d, 0, 0, 0), box(0.4, 1.1, 0.35, 0x22252a, 0, h - 0.4, 0.1)], [box(0.2, 0.2, 0.06, 0x3ddc63, 0, h - 0.7, 0.3)]);
    case 'bench':
      return single(id, [box(1.7, 0.1, 0.5, 0x9a6b3a, 0, 0.45, 0), box(1.7, 0.45, 0.08, 0x9a6b3a, 0, 0.72, -0.24), box(0.1, 0.45, 0.5, 0x33373d, 0.7, 0.22, 0), box(0.1, 0.45, 0.5, 0x33373d, -0.7, 0.22, 0)]);
    case 'hydrant':
      return single(id, [boxOn(0.3, h * 0.8, 0.3, 0xd7263d, 0, 0, 0), boxOn(0.2, h * 0.2, 0.2, 0xaab2bc, 0, h * 0.8, 0), box(0.46, 0.14, 0.14, 0xd7263d, 0, h * 0.55, 0)]);
    case 'billboard':
      return single(id, [boxOn(0.3, h * 0.55, 0.3, 0x4a4f58, 2.2, 0, 0), boxOn(0.3, h * 0.55, 0.3, 0x4a4f58, -2.2, 0, 0), boxOn(6.6, h * 0.45, 0.3, 0xffd91a, 0, h * 0.55, 0), box(5.8, h * 0.3, 0.34, 0xe0372f, 0, h * 0.77, 0)]);
    case 'busstop':
      return single(id, [boxOn(4.4, 0.15, 1.5, 0x2f62c9, 0, h - 0.15, 0), boxOn(4.2, h - 0.3, 0.1, GLASS, 0, 0.15, -0.65), boxOn(0.12, h, 0.12, 0x4a4f58, 2.1, 0, 0.6), boxOn(0.12, h, 0.12, 0x4a4f58, -2.1, 0, 0.6)]);
    // Stand-ins for the city weapons (phase 2) until their art files are in.
    case 'propane':
      return single(id, [boxOn(1.1, h - 0.2, 2.4, 0xf5f5f0, 0, 0.2, 0), box(1.0, 0.2, 0.2, 0x4a4f58, 0, 0.1, 0.8), box(1.0, 0.2, 0.2, 0x4a4f58, 0, 0.1, -0.8)]);
    case 'watertank':
      return single(id, [boxOn(0.2, h - 2.6, 0.2, 0x4a4f58, 1, 0, 1), boxOn(0.2, h - 2.6, 0.2, 0x4a4f58, -1, 0, -1), boxOn(2.8, 2.6, 2.8, 0x9ab3c4, 0, h - 2.6, 0)]);
    case 'antenna':
      return single(id, [boxOn(0.14, h, 0.14, 0x8a9099, 0, 0, 0), box(2.0, 0.08, 0.08, 0x8a9099, 0, h - 0.6, 0), box(1.4, 0.08, 0.08, 0x8a9099, 0, h - 1.3, 0)]);
    case 'foodsign':
      return single(id, [boxOn(0.3, h - 2.4, 0.3, 0x4a4f58, 0, 0, 0), boxOn(3.0, 2.4, 0.5, 0xd7263d, 0, h - 2.4, 0), box(2.4, 0.8, 0.54, 0xffd91a, 0, h - 1.2, 0)]);
    case 'garagedoor':
      return single(id, [boxOn(3.2, h, 0.3, 0xd9d2c0, 0, 0, 0), box(2.8, h - 0.3, 0.34, 0xaab2bc, 0, (h - 0.3) / 2, 0)]);
    case 'mast':
      return single(id, [boxOn(0.9, 0.9, 8, 0xd7263d, 0, 0, 0), box(0.95, 0.95, 1.4, 0xf5f5f0, 0, 0.45, 2), box(0.95, 0.95, 1.4, 0xf5f5f0, 0, 0.45, -2)]);
  }
}

function carWreckModel(id: string): RigModel {
  const top = boxOn(1.6, 0.3, 2.2, 0x26211e, 0, 0.55, -0.2);
  top.rotateZ(0.12);
  return single(id, [boxOn(1.95, 0.55, 4.3, 0x3a322c, 0, 0, 0), top, box(2.0, 0.5, 0.7, 0x151515, 0, 0.25, 1.3)]);
}

/** A torn-out piece of building in the kaiju's hand: about 1 m across, scaled in code. */
function heldChunkModel(id: string): RigModel {
  const slab = box(1.0, 0.55, 0.8, 0xd9d2c0, 0, 0.3, 0);
  const lump = box(0.5, 0.45, 0.6, 0x9a9aa1, 0.3, 0.75, -0.05);
  lump.rotateZ(0.3);
  return single(id, [slab, lump, box(0.12, 0.5, 0.12, 0x5a5f68, -0.3, 0.8, 0.2)]);
}

function unknownModel(id: string, size: [number, number, number] | undefined): RigModel {
  const [w, h, d] = size ?? [1, 1, 1];
  return single(id, [boxOn(w, h, d, 0xb05cff, 0, 0, 0)]);
}

/**
 * The stand-in for a model id. `size` (from the manifest entry, when there is one) sizes the
 * box for ids this file knows nothing about.
 */
export function proceduralModel(id: string, size?: [number, number, number]): RigModel {
  const kaiju = /^kaiju_([a-z]+)_s([123])$/.exec(id);
  if (kaiju) {
    const kind = kaiju[1] as KaijuKindId;
    const stage = Number(kaiju[2]) as StageId;
    let height = size?.[1] ?? 4.5 * [1, 7.1, 25.5][stage - 1];
    try {
      height = kaijuKindDef(kind).stages[stage - 1].height;
    } catch {
      // A kind without a definition yet: the lizard's proportions at the manifest's height.
    }
    return kaijuModel(id, kind, height);
  }
  if (id === 'kaiju_cocoon') return cocoonModel(id, false);
  if (id === 'kaiju_egg') return cocoonModel(id, true);
  if (id === 'army_tank') return tankModel(id);
  if (id === 'army_tank_wreck') return tankWreckModel(id);
  if (id.startsWith('proj_')) return projectileModel(id);
  if (id === 'prop_car_wreck') return carWreckModel(id);
  if (id === 'held_chunk') return heldChunkModel(id);
  if (id.startsWith('prop_')) {
    const kind = id.slice(5) as PropKindId;
    if (PROP_KINDS[kind]) return propModel(id, kind);
  }
  return unknownModel(id, size);
}
