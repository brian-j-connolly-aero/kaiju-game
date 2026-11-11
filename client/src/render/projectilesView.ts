/**
 * Projectiles are not in snapshots: each one is spawned here from a `projectileSpawn` event and
 * flown locally along the same parabola the server uses (ARCHITECTURE.md section 3), until its
 * `projectileHit` arrives. They are drawn big and glowing so both sides can read and dodge them.
 */

import * as THREE from 'three';
import { DT, type HeldObject, type ProjectileHitEvent, type ProjectileSpawnEvent, type ProjectileTypeId } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { frameRect } from '../assets/spriteAtlas';
import type { Effects } from './effects';
import { InstancedRig } from './instancedRig';
import type { Materials } from './materials';
import type { QuadBatch } from './quadBatch';
import { SceneRig } from './sceneRig';

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
  spawnTick: number;
  ttl: number;
  volley: boolean;
  /** Thrown objects: the model that tumbles through the air. */
  object: SceneRig | null;
  spin: THREE.Vector3;
  trail: number;
  x: number;
  y: number;
  z: number;
}

const MODELS: Partial<Record<ProjectileTypeId, string>> = { rocket: 'proj_rocket', shell: 'proj_shell', arty: 'proj_arty' };
const GLOW: Record<ProjectileTypeId, [number, number, number, number]> = {
  // r, g, b, size in meters
  rocket: [1, 0.55, 0.15, 4],
  shell: [1, 0.85, 0.4, 5],
  arty: [1, 0.7, 0.3, 9],
  thrown: [0, 0, 0, 0],
};

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

export class ProjectilesView {
  readonly group = new THREE.Group();
  private readonly assets: AssetStore;
  private readonly materials: Materials;
  private readonly glow: QuadBatch;
  private readonly flying = new Map<number, Flying>();
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

  spawn(e: ProjectileSpawnEvent, chunkScale: number): void {
    let object: SceneRig | null = null;
    if (e.projectile === 'thrown') {
      const id = payloadModel(e.payload);
      object = new SceneRig(this.assets.model(id), this.materials);
      if (id === 'held_chunk') object.root.scale.setScalar(chunkScale);
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
      spawnTick: e.tick,
      ttl: e.ttl,
      volley: e.volley,
      object,
      spin: new THREE.Vector3((e.id % 5) - 2, (e.id % 3) - 1, (e.id % 7) - 3).multiplyScalar(0.9),
      trail: 0,
      x: e.x,
      y: e.y,
      z: e.z,
    });
  }

  /** Ends a projectile; returns where it was last drawn (or null if it was unknown). */
  hit(e: ProjectileHitEvent): boolean {
    const p = this.flying.get(e.id);
    if (!p) return false;
    p.object?.dispose();
    this.flying.delete(e.id);
    return true;
  }

  clear(): void {
    for (const p of this.flying.values()) p.object?.dispose();
    this.flying.clear();
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
  update(tick: number, dt: number, effects: Effects, camera: THREE.Camera): void {
    for (const rig of this.rigs.values()) rig.begin();
    for (const p of this.flying.values()) {
      // A projectile has already flown one step at the end of the tick that spawned it.
      const t = Math.max(0, (tick - p.spawnTick + 1) * DT);
      if (t > p.ttl + 1) {
        p.object?.dispose();
        this.flying.delete(p.id);
        continue;
      }
      p.x = p.x0 + p.vx * t;
      p.z = p.z0 + p.vz * t;
      p.y = Math.max(0, p.y0 + p.vy * t - 0.5 * p.gravity * t * t);
      const vy = p.vy - p.gravity * t;
      const yaw = Math.atan2(p.vx, p.vz);
      const pitch = -Math.atan2(vy, Math.hypot(p.vx, p.vz));
      if (p.object) {
        p.object.root.position.set(p.x, p.y, p.z);
        p.object.root.rotation.set(p.spin.x * t, p.spin.y * t, p.spin.z * t);
        continue;
      }
      const modelId = MODELS[p.type];
      // Far away a shell is a dot of light; the model is drawn bigger than life so it reads.
      const dist = Math.hypot(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z);
      const scale = Math.max(1.5, Math.min(12, dist * 0.02));
      if (modelId) this.rig(modelId).add(p.x, p.y, p.z, yaw, scale, 0xffffff, pitch);
      const [r, g, b, size] = GLOW[p.type];
      const boost = p.volley ? 1.6 : 1;
      const glowSize = Math.max(size, dist * 0.03) * boost;
      this.glow.push(p.x, p.y, p.z, glowSize, glowSize, this.glowUv, 0, r, g, b, 0.95);
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = p.type === 'rocket' ? 0.09 : 0.14;
        if (p.type !== 'shell' || p.volley) effects.puff(p.x, p.y, p.z, p.type === 'arty' ? 2.5 : 1.2, 0xe8e2d6, 0.38, 0.4);
      }
    }
    for (const rig of this.rigs.values()) rig.end();
  }
}
