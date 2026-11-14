/**
 * The kaiju player's warnings of the guns charging at it, in the head as well as behind it
 * (polish pass 2: "when monster is in first person we should have some visual indicators for
 * volleys, like in 3rd person"). Third person shows the yellow targeting lasers all round the
 * body; from inside the head most of them are behind or beside the view. So, pictures only:
 *
 * - every squad with guns charging at the kaiju (lasers lit, the kaiju inside their range and
 *   aimed at within a few degrees) is one yellow diamond. Off the screen it sits on the screen's
 *   edge in the squad's direction with a small arrow pointing out at it; on the screen (first
 *   person only: third person sees the lasers themselves) it sits over the guns;
 * - it grows with the squad's charge, and from the charge at which a volley counts (60%) it is
 *   lit and pulses fast: that one is about to hurt;
 * - when a squad fires a volley its diamond flashes for a moment.
 *
 * Guns standing in smoke are not shown: the kaiju cannot see them (sim/abilities.ts).
 */

import {
  COMBAT_RULES,
  inSmoke,
  kaijuStageDef,
  unitTypeDef,
  weaponDef,
  wrapAngle,
  type SmokeShape,
  type SnapKaiju,
  type SnapUnit,
} from '@mb/shared';
import { el, icon } from './icons';

/** One squad's guns charging at the kaiju. */
export interface SquadThreat {
  squad: number;
  /** Where its charging guns stand (their middle), and the height of their muzzles. */
  x: number;
  y: number;
  z: number;
  /** The highest charge among them, 0..1. */
  charge: number;
}

/** A laser points at the kaiju when it is aimed within this many degrees of its body's edge. */
const AIM_SLACK = (6 * Math.PI) / 180;
/** Seconds a squad's diamond flashes after it fires a volley. */
const FLASH = 0.8;
/** Most squads in a match (one diamond each). */
const POOL = 8;

/**
 * The squads with guns charging at the kaiju, read from a frame: each unit with its laser lit,
 * not in smoke, with the kaiju inside its weapon's range and its aim on the kaiju's body (or
 * within a few degrees of it).
 */
export function squadThreats(k: SnapKaiju, units: readonly SnapUnit[], smokes: readonly SmokeShape[], out: SquadThreat[] = []): SquadThreat[] {
  out.length = 0;
  const radius = kaijuStageDef(k.kind, k.stage).bodyRadius;
  const sums = new Map<number, { x: number; y: number; z: number; n: number; charge: number }>();
  for (const u of units) {
    if (!u.alive || !u.laser) continue;
    const dx = k.x - u.x;
    const dz = k.z - u.z;
    const d = Math.hypot(dx, dz);
    const def = unitTypeDef(u.type);
    if (d - radius > weaponDef(def.weapon).range) continue;
    const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - u.aimYaw));
    if (off > Math.atan2(radius, Math.max(d, 1)) + AIM_SLACK) continue;
    if (smokes.length > 0 && inSmoke(smokes, u.x, u.z)) continue;
    let s = sums.get(u.squad);
    if (!s) sums.set(u.squad, (s = { x: 0, y: 0, z: 0, n: 0, charge: 0 }));
    s.x += u.x;
    s.y += u.y + def.muzzleHeight;
    s.z += u.z;
    s.n++;
    s.charge = Math.max(s.charge, u.charge);
  }
  for (const [squad, s] of sums) out.push({ squad, x: s.x / s.n, y: s.y / s.n, z: s.z / s.n, charge: s.charge });
  out.sort((a, b) => a.squad - b.squad);
  return out;
}

/** Where a picture goes for a point the camera sees at (cx, cy, cz) in its own space (looking down -z). */
export interface ScreenSpot {
  /** Screen position, 0..1 from the left and from the top. */
  x: number;
  y: number;
  /** On the screen (in front of the camera, inside the view), or pinned to its edge. */
  onScreen: boolean;
  /** Pinned: the direction the point lies in, screen radians (0 = right, positive = down). */
  angle: number;
}

/**
 * Projects a point in camera space onto the screen; a point outside the view (or behind the
 * camera) is pinned to the screen's edge, `margin` (0..0.5) in from it, in the direction it lies.
 */
export function screenSpot(cx: number, cy: number, cz: number, fovY: number, aspect: number, margin: number, out: ScreenSpot): ScreenSpot {
  const t = Math.tan(fovY / 2);
  const front = cz < -1e-3;
  // Normalized device coordinates, -1..1 inside the view (y up).
  let nx = front ? cx / (-cz * t * aspect) : cx;
  let ny = front ? cy / (-cz * t) : cy;
  if (front && Math.abs(nx) <= 1 && Math.abs(ny) <= 1) {
    out.onScreen = true;
    out.x = (nx + 1) / 2;
    out.y = (1 - ny) / 2;
    out.angle = Math.atan2(-ny, nx);
    return out;
  }
  if (!front) {
    // Behind: what matters is left or right (and a little of up or down); straight behind is below.
    nx = cx;
    ny = Math.min(cy, 0) - Math.abs(cz) * 0.25;
    if (Math.abs(nx) < 1e-6 && Math.abs(ny) < 1e-6) ny = -1;
  }
  const angle = Math.atan2(-ny, nx);
  // To the edge of the box that is `margin` in from each side.
  const hx = 0.5 - margin;
  const hy = 0.5 - margin;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const s = Math.min(Math.abs(ux) > 1e-9 ? hx / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? hy / Math.abs(uy) : Infinity);
  out.onScreen = false;
  out.x = 0.5 + ux * s;
  out.y = 0.5 + uy * s;
  out.angle = angle;
  return out;
}

/** The camera, as much of it as the warnings need (a three.js PerspectiveCamera has all of it). */
export interface ThreatCamera {
  fov: number;
  aspect: number;
  matrixWorldInverse: { elements: ArrayLike<number> };
}

interface Marker {
  root: HTMLElement;
  key: string;
}

export class ThreatRing {
  readonly root = el('div', 'threats hidden');
  private readonly markers: Marker[] = [];
  private readonly threats: SquadThreat[] = [];
  private readonly spot: ScreenSpot = { x: 0, y: 0, onScreen: false, angle: 0 };
  private readonly flashUntil = new Map<number, number>();

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const root = el('div', 'threat hidden', [el('div', 'threat-arrow'), icon('st_charge', 'threat-icon')]);
      this.markers.push({ root, key: '' });
      this.root.append(root);
    }
  }

  /** A squad fired a volley: its diamond flashes. */
  volley(squad: number, now: number): void {
    this.flashUntil.set(squad, now + FLASH);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /**
   * `firstPerson`: the camera is in the head (on-screen guns get a diamond too; in third person
   * their lasers are in plain view).
   */
  update(k: SnapKaiju, units: readonly SnapUnit[], smokes: readonly SmokeShape[], camera: ThreatCamera, firstPerson: boolean, now: number): void {
    this.root.classList.remove('hidden');
    squadThreats(k, units, smokes, this.threats);
    const m = camera.matrixWorldInverse.elements;
    const fovY = (camera.fov * Math.PI) / 180;
    let used = 0;
    for (const t of this.threats) {
      if (used >= this.markers.length) break;
      // Into the camera's own space (three.js matrices are column-major).
      const cx = m[0] * t.x + m[4] * t.y + m[8] * t.z + m[12];
      const cy = m[1] * t.x + m[5] * t.y + m[9] * t.z + m[13];
      const cz = m[2] * t.x + m[6] * t.y + m[10] * t.z + m[14];
      const spot = screenSpot(cx, cy, cz, fovY, camera.aspect, 0.06, this.spot);
      if (spot.onScreen && !firstPerson) continue;
      const marker = this.markers[used++];
      const hot = t.charge >= COMBAT_RULES.volleyMinCharge;
      const flash = (this.flashUntil.get(t.squad) ?? 0) > now;
      const scale = 0.7 + t.charge * 0.6;
      const key = `${spot.x.toFixed(3)}:${spot.y.toFixed(3)}:${spot.onScreen ? 1 : 0}:${spot.angle.toFixed(2)}:${scale.toFixed(2)}:${hot ? 1 : 0}:${flash ? 1 : 0}`;
      if (marker.key === key) continue;
      marker.key = key;
      const r = marker.root;
      r.classList.remove('hidden');
      r.classList.toggle('edge', !spot.onScreen);
      r.classList.toggle('hot', hot);
      r.classList.toggle('flash', flash);
      r.style.left = `${(spot.x * 100).toFixed(2)}%`;
      r.style.top = `${(spot.y * 100).toFixed(2)}%`;
      r.style.setProperty('--scale', scale.toFixed(2));
      r.style.setProperty('--angle', `${spot.angle.toFixed(3)}rad`);
    }
    for (let i = used; i < this.markers.length; i++) {
      const marker = this.markers[i];
      if (marker.key === '') continue;
      marker.key = '';
      marker.root.classList.add('hidden');
    }
  }
}
