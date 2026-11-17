/**
 * The monster's aim on its own screen (docs/ROADMAP.md, round 5: "the preview must be impossible
 * to miss by day and by night: a bold landing marker, a bold arc, a clearly visible widening
 * tube"), on the monster player's own screen only.
 *
 * Whenever its hand holds something to throw, every frame it works out the throw the server would
 * make with this aim (the predicted body and the aim the client sends: the crosshair's throw,
 * game/controllers/kaijuController.ts; the same physics, sim/throwArc.ts) and draws:
 *
 *   the arc     the aimed arc from the hand to where it meets the city: a thick ribbon with an
 *               ink edge, marks running along it toward where it lands. Faint near the hand
 *               (from behind the monster that part is all in front of the camera).
 *   the tube    round it, the throw's spread at each point of its flight (`spreadAt`): its
 *               outline as the camera sees it, widening toward where it lands (third person); in
 *               first person, where the outline would read as goalposts, two rings across it near
 *               the end instead.
 *   landing     the blast's disc, filled, with a bold rim; the spread's ellipse round it, dashed
 *               (round for a lob, long for a flat throw; `landingSpread`), or its circle on a wall;
 *               a dot where the aimed arc lands; four brackets facing the camera round it, never
 *               under 34 pixels out (so a titan's throw 700 m away still reads); and a post of
 *               light standing up from it, seen over the roofs.
 *
 * Every width is in pixels on a 720-line screen, so it reads the same at every stage. A deep
 * orange with a near-black ink edge reads on a bright street or sky by day and on the dark city
 * at night; where a building stands in front of it, it shows through, fainter. When the throw
 * cannot get to the crosshair's point (`ThrowAimView.reach`: too far, blocked, too close) it all
 * turns red, and the screen says why in a word or two (ui/kaijuSight.ts). Nothing of it is the
 * humans' cyan.
 *
 * In a charge's wind-up and run it also draws the charge's lane on the ground, as wide as the body
 * and as long as the run, and outlines in red the first building in it too tall to smash (the
 * controller finds it; the word 'Too tall' is the HUD's).
 */

import * as THREE from 'three';
import {
  createLandingSpread,
  createThrowFlight,
  createThrowLaunch,
  createThrowTrace,
  kaijuKindDef,
  kaijuStageDef,
  landingSpread,
  perStage,
  spreadAt,
  strikeVerb,
  throwClearance,
  throwFlight,
  throwLaunch,
  traceThrow,
  type CityQuery,
  type SnapKaiju,
  type ThrowReach,
} from '@mb/shared';
import type { AimWord } from '../ui/labels';

/** What the crosshair is on for a throw, and what the throw does there (the controller's `aim.throw`). */
export interface ThrowAimView {
  /** Where the crosshair points: the ground, a roof or wall, a unit (its feet), or nothing (the sky). */
  on: 'ground' | 'structure' | 'unit' | 'none';
  /** The crosshair's point (on the sky: the point far out along the view the throw was aimed at). */
  x: number;
  y: number;
  z: number;
  /** Whether the throw gets there ('on'), and if not why (sim/throwArc.ts `ThrowReach`). */
  reach: ThrowReach;
  /** The game picked the lob. */
  high: boolean;
  /** Where the picked arc comes down. */
  landX: number;
  landY: number;
  landZ: number;
}

/** A charge's lane ahead of the monster, in its wind-up and run (the controller's `aim.lane`). */
export interface ChargeLaneView {
  /** The body when it was worked out, and its heading. */
  x: number;
  z: number;
  yaw: number;
  /** Half the lane's width (the body's radius). */
  half: number;
  /** How far the run goes along it (to the run's end, or to where something stops it). */
  length: number;
  /** The first building in it too tall to smash, or -1. */
  blocker: number;
}

/** The one- or two-word labels the monster's screen shows beside what cannot be reached (ui/labels.ts). */
export type { AimWord };

/** Something the monster aims at that it cannot reach: the word, and the point it goes under. */
export interface AimWarning {
  word: AimWord;
  x: number;
  y: number;
  z: number;
  /** What the crosshair is on cannot be reached (a throw, the beam): the crosshair says so too. */
  crosshair: boolean;
}

/** The local monster's aim as its controller has it this frame (`RenderView.kaijuAim`). */
export interface KaijuAimView {
  /** Where the view looks (the head carries the first-person camera and follows it). */
  yaw: number;
  pitch: number;
  /** A throw aimed with the crosshair, or null (nothing to throw, or the autopilot aims). */
  throw: ThrowAimView | null;
  /** A charge's lane, or null. */
  lane: ChargeLaneView | null;
  /** What cannot be reached right now, or null. */
  warning: AimWarning | null;
}

/** Points along the arc, segments round a ring across the tube, round the landing marks. */
const ARC_POINTS = 48;
const CIRCLE_SIDES = 28;
const ROUND = 64;
/** Ribbon pieces the batch holds: everything above, each drawn twice (ink and core), with room to spare. */
const CAPACITY = 1400;

const VERTEX = /* glsl */ `
attribute vec3 iStart;
attribute vec3 iEnd;
attribute float iWidth;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv;
  vColor = iColor;
  vec3 p = mix(iStart, iEnd, position.y + 0.5);
  vec3 dir = iEnd - iStart;
  vec3 toCam = cameraPosition - p;
  vec3 side = cross(dir, toCam);
  float len = length(side);
  side = len > 0.00001 ? side / len : vec3(1.0, 0.0, 0.0);
  p += side * (position.x * iWidth);
  // Half a width past each end, so the pieces of a curve join without gaps.
  float dl = length(dir);
  if (dl > 0.00001) p += dir / dl * (position.y * iWidth);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float soft = smoothstep(0.0, 0.12, across);
  gl_FragColor = vec4(vColor.rgb, vColor.a * soft * uOpacity);
  #include <colorspace_fragment>
}
`;

const FLOATS = 11;

/** Camera-facing line pieces drawn with ordinary see-through blending (not added light: it must read by day). */
class Ribbons {
  readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly data = new Float32Array(CAPACITY * FLOATS);
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private count = 0;

  constructor() {
    const g = this.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, FLOATS);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iStart', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    g.setAttribute('iEnd', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    g.setAttribute('iWidth', new THREE.InterleavedBufferAttribute(this.buffer, 1, 6));
    g.setAttribute('iColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 7));
    g.instanceCount = 0;
  }

  material(opacity: number, depthTest: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: opacity } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest,
      side: THREE.DoubleSide,
    });
  }

  begin(): void {
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  push(a: THREE.Vector3, b: THREE.Vector3, width: number, c: THREE.Color, alpha: number): void {
    if (this.count >= CAPACITY) return;
    const d = this.data;
    const o = this.count * FLOATS;
    d[o] = a.x;
    d[o + 1] = a.y;
    d[o + 2] = a.z;
    d[o + 3] = b.x;
    d[o + 4] = b.y;
    d[o + 5] = b.z;
    d[o + 6] = width;
    d[o + 7] = c.r;
    d[o + 8] = c.g;
    d[o + 9] = c.b;
    d[o + 10] = alpha;
    this.count++;
  }

  end(): void {
    this.geometry.instanceCount = this.count;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, this.count * FLOATS);
    this.buffer.needsUpdate = true;
  }
}

/** Colors (linear): a deep orange with a pale highlight; red with a pink one when it cannot get there; the ink under everything. */
const GOLD = new THREE.Color(1.0, 0.42, 0.015);
const GOLD_HI = new THREE.Color(1.0, 0.86, 0.45);
const RED = new THREE.Color(1.0, 0.05, 0.03);
const RED_HI = new THREE.Color(1.0, 0.55, 0.45);
const INK = new THREE.Color(0.012, 0.006, 0.0);
const INK_ALPHA = 0.92;
/** The landing disc's fill, and the spread's. */
const DISC_FILL = 0.38;
const SPREAD_FILL = 0.12;
/** Opacity of the pass drawn through whatever stands in front. */
const THROUGH = 0.38;

const tangent = new THREE.Vector3();
const across = new THREE.Vector3();
const upward = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const axisA = new THREE.Vector3();
const axisB = new THREE.Vector3();
const normal = new THREE.Vector3();
const p0 = new THREE.Vector3();
const p1 = new THREE.Vector3();
const q0 = new THREE.Vector3();
const q1 = new THREE.Vector3();
const ringCenter = new THREE.Vector3();
const mark = new THREE.Color();

/** The point of the traced arc at time `t` (straight between ticks: a tick is a thirtieth of a second). */
function pointAt(points: Float64Array, count: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  let lo = 0;
  let hi = count - 1;
  if (t <= points[3]) return out.set(points[0], points[1], points[2]);
  if (t >= points[hi * 4 + 3]) return out.set(points[hi * 4], points[hi * 4 + 1], points[hi * 4 + 2]);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid * 4 + 3] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = points[lo * 4 + 3];
  const t1 = points[hi * 4 + 3];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return out.set(
    points[lo * 4] + (points[hi * 4] - points[lo * 4]) * f,
    points[lo * 4 + 1] + (points[hi * 4 + 1] - points[lo * 4 + 1]) * f,
    points[lo * 4 + 2] + (points[hi * 4 + 2] - points[lo * 4 + 2]) * f,
  );
}

/** A filled fan of ROUND triangles about a middle point (the landing disc, the spread's fill). */
function fanGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ROUND + 2) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const index: number[] = [];
  for (let i = 0; i < ROUND; i++) index.push(0, i + 1, i + 2);
  g.setIndex(index);
  return g;
}

export class ThrowPreview {
  readonly group = new THREE.Group();
  private readonly lines = new Ribbons();
  private readonly discGeometry = fanGeometry();
  private readonly spreadGeometry = fanGeometry();
  private readonly disc: THREE.Mesh;
  private readonly spreadFill: THREE.Mesh;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly spreadMat: THREE.MeshBasicMaterial;
  private readonly materials: THREE.Material[] = [];
  private readonly flight = createThrowFlight();
  private readonly launch = createThrowLaunch();
  /** The aimed arc as last traced (scripts read where it ends). */
  readonly trace = createThrowTrace();
  private readonly spread = createLandingSpread();
  /** Meters per pixel at one meter from the camera, on a 720-line screen (set from the camera each frame). */
  private pixel = 0.0016;
  private readonly camera = new THREE.Vector3();
  /** Whether the throw's landing marks were drawn this frame (scripts and tests). */
  shown = false;

  constructor() {
    // The ribbons: once where nothing stands in front of them, and once more, fainter, through whatever does.
    const front = new THREE.Mesh(this.lines.geometry, this.lines.material(1, true));
    const through = new THREE.Mesh(this.lines.geometry, this.lines.material(THROUGH, false));
    front.renderOrder = 23;
    through.renderOrder = 22;
    const flat = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.discMat = flat(DISC_FILL);
    this.spreadMat = flat(SPREAD_FILL);
    this.disc = new THREE.Mesh(this.discGeometry, this.discMat);
    this.spreadFill = new THREE.Mesh(this.spreadGeometry, this.spreadMat);
    this.disc.renderOrder = 21;
    this.spreadFill.renderOrder = 20;
    for (const m of [front, through, this.disc, this.spreadFill]) {
      m.frustumCulled = false;
      this.materials.push(m.material as THREE.Material);
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /**
   * Draws the preview for the local kaiju `k` (predicted, its aim the one being sent), or hides
   * it: nothing to throw in the hand (or a sign, which is swung), swimming, helpless, or no city.
   * `firstPerson`: the camera is in the head. `aim`: the controller's aim this frame (the throw's
   * reach turns it red; a charge's lane), or null. `now`: seconds, for the marks running along
   * the arc. The same colors serve by day and at night: the ink edge reads on both.
   */
  update(k: SnapKaiju | null, city: CityQuery | null, camera: THREE.PerspectiveCamera, firstPerson: boolean, aim: KaijuAimView | null, now: number): void {
    this.shown = false;
    this.group.visible = false;
    if (!k || !city || !k.alive) return;
    this.camera.copy(camera.position);
    this.pixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / 720;
    this.lines.begin();
    const throwing =
      k.held !== null &&
      strikeVerb(k.held) === 'throw' &&
      k.submerge <= 0 &&
      k.phase !== 'cocoon' &&
      k.phase !== 'stagger' &&
      k.phase !== 'dead' &&
      !(k.action === 'throw' && k.phase !== 'windup' && k.phase !== 'idle');
    this.disc.visible = false;
    this.spreadFill.visible = false;
    if (throwing && k.held) {
      const st = kaijuStageDef(k.kind, k.stage);
      throwFlight(k.kind, k.stage, k.held, this.flight);
      const launch = throwLaunch(k, this.flight, this.launch);
      const trace = traceThrow(city, launch, throwClearance(k), this.trace);
      if (trace.count >= 2) {
        const bad = aim?.throw ? aim.throw.reach !== 'on' : false;
        const core = bad ? RED : GOLD;
        const hi = bad ? RED_HI : GOLD_HI;
        this.drawArc(st.height, firstPerson, core, hi, now);
        this.drawLanding(st.height, perStage(kaijuKindDef(k.kind).actions.throw.impactRadius, k.stage), core, hi);
        this.shown = true;
      }
    }
    if (aim?.lane && k.action === 'charge') this.drawLane(k, aim.lane, city);
    this.lines.end();
    this.group.visible = this.lines.size > 0;
  }

  /** Width on screen in pixels (720 lines), as meters at point `p`. */
  private width(p: THREE.Vector3, pixels: number): number {
    return p.distanceTo(this.camera) * this.pixel * pixels;
  }

  /** A line piece: a dark ink edge (`ink` pixels wider) under a colored core `pixels` wide. */
  private inked(a: THREE.Vector3, b: THREE.Vector3, pixels: number, ink: number, c: THREE.Color, alpha: number): void {
    const w = this.width(a, pixels);
    this.lines.push(a, b, w + this.width(a, ink), INK, alpha * INK_ALPHA);
    this.lines.push(a, b, w, c, alpha);
  }

  private drawArc(height: number, firstPerson: boolean, core: THREE.Color, hi: THREE.Color, now: number): void {
    const trace = this.trace;
    const launch = this.launch;
    const time = trace.time;
    const g = launch.gravity;
    // In first person the hand is right under the camera: the line starts a little way out.
    const start = firstPerson ? Math.min(0.25, 0.12 + (height * 0.02) / Math.max(1, launch.speed)) : 0.02;
    // The arc: a thick ribbon, marks running along it toward where it lands.
    for (let i = 0; i < ARC_POINTS - 1; i++) {
      const u0 = i / (ARC_POINTS - 1);
      const u1 = (i + 1) / (ARC_POINTS - 1);
      if (u1 < start) continue;
      pointAt(trace.points, trace.count, time * Math.max(u0, start), p0);
      pointAt(trace.points, trace.count, time * u1, p1);
      const run = u0 * 9 - now * 1.2;
      mark.copy(run - Math.floor(run) < 0.4 ? hi : core);
      // Faint near the hand, full from 30% of the flight on.
      const fade = Math.min(1, Math.max(0.15, (u0 - start) / 0.3));
      this.inked(p0, p1, 8, 6, mark, fade);
    }
    if (!firstPerson) {
      // The tube's outline as the camera sees it: its two edges, either side of the arc square to
      // the line of sight (from behind the monster, a funnel opening toward where it lands).
      for (let i = 0; i < ARC_POINTS - 1; i++) {
        const u0 = i / (ARC_POINTS - 1);
        const u1 = (i + 1) / (ARC_POINTS - 1);
        if (u0 < Math.max(start, 0.25)) continue;
        for (const sign of [-1, 1]) {
          this.edgeAt(g, time * u0, sign, q0);
          this.edgeAt(g, time * u1, sign, q1);
          this.inked(q0, q1, 3, 4, core, Math.min(0.85, (u0 - 0.25) / 0.25));
        }
      }
    } else {
      // From inside the head the outline reads as goalposts: two thin rings across the tube near
      // the end instead (bolder, they would frame the target like a gunsight and hide it).
      for (const u of [0.8, 0.92]) this.ringAcross(g, time * u, core);
    }
  }

  /** A ring across the tube at time `t` (its spread there). */
  private ringAcross(gravity: number, t: number, c: THREE.Color): void {
    this.frameAt(gravity, t);
    const center = pointAt(this.trace.points, this.trace.count, t, ringCenter);
    const r = spreadAt(this.launch, t);
    for (let j = 0; j < CIRCLE_SIDES; j++) {
      this.onCircle(center, r, j / CIRCLE_SIDES, q0);
      this.onCircle(center, r, (j + 1) / CIRCLE_SIDES, q1);
      this.inked(q0, q1, 3, 3, c, 0.5);
    }
  }

  /** A point on the tube's outline at time `t`: the arc there, moved its spread square to the arc and to the line of sight (`sign`: which side). */
  private edgeAt(gravity: number, t: number, sign: number, out: THREE.Vector3): THREE.Vector3 {
    const l = this.launch;
    pointAt(this.trace.points, this.trace.count, t, out);
    tangent.set(l.vx, l.vy - gravity * t, l.vz).normalize();
    upward.subVectors(this.camera, out).normalize();
    across.crossVectors(tangent, upward);
    if (across.lengthSq() < 1e-6) across.crossVectors(tangent, UP);
    if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
    across.normalize();
    return out.addScaledVector(across, sign * spreadAt(l, t));
  }

  /** Sets `across` and `upward` square to the arc at time `t`. */
  private frameAt(gravity: number, t: number): void {
    const l = this.launch;
    tangent.set(l.vx, l.vy - gravity * t, l.vz).normalize();
    across.crossVectors(tangent, UP);
    if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
    across.normalize();
    upward.crossVectors(across, tangent).normalize();
  }

  /** The point a share `f` of the way round the circle of radius `r` about `center`, square to the arc (`frameAt`). */
  private onCircle(center: THREE.Vector3, r: number, f: number, out: THREE.Vector3): THREE.Vector3 {
    const a = f * Math.PI * 2;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    return out.set(center.x + across.x * c + upward.x * s, center.y + across.y * c + upward.y * s, center.z + across.z * c + upward.z * s);
  }

  /** Where it lands: the blast's disc with a bold rim, the spread's ellipse dashed, a dot, brackets and a post of light. */
  private drawLanding(height: number, impact: number, core: THREE.Color, hi: THREE.Color): void {
    const trace = this.trace;
    const spread = landingSpread(this.launch, trace, this.spread);
    // The plane it is drawn in: the ground or a roof, along the flight; a wall, square to it.
    normal.set(trace.nx, trace.ny, trace.nz);
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    normal.normalize();
    let along = spread.along;
    const side = spread.across;
    if (normal.y > 0.5) {
      axisA.set(spread.dirX, 0, spread.dirZ);
      axisB.set(spread.dirZ, 0, -spread.dirX);
    } else {
      axisA.set(0, 1, 0);
      axisB.crossVectors(normal, axisA).normalize();
      along = side;
    }
    const lift = Math.max(0.05, height * 0.008);
    const center = p0.set(trace.x + normal.x * lift, Math.max(lift, trace.y + normal.y * lift), trace.z + normal.z * lift);
    const cx = center.x;
    const cy = center.y;
    const cz = center.z;
    // The blast, never smaller on screen than 22 pixels in radius; the spread never smaller than it.
    const blast = Math.max(impact, this.width(center, 22));
    const sAlong = Math.max(along, blast);
    const sSide = Math.max(side, blast);
    const disc = (this.discGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const fill = (this.spreadGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    disc[0] = fill[0] = cx;
    disc[1] = fill[1] = cy;
    disc[2] = fill[2] = cz;
    for (let i = 0; i <= ROUND; i++) {
      const a = (i / ROUND) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const f = (i + 1) * 3;
      disc[f] = cx + (axisA.x * c + axisB.x * s) * blast;
      disc[f + 1] = cy + (axisA.y * c + axisB.y * s) * blast;
      disc[f + 2] = cz + (axisA.z * c + axisB.z * s) * blast;
      fill[f] = cx + axisA.x * c * sAlong + axisB.x * s * sSide;
      fill[f + 1] = cy + axisA.y * c * sAlong + axisB.y * s * sSide;
      fill[f + 2] = cz + axisA.z * c * sAlong + axisB.z * s * sSide;
      if (i === 0) continue;
      // The blast's rim: bold.
      q0.set(disc[f - 3], disc[f - 2], disc[f - 1]);
      q1.set(disc[f], disc[f + 1], disc[f + 2]);
      this.inked(q0, q1, 7, 6, core, 1);
      // The spread's ellipse: dashed, two pieces drawn of every four.
      if (i % 4 < 2) {
        q0.set(fill[f - 3], fill[f - 2], fill[f - 1]);
        q1.set(fill[f], fill[f + 1], fill[f + 2]);
        this.inked(q0, q1, 4, 5, hi, 0.95);
      }
    }
    // The dot where the aimed arc lands.
    const dotR = this.width(center, 5);
    for (let j = 0; j < 12; j++) {
      const a0 = (j / 12) * Math.PI * 2;
      const a1 = ((j + 1) / 12) * Math.PI * 2;
      q0.set(cx + (axisA.x * Math.cos(a0) + axisB.x * Math.sin(a0)) * dotR, cy + (axisA.y * Math.cos(a0) + axisB.y * Math.sin(a0)) * dotR, cz + (axisA.z * Math.cos(a0) + axisB.z * Math.sin(a0)) * dotR);
      q1.set(cx + (axisA.x * Math.cos(a1) + axisB.x * Math.sin(a1)) * dotR, cy + (axisA.y * Math.cos(a1) + axisB.y * Math.sin(a1)) * dotR, cz + (axisA.z * Math.cos(a1) + axisB.z * Math.sin(a1)) * dotR);
      this.inked(q0, q1, 6, 4, hi, 1);
    }
    // Four brackets facing the camera round where it lands, 34 pixels out at least: seen at any distance.
    upward.subVectors(this.camera, center).normalize();
    across.crossVectors(upward, UP);
    if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
    across.normalize();
    tangent.crossVectors(across, upward).normalize();
    const rr = Math.max(this.width(center, 34), blast * 1.25);
    for (let b = 0; b < 4; b++) {
      const mid = Math.PI / 4 + (b * Math.PI) / 2;
      for (let j = -2; j < 2; j++) {
        const a0 = mid + j * 0.16;
        const a1 = mid + (j + 1) * 0.16;
        q0.set(cx + (across.x * Math.cos(a0) + tangent.x * Math.sin(a0)) * rr, cy + (across.y * Math.cos(a0) + tangent.y * Math.sin(a0)) * rr, cz + (across.z * Math.cos(a0) + tangent.z * Math.sin(a0)) * rr);
        q1.set(cx + (across.x * Math.cos(a1) + tangent.x * Math.sin(a1)) * rr, cy + (across.y * Math.cos(a1) + tangent.y * Math.sin(a1)) * rr, cz + (across.z * Math.cos(a1) + tangent.z * Math.sin(a1)) * rr);
        this.inked(q0, q1, 6, 5, hi, 1);
      }
    }
    // A post of light standing up from where it lands (seen over roofs and from far off), fading to the top.
    const top = height * 1.6;
    for (let i = 0; i < 8; i++) {
      q0.set(cx, cy + (top * i) / 8, cz);
      q1.set(cx, cy + (top * (i + 1)) / 8, cz);
      this.inked(q0, q1, 5, 4, core, 1 - i / 9);
    }
    this.discMat.color.copy(core);
    this.spreadMat.color.copy(core);
    this.disc.visible = true;
    this.spreadFill.visible = true;
    for (const g of [this.discGeometry, this.spreadGeometry]) (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * A charge's lane on the ground, from the body (as predicted now) to where the run ends: its two
   * edges and chevrons pointing along it; red at its end, with the building that stops it
   * outlined, when one does.
   */
  private drawLane(k: SnapKaiju, lane: ChargeLaneView, city: CityQuery): void {
    const height = kaijuStageDef(k.kind, k.stage).height;
    const dx = Math.sin(lane.yaw);
    const dz = Math.cos(lane.yaw);
    // The end stays where the controller found it; the start rides the body as drawn.
    const ex = lane.x + dx * lane.length;
    const ez = lane.z + dz * lane.length;
    const startAlong = (k.x - lane.x) * dx + (k.z - lane.z) * dz + lane.half;
    const length = lane.length - startAlong;
    if (length <= 0) return;
    const y = Math.max(0.08, height * 0.01);
    const blocked = lane.blocker >= 0;
    const rx = -dz;
    const rz = dx;
    const sx = lane.x + dx * startAlong;
    const sz = lane.z + dz * startAlong;
    for (const sign of [-1, 1]) {
      p0.set(sx + rx * lane.half * sign, y, sz + rz * lane.half * sign);
      p1.set(ex + rx * lane.half * sign, y, ez + rz * lane.half * sign);
      this.inked(p0, p1, 4, 4, GOLD, 0.9);
    }
    // Chevrons along it, pointing the way it runs.
    const count = Math.max(2, Math.min(8, Math.round(length / (lane.half * 3))));
    for (let i = 1; i <= count; i++) {
      const d = (length * i) / (count + 1);
      const mx = sx + dx * d;
      const mz = sz + dz * d;
      const back = lane.half * 0.6;
      for (const sign of [-1, 1]) {
        p0.set(mx + rx * lane.half * 0.7 * sign - dx * back, y, mz + rz * lane.half * 0.7 * sign - dz * back);
        p1.set(mx, y, mz);
        this.inked(p0, p1, 4, 4, GOLD_HI, 0.8);
      }
    }
    // Its end: a bar across, red where something stops it.
    p0.set(ex + rx * lane.half * 1.2, y, ez + rz * lane.half * 1.2);
    p1.set(ex - rx * lane.half * 1.2, y, ez - rz * lane.half * 1.2);
    this.inked(p0, p1, blocked ? 7 : 5, 5, blocked ? RED : GOLD, 1);
    if (!blocked) return;
    // The building too tall to smash: its outline, at the ground and at the roof, and its corners.
    const idx = city.index;
    const id = lane.blocker;
    const top = idx.sheight[id];
    for (let c = 0; c < 4; c++) {
      this.corner(idx.sx[id], idx.sz[id], idx.shx[id], idx.shz[id], idx.scos[id], idx.ssin[id], c, q0);
      this.corner(idx.sx[id], idx.sz[id], idx.shx[id], idx.shz[id], idx.scos[id], idx.ssin[id], c + 1, q1);
      p0.set(q0.x, y, q0.z);
      p1.set(q1.x, y, q1.z);
      this.inked(p0, p1, 6, 5, RED, 1);
      p0.y = p1.y = top;
      this.inked(p0, p1, 6, 5, RED, 1);
      p1.set(q0.x, y, q0.z);
      this.inked(p0.set(q0.x, top, q0.z), p1, 5, 5, RED, 1);
    }
  }

  /** Corner `c` (0..3, round the box) of a structure's footprint, into `out` (x, z). */
  private corner(x: number, z: number, hx: number, hz: number, cos: number, sin: number, c: number, out: THREE.Vector3): THREE.Vector3 {
    const i = c % 4;
    const lx = (i === 0 || i === 3 ? -1 : 1) * hx;
    const lz = (i < 2 ? -1 : 1) * hz;
    return out.set(x + lx * cos + lz * sin, 0, z - lx * sin + lz * cos);
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.discGeometry.dispose();
    this.spreadGeometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
