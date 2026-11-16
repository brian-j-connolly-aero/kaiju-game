/**
 * The throw's trajectory preview (docs/ROADMAP.md, round 4: "a tube whose round cross-section
 * grows with distance, so the player reads at a glance where it can land"), on the monster
 * player's own screen only, whenever its hand holds something to throw.
 *
 * Every frame it works out the throw the server would make with this aim (the predicted body and
 * the aim the client sends; the same physics, sim/throwArc.ts) and draws:
 *
 *   the arc     the aimed arc from the hand to where it meets the city: a bright line.
 *   the tube    round it, the throw's spread at each point of its flight (`spreadAt`): its
 *               outline as the camera sees it (two lines either side of the arc, as far out as
 *               the spread there) and a few of its round cross-sections, faint. Seen from behind
 *               the monster a solid tube would be a blot over everything; drawn as an outline it
 *               reads as a tube widening toward where it lands, and what it passes over stays in
 *               view.
 *   the ring    where it can come down: the spread's ellipse on the ground or a roof (round for a
 *               lob, long for a flat throw; `landingSpread`), or its circle on a wall, with a
 *               faint fill and a dot where the aimed arc lands.
 *
 * Every line is a warm yellow with a dark edge, so it reads on a bright street or sky by day and
 * on the dark city at night; where a building stands in front of it, it shows through, fainter.
 * Nothing of it is the humans' cyan.
 */

import * as THREE from 'three';
import {
  createLandingSpread,
  createThrowFlight,
  createThrowLaunch,
  createThrowTrace,
  kaijuStageDef,
  landingSpread,
  spreadAt,
  strikeVerb,
  throwClearance,
  throwFlight,
  throwLaunch,
  traceThrow,
  type CityQuery,
  type SnapKaiju,
} from '@mb/shared';

/** Points along the arc's line, cross-section circles along it, and segments round each circle and the landing ring. */
const ARC_POINTS = 48;
const CIRCLES = 2;
const CIRCLE_SIDES = 24;
const ROUND = 64;
/** Line pieces the batch holds: the arc, its two outline edges, the circles, the landing ring; each drawn twice (edge and core). */
const CAPACITY = 2 * (ARC_POINTS * 3 + CIRCLES * CIRCLE_SIDES + ROUND);

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
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float soft = smoothstep(0.0, 0.35, across);
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

  push(a: THREE.Vector3, b: THREE.Vector3, width: number, r: number, g: number, bl: number, alpha: number): void {
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
    d[o + 7] = r;
    d[o + 8] = g;
    d[o + 9] = bl;
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

/** The core's color and the dark edge under it (linear). */
const CORE = new THREE.Color(1.0, 0.72, 0.12);
const EDGE = new THREE.Color(0.16, 0.07, 0.0);
const FILL = new THREE.Color(1.0, 0.75, 0.25);

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

export class ThrowPreview {
  readonly group = new THREE.Group();
  private readonly lines = new Ribbons();
  private readonly fill: THREE.Mesh;
  private readonly fillGeometry = new THREE.BufferGeometry();
  private readonly dot: THREE.Mesh;
  private readonly dotGeometry = new THREE.BufferGeometry();
  private readonly materials: THREE.Material[] = [];
  private readonly flight = createThrowFlight();
  private readonly launch = createThrowLaunch();
  /** The aimed arc as last traced (scripts read where it ends). */
  readonly trace = createThrowTrace();
  private readonly spread = createLandingSpread();
  /** Meters per pixel at one meter from the camera (set from the camera each frame). */
  private pixel = 0.0016;
  private readonly camera = new THREE.Vector3();

  constructor() {
    // The lines: once where nothing stands in front of them, and once more, faint, through whatever does.
    const shown = this.lines.material(1, true);
    const behind = this.lines.material(0.28, false);
    const front = new THREE.Mesh(this.lines.geometry, shown);
    const through = new THREE.Mesh(this.lines.geometry, behind);
    front.renderOrder = 23;
    through.renderOrder = 22;
    // The landing ring's faint fill and the dot where the aimed arc lands.
    this.fillGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ROUND + 2) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const fillIndex: number[] = [];
    for (let i = 0; i < ROUND; i++) fillIndex.push(0, i + 1, i + 2);
    this.fillGeometry.setIndex(fillIndex);
    this.dotGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ROUND + 2) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.dotGeometry.setIndex(fillIndex);
    const flat = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color: FILL, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.fill = new THREE.Mesh(this.fillGeometry, flat(0.2));
    this.dot = new THREE.Mesh(this.dotGeometry, flat(0.9));
    this.fill.renderOrder = 21;
    this.dot.renderOrder = 24;
    for (const m of [front, through, this.fill, this.dot]) {
      m.frustumCulled = false;
      this.materials.push(m.material as THREE.Material);
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /**
   * Draws the preview for the local kaiju `k` (predicted, its aim the one being sent), or hides
   * it: nothing to throw in the hand (or a sign, which is swung), swimming, helpless, or no city.
   * `firstPerson`: the camera is in the head (the arc starts a little out from the hand).
   * `night`: 0 by day to 1 at night.
   */
  update(k: SnapKaiju | null, city: CityQuery | null, camera: THREE.PerspectiveCamera, firstPerson: boolean, night: number): void {
    const show =
      k !== null &&
      city !== null &&
      k.alive &&
      k.held !== null &&
      strikeVerb(k.held) === 'throw' &&
      k.submerge <= 0 &&
      k.phase !== 'cocoon' &&
      k.phase !== 'stagger' &&
      k.phase !== 'dead' &&
      !(k.action === 'throw' && k.phase !== 'windup' && k.phase !== 'idle');
    this.group.visible = show;
    if (!show || !k || !city || !k.held) return;
    const st = kaijuStageDef(k.kind, k.stage);
    throwFlight(k.kind, k.stage, k.held, this.flight);
    const launch = throwLaunch(k, this.flight, this.launch);
    const trace = traceThrow(city, launch, throwClearance(k), this.trace);
    if (trace.count < 2) {
      this.group.visible = false;
      return;
    }
    this.camera.copy(camera.position);
    this.pixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / 720;
    // A touch heavier by day, when the city behind it is bright.
    const day = 1 - Math.max(0, Math.min(1, night));
    this.lines.begin();
    this.drawTube(launch.gravity, st.height, trace.time, firstPerson, day);
    this.drawRing(st.height, st.bodyRadius, day);
    this.lines.end();
  }

  /** Width on screen in pixels, as meters at point `p` (never thinner than `least`). */
  private width(p: THREE.Vector3, pixels: number, least: number): number {
    return Math.max(least, p.distanceTo(this.camera) * this.pixel * pixels);
  }

  /** One line piece: its dark edge, then its bright core. */
  private piece(a: THREE.Vector3, b: THREE.Vector3, pixels: number, least: number, alpha: number, day: number): void {
    const w = this.width(a, pixels, least);
    this.lines.push(a, b, w * 2.1, EDGE.r, EDGE.g, EDGE.b, alpha * (0.35 + 0.3 * day));
    this.lines.push(a, b, w, CORE.r, CORE.g, CORE.b, alpha);
  }

  private drawTube(gravity: number, height: number, time: number, firstPerson: boolean, day: number): void {
    const trace = this.trace;
    const launch = this.launch;
    const least = Math.max(0.02, height * 0.004);
    // In first person the hand is right under the camera: the line starts a little way out.
    const start = firstPerson ? Math.min(0.25, 0.12 + (height * 0.02) / Math.max(1, launch.speed)) : 0.02;
    // The aimed arc.
    for (let i = 0; i < ARC_POINTS - 1; i++) {
      const u0 = i / (ARC_POINTS - 1);
      const u1 = (i + 1) / (ARC_POINTS - 1);
      if (u1 < start) continue;
      pointAt(trace.points, trace.count, time * Math.max(u0, start), p0);
      pointAt(trace.points, trace.count, time * u1, p1);
      const fade = Math.min(1, (u0 - start) / 0.1 + 0.25);
      this.piece(p0, p1, 3.5, least, fade, day);
    }
    // The tube's outline as the camera sees it: its two edges, either side of the arc square to
    // the line of sight (from behind the monster, a funnel opening toward where it lands).
    for (let i = 0; i < ARC_POINTS - 1; i++) {
      const u0 = i / (ARC_POINTS - 1);
      const u1 = (i + 1) / (ARC_POINTS - 1);
      if (u0 < start) continue;
      for (const sign of [-1, 1]) {
        this.edgeAt(gravity, time * u0, sign, q0);
        this.edgeAt(gravity, time * u1, sign, q1);
        this.piece(q0, q1, 1.8, least, 0.55, day);
      }
    }
    // A few of its round cross-sections, faint (where it lands, the ring shows it).
    for (let c = 1; c <= CIRCLES; c++) {
      const u = c / (CIRCLES + 1);
      if (u < start + 0.1) continue;
      const t = time * u;
      this.frameAt(gravity, t);
      pointAt(trace.points, trace.count, t, p0);
      const r = Math.max(least, spreadAt(launch, t));
      for (let j = 0; j < CIRCLE_SIDES; j++) {
        this.onCircle(p0, r, j / CIRCLE_SIDES, q0);
        this.onCircle(p0, r, (j + 1) / CIRCLE_SIDES, q1);
        this.piece(q0, q1, 1.2, least, 0.2 + 0.25 * u, day);
      }
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

  private drawRing(height: number, bodyRadius: number, day: number): void {
    const trace = this.trace;
    const spread = landingSpread(this.launch, trace, this.spread);
    const least = bodyRadius * 0.35;
    let along = Math.max(least, spread.along);
    const side = Math.max(least, spread.across);
    // The plane it is drawn in: the ground or a roof, along the flight; a wall, square to it.
    normal.set(trace.nx, trace.ny, trace.nz);
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    normal.normalize();
    if (normal.y > 0.5) {
      axisA.set(spread.dirX, 0, spread.dirZ);
      axisB.set(spread.dirZ, 0, -spread.dirX);
    } else {
      axisA.set(0, 1, 0);
      axisB.crossVectors(normal, axisA).normalize();
      along = side;
    }
    const lift = Math.max(0.05, height * 0.008);
    const cx = trace.x + normal.x * lift;
    const cy = Math.max(lift, trace.y + normal.y * lift);
    const cz = trace.z + normal.z * lift;
    const fill = (this.fillGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const dot = (this.dotGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const center = p0.set(cx, cy, cz);
    const dotR = Math.max(this.width(center, 7, lift * 2), Math.min(along, side) * 0.07);
    fill[0] = cx;
    fill[1] = cy;
    fill[2] = cz;
    dot[0] = cx;
    dot[1] = cy;
    dot[2] = cz;
    for (let i = 0; i <= ROUND; i++) {
      const a = (i / ROUND) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const ox = axisA.x * c * along + axisB.x * s * side;
      const oy = axisA.y * c * along + axisB.y * s * side;
      const oz = axisA.z * c * along + axisB.z * s * side;
      const f = (i + 1) * 3;
      fill[f] = cx + ox;
      fill[f + 1] = cy + oy;
      fill[f + 2] = cz + oz;
      dot[f] = cx + (axisA.x * c + axisB.x * s) * dotR;
      dot[f + 1] = cy + (axisA.y * c + axisB.y * s) * dotR;
      dot[f + 2] = cz + (axisA.z * c + axisB.z * s) * dotR;
      if (i > 0) {
        q0.set(fill[f - 3], fill[f - 2], fill[f - 1]);
        q1.set(fill[f], fill[f + 1], fill[f + 2]);
        this.piece(q0, q1, 6, lift, 1, day);
      }
    }
    for (const g of [this.fillGeometry, this.dotGeometry]) (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.fillGeometry.dispose();
    this.dotGeometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
