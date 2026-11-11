/**
 * Sky, fog and lighting for the three times of day (DESIGN.md section 2: afternoon, sunset,
 * night). The sky is a gradient dome that follows the camera, with a sun or moon disc and two
 * drifting cloud layers; fog and haze sell the scale, and there are no shadow maps.
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
  cloudOpacity: number;
  /** 0 by day, 1 at night: window lights. */
  night: number;
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
    hemiGround: 0x8a8f7a,
    hemiIntensity: 1.5,
    cloud: 0xffffff,
    cloudOpacity: 0.9,
    night: 0,
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
    cloudOpacity: 0.85,
    night: 0.35,
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
    cloudOpacity: 0.55,
    night: 1,
    disc: 0xe8efff,
    discSize: 200,
  },
};

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
  private readonly dome: THREE.Mesh;
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly clouds: THREE.Mesh[] = [];
  private from: Preset;
  private to: Preset;
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

    for (const [id, height, repeat] of [['clouds_a', 520, 5], ['clouds_b', 760, 3]] as const) {
      const texture = assets.texture(id);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat, repeat);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), material);
      plane.rotation.x = Math.PI / 2;
      plane.position.y = height;
      plane.renderOrder = -50;
      plane.frustumCulled = false;
      this.clouds.push(plane);
      this.group.add(plane);
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
    this.fogTo = fog;
    this.blend = seconds <= 0 ? 1 : 0;
    this.speed = seconds <= 0 ? 0 : 1 / seconds;
    if (seconds <= 0) this.apply(1);
  }

  private speed = 0;

  /** The current mix frozen as a preset, so a change that interrupts another starts from what is on screen. */
  private snapshotPreset(): Preset {
    const t = this.blend;
    const mixColor = (a: number, b: number): number => this.colorA.set(a).lerp(this.colorB.set(b), t).getHex();
    const mix = (a: number, b: number): number => a + (b - a) * t;
    const f = this.from;
    const g = this.to;
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
      cloudOpacity: mix(f.cloudOpacity, g.cloudOpacity),
      night: mix(f.night, g.night),
      disc: mixColor(f.disc, g.disc),
      discSize: mix(f.discSize, g.discSize),
    };
  }

  private apply(t: number): void {
    const f = this.from;
    const g = this.to;
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
    this.fog.near = this.fogFrom.near + (this.fogTo.near - this.fogFrom.near) * t;
    this.fog.far = this.fogFrom.far + (this.fogTo.far - this.fogFrom.far) * t;
    this.night = f.night + (g.night - f.night) * t;
    for (const plane of this.clouds) {
      const material = plane.material as THREE.MeshBasicMaterial;
      mixInto(material.color, f.cloud, g.cloud);
      material.opacity = f.cloudOpacity + (g.cloudOpacity - f.cloudOpacity) * t;
    }
    this.sunDirection.copy(dir);
  }

  /** Unit vector toward the sun or moon. */
  readonly sunDirection = new THREE.Vector3(0, 1, 0);

  update(dt: number, camera: THREE.Camera, time: number): void {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt * this.speed);
      this.apply(this.blend);
    }
    // The dome is drawn at the far plane and follows the camera, so it has no real size.
    this.dome.scale.setScalar(1);
    this.sun.position.copy(camera.position).addScaledVector(this.sunDirection, 1000);
    this.sun.target.position.copy(camera.position);
    this.sun.target.updateMatrixWorld();
    this.clouds.forEach((plane, i) => {
      const texture = (plane.material as THREE.MeshBasicMaterial).map;
      if (texture) texture.offset.set(time * (0.0006 + i * 0.0004), time * 0.0002);
      plane.position.x = camera.position.x;
      plane.position.z = camera.position.z;
    });
  }
}
