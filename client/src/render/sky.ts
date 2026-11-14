/**
 * Sky, fog and lighting for the three times of day (DESIGN.md section 2: afternoon, sunset,
 * night). The sky is a gradient dome that follows the camera, with a sun or moon disc and two
 * cloud panoramas on horizon rings around the camera (towers standing on the horizon, with a
 * gap for the sunset sun: docs/art/client-notes-sprites-textures.md note 1); fog and haze sell
 * the scale, and there are no shadow maps.
 */

import * as THREE from 'three';
import type { TimeOfDay } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';

interface Preset {
  top: number;
  horizon: number;
  ground: number;
  fog: number;
  sun: number;
  sunIntensity: number;
  /** Direction TO the sun or moon. */
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  cloud: number;
  /** 0 by day, 1 at night: window lights. */
  night: number;
  /** 1 at sunset, 0 otherwise: how much the ground is warmed against the violet sky light. */
  sunset: number;
  /** Size and color of the sun or moon disc. */
  disc: number;
  discSize: number;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  afternoon: {
    top: 0x2f7fe0,
    horizon: 0xbfe6ff,
    ground: 0x9fc4dd,
    fog: 0xc4e0f4,
    sun: 0xfff2d6,
    sunIntensity: 2.6,
    sunDir: [0.45, 0.78, 0.35],
    hemiSky: 0xcfe8ff,
    hemiGround: 0xb3b0a4,
    hemiIntensity: 1.5,
    cloud: 0xffffff,
    night: 0,
    sunset: 0,
    disc: 0xfffbe6,
    discSize: 260,
  },
  sunset: {
    top: 0x3a3a8c,
    horizon: 0xff9a5c,
    ground: 0xc77a5e,
    fog: 0xe9a07c,
    sun: 0xffa45c,
    sunIntensity: 2.3,
    sunDir: [-0.82, 0.2, -0.45],
    hemiSky: 0xb9a0e6,
    hemiGround: 0x7a5a52,
    hemiIntensity: 1.25,
    cloud: 0xffc9a8,
    night: 0.35,
    sunset: 1,
    disc: 0xffd08a,
    discSize: 420,
  },
  night: {
    top: 0x04071a,
    horizon: 0x1c2a52,
    ground: 0x10162c,
    fog: 0x141d3a,
    sun: 0x9db8ff,
    sunIntensity: 0.9,
    sunDir: [-0.3, 0.72, 0.5],
    hemiSky: 0x44578f,
    hemiGround: 0x1a1c2a,
    hemiIntensity: 1.0,
    cloud: 0x3a466e,
    night: 1,
    sunset: 0,
    disc: 0xe8efff,
    discSize: 200,
  },
};

/**
 * The middle of the sunset-to-night change. Blending the warm sunset straight into the blue
 * night mixes orange light with blue light, and on the way the whole view went pink-magenta
 * (the sun's light passed through #d5aec4, the horizon and fog through mauve). The change goes
 * through this dusk instead: a deep blue-violet sky over a slate horizon, a pale low sun. Orange
 * fades toward slate (never pink: slate has more green than red), then slate deepens into the
 * night blue (never pink: red stays the weakest). client/test/sky.test.ts holds it to that.
 */
const DUSK: Preset = {
  top: 0x1c1f5a,
  horizon: 0x566a74,
  ground: 0x384650,
  fog: 0x485864,
  sun: 0xb4b8b8,
  sunIntensity: 1.3,
  sunDir: [-0.56, 0.46, 0.03],
  hemiSky: 0x7078b0,
  hemiGround: 0x34383c,
  hemiIntensity: 1.1,
  cloud: 0x8a9098,
  night: 0.7,
  sunset: 0.35,
  disc: 0xf2e6d0,
  discSize: 300,
};

/** The preset a change of time passes through halfway, if it has one (sunset and night, either way). */
export function middlePreset(from: Preset, to: Preset): Preset | null {
  const pair = (a: Preset, b: Preset): boolean => (from === a && to === b) || (from === b && to === a);
  return pair(PRESETS.sunset, PRESETS.night) ? DUSK : null;
}

/** Where a blend `t` of 0..1 stands: the two presets to mix and how far between them. */
export function blendLeg(from: Preset, to: Preset, middle: Preset | null, t: number): [Preset, Preset, number] {
  if (!middle) return [from, to, t];
  return t < 0.5 ? [from, middle, t * 2] : [middle, to, t * 2 - 1];
}

/** The time-of-day presets (exported for tests). */
export const SKY_PRESETS: Readonly<Record<TimeOfDay, Preset>> = PRESETS;
export type { Preset as SkyPreset };

/** Radius of the cloud rings: the taller ring's far corner stays inside the 9000 m far plane. */
const RING_RADIUS = 6000;
interface CloudRing {
  repeats: number;
  bottomDeg: number;
  sunGap: [number, number];
}
const RING_FALLBACK: Record<'clouds_a' | 'clouds_b', CloudRing> = {
  clouds_a: { repeats: 4, bottomDeg: -5, sunGap: [258, 72] },
  clouds_b: { repeats: 3, bottomDeg: -5, sunGap: [414, 58] },
};
/** Azimuth of the sunset sun (heading 0 looks along +z and grows toward +x). */
const SUNSET_AZIMUTH = Math.atan2(PRESETS.sunset.sunDir[0], PRESETS.sunset.sunDir[2]);

/** Texture offset that turns a ring so the middle of its sun gap stands at the sunset sun. */
export function ringOffset(ring: CloudRing, width = 512): number {
  const middle = (ring.sunGap[0] + ring.sunGap[1] / 2) / width;
  const offset = middle + (ring.repeats * SUNSET_AZIMUTH) / (2 * Math.PI);
  return offset - Math.floor(offset);
}

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;
}
`;
const DOME_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 discColor;
uniform float discCos;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 color = h >= 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, ground, clamp(-h * 6.0, 0.0, 1.0));
  float s = dot(d, sunDir);
  // A hard-edged disc with a soft halo: painted scenery, not a physical sun.
  color += discColor * (smoothstep(discCos, discCos + 0.0015, s) * 0.9 + pow(max(s, 0.0), 48.0) * 0.35);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export interface FogRange {
  near: number;
  far: number;
}

export class Sky {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.Fog;
  /** 0 by day .. 1 at night, after blending. */
  night = 0;
  /** 1 at sunset, 0 otherwise (eased with the change of time): the ground's warm tint. */
  sunset = 0;
  private readonly dome: THREE.Mesh;
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly clouds: THREE.Mesh[] = [];
  private from: Preset;
  private to: Preset;
  /** What the current change passes through halfway (`middlePreset`), or null. */
  private middle: Preset | null = null;
  private blend = 1;
  private fogFrom: FogRange = { near: 200, far: 1600 };
  private fogTo: FogRange = { near: 200, far: 1600 };
  private readonly colorA = new THREE.Color();
  private readonly colorB = new THREE.Color();

  constructor(scene: THREE.Scene, assets: AssetStore) {
    this.from = PRESETS.afternoon;
    this.to = PRESETS.afternoon;
    this.domeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        ground: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        discColor: { value: new THREE.Color() },
        discCos: { value: 0.999 },
      },
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), this.domeMaterial);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    this.group.add(this.dome);

    // Each panorama goes on the inside of an upright open cylinder centered on the camera:
    // clouds_b behind, clouds_a in front; no fog (the rings are far past it), no scrolling.
    for (const id of ['clouds_b', 'clouds_a'] as const) {
      const ring = assets.manifest.textures[id]?.ring ?? RING_FALLBACK[id];
      const texture = assets.texture(id);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      // Negative: seen from inside, the painting must not be mirrored (lit from the upper left).
      texture.repeat.set(-ring.repeats, 1);
      texture.offset.set(ringOffset(ring), 0);
      texture.needsUpdate = true;
      const height = (Math.PI * RING_RADIUS) / ring.repeats;
      const bottom = RING_RADIUS * Math.tan((ring.bottomDeg * Math.PI) / 180);
      const geometry = new THREE.CylinderGeometry(RING_RADIUS, RING_RADIUS, height, 48, 1, true);
      geometry.translate(0, bottom + height / 2, 0);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = id === 'clouds_b' ? -51 : -50;
      mesh.frustumCulled = false;
      this.clouds.push(mesh);
      this.group.add(mesh);
    }

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
    this.fog = new THREE.Fog(0xffffff, 200, 1600);
    scene.add(this.group, this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    this.apply(1);
  }

  /** Changes the time of day; `seconds` is how long the change takes (0 = at once). */
  setTime(time: TimeOfDay, fog: FogRange, seconds = 4): void {
    const target = PRESETS[time];
    if (target === this.to && fog.near === this.fogTo.near && fog.far === this.fogTo.far) return;
    this.from = this.blend >= 1 ? this.to : this.snapshotPreset();
    this.fogFrom = { near: this.fog.near, far: this.fog.far };
    this.to = target;
    this.middle = middlePreset(this.from, target);
    this.fogTo = fog;
    this.blend = seconds <= 0 ? 1 : 0;
    this.speed = seconds <= 0 ? 0 : 1 / seconds;
    if (seconds <= 0) this.apply(1);
  }

  private speed = 0;

  /** The current mix frozen as a preset, so a change that interrupts another starts from what is on screen. */
  private snapshotPreset(): Preset {
    const [f, g, t] = blendLeg(this.from, this.to, this.middle, this.blend);
    const mixColor = (a: number, b: number): number => this.colorA.set(a).lerp(this.colorB.set(b), t).getHex();
    const mix = (a: number, b: number): number => a + (b - a) * t;
    return {
      top: mixColor(f.top, g.top),
      horizon: mixColor(f.horizon, g.horizon),
      ground: mixColor(f.ground, g.ground),
      fog: mixColor(f.fog, g.fog),
      sun: mixColor(f.sun, g.sun),
      sunIntensity: mix(f.sunIntensity, g.sunIntensity),
      sunDir: [mix(f.sunDir[0], g.sunDir[0]), mix(f.sunDir[1], g.sunDir[1]), mix(f.sunDir[2], g.sunDir[2])],
      hemiSky: mixColor(f.hemiSky, g.hemiSky),
      hemiGround: mixColor(f.hemiGround, g.hemiGround),
      hemiIntensity: mix(f.hemiIntensity, g.hemiIntensity),
      cloud: mixColor(f.cloud, g.cloud),
      night: mix(f.night, g.night),
      sunset: mix(f.sunset, g.sunset),
      disc: mixColor(f.disc, g.disc),
      discSize: mix(f.discSize, g.discSize),
    };
  }

  private apply(blend: number): void {
    const [f, g, t] = blendLeg(this.from, this.to, this.middle, blend);
    const u = this.domeMaterial.uniforms;
    const mixInto = (target: THREE.Color, a: number, b: number): void => {
      target.set(a).lerp(this.colorB.set(b), t);
    };
    mixInto(u.top.value as THREE.Color, f.top, g.top);
    mixInto(u.horizon.value as THREE.Color, f.horizon, g.horizon);
    mixInto(u.ground.value as THREE.Color, f.ground, g.ground);
    mixInto(u.discColor.value as THREE.Color, f.disc, g.disc);
    mixInto(this.fog.color, f.fog, g.fog);
    mixInto(this.sun.color, f.sun, g.sun);
    mixInto(this.hemi.color, f.hemiSky, g.hemiSky);
    mixInto(this.hemi.groundColor, f.hemiGround, g.hemiGround);
    this.sun.intensity = f.sunIntensity + (g.sunIntensity - f.sunIntensity) * t;
    this.hemi.intensity = f.hemiIntensity + (g.hemiIntensity - f.hemiIntensity) * t;
    const dir = (u.sunDir.value as THREE.Vector3)
      .set(f.sunDir[0] + (g.sunDir[0] - f.sunDir[0]) * t, f.sunDir[1] + (g.sunDir[1] - f.sunDir[1]) * t, f.sunDir[2] + (g.sunDir[2] - f.sunDir[2]) * t)
      .normalize();
    const size = f.discSize + (g.discSize - f.discSize) * t;
    // The disc's angular radius, from a nominal size at the dome's nominal 6000 m distance.
    u.discCos.value = Math.cos(Math.atan2(size, 6000));
    this.fog.near = this.fogFrom.near + (this.fogTo.near - this.fogFrom.near) * blend;
    this.fog.far = this.fogFrom.far + (this.fogTo.far - this.fogFrom.far) * blend;
    this.night = f.night + (g.night - f.night) * t;
    this.sunset = f.sunset + (g.sunset - f.sunset) * t;
    for (const plane of this.clouds) {
      const material = plane.material as THREE.MeshBasicMaterial;
      mixInto(material.color, f.cloud, g.cloud);
      material.opacity = 1;
    }
    this.sunDirection.copy(dir);
  }

  /** Unit vector toward the sun or moon. */
  readonly sunDirection = new THREE.Vector3(0, 1, 0);

  update(dt: number, camera: THREE.Camera): void {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt * this.speed);
      this.apply(this.blend);
    }
    // The dome is drawn at the far plane and follows the camera, so it has no real size.
    this.dome.scale.setScalar(1);
    this.sun.position.copy(camera.position).addScaledVector(this.sunDirection, 1000);
    this.sun.target.position.copy(camera.position);
    this.sun.target.updateMatrixWorld();
    // The rings follow the camera on all three axes, so the horizon stays put when a titan
    // stands up; they never turn (the two sun gaps must stay lined up).
    for (const ring of this.clouds) ring.position.copy(camera.position);
  }
}
