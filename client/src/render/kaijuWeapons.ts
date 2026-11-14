/**
 * The monster's city weapons in its hand, and its power surge (docs/ROADMAP.md phase 2), drawn
 * on the kaiju's rig by `KaijuView`:
 *
 *   HeldWeapon   a city weapon on the `hold` node, held by its grip node the way its manifest
 *                entry says (render/heldProps.ts): a tank hangs, a javelin points along the
 *                aim (the monster's own player sees a straight aim line out to its range), the
 *                fast-food sign is swung along the club's arc (one of three looks) with a slash
 *                trail behind its head (render/kaijuTrails.ts, shared with the claws and the
 *                tail), the garage door is held up in front and dents, scorches and shakes as
 *                shots hit it; a propane tank glows a warning red now and then (a shot near the
 *                hand sets it off)
 *   SurgeArcs    while a power surge lasts (the snapshot's `surge`): electric arcs crackle along
 *                the spines and tail, between the claws and down to the ground, the glowing
 *                facets burn blue-white, and the arcs take over the glowing stripes and flash
 *                the hide (both through the kaiju view's own body material, its `KaijuSkin`)
 */

import * as THREE from 'three';
import { kaijuKindDef, kaijuStageDef, type KaijuActionId, type KaijuPhase, type PropKindId, type SnapKaiju } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import type { Effects } from './effects';
import { carryTilt, clubDirection, gripFor, gripRotation, reachFromGrip, type GripInfo } from './heldProps';
import { addTrailPoint, clearTrail, createTrailPath, type TrailRibbons } from './kaijuTrails';
import type { LineBatch } from './lineBatch';
import type { KaijuSkin, Materials } from './materials';
import { SceneRig } from './sceneRig';

const UP = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();
const hint = new THREE.Vector3();
const motion = new THREE.Vector3();
const holdPos = new THREE.Vector3();
const holdQuat = new THREE.Quaternion();
const want = new THREE.Quaternion();
const local = new THREE.Quaternion();
const wobbleQuat = new THREE.Quaternion();
const wobbleAxis = new THREE.Vector3();
const p0 = new THREE.Vector3();
const p1 = new THREE.Vector3();
const sphere = new THREE.Sphere();
const shift = new THREE.Vector3();
const shiftLocal = new THREE.Vector3();
const invHold = new THREE.Quaternion();
const swingTip = createTrailPath();
const swingInner = createTrailPath();

/** Turns `v`, given in a body's frame (x to its left, y up, z forward), into the world for heading `yaw`. */
export function bodyToWorld(v: THREE.Vector3, yaw: number): THREE.Vector3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return v.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/** The direction of an aim (yaw 0 is +Z, positive pitch looks up). */
export function aimDirection(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pitch);
  return out.set(Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c);
}

/** The action state a held weapon is posed for: the kaiju's own, or the local press shown ahead of the server. */
export interface HeldPose {
  action: KaijuActionId;
  phase: KaijuPhase;
  /** 0..1 through the phase (0 when open-ended). */
  u: number;
  /** The look of the swing (render/kaijuAnimator.ts `attackVariant`; null: not known yet). */
  variant?: number | null;
}

export interface HeldFrame {
  /** Seen from inside the kaiju's head: shrunk out of the lens (KaijuView's rule for anything held). */
  firstPerson: boolean;
  /** The local player's own kaiju: a javelin shows its aim line. */
  local: boolean;
  /** Where the camera is (the aim line is drawn wider the farther it is, so it reads all the way out). */
  camera?: THREE.Vector3;
}

/** How fast a shield's shake from a hit dies away (its share left falls by e every 1/9 s). */
const WOBBLE_DECAY = 9;

export class HeldWeapon {
  kind: PropKindId | null = null;
  private readonly assets: AssetStore;
  private readonly materials: Materials;
  private rig: SceneRig | null = null;
  private grip: GripInfo | null = null;
  /** Meters from the grip to the far end along the tip, at true size. */
  private reach = 1;
  /** Bounding sphere radius at true size (first person shrinks anything held to fit). */
  private radius = 1;
  private readonly world = new THREE.Quaternion();
  private placed = false;
  private paint: THREE.MeshLambertMaterial | null = null;
  private wobble = 0;
  private wobbleSeed = 1;
  /** The far end of the weapon in the world (the sign's burger, the javelin's point), valid after `update`. */
  readonly end = new THREE.Vector3();

  constructor(assets: AssetStore, materials: Materials) {
    this.assets = assets;
    this.materials = materials;
  }

  /** Whether this kind is held by its grip here (a city weapon), not hung from the hand by its middle. */
  handles(kind: PropKindId): boolean {
    return gripFor(this.assets, kind) !== null;
  }

  /** Puts a city weapon on the hand (`hold`, the rig's node), or takes it away (`kind` null). */
  set(kind: PropKindId | null, hold: THREE.Object3D | null): void {
    if (kind === this.kind && (kind === null || this.rig?.root.parent === hold)) return;
    this.rig?.dispose();
    this.rig = null;
    this.kind = null;
    this.grip = null;
    this.placed = false;
    this.wobble = 0;
    if (!kind || !hold) return;
    const grip = gripFor(this.assets, kind);
    if (!grip) return;
    const model = this.assets.model(`prop_${kind}`);
    const rig = new SceneRig(model, this.materials);
    // Its own copy of the painted material: a door darkens as it is shot up, a sign as it is swung.
    this.paint ??= this.materials.vcol.clone();
    this.paint.color.setRGB(1, 1, 1);
    for (const node of model.nodes) rig.setNodeMaterial(node.name, 'vcol', this.paint);
    hold.add(rig.root);
    this.rig = rig;
    this.kind = kind;
    this.grip = grip;
    this.reach = Math.max(0.1, reachFromGrip(model.bounds, grip));
    this.radius = Math.max(0.01, model.bounds.getBoundingSphere(sphere).radius);
  }

  /** A shot hit the garage door: it jolts. */
  hit(damage: number): void {
    this.wobble = Math.min(1, this.wobble + 0.35 + damage * 0.02);
    this.wobbleSeed = (Math.imul(this.wobbleSeed, 1664525) + 1013904223) >>> 0;
  }

  /**
   * Places and turns the weapon for this frame. The kaiju's group must have up-to-date world
   * matrices (the hand's world position and turn are read from them).
   */
  update(k: SnapKaiju, pose: HeldPose, dt: number, time: number, view: HeldFrame, lines: LineBatch, ribbons: TrailRibbons | null = null): void {
    const rig = this.rig;
    const grip = this.grip;
    const hold = rig?.root.parent;
    if (!rig || !grip || !hold || !this.kind) return;
    const st = kaijuStageDef(k.kind, k.stage);
    // Seen from inside the head the weapon would fill the view: shrunk to at most 0.16 body
    // heights across, as everything held is (the art notes for the kaiju, section 6).
    const scale = view.firstPerson ? Math.min(1, (0.16 * st.height) / this.radius) : 1;
    hold.getWorldPosition(holdPos);
    hold.getWorldQuaternion(holdQuat);
    let rate = 16;
    switch (grip.hold) {
      case 'carry': {
        // Hanging from the claw, tipped forward when it is longer than the hand is high.
        const tilt = carryTilt(this.reach * scale, holdPos.y, 0.25);
        bodyToWorld(dir.set(0, -Math.cos(tilt), Math.sin(tilt)), k.yaw);
        bodyToWorld(hint.set(0, 0, 1), k.yaw);
        rate = 12;
        break;
      }
      case 'javelin': {
        // Along the aim; drawn back and up a little while the throw winds up.
        const cock = pose.action === 'throw' && pose.phase === 'windup' ? pose.u : 0;
        aimDirection(k.aimYaw, k.aimPitch + 0.3 * cock, dir);
        hint.copy(UP);
        rate = 24;
        break;
      }
      case 'club': {
        const swinging = pose.action === 'club';
        clubDirection(swinging ? pose.phase : 'idle', pose.u, dir, motion, pose.variant ?? 0);
        // The swing is aimed along the head (the club's arc is centered on the aim); held at rest
        // it follows the body.
        const yaw = swinging ? k.aimYaw : k.yaw;
        bodyToWorld(dir, yaw);
        bodyToWorld(hint.copy(motion), yaw);
        rate = swinging && pose.phase === 'active' ? 70 : 20;
        break;
      }
      case 'shield':
        // Up in front of the chest, its face away from the body, square to where it faces.
        bodyToWorld(dir.set(0, -0.08, 1), k.yaw);
        hint.copy(UP);
        rate = 16;
        break;
    }
    gripRotation(grip.tip, grip.side, dir, hint, want);
    if (!this.placed) this.world.copy(want);
    else this.world.slerp(want, 1 - Math.exp(-rate * dt));
    this.placed = true;
    local.copy(holdQuat).invert().multiply(this.world);
    if (this.wobble > 0.001) {
      // A hit on the door: it jerks about a random axis, the shake dying away.
      const s = this.wobbleSeed;
      wobbleAxis.set(((s & 255) / 255) * 2 - 1, (((s >> 8) & 255) / 255) * 0.6 - 0.3, (((s >> 16) & 255) / 255) * 2 - 1).normalize();
      wobbleQuat.setFromAxisAngle(wobbleAxis, this.wobble * 0.22 * Math.sin(time * 38));
      local.multiply(wobbleQuat);
      this.wobble *= Math.exp(-WOBBLE_DECAY * dt);
    }
    rig.root.quaternion.copy(local);
    rig.root.scale.setScalar(scale);
    rig.root.position.copy(grip.at).multiplyScalar(-scale).applyQuaternion(local);
    // The door is held up in front of the chest, not out at the side where the hand is: it is
    // moved most of the way across to the body's middle line, a little ahead of it.
    shift.set(0, 0, 0);
    if (grip.hold === 'shield' && !view.firstPerson) {
      const r = st.bodyRadius;
      shift.set(k.x + Math.sin(k.yaw) * r * 0.95 - holdPos.x, 0, k.z + Math.cos(k.yaw) * r * 0.95 - holdPos.z).multiplyScalar(0.8);
      // (The weapon hangs on the hand: the move is turned into the hand's own frame.)
      rig.root.position.add(shiftLocal.copy(shift).applyQuaternion(invHold.copy(holdQuat).invert()));
    }
    this.end.copy(grip.tip).applyQuaternion(this.world).multiplyScalar(this.reach * scale).add(holdPos).add(shift);

    // The paint: a door scorched and dented as its hp goes, a sign as its swings are used up, and
    // a propane tank's warning glow.
    const paint = this.paint;
    if (paint) {
      if (this.kind === 'garagedoor') {
        const hp = Math.max(0, Math.min(1, k.shieldHp / kaijuKindDef(k.kind).cityWeapons.garagedoor.hp));
        paint.color.setRGB(0.42 + 0.58 * hp, 0.34 + 0.66 * hp, 0.3 + 0.7 * hp);
      } else if (this.kind === 'foodsign') {
        const left = Math.max(0, Math.min(1, k.clubSwings / Math.max(1, kaijuKindDef(k.kind).actions.club.swings)));
        paint.color.setRGB(0.6 + 0.4 * left, 0.55 + 0.45 * left, 0.5 + 0.5 * left);
      } else if (this.kind === 'propane') {
        const warn = Math.max(0, Math.sin(time * 5.5)) ** 4;
        paint.color.setRGB(1 + warn * 0.6, 1 - warn * 0.45, 1 - warn * 0.5);
      } else {
        paint.color.setRGB(1, 1, 1);
      }
    }

    if (grip.hold === 'club' && pose.action === 'club' && ribbons) this.drawSwingTrail(k, pose, st.height, scale, lines, ribbons, view.firstPerson);
    if (grip.hold === 'javelin' && view.local && pose.action !== 'throw') this.drawAimLine(k, lines, view.camera);
  }

  /**
   * The club's trail (one of the monster's slash trails, render/kaijuTrails.ts): the arc the
   * sign's head has swept so far in this swing, bright at the head and fading behind it (worked
   * out from the swing itself, so it reads at any frame rate). It fades out as the arm comes back.
   */
  private drawSwingTrail(k: SnapKaiju, pose: HeldPose, height: number, scale: number, lines: LineBatch, ribbons: TrailRibbons, firstPerson: boolean): void {
    let head: number;
    let fade: number;
    if (pose.phase === 'active') {
      head = pose.u;
      fade = 1;
    } else if (pose.phase === 'recover') {
      head = 1;
      fade = Math.max(0, 1 - pose.u / 0.45);
    } else {
      return;
    }
    if (fade <= 0.01) return;
    const n = 14;
    const from = Math.max(0, head - 0.85);
    const reach = this.reach * scale;
    clearTrail(swingTip);
    clearTrail(swingInner);
    for (let i = 0; i <= n; i++) {
      const f = from + ((head - from) * i) / n;
      clubDirection('active', f, p0, undefined, pose.variant ?? 0);
      bodyToWorld(p0, k.aimYaw);
      // The band between the sign's head and its middle.
      p1.copy(p0).multiplyScalar(reach * 0.45).add(holdPos);
      p0.multiplyScalar(reach).add(holdPos);
      addTrailPoint(swingTip, p0.x, p0.y, p0.z);
      addTrailPoint(swingInner, p1.x, p1.y, p1.z);
    }
    ribbons.ribbon(swingTip, swingInner, fade * (firstPerson ? 0.5 : 1), k.surge > 0, lines, firstPerson ? 0 : height * 0.03);
  }

  /**
   * A javelin in the local player's hand: a straight line from its point to where the crosshair
   * is (the aim ray from the eye, as the simulation aims it; the ground or how far the javelin
   * flies, whichever comes first), with a cross where it would strike. Buildings are not looked
   * for: it is a guide. Seen from behind it runs almost straight away from the camera, so it is
   * drawn unbroken and as wide as it needs to be to read at each distance.
   */
  private drawAimLine(k: SnapKaiju, lines: LineBatch, camera: THREE.Vector3 | undefined): void {
    const def = kaijuKindDef(k.kind).cityWeapons;
    const st = kaijuStageDef(k.kind, k.stage);
    const range = this.kind === 'mast' ? def.mast.range : def.antenna.range;
    aimDirection(k.aimYaw, k.aimPitch, dir);
    // Where the eye's ray meets the ground, or the javelin's range along it.
    let reach = range;
    if (dir.y < -1e-3) reach = Math.min(range, st.eyeHeight / -dir.y);
    p1.set(k.x + Math.sin(k.aimYaw) * st.eyeForward, st.eyeHeight, k.z + Math.cos(k.aimYaw) * st.eyeForward).addScaledVector(dir, reach);
    hint.subVectors(p1, this.end);
    const len = hint.length();
    if (len < 1) return;
    hint.multiplyScalar(1 / len);
    const base = Math.max(0.08, st.height * 0.018);
    const widthAt = (x: number, y: number, z: number): number => (camera ? Math.max(base, Math.hypot(x - camera.x, y - camera.y, z - camera.z) * 0.006) : base);
    const pieces = 10;
    for (let i = 0; i < pieces; i++) {
      p0.copy(this.end).addScaledVector(hint, (len * i) / pieces);
      const x = p0.x;
      const y = Math.max(0.05, p0.y);
      const z = p0.z;
      p0.addScaledVector(hint, len / pieces);
      lines.push(x, y, z, p0.x, Math.max(0.05, p0.y), p0.z, widthAt(x, y, z), 1, 0.82, 0.5, 0.5 - 0.2 * (i / pieces));
    }
    // A cross of light where it would strike.
    const w = camera ? Math.max(base * 4, Math.hypot(p1.x - camera.x, p1.y - camera.y, p1.z - camera.z) * 0.025) : base * 4;
    const y = Math.max(0.1, p1.y);
    lines.push(p1.x - w, y, p1.z, p1.x + w, y, p1.z, w * 0.3, 1, 0.82, 0.5, 0.85);
    lines.push(p1.x, y, p1.z - w, p1.x, y, p1.z + w, w * 0.3, 1, 0.82, 0.5, 0.85);
    lines.push(p1.x, y - w, p1.z, p1.x, y + w, p1.z, w * 0.3, 1, 0.82, 0.5, 0.85);
  }

  dispose(): void {
    this.rig?.dispose();
    this.rig = null;
    this.kind = null;
    this.paint?.dispose();
    this.paint = null;
  }
}

// ---------------------------------------------------------------------------------------------
// The power surge
// ---------------------------------------------------------------------------------------------

/** Pairs of rig nodes an arc may run between, lifted off the body (the spines' ridge, the tail). */
const BACK_ARCS: ReadonlyArray<readonly [string, string]> = [
  ['spines', 'tail_1'],
  ['tail_1', 'tail_2'],
  ['tail_2', 'tail_3'],
  ['tail_3', 'tail_4'],
  ['tail_4', 'tail_5'],
  ['neck', 'spines'],
  ['head', 'neck'],
];
/** Nodes an arc may jump out from, into the air or down to the ground. */
const SPARK_NODES = ['hand_L', 'hand_R', 'head', 'tail_5', 'tail_3', 'foot_L', 'foot_R', 'spines'] as const;
const GLOW_NODES = ['head', 'spines', 'tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5'] as const;

/** The arcs' color: a hot blue-white, never the humans' cyan. */
const ARC = { r: 0.82, g: 0.86, b: 1 };

const a0 = new THREE.Vector3();
const a1 = new THREE.Vector3();
const side = new THREE.Vector3();
const lift = new THREE.Vector3();

export class SurgeArcs {
  /** The glowing facets' surge material (no vertex colors: they burn blue-white whatever their paint). */
  private surgeGlow: THREE.MeshBasicMaterial | null = null;
  /** The body material whose stripes and hide the surge lights (the kaiju view's own). */
  private skin: KaijuSkin | null = null;
  private on = false;
  private seed = 2463534242;
  /** The arcs of the current burst (a new burst every few hundredths of a second). */
  private readonly arcs: number[] = [];
  private burstIn = 0;
  private flash = 0;
  /** Seconds to the next puff of the glow round the body. */
  private glowIn = 0;

  private rand(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }

  /** Whether the surge is being drawn (for the view: the facets' material is swapped meanwhile). */
  get active(): boolean {
    return this.on;
  }

  /**
   * Draws a frame of the surge on `rig` (world matrices up to date). `ember` is the facets'
   * ordinary material, given back when the surge is over. While it lasts the surge sets the
   * stripes' glow and the hide's flash of `skin` (the view sets the stripes from rage otherwise).
   */
  update(k: SnapKaiju, rig: SceneRig, ember: THREE.Material | null, skin: KaijuSkin, dt: number, lines: LineBatch, effects: Effects, visible: boolean): void {
    this.glowIn -= dt;
    this.skin = skin;
    const surging = k.alive && k.surge > 0 && k.phase !== 'cocoon' && visible;
    if (surging !== this.on) {
      this.on = surging;
      if (surging) {
        this.surgeGlow ??= new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        for (const node of GLOW_NODES) rig.setNodeMaterial(node, 'glow', this.surgeGlow);
      } else {
        if (ember) for (const node of GLOW_NODES) rig.setNodeMaterial(node, 'glow', ember);
        skin.flash.setRGB(0, 0, 0);
        this.arcs.length = 0;
      }
    }
    if (!surging) return;
    const st = kaijuStageDef(k.kind, k.stage);
    // Strong for most of it, guttering out over the last two seconds.
    const strength = Math.min(1, k.surge / 2);
    this.burstIn -= dt;
    if (this.burstIn <= 0) {
      this.burstIn = 0.07 + this.rand() * 0.07;
      this.newBurst(rig, st.bodyRadius, strength, effects);
    }
    // The arcs of the burst, redrawn every frame (a burst lasts a few frames).
    const width = Math.max(0.12, st.height * 0.03);
    const list = this.arcs;
    for (let i = 0; i + 7 <= list.length; i += 7) {
      const a = list[i + 6];
      lines.push(list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4], list[i + 5], width * 3.5, ARC.r * 0.55, ARC.g * 0.65, ARC.b, 0.45 * a);
      lines.push(list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4], list[i + 5], width, 1, 1, 1, a);
    }
    // The facets burn blue-white and flicker; the hide flashes pale with each burst (a flash,
    // not a tint: a lasting one would turn the orange hide pink); the stripes carry the arcs'
    // light, flaring with each burst.
    const flicker = 0.65 + this.rand() * 0.7;
    this.surgeGlow?.color.setRGB(0.75 * flicker + 0.3, 0.85 * flicker + 0.3, 1.5 * flicker + 0.4);
    this.flash = Math.max(0, this.flash - dt * 9);
    const sheen = 0.16 * this.flash * this.flash * strength;
    skin.flash.setRGB(sheen, sheen, sheen * 1.15);
    const arcLight = (0.35 + 0.9 * this.flash) * strength * flicker;
    skin.stripe.setRGB(0.55 * arcLight, 0.65 * arcLight, 1.1 * arcLight);
    // Patches of the same light flickering over the hide, along the spines and down the tail.
    if (this.glowIn <= 0) {
      this.glowIn = 0.08;
      for (const node of GLOW_NODES) {
        if (this.rand() > 0.35 || !rig.worldPosition(node, a0)) continue;
        effects.glowAt(a0.x, a0.y + st.bodyRadius * 0.25, a0.z, st.bodyRadius * (0.6 + this.rand() * 0.6), 0xc4d0ff, 0.12, 0.5 * strength);
      }
    }
  }

  /** A new set of arcs: along the back and tail, and jumping off the claws, head and feet. */
  private newBurst(rig: SceneRig, radius: number, strength: number, effects: Effects): void {
    this.arcs.length = 0;
    this.flash = 1;
    const count = 2 + Math.round(4 * strength);
    for (let n = 0; n < count; n++) {
      const pick = this.rand();
      if (pick < 0.4) {
        const [from, to] = BACK_ARCS[Math.floor(this.rand() * BACK_ARCS.length)];
        if (!rig.worldPosition(from, a0) || !rig.worldPosition(to, a1)) continue;
        // Lifted off the body so it plays over the hide, not inside it.
        lift.set(0, radius * 0.35, 0);
        a0.add(lift);
        a1.add(lift);
      } else if (pick < 0.6) {
        // A crown of sparks leaping up off the spines.
        const node = GLOW_NODES[Math.floor(this.rand() * GLOW_NODES.length)];
        if (!rig.worldPosition(node, a0)) continue;
        a0.y += radius * 0.25;
        a1.set(a0.x + (this.rand() - 0.5) * radius, a0.y + radius * (0.5 + this.rand() * 0.7), a0.z + (this.rand() - 0.5) * radius);
        effects.sparks(a1.x, a1.y, a1.z, radius * 0.3, 2, 0xd8e0ff, 0.3);
      } else {
        const from = SPARK_NODES[Math.floor(this.rand() * SPARK_NODES.length)];
        if (!rig.worldPosition(from, a0)) continue;
        const ang = this.rand() * Math.PI * 2;
        const out = radius * (0.5 + this.rand() * 0.8);
        // From a foot or the tail it strikes the ground; from a claw or the head it leaps into the air.
        const down = from.startsWith('foot') || from.startsWith('tail') || this.rand() < 0.3;
        a1.set(a0.x + Math.cos(ang) * out, down ? 0.05 : a0.y + radius * (0.2 + this.rand() * 0.5), a0.z + Math.sin(ang) * out);
        effects.glowAt(a1.x, a1.y, a1.z, radius * 0.35, 0xc8d2ff, 0.08, 0.9);
      }
      this.jagged(a0, a1, radius, 0.6 + 0.4 * strength);
    }
  }

  /** One arc as a zig-zag of short lines between two points. */
  private jagged(from: THREE.Vector3, to: THREE.Vector3, radius: number, alpha: number): void {
    const segments = 5;
    const len = from.distanceTo(to);
    side.subVectors(to, from);
    let px = from.x;
    let py = from.y;
    let pz = from.z;
    for (let s = 1; s <= segments; s++) {
      const f = s / segments;
      const jitter = s === segments ? 0 : Math.min(radius * 0.3, len * 0.22);
      const x = from.x + side.x * f + (this.rand() - 0.5) * 2 * jitter;
      const y = from.y + side.y * f + (this.rand() - 0.5) * 2 * jitter;
      const z = from.z + side.z * f + (this.rand() - 0.5) * 2 * jitter;
      this.arcs.push(px, py, pz, x, y, z, alpha);
      px = x;
      py = y;
      pz = z;
    }
  }

  /** The surge is over for this view (the rig is going away, or the match ended). */
  reset(): void {
    if (this.on) this.skin?.flash.setRGB(0, 0, 0);
    this.on = false;
    this.arcs.length = 0;
  }
}
