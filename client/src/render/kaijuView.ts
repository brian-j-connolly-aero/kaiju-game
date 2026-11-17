/**
 * One kaiju on screen: the rig for its current stage, posed by the animator, with the cocoon,
 * the thing it holds (a city weapon by its grip: render/kaijuWeapons.ts), its weak point, its
 * beam and its power surge. The rig is whatever the AssetStore has for `kaiju_<kind>_s<stage>`:
 * the art file or the box stand-in, the same code drives both.
 *
 * Phase 3 (docs/ROADMAP.md, "looks"): the look of each attack (`attackVariant` of the tick it
 * began, so every screen shows the same one), slash trails from the claw tips and the tail tip
 * through a strike and a short shock ring where a stomping foot lands (render/kaijuTrails.ts),
 * stripes that glow with rage (the models mark them; this view's own body material, its
 * `KaijuSkin`, lights them), and a handful of civilians lifted to the mouth (render/crowd.ts
 * holds them; this view poses the arm and says when they are gulped).
 *
 * Round 4 (docs/ROADMAP.md, "the titan wading"): a kaiju too big to swim (the titan) that stands
 * in the bay, the river or the moat (the snapshot's `inWater`) is drawn sunk to its thighs, the
 * opaque water hiding its legs, with a ring of foam lapping round it, a splash at each step and a
 * wake behind it while it walks. Its own player's first-person view is left as it is (the claws
 * keep their place before the eye).
 */

import * as THREE from 'three';
import {
  angleDiff,
  clamp01,
  COMBAT_RULES,
  beamPath,
  createBeamPath,
  DT,
  kaijuKindDef,
  kaijuStageDef,
  perStage,
  type CityQuery,
  type HeldObject,
  type KaijuActionEvent,
  type KaijuActionId,
  type KaijuPhase,
  type SnapKaiju,
} from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import type { Effects } from './effects';
import { HeldWeapon, SurgeArcs } from './kaijuWeapons';
import {
  ATTACK_VARIANTS,
  attackVariant,
  computeKaijuPose,
  createKaijuPose,
  posesFromManifest,
  SNACK_GULP,
  SNACK_TIME,
  type KaijuAnimInput,
  type KaijuPose,
  type NodePose,
  type PoseTable,
} from './kaijuAnimator';
import { addTrailPoint, clearTrail, createTrailPath, stompShock, type TrailPath, type TrailRibbons } from './kaijuTrails';
import type { LineBatch } from './lineBatch';
import type { KaijuSkin, Materials } from './materials';
import { SceneRig } from './sceneRig';

export interface KaijuOverride {
  /** A wind-up the local player just started that the server has not confirmed yet. */
  action: KaijuActionId;
  phase: KaijuPhase;
  phaseTime: number;
  phaseDuration: number;
}

export interface KaijuViewCallbacks {
  /** A foot came down, at (x, z) on the ground. */
  onStep?: (k: SnapKaiju, x: number, z: number) => void;
  /** It went into the water to swim, or came up out of it (sim/swim.ts). */
  onSplash?: (k: SnapKaiju) => void;
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
  /** Where the camera is (for the weak point's halo, drawn on the side facing it). */
  camera?: THREE.Vector3;
  /**
   * The (fractional) server tick the frame shows (`FrameState.tick`): with the snapshot's phase
   * time it says the tick the phase began, which picks the attack's look.
   */
  tick?: number;
  /**
   * First person: where the player's view looks. The head (which carries the camera) follows it
   * rather than the aim sent, which for a lob points far above the view (round 5: the camera
   * ended up inside the monster's own head).
   */
  look?: { yaw: number; pitch: number };
}

const NOT_LOCAL: KaijuViewFrame = { firstPerson: false, insideHead: false };
/** The weak point's violet (art notes for the kaiju, section 5). */
const WEAK_GLOW = 0xc9a6ff;
/**
 * Swimming: how far the body tips forward (radians), and how far it sinks and slides back
 * (body heights), all the way under. Tuned by eye so the spines' ridge shows (sim/swim.ts).
 */
const SWIM_TILT = 0.35;
const SWIM_SINK = 0.72;
const SWIM_BACK = 0.1;
/**
 * Wading in deep water (a kaiju too big to swim): how deep it stands, as a share of its hips'
 * height at rest (the water about two thirds of the way up its thighs), and how fast it eases
 * in and out (per second).
 */
const WADE_DEPTH = 0.62;
const WADE_EASE = 1.6;

/**
 * The stripes' glow (linear colors, times the brightness): a deep ember red when rage is low,
 * hot orange as it fills; a white-hot flare as the new body comes out of the cocoon.
 */
const STRIPE_LOW = { r: 1, g: 0.13, b: 0.02 };
const STRIPE_HIGH = { r: 1, g: 0.36, b: 0.06 };
const STRIPE_FLARE = { r: 1, g: 0.85, b: 0.6 };
/** Brightness of the stripes: at no rage, at full rage, the pulse of a special that is ready (low to high), the beam. */
const STRIPE_IDLE = 0.12;
const STRIPE_FULL = 0.75;
const STRIPE_READY = [0.7, 1.25] as const;
const STRIPE_BEAM = 1.5;
/** The ready pulse: about one slow throb every 2.6 seconds. */
const READY_PULSE = 2.4;
/** Seen from inside its own head the stripes on the snout and claws glow this much less. */
const STRIPE_FIRST_PERSON = 0.45;
/** How long the molt's flare takes to die down (seconds). */
const FLARE_TIME = 2.4;
/** Points along a slash trail. */
const TRAIL_POINTS = 10;
/**
 * A trail is the band between a tip's path and a point part of the way in from it to its node's
 * pivot: here the pivot itself, so a claw slash is the band the whole hand sweeps, from the wrist
 * to the claw tips, and the tail's the band its last joint sweeps.
 */
const CLAW_INNER = 0;
const TAIL_INNER = 0;
/** The width of the glowing edge along the tip (body heights). */
const TRAIL_EDGE = 0.03;
/** The follow-through: a trail fades out over this share of the recovery. */
const TRAIL_FADE = 0.45;
/** Seen from inside its own head: the trail starts this far into the strike (the claw is above the view before) and is fainter. */
const TRAIL_FP_FROM = 0.3;
const TRAIL_FP_FADE = 0.5;

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

/** Ticks a phase of `seconds` lasts in the simulation (it ends on the tick its time reaches its length). */
function phaseTicks(seconds: number): number {
  return seconds > 0 ? Math.ceil(seconds / DT - 1e-6) : 0;
}

export class KaijuView {
  readonly group = new THREE.Group();
  private readonly assets: AssetStore;
  private readonly materials: Materials;
  private readonly callbacks: KaijuViewCallbacks;
  /** This view's own body material: its stripes glow with this kaiju's rage. */
  private readonly skin: KaijuSkin;
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
  /** A city weapon in the hand, held by its grip (phase 2). */
  private readonly weapon: HeldWeapon;
  private readonly surge: SurgeArcs;
  private readonly pose = createKaijuPose();
  /** A pose the trails sample the strike with (the drawn one is `current`). */
  private readonly sample = createKaijuPose();
  private readonly current = new Map<string, NodePose>();
  private hipsLift = 0;
  /** Swimming, as drawn: eased toward the snapshot's `submerge` so it glides down and up. */
  private swim = 0;
  private wakeTimer = 0;
  /** Standing in deep water, as drawn (0 on land, 1 sunk to its thighs: a kaiju too big to swim). */
  private wade = 0;
  private foamTimer = 0;
  /** Where round the legs the next churn of white water goes (turned by the golden angle each time). */
  private foamTurn = 0;
  /** The hips' height at rest (the model's frame): how deep a wading kaiju stands. */
  private hipsHeight = 0;
  /** Seconds to the next puff of the charge's dust. */
  private dustTimer = 0;
  private walkPhase = 0;
  private lastStepHalf = 0;
  private deadTime = 0;
  /** The look of the attack being drawn: which action, the tick its first phase began, and the look. */
  private look = { action: 'none' as KaijuActionId, start: Number.NaN, variant: 0 };
  /** The look of the charge's stumble, by the tick the stumble began. */
  private stumble = { start: Number.NaN, variant: 0 };
  /** The look drawn on the last frame (null: not known yet). */
  private lookNow: number | null = 0;
  /** The molt's flare on the stripes: 1 as the new body comes out, dying down. */
  private flare = 0;
  /** Seconds since the hand closed on a handful of civilians (null: none in the hand). */
  private snackTime: number | null = null;
  /** The claw tips and the tail tip, each in its own node's frame. */
  private readonly tips = new Map<string, THREE.Vector3>();
  /** The feet where they stand at rest, in the model's frame (where a stomp lands). */
  private readonly feet = new Map<string, THREE.Vector3>();
  private readonly input: KaijuAnimInput = {
    time: 0,
    walkPhase: 0,
    speed: 0,
    headYaw: 0,
    headPitch: 0,
    action: 'none',
    phase: 'idle',
    phaseTime: 0,
    phaseDuration: 0,
    holding: false,
    height: 1,
  };
  /** The tip and inner paths of up to two slash trails (both claws in the rake). */
  private readonly tipPaths: TrailPath[] = [createTrailPath(), createTrailPath()];
  private readonly innerPaths: TrailPath[] = [createTrailPath(), createTrailPath()];
  /** Where every slash trail of the frame is drawn (the renderer's; none: no trails). */
  private readonly ribbons: TrailRibbons | null;
  /** World position of the first-person camera anchor, valid after update(). */
  readonly camAnchor = new THREE.Vector3();
  /** World position of the mouth, valid after update(). */
  readonly mouth = new THREE.Vector3();
  hasCamAnchor = false;
  /** World position of the `hold` anchor (the hand, where a held thing sits), valid after update() when `hasHand`. */
  readonly hand = new THREE.Vector3();
  hasHand = false;
  /** Seen from inside its own head on the last frame (anything in the hand is shrunk to fit). */
  firstPerson = false;
  /** First person: the view the head follows this frame (`KaijuViewFrame.look`). */
  private headLook: { yaw: number; pitch: number } | undefined = undefined;

  constructor(assets: AssetStore, materials: Materials, callbacks: KaijuViewCallbacks = {}, ribbons: TrailRibbons | null = null) {
    this.assets = assets;
    this.materials = materials;
    this.callbacks = callbacks;
    this.ribbons = ribbons;
    this.skin = materials.kaijuSkin();
    this.weapon = new HeldWeapon(assets, materials);
    this.surge = new SurgeArcs();
    for (const name of this.pose.rotations.keys()) this.current.set(name, { x: 0, y: 0, z: 0 });
  }

  /** The city weapon in the hand, or null (for effects: where a sign breaks, a door is hit). */
  get weaponKind(): string | null {
    return this.weapon.kind;
  }

  /** The far end of the city weapon in the hand (the sign's head), valid after update(). */
  get weaponEnd(): THREE.Vector3 {
    return this.weapon.end;
  }

  /** The look of the attack drawn on the last frame (`attackVariant`; null while not known). */
  get attackLook(): number | null {
    return this.lookNow;
  }

  /** Seconds since the hand closed on a handful of civilians, or null (render/crowd.ts). */
  get snack(): number | null {
    return this.snackTime;
  }

  /** The hand closed on a handful of civilians: it lifts them to the mouth and gulps them down. */
  startSnack(): void {
    this.snackTime = 0;
  }

  /** A shot hit the garage door in the hand: it jolts. */
  shieldHit(damage: number): void {
    this.weapon.hit(damage);
  }

  private ensureRig(k: SnapKaiju): SceneRig {
    const key = `kaiju_${k.kind}_s${k.stage}`;
    if (!this.rig || this.rigKey !== key) {
      // Grown into its next body: the stripes flare as it comes out of the cocoon.
      if (this.rig && this.rigKey.startsWith(`kaiju_${k.kind}_s`) && Number(this.rigKey.slice(-1)) < k.stage) this.flare = 1;
      this.rig?.dispose();
      this.rig = new SceneRig(this.assets.model(key), this.materials, this.skin.material);
      this.rigKey = key;
      this.armsOnHead = false;
      this.poses = this.assets.hasModel(key) ? posesFromManifest(this.assets.manifest.models[key]?.poses) : null;
      this.group.add(this.rig.root);
      this.dropHeld();
      this.surge.reset();
      // The glowing facets outside the weak point (eyes, the embers at the roots of the spines
      // and tail spikes) get their own material, so they can heat up with rage and the beam.
      this.ember ??= this.materials.glow.clone();
      for (const node of ['head', 'spines', 'tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5']) this.rig.setNodeMaterial(node, 'glow', this.ember);
      this.findTips(this.rig);
    }
    return this.rig;
  }

  /** The claw tips and the tail tip (the farthest point of each from its pivot), and the feet at rest. */
  private findTips(rig: SceneRig): void {
    this.tips.clear();
    this.feet.clear();
    this.hipsHeight = 0;
    const nodes = rig.model.nodes;
    nodes.forEach((node, i) => {
      if (node.name === 'hand_L' || node.name === 'hand_R' || node.name === 'tail_5') {
        let best = -1;
        const tip = new THREE.Vector3();
        for (const part of node.parts) {
          const pos = part.geometry.getAttribute('position');
          if (!pos) continue;
          for (let j = 0; j < pos.count; j++) {
            const d = pos.getX(j) ** 2 + pos.getY(j) ** 2 + pos.getZ(j) ** 2;
            if (d > best) {
              best = d;
              tip.set(pos.getX(j), pos.getY(j), pos.getZ(j));
            }
          }
        }
        if (best > 0) this.tips.set(node.name, tip);
      }
      if (node.name === 'foot_L' || node.name === 'foot_R') {
        const at = new THREE.Vector3();
        for (let j = i; j >= 0; j = nodes[j].parent) at.add(nodes[j].position);
        this.feet.set(node.name, at.setY(0));
      }
      if (node.name === 'hips') {
        let y = 0;
        for (let j = i; j >= 0; j = nodes[j].parent) y += nodes[j].position.y;
        this.hipsHeight = y;
      }
    });
  }

  private dropHeld(): void {
    this.held?.dispose();
    this.held = null;
    this.heldKey = '';
    this.weapon.set(null, null);
  }

  private updateHeld(k: SnapKaiju, rig: SceneRig, firstPerson: boolean): void {
    const held = k.held;
    const key = held ? heldModelId(held) : '';
    if (key !== this.heldKey) {
      this.dropHeld();
      const hold = rig.node('hold');
      if (held && hold && held.kind === 'prop' && this.weapon.handles(held.prop)) {
        // A city weapon: held by its grip and turned the way it is used (kaijuWeapons.ts).
        this.weapon.set(held.prop, hold);
        this.heldKey = key;
      } else if (held && hold) {
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
   * The look of the attack being drawn (render/kaijuAnimator.ts `attackVariant`), or null while
   * it is not known: the local player's own press shown before the server's phase has reached
   * the view. Every screen works it out alike from the snapshot: its tick less its phase time is
   * the tick the phase began (exactly the tick of the phase's `kaijuAction` event); an attack's
   * look is kept from its first phase on.
   */
  private lookFor(k: SnapKaiju, action: KaijuActionId, phase: KaijuPhase, tick: number | undefined): number | null {
    if (!ATTACK_VARIANTS[action]) return 0;
    if (k.action !== action || k.phase === 'idle' || k.phase !== phase) {
      // Shown ahead of the server, or the frame between two phases: the look kept, if any.
      return this.look.action === action && k.action === action ? this.look.variant : null;
    }
    const timing = kaijuKindDef(k.kind).actions[action as Exclude<KaijuActionId, 'none'>]?.timing;
    if (!timing) return 0;
    if (tick === undefined || !(k.phaseTime > 0)) {
      // The very first frame of a phase (its start lies between two snapshots): a new attack's
      // look is not known yet; a later phase of the same attack keeps its look.
      const first = phase === 'stumble' || phase === (timing.windup > 0 ? 'windup' : kaijuKindDef(k.kind).actions[action as Exclude<KaijuActionId, 'none'>].activePhase);
      return !first && this.look.action === action ? this.look.variant : null;
    }
    const phaseStart = Math.round(tick - k.phaseTime / DT);
    if (action === 'charge') {
      if (phase !== 'stumble') return 0;
      if (this.stumble.start !== phaseStart) this.stumble = { start: phaseStart, variant: attackVariant('charge', phaseStart, k.id) };
      return this.stumble.variant;
    }
    const windup = phaseTicks(timing.windup);
    const active = phaseTicks(timing.active);
    // The tick the attack began: its wind-up's start (or, for an attack without one, its active
    // phase's). Seen first in a later phase (a page that joined in the middle), it is reckoned back.
    const earlier = phase === 'windup' ? 0 : phase === 'recover' ? windup + active : windup;
    let start = phaseStart - earlier;
    const kept = this.look.action === action && this.look.start <= phaseStart && phaseStart - this.look.start <= windup + active + 1;
    if (kept && earlier > 0) start = this.look.start;
    if (this.look.action !== action || this.look.start !== start) this.look = { action, start, variant: attackVariant(action, start, k.id) };
    return this.look.variant;
  }

  /**
   * The stripes' glow (the models mark them in the vertex color alpha): faint when rage is
   * low, stronger as it fills, a slow pulse when the beam is ready (so the army can read "it is
   * charged"), blazing while the beam burns, a white-hot flare as a new body comes out of the
   * cocoon. During a power surge the arcs take over (SurgeArcs sets the skin after this).
   */
  private updateGlow(k: SnapKaiju, action: KaijuActionId, phase: KaijuPhase, phaseTime: number, phaseDuration: number, dt: number, time: number, firstPerson: boolean): number {
    const rage = clamp01(k.rage / COMBAT_RULES.rageMax);
    const def = kaijuKindDef(k.kind);
    const beamReady = (k.moves[0] === 'beam' || k.moves[1] === 'beam') && k.rage >= def.actions.special.rageCost && k.cooldowns.special <= 0;
    let level = STRIPE_IDLE + (STRIPE_FULL - STRIPE_IDLE) * rage * Math.sqrt(rage);
    let heat = rage;
    if (beamReady) {
      const throb = 0.5 - 0.5 * Math.cos(time * READY_PULSE);
      level = STRIPE_READY[0] + (STRIPE_READY[1] - STRIPE_READY[0]) * throb * throb;
    }
    if (action === 'special' && phase !== 'idle') {
      const gather = phase === 'windup' ? clamp01(phaseTime / Math.max(0.01, phaseDuration)) : phase === 'recover' ? 0.5 : 1;
      level = Math.max(level, STRIPE_BEAM * gather);
      heat = Math.max(heat, gather);
    }
    if (!k.alive) level = 0;
    this.flare = Math.max(0, this.flare - dt / FLARE_TIME);
    const flare = this.flare * this.flare * 2.2;
    const hot = clamp01(rage * 0.8 + (beamReady ? 0.2 : 0));
    const fp = firstPerson ? STRIPE_FIRST_PERSON : 1;
    this.skin.stripe.setRGB(
      ((STRIPE_LOW.r + (STRIPE_HIGH.r - STRIPE_LOW.r) * hot) * level + STRIPE_FLARE.r * flare) * fp,
      ((STRIPE_LOW.g + (STRIPE_HIGH.g - STRIPE_LOW.g) * hot) * level + STRIPE_FLARE.g * flare) * fp,
      ((STRIPE_LOW.b + (STRIPE_HIGH.b - STRIPE_LOW.b) * hot) * level + STRIPE_FLARE.b * flare) * fp,
    );
    this.skin.flash.setRGB(0.25 * flare, 0.2 * flare, 0.15 * flare);
    return Math.max(heat, this.flare);
  }

  /** Sets the rig to a pose (rotations, hips) and, seen from inside the head, locks the head to the aim. */
  private applyPose(rig: SceneRig, rotations: Map<string, NodePose>, hipsLift: number, k: SnapKaiju, assembly: boolean): void {
    for (const [name, r] of rotations) rig.setRotation(name, r.x, r.y, r.z);
    rig.setOffset('hips', 0, hipsLift, 0);
    // Seen from inside the head: lock the head to the aim (it carries the camera anchor, the
    // snout and, riding on it, the arms), so the claws keep their place whatever the body does.
    // The local player's head follows the view (`look`), not a throw's aim (round 5).
    if (assembly) {
      const neck = rig.node('neck');
      const head = rig.node('head');
      if (neck && head) {
        this.group.updateMatrixWorld(true);
        neck.getWorldQuaternion(quat).invert();
        const look = this.headLook;
        aimQuat.setFromEuler(aimEuler.set(-(look ? look.pitch : k.aimPitch), look ? look.yaw : k.aimYaw, 0, 'YXZ'));
        head.quaternion.copy(quat).multiply(aimQuat);
      }
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
      if (speed > stage.topSpeed * 0.15 && !cocooned && this.swim < 0.3) {
        // The foot that just landed kicks up dust beside the body.
        const side = half % 2 === 0 ? 1 : -1;
        const fx = k.x + Math.cos(k.yaw) * side * stage.bodyRadius * 0.45;
        const fz = k.z - Math.sin(k.yaw) * side * stage.bodyRadius * 0.45;
        this.callbacks.onStep?.(k, fx, fz);
        if (this.wade > 0.4) {
          // Wading: each step throws up water and a ring of foam.
          effects.splash(fx, fz, stage.bodyRadius * 0.32);
          effects.ring(fx, fz, stage.bodyRadius * 0.8, 0xeaf6ff, 1.1, 0.8, Math.max(0.15, stage.bodyRadius * 0.04));
        } else {
          effects.dust(fx, 0.1, fz, stage.bodyRadius * 0.45, k.stage === 1 ? 2 : 4);
        }
      }
    }

    // --- a handful of civilians on the way to the mouth --------------------------------------------
    if (this.snackTime !== null) {
      // Anything else it does gulps them at once.
      if (phase !== 'idle' && this.snackTime < SNACK_GULP) this.snackTime = SNACK_GULP;
      this.snackTime += dt;
      if (this.snackTime >= SNACK_TIME || cocooned || !k.alive) this.snackTime = null;
    }

    // --- pose --------------------------------------------------------------------------------------
    const assembly = view.firstPerson && phase !== 'dead' && phase !== 'cocoon';
    this.firstPerson = assembly;
    this.headLook = assembly ? view.look : undefined;
    if (assembly !== this.armsOnHead) {
      this.armsOnHead = assembly;
      rig.ride('arm_L', assembly ? 'head' : null);
      rig.ride('arm_R', assembly ? 'head' : null);
    }
    const look = this.lookFor(k, action, phase, view.tick);
    this.lookNow = look;
    const input = this.input;
    input.time = time;
    input.walkPhase = this.walkPhase;
    input.speed = speed / Math.max(0.1, stage.topSpeed);
    input.headYaw = angleDiff(k.aimYaw, k.yaw);
    input.headPitch = k.aimPitch;
    input.action = action;
    input.phase = phase;
    input.phaseTime = phaseTime;
    input.phaseDuration = phaseDuration;
    input.holding = k.held !== null;
    input.height = stage.height;
    input.poses = this.poses ?? undefined;
    input.firstPerson = assembly;
    input.variant = look;
    input.snack = this.snackTime;
    computeKaijuPose(input, this.pose);
    const blend = 1 - Math.exp(-this.pose.stiffness * dt);
    for (const [name, target] of this.pose.rotations) {
      const c = this.current.get(name) as NodePose;
      c.x += (target.x - c.x) * blend;
      c.y += (target.y - c.y) * blend;
      c.z += (target.z - c.z) * blend;
    }
    this.hipsLift += (this.pose.hipsLift - this.hipsLift) * blend;

    // --- swimming ------------------------------------------------------------------------------------
    this.updateSwim(k, dt, speed, effects);
    this.updateWade(k, dt, speed, effects);
    this.chargeDust(k, action, phase, dt, effects);

    // Dead: topple over and sink a little.
    if (phase === 'dead') {
      this.deadTime = Math.min(1, this.deadTime + dt / 1.6);
      const fall = this.deadTime * this.deadTime;
      rig.root.rotation.set(fall * 1.45, 0, fall * 0.2);
      rig.root.position.set(0, -fall * stage.height * 0.04, fall * stage.height * 0.25);
    } else if (this.swim > 0) {
      // Swimming: it lies forward along the surface like a crocodile and sinks until only the
      // ridge of spines along its back shows. The water (drawn opaque) hides the rest.
      this.deadTime = 0;
      const s = this.swim * this.swim * (3 - 2 * this.swim);
      rig.root.rotation.set(s * SWIM_TILT, 0, 0);
      rig.root.position.set(0, -s * stage.height * SWIM_SINK, -s * stage.height * SWIM_BACK);
    } else {
      this.deadTime = 0;
      rig.root.rotation.set(0, 0, 0);
      // Wading in deep water: sunk to its thighs (not in its own first-person view).
      rig.root.position.set(0, assembly ? 0 : -this.wadeDepth(stage.height), 0);
    }
    this.applyPose(rig, this.current, this.hipsLift, k, assembly);

    // The weak point shows, and throbs, only while staggered. The throb never shrinks it below
    // 1.1: the shards at the shoulder blades only show above about 0.95 (art notes, section 5).
    const weak = rig.node('weak_point');
    const throb = 1.3 + Math.sin(time * 9) * 0.2;
    if (weak) {
      weak.visible = phase === 'stagger';
      if (weak.visible) weak.scale.setScalar(throb);
    }

    // The stripes glow with rage; the embers and eyes heat up with it and while the beam gathers and burns.
    const heat = this.updateGlow(k, action, phase, phaseTime, phaseDuration, dt, time, assembly);
    if (this.ember) {
      const flicker = 1 + Math.sin(time * 7.3) * 0.06 * heat;
      this.ember.color.setScalar((0.8 + Math.min(1, heat) * 0.8) * flicker + this.flare * 0.6);
    }

    // With the camera pulled back into the skull the claws would be seen from behind.
    const hideLimbs = assembly && view.insideHead;
    rig.setVisible('arm_L', !hideLimbs);
    rig.setVisible('arm_R', !hideLimbs);
    rig.setVisible('jaw', !hideLimbs);

    this.updateHeld(k, rig, assembly);
    // A city weapon in the hand and the power surge (kaijuWeapons.ts): both read the hand and the
    // nodes where this frame's pose has put them.
    if (this.weapon.kind !== null || k.surge > 0 || this.surge.active) {
      this.group.updateMatrixWorld(true);
      const u = phaseDuration > 0 ? Math.min(1, phaseTime / phaseDuration) : 0;
      this.weapon.update(k, { action, phase, u, variant: look }, dt, time, { firstPerson: assembly }, lines, this.ribbons);
      this.surge.update(k, rig, this.ember, this.skin, dt, lines, effects, rig.root.visible);
    }

    // A staggered kaiju's weak point also gets a halo of its light, toward whoever looks: from a
    // squad's eye, across a dark city, the crystal alone is a few pixels.
    if (phase === 'stagger' && !assembly && view.camera) {
      this.group.updateMatrixWorld(true);
      if (!rig.worldPosition('weak_point', tmp)) tmp.set(k.x, stage.height * 0.6, k.z);
      tmp2.copy(view.camera).sub(tmp).setY(0);
      const toward = tmp2.length();
      if (toward > 1e-3) tmp.addScaledVector(tmp2, Math.min(toward * 0.5, stage.bodyRadius * 1.3) / toward);
      effects.glowAt(tmp.x, tmp.y, tmp.z, stage.bodyRadius * 2.4 * throb, WEAK_GLOW, 0.06, 0.85);
    }

    // --- anchors ---------------------------------------------------------------------------------
    this.group.updateMatrixWorld(true);
    this.hasCamAnchor = rig.worldPosition('cam_fp', this.camAnchor);
    if (!this.hasCamAnchor) this.camAnchor.set(k.x, stage.eyeHeight, k.z);
    if (!rig.worldPosition('mouth', this.mouth)) this.mouth.set(k.x, stage.mouthHeight, k.z);
    this.hasHand = rig.worldPosition('hold', this.hand);

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

    // --- slash trails (last: they pose the rig along the strike, then put it back) ----------------
    if (rig.root.visible && !hideLimbs) this.slashTrails(k, rig, action, phase, phaseTime, phaseDuration, look, assembly, stage.height, lines);
  }

  /**
   * The slash trails of a swipe's claws and a tail sweep's tail: the band the tip sweeps through
   * the strike, worked out by posing the rig at moments of it (so it reads at any frame rate),
   * drawn up to now; through the follow-through it fades.
   */
  private slashTrails(k: SnapKaiju, rig: SceneRig, action: KaijuActionId, phase: KaijuPhase, phaseTime: number, phaseDuration: number, look: number | null, assembly: boolean, height: number, lines: LineBatch): void {
    const ribbons = this.ribbons;
    if (!ribbons || (action !== 'swipe' && action !== 'tailSweep') || look === null) return;
    if (phase !== 'active' && phase !== 'recover') return;
    const timing = kaijuKindDef(k.kind).actions[action].timing;
    const u = phaseDuration > 0 ? clamp01(phaseTime / phaseDuration) : 1;
    const head = phase === 'active' ? u : 1;
    const from = assembly ? head * TRAIL_FP_FROM : 0;
    const fade = (phase === 'active' ? 1 : 1 - u / TRAIL_FADE) * (assembly ? TRAIL_FP_FADE : 1);
    if (fade <= 0.01 || head <= 0.02) return;
    const tail = action === 'tailSweep';
    const names = tail ? ['tail_5'] : look === 2 ? ['hand_R', 'hand_L'] : [look === 1 ? 'hand_L' : 'hand_R'];
    const inner = tail ? TAIL_INNER : CLAW_INNER;
    const objects: THREE.Object3D[] = [];
    const tips: THREE.Vector3[] = [];
    for (const name of names) {
      const node = rig.node(name);
      const tip = this.tips.get(name);
      if (node && tip) {
        objects.push(node);
        tips.push(tip);
      }
    }
    if (objects.length === 0) return;
    for (let j = 0; j < objects.length; j++) {
      clearTrail(this.tipPaths[j]);
      clearTrail(this.innerPaths[j]);
    }
    const input = this.input;
    const sample: KaijuPose = this.sample;
    for (let i = 0; i <= TRAIL_POINTS; i++) {
      input.phase = 'active';
      input.phaseDuration = timing.active;
      input.phaseTime = (from + ((head - from) * i) / TRAIL_POINTS) * timing.active;
      computeKaijuPose(input, sample);
      this.applyPose(rig, sample.rotations, sample.hipsLift, k, assembly);
      this.group.updateMatrixWorld(true);
      for (let j = 0; j < objects.length; j++) {
        const m = objects[j].matrixWorld;
        tmp.copy(tips[j]).applyMatrix4(m);
        addTrailPoint(this.tipPaths[j], tmp.x, tmp.y, tmp.z);
        tmp.copy(tips[j]).multiplyScalar(inner).applyMatrix4(m);
        addTrailPoint(this.innerPaths[j], tmp.x, tmp.y, tmp.z);
      }
    }
    // Back to the pose drawn this frame.
    this.applyPose(rig, this.current, this.hipsLift, k, assembly);
    this.group.updateMatrixWorld(true);
    // (Seen from inside its own head the glowing edge would cross the crosshair: the band alone.)
    const edge = assembly ? 0 : height * TRAIL_EDGE;
    for (let j = 0; j < objects.length; j++) ribbons.ribbon(this.tipPaths[j], this.innerPaths[j], fade, k.surge > 0, lines, edge);
  }

  /**
   * One of this kaiju's actions changed phase (the simulation's `kaijuAction`, handed on by the
   * renderer): a stomp's foot (or, for the hop, both feet) lands with a short shock ring.
   */
  onAction(e: KaijuActionEvent, k: SnapKaiju, effects: Effects): void {
    if (e.action !== 'stomp' || e.phase !== 'active' || !this.rig) return;
    const look = this.look.action === 'stomp' ? this.look.variant : 2;
    const st = kaijuStageDef(k.kind, k.stage);
    this.group.updateMatrixWorld(true);
    for (const name of look === 2 ? ['foot_L', 'foot_R'] : [look === 1 ? 'foot_L' : 'foot_R']) {
      const foot = this.feet.get(name);
      if (!foot) continue;
      tmp.copy(foot).applyMatrix4(this.group.matrixWorld);
      stompShock(effects, tmp.x, tmp.z, st.bodyRadius * 1.25, k.surge > 0);
    }
  }

  /**
   * Eases the drawn swim toward the snapshot's, splashes on the way in and out, and leaves a
   * wake behind it while it swims (a V of foam rings) or bubbles while it lies still.
   */
  private updateSwim(k: SnapKaiju, dt: number, speed: number, effects: Effects): void {
    const target = k.alive && k.phase !== 'cocoon' ? k.submerge : 0;
    const before = this.swim;
    // Fast enough to follow the 1 s dive, smooth enough to hide the 15 Hz snapshot steps.
    this.swim += (target - this.swim) * (1 - Math.exp(-dt * 8));
    if (Math.abs(target - this.swim) < 0.002) this.swim = target;
    const st = kaijuStageDef(k.kind, k.stage);
    const r = st.bodyRadius;
    const going = before <= 0.02 && this.swim > 0.02;
    const coming = before >= 0.3 && this.swim < 0.3 && target < before;
    if (going || coming) {
      effects.splash(k.x, k.z, r * 0.7);
      this.callbacks.onSplash?.(k);
    }
    if (this.swim < 0.3) {
      this.wakeTimer = 0;
      return;
    }
    this.wakeTimer -= dt;
    if (this.wakeTimer > 0) return;
    const fx = Math.sin(k.yaw);
    const fz = Math.cos(k.yaw);
    if (speed > st.topSpeed * 0.1) {
      this.wakeTimer = 0.14;
      // Foam at the bow and a spreading ring at the tail: together they draw the V.
      effects.ring(k.x + fx * r * 0.9, k.z + fz * r * 0.9, r * 0.8, 0xe8f6ff, 0.9, 0.55, 0.14);
      effects.ring(k.x - fx * r * 1.6, k.z - fz * r * 1.6, r * 1.3, 0xdff1ff, 1.6, 0.4, 0.13);
      effects.dust(k.x + fx * r, 0.2, k.z + fz * r, r * 0.35, 1, 0xeaf6ff);
    } else {
      this.wakeTimer = 0.8;
      effects.ring(k.x, k.z, r * 0.9, 0xdff1ff, 1.4, 0.3, 0.13);
    }
  }

  /** How far below the water a wading kaiju is drawn now (meters). */
  private wadeDepth(height: number): number {
    if (this.wade <= 0) return 0;
    const s = this.wade * this.wade * (3 - 2 * this.wade);
    return s * WADE_DEPTH * (this.hipsHeight > 0 ? this.hipsHeight : height * 0.4);
  }

  /** Standing in deep water, as drawn (0..1; playtests). */
  get wading(): number {
    return this.wade;
  }

  /**
   * A kaiju too big to swim that stands in deep water (the snapshot's `inWater`): eases down to
   * its thighs, with foam lapping round it while it stands and a wake behind it while it walks.
   */
  private updateWade(k: SnapKaiju, dt: number, speed: number, effects: Effects): void {
    const swim = kaijuKindDef(k.kind).swim;
    const tooBig = !swim || !swim.stages[k.stage - 1];
    const target = tooBig && k.inWater && k.alive && k.phase !== 'cocoon' ? 1 : 0;
    const before = this.wade;
    this.wade += (target - this.wade) * (1 - Math.exp(-dt * WADE_EASE));
    if (Math.abs(target - this.wade) < 0.003) this.wade = target;
    const st = kaijuStageDef(k.kind, k.stage);
    const r = st.bodyRadius;
    // Stepping in: a big splash.
    if (before < 0.15 && this.wade >= 0.15 && target === 1) effects.splash(k.x, k.z, r * 0.8);
    if (this.wade < 0.3) {
      this.foamTimer = 0;
      return;
    }
    this.foamTimer -= dt;
    if (this.foamTimer > 0) return;
    const fx = Math.sin(k.yaw);
    const fz = Math.cos(k.yaw);
    const moving = speed > st.topSpeed * 0.1;
    // Everything well outside the body (its own thighs hide foam closer in), and the rings a
    // little above the water, which they would otherwise flicker against from far off.
    const y = Math.max(0.15, r * 0.04);
    if (moving) {
      this.foamTimer = 0.18;
      // A bow wave at the chest and a spreading wake behind: together they draw the V.
      effects.ring(k.x + fx * r * 0.9, k.z + fz * r * 0.9, r * 1.4, 0xeef8ff, 0.9, 0.9, y);
      effects.ring(k.x - fx * r * 1.6, k.z - fz * r * 1.6, r * 2.2, 0xdff1ff, 2, 0.75, y);
    } else {
      // Standing: foam lapping round its legs.
      this.foamTimer = 0.4;
      effects.ring(k.x, k.z, r * 1.7, 0xeef8ff, 1.6, 0.9, y);
    }
    // White water churning at the waterline, all round the legs (the renderer adds a collar of
    // foam: render/gameRenderer.ts).
    for (let i = 0; i < (moving ? 2 : 1); i++) {
      const a = (this.foamTurn += 2.4);
      effects.splash(k.x + Math.cos(a) * r * 1.05, k.z + Math.sin(a) * r * 1.05, r * 0.22);
    }
  }

  /**
   * The charge's dust: the right foot scraping the ground in the wind-up, then in the run a wake
   * of it behind the feet and a low wave of it pushed ahead of the chest.
   */
  private chargeDust(k: SnapKaiju, action: KaijuActionId, phase: KaijuPhase, dt: number, effects: Effects): void {
    if (action !== 'charge' || (phase !== 'windup' && phase !== 'charge') || this.swim > 0.3) {
      this.dustTimer = 0;
      return;
    }
    this.dustTimer -= dt;
    if (this.dustTimer > 0) return;
    const r = kaijuStageDef(k.kind, k.stage).bodyRadius;
    const fx = Math.sin(k.yaw);
    const fz = Math.cos(k.yaw);
    // The model's right, in the world.
    const rx = -Math.cos(k.yaw);
    const rz = Math.sin(k.yaw);
    if (phase === 'windup') {
      this.dustTimer = 0.2;
      effects.dust(k.x + rx * r * 0.45 + fx * r * 0.15, 0.1, k.z + rz * r * 0.45 + fz * r * 0.15, r * 0.4, 2, 0xcbbfa8);
      return;
    }
    this.dustTimer = 0.07;
    effects.dust(k.x - fx * r * 0.7, 0.1, k.z - fz * r * 0.7, r * 0.6, 2, 0xcfc4ae);
    effects.dust(k.x + fx * r * 1.1, 0.1, k.z + fz * r * 1.1, r * 0.45, 1, 0xd8cfbb);
  }

  hide(): void {
    this.group.visible = false;
    this.surge.reset();
    this.snackTime = null;
  }

  dispose(): void {
    this.rig?.dispose();
    this.cocoon?.dispose();
    this.dropHeld();
    this.weapon.dispose();
    this.surge.reset();
    this.skin.material.dispose();
    this.group.removeFromParent();
  }
}
