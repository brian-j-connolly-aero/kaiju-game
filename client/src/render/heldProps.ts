/**
 * How a city weapon sits in the kaiju's hand (docs/ROADMAP.md phase 2, "the city as a weapon";
 * docs/ASSETS.md section 3). Each weapon's art file has an empty node `grip` where the claw
 * closes, and its manifest entry says where that is (`at`), which way the weapon points from it
 * (`tip`, in the model's own frame) and how it is held:
 *
 *   carry     the tip hangs down (the propane tank, the water tank), tilted forward when the
 *             thing is longer than the hand is high, so it never goes through the ground
 *   javelin   the tip points along the aim (the antenna, the radio mast's top)
 *   club      the tip points along the swing (the fast-food sign)
 *   shield    the tip points away from the chest (the garage door's face)
 *
 * The reference is `held()` in tools/art/props_weapons.py. A procedural stand-in (no art file)
 * is held with the same numbers.
 */

import * as THREE from 'three';
import { PROP_KINDS, type PropKindId } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';

export type HoldKind = 'carry' | 'javelin' | 'club' | 'shield';

export interface GripInfo {
  /** Where the claw closes, in the model's frame (meters). */
  at: THREE.Vector3;
  /** Which way the weapon points from the grip, in the model's frame (unit length). */
  tip: THREE.Vector3;
  hold: HoldKind;
  /** A model axis square to `tip` that is kept as close as it can be to the hold's "up" (see `holdUp`). */
  side: THREE.Vector3;
}

type RawGrip = { at: [number, number, number]; tip: [number, number, number]; hold: HoldKind };

/** The art files' numbers (manifest.props_weapons.json), for a model without them (the stand-ins). */
const DEFAULT_GRIPS: Partial<Record<PropKindId, RawGrip>> = {
  propane: { at: [0, 1.3, 0], tip: [0, -1, 0], hold: 'carry' },
  watertank: { at: [0, 4.5, 0], tip: [0, -1, 0], hold: 'carry' },
  antenna: { at: [0, 2.8, 0], tip: [0, 1, 0], hold: 'javelin' },
  foodsign: { at: [0, 0.7, 0], tip: [0, 1, 0], hold: 'club' },
  garagedoor: { at: [0, 1.4, -0.08], tip: [0, 0, 1], hold: 'shield' },
  mast: { at: [0, 1.323, -0.8], tip: [0, -0.022, 1], hold: 'javelin' },
};

const HOLDS: readonly HoldKind[] = ['carry', 'javelin', 'club', 'shield'];

function vec(v: unknown): THREE.Vector3 | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? new THREE.Vector3(v[0], v[1], v[2]) : null;
}

/** Builds the grip from raw numbers; null when they make no sense. */
export function gripFromRaw(raw: unknown): GripInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const at = vec(r.at);
  const tip = vec(r.tip);
  const hold = HOLDS.find((h) => h === r.hold);
  if (!at || !tip || !hold || tip.lengthSq() < 1e-8) return null;
  tip.normalize();
  // The second axis: the model's up for a weapon that points sideways, its front for one that
  // points up or down.
  const side = Math.abs(tip.y) > 0.7 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  return { at, tip, hold, side };
}

const cache = new WeakMap<AssetStore, Map<string, GripInfo | null>>();

/**
 * How a prop of this kind is held, or null for anything that is not a city weapon (a car, a
 * kiosk: hung from the hand by its middle as before).
 */
export function gripFor(assets: AssetStore, kind: PropKindId): GripInfo | null {
  let byKind = cache.get(assets);
  if (!byKind) {
    byKind = new Map();
    cache.set(assets, byKind);
  }
  if (byKind.has(kind)) return byKind.get(kind) ?? null;
  let grip: GripInfo | null = null;
  if (PROP_KINDS[kind]?.cityWeapon) {
    const entry = assets.hasModel(`prop_${kind}`) ? assets.manifest.models[`prop_${kind}`] : undefined;
    grip = gripFromRaw(entry?.grip) ?? gripFromRaw(DEFAULT_GRIPS[kind]);
  }
  byKind.set(kind, grip);
  return grip;
}

const ma = new THREE.Matrix4();
const mb = new THREE.Matrix4();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();

/** `v` with its share along the unit vector `along` taken out, made unit length (or any square vector when nothing is left). */
function squareTo(v: THREE.Vector3, along: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(v).addScaledVector(along, -v.dot(along));
  if (out.lengthSq() < 1e-8) {
    out.set(1, 0, 0).addScaledVector(along, -along.x);
    if (out.lengthSq() < 1e-8) out.set(0, 0, 1).addScaledVector(along, -along.z);
  }
  return out.normalize();
}

/**
 * The rotation that turns a model so that its `tip` points along `dir` and its `side` axis comes
 * as close to `up` as it can (all in one frame, world or parent). Writes `out` and returns it.
 */
export function gripRotation(tip: THREE.Vector3, side: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  a.copy(tip).normalize();
  squareTo(side, a, b);
  c.crossVectors(a, b);
  A.copy(dir).normalize();
  squareTo(up, A, B);
  C.crossVectors(A, B);
  ma.makeBasis(A, B, C);
  mb.makeBasis(a, b, c).transpose();
  return out.setFromRotationMatrix(ma.multiply(mb));
}

/**
 * The tilt (radians from straight down, toward the front) a carried weapon needs so that its
 * far end, `length` meters from the grip, stays `clear` meters off the ground with the hand
 * `handY` meters up.
 */
export function carryTilt(length: number, handY: number, clear = 0.3): number {
  const room = handY - clear;
  if (length <= room) return 0;
  return Math.acos(Math.max(-1, Math.min(1, room / Math.max(1e-3, length))));
}

/** How far the weapon reaches from its grip along its tip (meters), from the model's bounds. */
export function reachFromGrip(bounds: THREE.Box3, grip: GripInfo): number {
  let best = 0;
  for (let i = 0; i < 8; i++) {
    a.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).sub(grip.at);
    best = Math.max(best, a.dot(grip.tip));
  }
  return best;
}

/** Where the fast-food sign points while it is only held: up, a little out to the right and forward. */
const CLUB_REST = new THREE.Vector3(-0.25, 1, 0.35).normalize();
/**
 * ...and at the top of the wind-up, by the look of the swing (render/kaijuAnimator.ts): cocked up
 * and back over the right shoulder (the forehand), over the left (the backhand), straight up
 * behind the head (the overhead smash); raised, while the look is not known yet.
 */
const CLUB_COCKED = [
  new THREE.Vector3(-0.7, 0.45, -0.55).normalize(),
  new THREE.Vector3(0.75, 0.45, -0.5).normalize(),
  new THREE.Vector3(-0.15, 0.85, -0.5).normalize(),
] as const;
const CLUB_RAISED = new THREE.Vector3(-0.3, 1, 0.05).normalize();
/** The forehand's swing, in the body's frame round the aim: from behind the right shoulder across the front to the left. */
const SWING_FROM = (-125 * Math.PI) / 180;
const SWING_TO = (80 * Math.PI) / 180;
/** The overhead smash: from up and back over the head, down to the ground in front (angle up from the aim). */
const SMASH_FROM = (115 * Math.PI) / 180;
const SMASH_TO = (-30 * Math.PI) / 180;

/** The sign's direction `f` (0..1) through the swing of look `look`, and (optional) the way its head moves. */
function swingDir(look: number, f: number, out: THREE.Vector3, motion?: THREE.Vector3): THREE.Vector3 {
  if (look === 2) {
    const p = SMASH_FROM + (SMASH_TO - SMASH_FROM) * f;
    motion?.set(0, -Math.cos(p), Math.sin(p));
    return out.set(-0.12, Math.sin(p), Math.cos(p)).normalize();
  }
  // The backhand is the forehand turned over: from behind the left shoulder across to the right.
  const side = look === 1 ? -1 : 1;
  const t = side * (SWING_FROM + (SWING_TO - SWING_FROM) * f);
  motion?.set(side * Math.cos(t), 0, -side * Math.sin(t));
  return out.set(Math.sin(t), 0.35 - 0.55 * f, Math.cos(t)).normalize();
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * Which way the fast-food sign points, in the frame of the aim (x to the model's left, y up, z
 * along the aim), at time `u` (0..1) of `phase` of a club action; the rest direction outside one.
 * `motion` (optional) gets the way the head of the sign is moving (the swing's tangent), or the
 * front when it is not swinging: the sign's face is kept toward it. `look` is the swing's look
 * (0 forehand, 1 backhand, 2 overhead smash; null not known yet: the sign is only raised).
 */
export function clubDirection(phase: string, u: number, out: THREE.Vector3, motion?: THREE.Vector3, look: number | null = 0): THREE.Vector3 {
  const f = Math.max(0, Math.min(1, u));
  const k = look === null ? 0 : Math.max(0, Math.min(2, Math.round(look)));
  if (phase === 'windup') {
    out.copy(CLUB_REST).lerp(look === null ? CLUB_RAISED : CLUB_COCKED[k], smooth(f) * (look === null ? 0.6 : 1)).normalize();
    motion?.set(0, 0, 1);
  } else if (phase === 'active') {
    swingDir(k, f, out, motion);
  } else if (phase === 'recover') {
    swingDir(k, 1, out).lerp(CLUB_REST, smooth(f)).normalize();
    motion?.set(0, 0, 1);
  } else {
    out.copy(CLUB_REST);
    motion?.set(0, 0, 1);
  }
  return out;
}
