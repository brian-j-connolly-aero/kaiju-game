/**
 * The gas station's fireball (docs/ROADMAP.md phase 3: a fireball that reads as fire, not as the
 * solid faceted ball phase 2 drew). It is a cluster of lumpy, low-poly puffs of flame: white-hot
 * in the middle, orange round it, flung out and rolling upward, cooling through red to soot and
 * rising as a dark column of smoke. Each puff glows from within, is partly see-through at its
 * edges, and is eaten away unevenly as it fades. The flash, the shock rings, the sparks and the
 * fire left on the ruin stay the effects' (specialsView.ts).
 *
 * Every puff of every fireball is one instance of one mesh (one draw call), sorted back to front
 * each frame so the see-through puffs blend in the right order.
 */

import * as THREE from 'three';
import { hash32 } from '@mb/shared';

/** One puff of flame or smoke. */
interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Radius (meters) now, at birth and the one it swells toward. */
  size: number;
  from: number;
  to: number;
  /** How fast it swells (per second), and how much more it spreads once it is smoke (meters a second). */
  swell: number;
  spread: number;
  /** 1 white-hot .. 0 cold soot; it cools by `cool` a second. */
  heat: number;
  cool: number;
  /** Rising: meters a second squared per unit of heat (hot air rises fast), and drag on its sideways speed. */
  buoyancy: number;
  drag: number;
  /** Seconds lived (negative: not yet born) and its whole life. */
  t: number;
  life: number;
  /** Turn and turning speed (radians), and its own squash per axis. */
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  sx: number;
  sy: number;
  sz: number;
  /** How opaque it is at its fullest. */
  alpha: number;
}

/** The most puffs on screen at once (about four fireballs' worth, 61 puffs each; the oldest go first). */
const MAX_PUFFS = 240;
/** How long a fireball feeds its column from the ruin, and how often a puff goes up (seconds). */
const STREAM_TIME = 3.2;
const STREAM_EVERY = 0.1;
/** Drag on a puff's rise (per second), and how much of its buoyancy cold smoke keeps. */
const RISE_DRAG = 0.7;
const SMOKE_LIFT = 0.6;

/** Heat to color: white-hot, yellow, orange, red, dark red, soot (linear colors, from 1 down to 0). */
const HEAT_STOPS: readonly [number, number][] = [
  [1.0, 0xfff7d6],
  [0.82, 0xffd65a],
  [0.62, 0xffa22e],
  [0.44, 0xf06a1e],
  [0.28, 0xb8361a],
  [0.16, 0x5e3024],
  [0.06, 0x3d3532],
  [0.0, 0x4d4642],
];
const heatColors = HEAT_STOPS.map(([h, c]) => [h, new THREE.Color(c)] as const);

/** The color of a puff at heat `h` (0..1), into `out`. */
export function heatColor(h: number, out: THREE.Color): THREE.Color {
  const x = Math.min(1, Math.max(0, h));
  for (let i = 0; i + 1 < heatColors.length; i++) {
    const [ha, ca] = heatColors[i];
    const [hb, cb] = heatColors[i + 1];
    if (x <= ha && x >= hb) return out.copy(cb).lerp(ca, (x - hb) / Math.max(1e-6, ha - hb));
  }
  return out.copy(heatColors[heatColors.length - 1][1]);
}

/** How much of a puff is smoke (lit like a cloud, not glowing) at heat `h`: 0 flame .. 1 smoke. */
export function smokeShare(h: number): number {
  const t = Math.min(1, Math.max(0, (0.3 - h) / 0.22));
  return t * t * (3 - 2 * t);
}

/** A lumpy ball: an icosahedron whose corners are pushed in and out (the same corner the same way, so no cracks). */
function lumpyBall(): THREE.BufferGeometry {
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const g = ball.index ? ball.toNonIndexed() : ball;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = hash32(Math.round(x * 1000), Math.round(y * 1000), Math.round(z * 1000)) / 4294967296;
    const s = 0.82 + 0.34 * k;
    p.setXYZ(i, x * s, y * s, z * s);
  }
  g.computeVertexNormals();
  return g;
}

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 instanceFx;
varying vec3 vColor;
varying vec3 vFx;
varying vec3 vNormalW;
varying vec3 vToEye;
varying vec3 vLocal;
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  vNormalW = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * normal );
  vToEye = cameraPosition - world.xyz;
  vLocal = position;
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3( 1.0 );
  #endif
  vFx = instanceFx;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float smokeLight;
varying vec3 vColor;
varying vec3 vFx;
varying vec3 vNormalW;
varying vec3 vToEye;
varying vec3 vLocal;
void main() {
  // vFx: x how opaque, y how much of it is smoke, z how much of it the fading has eaten.
  // Blocky cells of the puff's own surface go first as it fades: broken, uneven edges.
  float cell = fract( sin( dot( floor( vLocal * 3.2 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  if ( cell < vFx.z ) discard;
  vec3 n = normalize( vNormalW );
  float facing = abs( dot( n, normalize( vToEye ) ) );
  // Flame glows from within, brightest where it faces the eye; smoke is lit from above like a cloud.
  float glow = 0.82 + 0.38 * facing;
  float lit = ( 0.55 + 0.45 * clamp( n.y * 0.5 + 0.5, 0.0, 1.0 ) ) * smokeLight;
  vec3 color = vColor * mix( glow, lit, vFx.y );
  // See-through toward the edges, smoke thinner than flame.
  float alpha = vFx.x * mix( 0.3 + 0.7 * facing, 0.35 + 0.45 * facing, vFx.y );
  gl_FragColor = vec4( color, alpha );
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();

export class Fireballs {
  readonly mesh: THREE.InstancedMesh;
  private readonly fx: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly puffs: Puff[] = [];
  /** Fireballs still feeding their column: where, how big, how long since the blast, and when the next puff goes up. */
  private readonly streams: { x: number; z: number; r: number; t: number; next: number }[] = [];
  private readonly order: number[] = [];
  private readonly depth: number[] = [];
  private seed = 9157;

  constructor() {
    const geometry = lumpyBall();
    this.fx = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3);
    this.fx.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('instanceFx', this.fx);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { smokeLight: { value: 1 } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.material.name = 'fireball';
    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_PUFFS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, tmpColor.set(0xffffff));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    // After the smoke sprites, before the bright bursts and glows (effects.ts).
    this.mesh.renderOrder = 14.5;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** How many puffs are alive (tests, the debug view). */
  get count(): number {
    return this.puffs.length;
  }

  clear(): void {
    this.puffs.length = 0;
    this.streams.length = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  private add(p: Omit<Puff, 'size' | 'rx' | 'ry' | 'rz' | 'wx' | 'wy' | 'wz' | 'sx' | 'sy' | 'sz'>): void {
    if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
    this.puffs.push({
      ...p,
      size: p.from,
      rx: this.rand() * 6.28,
      ry: this.rand() * 6.28,
      rz: this.rand() * 6.28,
      wx: (this.rand() - 0.5) * 1.6,
      wy: (this.rand() - 0.5) * 1.2,
      wz: (this.rand() - 0.5) * 1.6,
      sx: 0.85 + this.rand() * 0.3,
      sy: 0.78 + this.rand() * 0.3,
      sz: 0.85 + this.rand() * 0.3,
    });
  }

  /**
   * A fireball at (x, z) the size of a blast of `radius` meters: a white-hot core, a shell of
   * flame flung out and rolling up, a cap of soot over it, and for a few seconds a stream of
   * flame and smoke rising from the ruin into it, the column.
   */
  burst(x: number, z: number, radius: number): void {
    const r = Math.max(4, radius);
    const rand = (): number => this.rand();
    // The core: white-hot, swelling in the middle and rolling up.
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * r * 0.12;
      this.add({
        x: x + Math.cos(a) * d,
        y: r * (0.22 + rand() * 0.18),
        z: z + Math.sin(a) * d,
        vx: Math.cos(a) * r * 0.25,
        vy: r * (0.2 + rand() * 0.15),
        vz: Math.sin(a) * r * 0.25,
        from: r * 0.12,
        to: r * (0.3 + rand() * 0.1),
        swell: 6,
        spread: r * 0.05,
        heat: 1,
        cool: 0.3 + rand() * 0.08,
        buoyancy: r * 0.3,
        drag: 1.4,
        t: -rand() * 0.06,
        life: 2.9 + rand() * 0.6,
        alpha: 0.95,
      });
    }
    // The shell: flame flung out on all sides and up, slowing, rolling upward as it cools.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.4;
      const up = 0.1 + rand() * 0.75;
      const c = Math.cos(up);
      const speed = r * (0.7 + rand() * 0.5);
      this.add({
        x: x + Math.cos(a) * r * 0.15,
        y: r * 0.25,
        z: z + Math.sin(a) * r * 0.15,
        vx: Math.cos(a) * c * speed,
        vy: Math.sin(up) * speed * 0.7,
        vz: Math.sin(a) * c * speed,
        from: r * 0.08,
        to: r * (0.16 + rand() * 0.2),
        swell: 4,
        spread: r * 0.07,
        // Some yellow, some deep orange: an uneven fire, not one even ball.
        heat: 0.6 + rand() * 0.36,
        cool: 0.36 + rand() * 0.14,
        buoyancy: r * 0.3,
        drag: 2.3,
        t: -rand() * 0.12,
        life: 2.6 + rand() * 0.9,
        alpha: 0.88,
      });
    }
    // The cap: soot rolling out over the top, the start of the smoke that stays.
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * (0.1 + rand() * 0.3);
      this.add({
        x: x + Math.cos(a) * d,
        y: r * (0.9 + rand() * 0.3),
        z: z + Math.sin(a) * d,
        vx: Math.cos(a) * r * 0.2,
        vy: r * 0.15,
        vz: Math.sin(a) * r * 0.2,
        from: r * 0.18,
        to: r * (0.32 + rand() * 0.12),
        swell: 1.6,
        spread: r * 0.1,
        heat: 0.24,
        cool: 0.1,
        buoyancy: r * 0.22,
        drag: 0.8,
        t: -0.5 - rand() * 0.5,
        life: 4.6 + rand() * 1.2,
        alpha: 0.72,
      });
    }
    this.streams.push({ x, z, r, t: 0, next: 0.05 });
  }

  /** The column: puffs pushed up from the ruin, hot at first, then only smoke. */
  private feed(dt: number): void {
    for (let i = 0; i < this.streams.length; i++) {
      const s = this.streams[i];
      s.t += dt;
      while (s.next <= s.t && s.next < STREAM_TIME) {
        const k = s.next / STREAM_TIME;
        const r = s.r;
        this.add({
          x: s.x + (this.rand() - 0.5) * r * 0.25,
          y: r * 0.08,
          z: s.z + (this.rand() - 0.5) * r * 0.25,
          vx: (this.rand() - 0.5) * r * 0.12,
          vy: r * (0.45 + this.rand() * 0.25),
          vz: (this.rand() - 0.5) * r * 0.12,
          from: r * (0.1 + 0.06 * k),
          to: r * (0.17 + 0.08 * k + this.rand() * 0.05),
          swell: 3,
          spread: r * 0.08,
          heat: 0.9 - 0.75 * k,
          cool: 0.32,
          buoyancy: r * 0.22,
          drag: 1,
          // It has lived since it was due; `update` adds this frame's step to every puff after this.
          t: s.t - s.next - dt,
          life: 3.2 + this.rand() * 0.8,
          alpha: 0.85 - 0.15 * k,
        });
        s.next += STREAM_EVERY;
      }
      if (s.t >= STREAM_TIME) {
        this.streams.splice(i--, 1);
      }
    }
  }

  /**
   * Moves the puffs on, writes them into the mesh back to front, and sets how lit the smoke is
   * (`light`: 1 by day, less in the dusk and the dark).
   */
  update(dt: number, camera: THREE.Camera, light = 1): void {
    this.feed(dt);
    const list = this.puffs;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.t += dt;
      if (p.t >= p.life) {
        list[i] = list[list.length - 1];
        list.pop();
        i--;
        continue;
      }
      if (p.t < 0) continue;
      const heat = Math.max(0, p.heat - p.cool * p.t);
      const keep = Math.exp(-p.drag * dt);
      p.vx *= keep;
      p.vz *= keep;
      // Hot air rises fast; smoke keeps rising, slower, into a column.
      p.vy = p.vy * Math.exp(-RISE_DRAG * dt) + p.buoyancy * (SMOKE_LIFT + heat) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size = p.to + (p.from - p.to) * Math.exp(-p.swell * p.t) + p.spread * Math.max(0, p.t - 0.6);
      p.rx += p.wx * dt;
      p.ry += p.wy * dt;
      p.rz += p.wz * dt;
    }
    // Back to front.
    const cam = camera.position;
    const order = this.order;
    const depth = this.depth;
    order.length = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].t < 0) continue;
      order.push(i);
      depth[i] = (list[i].x - cam.x) ** 2 + (list[i].y - cam.y) ** 2 + (list[i].z - cam.z) ** 2;
    }
    order.sort((a, b) => depth[b] - depth[a]);
    let n = 0;
    for (const i of order) {
      const p = list[i];
      const u = p.t / p.life;
      const heat = Math.max(0, p.heat - p.cool * p.t);
      // In quickly, out over the last part of its life, eaten away as it goes.
      const alpha = p.alpha * Math.min(1, p.t / 0.05) * (u > 0.55 ? 1 - (u - 0.55) / 0.45 : 1);
      const eaten = u > 0.5 ? ((u - 0.5) / 0.5) * 0.85 : 0;
      tmpQuat.setFromEuler(tmpEuler.set(p.rx, p.ry, p.rz));
      tmpMatrix.compose(tmpPos.set(p.x, p.y, p.z), tmpQuat, tmpScale.set(p.size * p.sx, p.size * p.sy, p.size * p.sz));
      this.mesh.setMatrixAt(n, tmpMatrix);
      this.mesh.setColorAt(n, heatColor(heat, tmpColor));
      this.fx.setXYZ(n, alpha, smokeShare(heat), eaten);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.material.uniforms.smokeLight.value = light;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.fx.needsUpdate = true;
    }
  }
}
