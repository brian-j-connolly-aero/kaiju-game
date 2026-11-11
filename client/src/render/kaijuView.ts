/**
 * One kaiju on screen: the rig for its current stage, posed by the animator, with the cocoon,
 * the thing it holds, its weak point and its beam. The rig is whatever the AssetStore has for
 * `kaiju_<kind>_s<stage>`: the art file or the box stand-in, the same code drives both.
 */

import * as THREE from 'three';
import {
  angleDiff,
  beamPath,
  createBeamPath,
  kaijuKindDef,
  kaijuStageDef,
  perStage,
  type CityQuery,
  type HeldObject,
  type KaijuActionId,
  type KaijuPhase,
  type SnapKaiju,
} from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import type { Effects } from './effects';
import { computeKaijuPose, createKaijuPose, type NodePose } from './kaijuAnimator';
import type { LineBatch } from './lineBatch';
import type { Materials } from './materials';
import { SceneRig } from './sceneRig';

export interface KaijuOverride {
  /** A wind-up the local player just started that the server has not confirmed yet. */
  action: KaijuActionId;
  phase: KaijuPhase;
  phaseTime: number;
  phaseDuration: number;
}

export interface KaijuViewCallbacks {
  /** A foot came down. */
  onStep?: (k: SnapKaiju) => void;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const beam = createBeamPath();

function heldModelId(held: HeldObject): string {
  switch (held.kind) {
    case 'prop':
      return `prop_${held.prop}`;
    case 'vehicle':
      return 'army_tank';
    case 'wreck':
      return held.wreck === 'tank' ? 'army_tank_wreck' : 'prop_car_wreck';
    case 'chunk':
      return 'held_chunk';
  }
}

export class KaijuView {
  readonly group = new THREE.Group();
  private readonly assets: AssetStore;
  private readonly materials: Materials;
  private readonly callbacks: KaijuViewCallbacks;
  private rig: SceneRig | null = null;
  private rigKey = '';
  private cocoon: SceneRig | null = null;
  private held: SceneRig | null = null;
  private heldKey = '';
  private readonly pose = createKaijuPose();
  private readonly current = new Map<string, NodePose>();
  private hipsLift = 0;
  private walkPhase = 0;
  private lastStepHalf = 0;
  private deadTime = 0;
  /** World position of the first-person camera anchor, valid after update(). */
  readonly camAnchor = new THREE.Vector3();
  /** World position of the mouth, valid after update(). */
  readonly mouth = new THREE.Vector3();
  hasCamAnchor = false;

  constructor(assets: AssetStore, materials: Materials, callbacks: KaijuViewCallbacks = {}) {
    this.assets = assets;
    this.materials = materials;
    this.callbacks = callbacks;
    for (const name of this.pose.rotations.keys()) this.current.set(name, { x: 0, y: 0, z: 0 });
  }

  private ensureRig(k: SnapKaiju): SceneRig {
    const key = `kaiju_${k.kind}_s${k.stage}`;
    if (!this.rig || this.rigKey !== key) {
      this.rig?.dispose();
      this.rig = new SceneRig(this.assets.model(key), this.materials);
      this.rigKey = key;
      this.group.add(this.rig.root);
      this.dropHeld();
    }
    return this.rig;
  }

  private dropHeld(): void {
    this.held?.dispose();
    this.held = null;
    this.heldKey = '';
  }

  private updateHeld(k: SnapKaiju, rig: SceneRig): void {
    const held = k.held;
    const key = held ? heldModelId(held) : '';
    if (key !== this.heldKey) {
      this.dropHeld();
      const hold = rig.node('hold');
      if (held && hold) {
        const model = this.assets.model(key);
        this.held = new SceneRig(model, this.materials);
        this.heldKey = key;
        // Carried by its middle, tilted as if pinched between claws.
        const size = model.bounds.getSize(tmp);
        const scale = key === 'held_chunk' ? kaijuStageDef(k.kind, k.stage).bodyRadius * 0.9 : 1;
        this.held.root.scale.setScalar(scale);
        this.held.root.position.set(0, -size.y * 0.5 * scale, 0);
        this.held.root.rotation.set(0.5, 0.4, 0.2);
        hold.add(this.held.root);
      }
    }
  }

  /**
   * Places and poses the kaiju for this frame. `local` marks the kaiju the player controls
   * (its feet raise dust but it is otherwise drawn the same, snout and claws included).
   */
  update(k: SnapKaiju, dt: number, time: number, override: KaijuOverride | null, city: CityQuery | null, lines: LineBatch, effects: Effects): void {
    const rig = this.ensureRig(k);
    const stage = kaijuStageDef(k.kind, k.stage);
    const def = kaijuKindDef(k.kind);
    this.group.position.set(k.x, 0, k.z);
    this.group.rotation.set(0, k.yaw, 0);
    this.group.visible = true;

    const phase = override ? override.phase : k.phase;
    const action = override ? override.action : k.action;
    const phaseTime = override ? override.phaseTime : k.phaseTime;
    const phaseDuration = override ? override.phaseDuration : k.phaseDuration;

    // --- cocoon --------------------------------------------------------------------------------
    const cocooned = phase === 'cocoon';
    if (cocooned && !this.cocoon) {
      this.cocoon = new SceneRig(this.assets.model('kaiju_cocoon'), this.materials);
      this.group.add(this.cocoon.root);
    }
    if (this.cocoon) {
      this.cocoon.root.visible = cocooned;
      if (cocooned) {
        // The cocoon is authored 1 m tall; it swells and trembles as the molt nears its end.
        const near = phaseDuration > 0 ? Math.min(1, phaseTime / phaseDuration) : 0;
        const pulse = 1 + Math.sin(time * (4 + near * 14)) * (0.02 + near * 0.05);
        this.cocoon.root.scale.set(stage.height * 0.95 * pulse, stage.height * 0.9 / pulse, stage.height * 0.95 * pulse);
      }
    }
    rig.root.visible = !cocooned;

    // --- walk cycle ------------------------------------------------------------------------------
    const speed = Math.hypot(k.vx, k.vz);
    const stride = stage.height * 0.9;
    this.walkPhase += (speed * dt * Math.PI * 2) / Math.max(0.1, stride * 2);
    const half = Math.floor(this.walkPhase / Math.PI);
    if (half !== this.lastStepHalf) {
      this.lastStepHalf = half;
      if (speed > stage.topSpeed * 0.15 && !cocooned) {
        this.callbacks.onStep?.(k);
        // The foot that just landed kicks up dust beside the body.
        const side = half % 2 === 0 ? 1 : -1;
        const fx = k.x + Math.cos(k.yaw) * side * stage.bodyRadius * 0.45;
        const fz = k.z - Math.sin(k.yaw) * side * stage.bodyRadius * 0.45;
        effects.dust(fx, 0.1, fz, stage.bodyRadius * 0.45, k.stage === 1 ? 2 : 4);
      }
    }

    // --- pose --------------------------------------------------------------------------------------
    computeKaijuPose(
      {
        time,
        walkPhase: this.walkPhase,
        speed: speed / Math.max(0.1, stage.topSpeed),
        headYaw: angleDiff(k.aimYaw, k.yaw),
        headPitch: k.aimPitch,
        action,
        phase,
        phaseTime,
        phaseDuration,
        holding: k.held !== null,
        height: stage.height,
      },
      this.pose,
    );
    const blend = 1 - Math.exp(-this.pose.stiffness * dt);
    for (const [name, target] of this.pose.rotations) {
      const c = this.current.get(name) as NodePose;
      c.x += (target.x - c.x) * blend;
      c.y += (target.y - c.y) * blend;
      c.z += (target.z - c.z) * blend;
      rig.setRotation(name, c.x, c.y, c.z);
    }
    this.hipsLift += (this.pose.hipsLift - this.hipsLift) * blend;
    rig.setOffset('hips', 0, this.hipsLift, 0);

    // Dead: topple over and sink a little.
    if (phase === 'dead') {
      this.deadTime = Math.min(1, this.deadTime + dt / 1.6);
      const fall = this.deadTime * this.deadTime;
      rig.root.rotation.set(fall * 1.45, 0, fall * 0.2);
      rig.root.position.set(0, -fall * stage.height * 0.04, fall * stage.height * 0.25);
    } else {
      this.deadTime = 0;
      rig.root.rotation.set(0, 0, 0);
      rig.root.position.set(0, 0, 0);
    }

    // The weak point shows, and throbs, only while staggered (or helpless in the cocoon's stead).
    const weak = rig.node('weak_point');
    if (weak) {
      weak.visible = phase === 'stagger';
      if (weak.visible) weak.scale.setScalar(1.2 + Math.sin(time * 9) * 0.25);
    }

    this.updateHeld(k, rig);

    // --- anchors ---------------------------------------------------------------------------------
    this.group.updateMatrixWorld(true);
    this.hasCamAnchor = rig.worldPosition('cam_fp', this.camAnchor);
    if (!this.hasCamAnchor) this.camAnchor.set(k.x, stage.eyeHeight, k.z);
    if (!rig.worldPosition('mouth', this.mouth)) this.mouth.set(k.x, stage.mouthHeight, k.z);

    // --- beam --------------------------------------------------------------------------------------
    const special = def.actions.special;
    if (action === 'special' && phase === 'windup') {
      // The breath gathers at the mouth.
      const charge = phaseDuration > 0 ? Math.min(1, phaseTime / phaseDuration) : 1;
      effects.flash(this.mouth.x, this.mouth.y, this.mouth.z, stage.bodyRadius * (0.4 + charge * 1.1), 0xffa040, 0.05);
    }
    if (k.action === 'special' && k.phase === special.activePhase && city) {
      beamPath(city, k, special, beam);
      const width = perStage(special.width, k.stage);
      // Drawn from the model's mouth so it leaves the jaws, ending where the rules say it ends.
      tmp.set(this.mouth.x, this.mouth.y, this.mouth.z);
      tmp2.set(beam.ex, Math.max(0.2, beam.ey), beam.ez);
      const flicker = 0.85 + Math.sin(time * 70) * 0.15;
      lines.push(tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.y, tmp2.z, width * 3.2, 1.0, 0.45, 0.1, 0.7 * flicker);
      lines.push(tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.y, tmp2.z, width * 1.3, 1.0, 0.95, 0.75, 1.0);
      effects.flash(tmp2.x, tmp2.y, tmp2.z, width * (4 + Math.sin(time * 50)), 0xffb060, 0.06);
      if (Math.floor(time * 30) % 2 === 0) effects.dust(tmp2.x, tmp2.y, tmp2.z, width * 1.5, 1, 0x554a44);
    }
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.rig?.dispose();
    this.cocoon?.dispose();
    this.dropHeld();
    this.group.removeFromParent();
  }
}
