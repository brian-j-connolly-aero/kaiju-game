/**
 * Projectiles are not in snapshots: each one is spawned here from a `projectileSpawn` event and
 * flown locally along the same path the server uses (ARCHITECTURE.md section 3), until its
 * `projectileHit` arrives. They are drawn big and glowing so both sides can read and dodge them.
 *
 * Each kind of shot has its own look, so a player can tell them apart at a glance (phase 2):
 *
 *   rocket, shell   the squads' own weapons: a model with a glow, a puff trail on rockets
 *   tracer          the machine gun pick-up: a short bright streak of light
 *   heavyShell      the big cannon pick-up: a big shell with a fat glow and a smoke trail
 *   missile         the missile pod pick-up: six missiles that fan out and curve onto the
 *                   crosshair (the guided flight of `stepProjectile`), each with a thick trail
 *   arty            an artillery barrage: big shells falling steeply, a long bright streak and a
 *                   smoke trail behind each, so they are seen coming down
 *   thrown          what the kaiju throws: the object itself, tumbling; a city weapon flies the
 *                   way it is used (a javelin point first and sticks where it stops, a garage
 *                   door flat and spinning, and it lies there a while)
 */

import * as THREE from 'three';
import { DT, type HeldObject, type ProjectileHitEvent, type ProjectileSpawnEvent, type ProjectileTypeId, type PropKindId } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { frameRect } from '../assets/spriteAtlas';
import type { Effects } from './effects';
import { gripFor, gripRotation, reachFromGrip, type GripInfo } from './heldProps';
import { InstancedRig } from './instancedRig';
import type { LineBatch } from './lineBatch';
import type { Materials } from './materials';
import type { QuadBatch } from './quadBatch';
import { SceneRig } from './sceneRig';

/** How a thrown object flies. */
type ThrownMode = 'tumble' | 'javelin' | 'frisbee';

interface Flying {
  id: number;
  type: ProjectileTypeId;
  x0: number;
  y0: number;
  z0: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  /** Guided flight (the missile pod): an acceleration for its first `steer` seconds. */
  ax: number;
  ay: number;
  az: number;
  steer: number;
  spawnTick: number;
  ttl: number;
  volley: boolean;
  /** Thrown objects: the model that flies through the air. */
  object: SceneRig | null;
  /** A thrown city weapon: its kind, its grip and how it flies. */
  prop: PropKindId | null;
  grip: GripInfo | null;
  mode: ThrownMode;
  /** Meters from a city weapon's grip to its point. */
  reach: number;
  spin: THREE.Vector3;
  trail: number;
  /** Where it is drawn at launch minus where the simulation launched it; faded out over `HAND_BLEND`. */
  ox: number;
  oy: number;
  oz: number;
  x: number;
  y: number;
  z: number;
  /** Velocity now. */
  dx: number;
  dy: number;
  dz: number;
}

/** A javelin stuck where it stopped, or a garage door lying where it landed: kept a while, then sunk away. */
interface Stuck {
  object: SceneRig;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Seconds over which a thrown object goes from the model's hand to the simulation's path
 * (docs/art/client-notes-kaiju-lizard.md section 7: the simulation throws from its own hand
 * point, up to 59 m from the model's at stage 3).
 */
export const HAND_BLEND = 0.15;

/** How much of the launch offset is still added `t` seconds after the launch (1 at the hand, 0 from `HAND_BLEND` on). */
export function handBlend(t: number): number {
  return t >= HAND_BLEND ? 0 : 1 - Math.max(0, t) / HAND_BLEND;
}

/** The flight of a projectile as the event describes it (positions and velocities, meters and seconds). */
export interface FlightSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  ax?: number;
  ay?: number;
  az?: number;
  steer?: number;
}

/**
 * Where a projectile is `t` seconds into its flight, and how fast it goes there: exactly what
 * `stepProjectile` gives tick by tick. A guided one accelerates by (ax, ay, az) and feels no
 * gravity for its first `steer` seconds, then flies on under gravity at the velocity it has.
 */
export function flightAt(f: FlightSpec, t: number, pos: { x: number; y: number; z: number }, vel?: { x: number; y: number; z: number }): void {
  const steer = f.steer !== undefined && f.steer > 0 ? f.steer : 0;
  let x = f.x;
  let y = f.y;
  let z = f.z;
  let vx = f.vx;
  let vy = f.vy;
  let vz = f.vz;
  let rest = t;
  if (steer > 0) {
    const s = Math.min(t, steer);
    const ax = f.ax ?? 0;
    const ay = f.ay ?? 0;
    const az = f.az ?? 0;
    x += vx * s + 0.5 * ax * s * s;
    y += vy * s + 0.5 * ay * s * s;
    z += vz * s + 0.5 * az * s * s;
    vx += ax * s;
    vy += ay * s;
    vz += az * s;
    rest = Math.max(0, t - steer);
  }
  x += vx * rest;
  z += vz * rest;
  y += vy * rest - 0.5 * f.gravity * rest * rest;
  vy -= f.gravity * rest;
  pos.x = x;
  pos.y = y;
  pos.z = z;
  if (vel) {
    vel.x = vx;
    vel.y = vy;
    vel.z = vz;
  }
}

const MODELS: Partial<Record<ProjectileTypeId, string>> = {
  rocket: 'proj_rocket',
  shell: 'proj_shell',
  arty: 'proj_arty',
  missile: 'proj_rocket',
  heavyShell: 'proj_shell',
};
/** How much bigger than life a model is drawn, at least (a big cannon's shell is a fat one). */
const MODEL_SIZE: Partial<Record<ProjectileTypeId, number>> = { heavyShell: 2.2, arty: 2.5, missile: 1.4 };
const GLOW: Record<ProjectileTypeId, [number, number, number, number]> = {
  // r, g, b, size in meters
  rocket: [1, 0.55, 0.15, 4],
  shell: [1, 0.85, 0.4, 5],
  arty: [1, 0.45, 0.2, 12],
  thrown: [0, 0, 0, 0],
  tracer: [1, 0.95, 0.55, 1.6],
  missile: [1, 0.5, 0.12, 5],
  heavyShell: [1, 0.78, 0.35, 9],
};
/** Seconds between two puffs of a projectile's smoke trail; none for a type not listed. */
const TRAIL_EVERY: Partial<Record<ProjectileTypeId, number>> = { rocket: 0.09, arty: 0.06, missile: 0.035, heavyShell: 0.07 };

function payloadModel(payload: HeldObject | undefined): string {
  if (!payload) return 'held_chunk';
  switch (payload.kind) {
    case 'prop':
      return `prop_${payload.prop}`;
    case 'vehicle':
      return 'army_tank';
    case 'wreck':
      return payload.wreck === 'tank' ? 'army_tank_wreck' : 'prop_car_wreck';
    case 'chunk':
      return 'held_chunk';
  }
}

const pos = { x: 0, y: 0, z: 0 };
const vel = { x: 0, y: 0, z: 0 };
const UP = new THREE.Vector3(0, 1, 0);
const dirV = new THREE.Vector3();
const hintV = new THREE.Vector3();
const offset = new THREE.Vector3();

export class ProjectilesView {
  readonly group = new THREE.Group();
  private readonly assets: AssetStore;
  private readonly materials: Materials;
  private readonly glow: QuadBatch;
  private readonly flying = new Map<number, Flying>();
  private readonly stuck: Stuck[] = [];
  private readonly rigs = new Map<string, InstancedRig>();
  private readonly glowUv = [0, 0, 0, 0];

  constructor(assets: AssetStore, materials: Materials, glow: QuadBatch) {
    this.assets = assets;
    this.materials = materials;
    this.glow = glow;
    const anim = [...assets.sprite('fx_glow').anims.values()][0];
    if (anim) frameRect(anim, 0, 0, this.glowUv, 0);
  }

  get count(): number {
    return this.flying.size;
  }

  /** `hand`: for a thrown object, the model's hand at the moment of release (the drawing starts there). */
  spawn(e: ProjectileSpawnEvent, chunkScale: number, hand: THREE.Vector3 | null = null): void {
    let object: SceneRig | null = null;
    let prop: PropKindId | null = null;
    let grip: GripInfo | null = null;
    let mode: ThrownMode = 'tumble';
    let reach = 1;
    if (e.projectile === 'thrown') {
      const id = payloadModel(e.payload);
      const model = this.assets.model(id);
      object = new SceneRig(model, this.materials);
      if (id === 'held_chunk') object.root.scale.setScalar(chunkScale);
      if (e.payload?.kind === 'prop') {
        grip = gripFor(this.assets, e.payload.prop);
        if (grip) {
          prop = e.payload.prop;
          reach = Math.max(0.1, reachFromGrip(model.bounds, grip));
          mode = grip.hold === 'javelin' ? 'javelin' : prop === 'garagedoor' ? 'frisbee' : 'tumble';
        }
      }
      this.group.add(object.root);
    }
    this.flying.set(e.id, {
      id: e.id,
      type: e.projectile,
      x0: e.x,
      y0: e.y,
      z0: e.z,
      vx: e.vx,
      vy: e.vy,
      vz: e.vz,
      gravity: e.gravity,
      ax: e.ax ?? 0,
      ay: e.ay ?? 0,
      az: e.az ?? 0,
      steer: e.steer ?? 0,
      spawnTick: e.tick,
      ttl: e.ttl,
      volley: e.volley,
      object,
      prop,
      grip,
      mode,
      reach,
      spin: new THREE.Vector3((e.id % 5) - 2, (e.id % 3) - 1, (e.id % 7) - 3).multiplyScalar(0.9),
      trail: 0,
      ox: hand && e.projectile === 'thrown' ? hand.x - e.x : 0,
      oy: hand && e.projectile === 'thrown' ? hand.y - e.y : 0,
      oz: hand && e.projectile === 'thrown' ? hand.z - e.z : 0,
      x: e.x,
      y: e.y,
      z: e.z,
      dx: e.vx,
      dy: e.vy,
      dz: e.vz,
    });
  }

  /**
   * Ends a projectile. Returns the kind of city weapon it was when the kaiju threw one (it has
   * its own picture where it lands: the propane blast, the water splash, the javelin stuck in a
   * wall), else null.
   */
  hit(e: ProjectileHitEvent): PropKindId | null {
    const p = this.flying.get(e.id);
    if (!p) return null;
    this.flying.delete(e.id);
    const object = p.object;
    if (!object) return null;
    // A javelin stays where it stopped, its point buried; a garage door lies where it landed.
    if (p.mode === 'javelin' && p.grip && (e.target === 'structure' || e.target === 'ground')) {
      dirV.set(p.dx, p.dy, p.dz);
      const flat = Math.hypot(dirV.x, dirV.z);
      // Into the ground it goes in at a slant, so that it stands up out of it.
      if (e.target === 'ground') dirV.y = Math.min(dirV.y, -0.45 * flat);
      dirV.normalize();
      gripRotation(p.grip.tip, p.grip.side, dirV, UP, object.root.quaternion);
      offset.copy(p.grip.at).applyQuaternion(object.root.quaternion);
      const sink = p.reach * 0.7;
      object.root.position.set(e.x - dirV.x * sink - offset.x, e.y - dirV.y * sink - offset.y, e.z - dirV.z * sink - offset.z);
      this.stuck.push({ object, age: 0, life: 12, x: e.x, y: e.y, z: e.z });
      return p.prop;
    }
    if (p.mode === 'frisbee' && p.grip && e.target === 'ground') {
      dirV.set(0, 1, 0);
      hintV.set(Math.cos(p.id), 0, Math.sin(p.id));
      gripRotation(p.grip.tip, p.grip.side, dirV, hintV, object.root.quaternion);
      offset.copy(p.grip.at).applyQuaternion(object.root.quaternion);
      object.root.position.set(e.x - offset.x, 0.05 - offset.y + 0.15, e.z - offset.z);
      this.stuck.push({ object, age: 0, life: 8, x: e.x, y: 0, z: e.z });
      return p.prop;
    }
    object.dispose();
    return p.prop;
  }

  clear(): void {
    for (const p of this.flying.values()) p.object?.dispose();
    this.flying.clear();
    for (const s of this.stuck) s.object.dispose();
    this.stuck.length = 0;
    for (const rig of this.rigs.values()) {
      rig.begin();
      rig.end();
    }
  }

  private rig(modelId: string): InstancedRig {
    let rig = this.rigs.get(modelId);
    if (!rig) {
      rig = new InstancedRig(this.assets.model(modelId), this.materials, 96);
      this.rigs.set(modelId, rig);
      this.group.add(rig.group);
    }
    return rig;
  }

  /** `tick` is the fractional server tick being drawn. */
  update(tick: number, dt: number, effects: Effects, camera: THREE.Camera, lines?: LineBatch): void {
    for (const rig of this.rigs.values()) rig.begin();
    for (const p of this.flying.values()) {
      // A projectile has already flown one step at the end of the tick that spawned it.
      const t = Math.max(0, (tick - p.spawnTick + 1) * DT);
      if (t > p.ttl + 1) {
        p.object?.dispose();
        this.flying.delete(p.id);
        continue;
      }
      flightAt({ x: p.x0, y: p.y0, z: p.z0, vx: p.vx, vy: p.vy, vz: p.vz, gravity: p.gravity, ax: p.ax, ay: p.ay, az: p.az, steer: p.steer }, t, pos, vel);
      p.x = pos.x;
      p.z = pos.z;
      p.y = Math.max(0, pos.y);
      p.dx = vel.x;
      p.dy = vel.y;
      p.dz = vel.z;
      const yaw = Math.atan2(vel.x, vel.z);
      const pitch = -Math.atan2(vel.y, Math.hypot(vel.x, vel.z));
      if (p.object) {
        this.placeThrown(p, t);
        continue;
      }
      const modelId = MODELS[p.type];
      // Far away a shell is a dot of light; the model is drawn bigger than life so it reads.
      const dist = Math.hypot(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z);
      const scale = Math.max(MODEL_SIZE[p.type] ?? 1.5, Math.min(12, dist * 0.02));
      if (modelId) this.rig(modelId).add(p.x, p.y, p.z, yaw, scale, 0xffffff, pitch);
      const [r, g, b, size] = GLOW[p.type];
      const boost = p.volley ? 1.6 : 1;
      const glowSize = Math.max(size, dist * 0.03) * boost;
      this.glow.push(p.x, p.y, p.z, glowSize, glowSize, this.glowUv, 0, r, g, b, 0.95);
      if (lines && (p.type === 'tracer' || p.type === 'arty' || p.type === 'heavyShell')) this.streak(p, dist, lines);
      p.trail -= dt;
      const every = TRAIL_EVERY[p.type] ?? (p.volley ? 0.14 : 0);
      if (every > 0 && p.trail <= 0) {
        p.trail = every;
        if (p.type === 'arty') effects.puff(p.x, p.y, p.z, 4, 0xd8d0c8, 1.6, 0.55);
        else if (p.type === 'missile') effects.puff(p.x, p.y, p.z, 1.8, 0xf2eee6, 1.3, 0.6);
        else if (p.type === 'heavyShell') effects.puff(p.x, p.y, p.z, 2.2, 0xcfc8bc, 0.8, 0.45);
        else effects.puff(p.x, p.y, p.z, 1.2, 0xe8e2d6, 0.38, 0.4);
      }
    }
    for (const rig of this.rigs.values()) rig.end();
    this.updateStuck(dt);
  }

  /**
   * A streak of light behind a fast shot: a tracer's short bright dash, a big shell's glowing
   * wake, an artillery shell's long trail down the sky (the barrage can be seen falling).
   */
  private streak(p: Flying, dist: number, lines: LineBatch): void {
    const speed = Math.hypot(p.dx, p.dy, p.dz) || 1;
    const len = p.type === 'tracer' ? Math.min(14, speed * 0.07) : p.type === 'arty' ? 45 : 10;
    const k = len / speed;
    const width = (p.type === 'tracer' ? 0.22 : p.type === 'arty' ? 1.2 : 0.5) * Math.max(1, dist * 0.006);
    const [r, g, b] = p.type === 'tracer' ? [1, 0.93, 0.55] : p.type === 'arty' ? [1, 0.55, 0.25] : [1, 0.8, 0.45];
    lines.push(p.x - p.dx * k, p.y - p.dy * k, p.z - p.dz * k, p.x, p.y, p.z, width, r, g, b, p.type === 'tracer' ? 1 : 0.75);
  }

  /** A thrown object in flight: tumbling, or a city weapon the way it flies. */
  private placeThrown(p: Flying, t: number): void {
    const object = p.object as SceneRig;
    const blend = handBlend(t - DT);
    const x = p.x + p.ox * blend;
    const y = p.y + p.oy * blend;
    const z = p.z + p.oz * blend;
    const grip = p.grip;
    if (grip && p.mode === 'javelin') {
      // Point first along its flight (the grip on the path, the point ahead of it).
      dirV.set(p.dx, p.dy, p.dz);
      gripRotation(grip.tip, grip.side, dirV, UP, object.root.quaternion);
      offset.copy(grip.at).applyQuaternion(object.root.quaternion);
      object.root.position.set(x - offset.x, y - offset.y, z - offset.z);
      return;
    }
    if (grip && p.mode === 'frisbee') {
      // Flat, face up, spinning fast about the vertical.
      const spin = t * 14 + p.id;
      hintV.set(Math.cos(spin), 0, Math.sin(spin));
      gripRotation(grip.tip, grip.side, UP, hintV, object.root.quaternion);
      offset.copy(grip.at).applyQuaternion(object.root.quaternion);
      object.root.position.set(x - offset.x, y - offset.y, z - offset.z);
      return;
    }
    object.root.position.set(x, y, z);
    object.root.rotation.set(p.spin.x * t, p.spin.y * t, p.spin.z * t);
  }

  private updateStuck(dt: number): void {
    for (let i = 0; i < this.stuck.length; i++) {
      const s = this.stuck[i];
      s.age += dt;
      if (s.age >= s.life) {
        s.object.dispose();
        this.stuck[i] = this.stuck[this.stuck.length - 1];
        this.stuck.pop();
        i--;
        continue;
      }
      // The last second it sinks out of sight.
      const sink = Math.max(0, s.age - (s.life - 1));
      if (sink > 0) s.object.root.position.y -= dt * 3;
    }
  }
}
