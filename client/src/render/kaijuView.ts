/**
 * One kaiju on screen: the rig for its current stage, posed by the animator, with the cocoon,
 * the thing it holds, its weak point and its beam. The rig is whatever the AssetStore has for
 * `kaiju_<kind>_s<stage>`: the art file or the box stand-in, the same code drives both.
 */

import * as THREE from 'three';
import {
  angleDiff,
  clamp01,
  COMBAT_RULES,
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
import { computeKaijuPose, createKaijuPose, posesFromManifest, type NodePose, type PoseTable } from './kaijuAnimator';
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
const quat = new THREE.Quaternion();
const aimQuat = new THREE.Quaternion();
const aimEuler = new THREE.Euler();
const sphere = new THREE.Sphere();
const beam = createBeamPath();

/** Options of one frame of a kaiju view. */
export interface KaijuViewFrame {
  /** This is the local player's kaiju and the camera is in its head. */
  firstPerson: boolean;
  /** The camera has been pulled back inside the skull (a wall ahead): hide the arms and jaw. */
  insideHead: boolean;
}

const NOT_LOCAL: KaijuViewFrame = { firstPerson: false, insideHead: false };

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
  /** The rig's pose targets from the manifest (null: the stand-in's fallback). */
  private poses: PoseTable | null = null;
  /** The arms ride on the head (first-person view). */
  private armsOnHead = false;
  /** Own copies of the glow material: the embers and eyes, and the cocoon's light. */
  private ember: THREE.MeshBasicMaterial | null = null;
  private cocoonLight: THREE.MeshBasicMaterial | null = null;
  private heldScale = 1;
  private heldRadius = 1;
  private heldHeight = 0;
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
      this.rig = new SceneRig(this.assets.model(key), this.materials, this.materials.kaiju);
      this.rigKey = key;
      this.armsOnHead = false;
      this.poses = this.assets.hasModel(key) ? posesFromManifest(this.assets.manifest.models[key]?.poses) : null;
      this.group.add(this.rig.root);
      this.dropHeld();
      // The glowing facets outside the weak point (eyes, the embers at the roots of the spines
      // and tail spikes) get their own material, so they can heat up with rage and the beam.
      this.ember ??= this.materials.glow.clone();
      for (const node of ['head', 'spines', 'tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5']) this.rig.setNodeMaterial(node, 'glow', this.ember);
    }
    return this.rig;
  }

  private dropHeld(): void {
    this.held?.dispose();
    this.held = null;
    this.heldKey = '';
  }

  private updateHeld(k: SnapKaiju, rig: SceneRig, firstPerson: boolean): void {
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
        this.heldScale = key === 'held_chunk' ? kaijuStageDef(k.kind, k.stage).bodyRadius * 0.9 : 1;
        this.heldRadius = Math.max(0.01, model.bounds.getBoundingSphere(sphere).radius * this.heldScale);
        this.heldHeight = size.y * this.heldScale;
        this.held.root.rotation.set(0.5, 0.4, 0.2);
        hold.add(this.held.root);
      }
    }
    if (this.held) {
      // Seen from inside the head the held thing would fill the view and reach into the lens:
      // there it is shrunk to at most 0.16 body heights across (art notes, section 6). Everyone
      // else sees it at its true size.
      const fp = firstPerson ? Math.min(1, (0.16 * kaijuStageDef(k.kind, k.stage).height) / this.heldRadius) : 1;
      const scale = this.heldScale * fp;
      this.held.root.scale.setScalar(scale);
      this.held.root.position.set(0, -this.heldHeight * 0.5 * fp, 0);
    }
  }

  /**
   * Places and poses the kaiju for this frame. `view.firstPerson` marks the local player's kaiju
   * seen from inside its head: then head, snout and claws are one rigid assembly locked to the
   * aim, like the weapon in a first-person game (docs/art/client-notes-kaiju-lizard.md section 3).
   */
  update(
    k: SnapKaiju,
    dt: number,
    time: number,
    override: KaijuOverride | null,
    city: CityQuery | null,
    lines: LineBatch,
    effects: Effects,
    view: KaijuViewFrame = NOT_LOCAL,
  ): void {
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
        // The light inside beats with the swelling (and the heartbeat), faster near the end.
        if (!this.cocoonLight) {
          this.cocoonLight = this.materials.glow.clone();
          this.cocoon.setNodeMaterial('cocoon_glow', 'glow', this.cocoonLight);
        }
        const beat = Math.pow(0.5 + 0.5 * Math.sin(time * (4 + near * 14)), 3);
        this.cocoonLight.color.setScalar(0.75 + beat * 0.9);
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
    const assembly = view.firstPerson && phase !== 'dead' && phase !== 'cocoon';
    if (assembly !== this.armsOnHead) {
      this.armsOnHead = assembly;
      rig.ride('arm_L', assembly ? 'head' : null);
      rig.ride('arm_R', assembly ? 'head' : null);
    }
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
        poses: this.poses ?? undefined,
        firstPerson: assembly,
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

    // The weak point shows, and throbs, only while staggered. The throb never shrinks it below
    // 1.1: the shards at the shoulder blades only show above about 0.95 (art notes, section 5).
    const weak = rig.node('weak_point');
    if (weak) {
      weak.visible = phase === 'stagger';
      if (weak.visible) weak.scale.setScalar(1.3 + Math.sin(time * 9) * 0.2);
    }

    // The embers and eyes heat up with rage and while the beam gathers and burns.
    if (this.ember) {
      const rage = clamp01(k.rage / COMBAT_RULES.rageMax);
      const beamHeat = action === 'special' ? (phase === 'windup' ? clamp01(phaseTime / Math.max(0.01, phaseDuration)) : phase === 'recover' ? 0.5 : 1) : 0;
      const heat = Math.max(rage, beamHeat);
      const flicker = 1 + Math.sin(time * 7.3) * 0.06 * heat;
      this.ember.color.setScalar((0.8 + heat * 0.8) * flicker);
    }

    // Seen from inside the head: lock the head to the aim (it carries the camera anchor, the
    // snout and, riding on it, the arms), so the claws keep their place whatever the body does.
    if (assembly) {
      const neck = rig.node('neck');
      const head = rig.node('head');
      if (neck && head) {
        this.group.updateMatrixWorld(true);
        neck.getWorldQuaternion(quat).invert();
        aimQuat.setFromEuler(aimEuler.set(-k.aimPitch, k.aimYaw, 0, 'YXZ'));
        head.quaternion.copy(quat).multiply(aimQuat);
      }
    }
    // With the camera pulled back into the skull the claws would be seen from behind.
    const hideLimbs = assembly && view.insideHead;
    rig.setVisible('arm_L', !hideLimbs);
    rig.setVisible('arm_R', !hideLimbs);
    rig.setVisible('jaw', !hideLimbs);

    this.updateHeld(k, rig, assembly);

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
      effects.glowAt(this.mouth.x, this.mouth.y, this.mouth.z, stage.bodyRadius * (0.4 + charge * 1.1) * 1.6, 0xffa040, 0.05);
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
      effects.glowAt(tmp2.x, tmp2.y, tmp2.z, width * (4 + Math.sin(time * 50)) * 1.6, 0xffb060, 0.06);
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
