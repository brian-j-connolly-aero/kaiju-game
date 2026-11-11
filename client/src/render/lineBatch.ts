/**
 * LineBatch: one draw call for glowing straight lines of any thickness (targeting lasers, the
 * beam, tracers). Each line is a quad between two world points that turns about its own axis
 * to face the camera, bright in the middle and soft at the edges, added to what is behind it.
 */

import * as THREE from 'three';

const VERTEX = /* glsl */ `
attribute vec3 iStart;
attribute vec3 iEnd;
attribute float iWidth;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vDepth;
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
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  vDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec4 vColor;
varying float vDepth;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float glow = smoothstep(0.0, 0.9, across);
  float fade = 1.0 - smoothstep(fogNear, fogFar, vDepth) * 0.85;
  gl_FragColor = vec4(vColor.rgb * (glow * vColor.a * fade), 1.0);
  #include <colorspace_fragment>
}
`;

const FLOATS = 11;

export class LineBatch {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private readonly data: Float32Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * FLOATS);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const buffer = new THREE.InstancedInterleavedBuffer(this.data, FLOATS);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iStart', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('iEnd', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    geometry.setAttribute('iWidth', new THREE.InterleavedBufferAttribute(buffer, 1, 6));
    geometry.setAttribute('iColor', new THREE.InterleavedBufferAttribute(buffer, 4, 7));
    geometry.instanceCount = 0;
    this.geometry = geometry;
    this.buffer = buffer;
    this.material = new THREE.ShaderMaterial({
      uniforms: { fogNear: { value: 500 }, fogFar: { value: 3000 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  setFog(near: number, far: number): void {
    this.material.uniforms.fogNear.value = near;
    this.material.uniforms.fogFar.value = far;
  }

  begin(): void {
    this.count = 0;
  }

  /** Adds a line from (ax, ay, az) to (bx, by, bz). Colors are linear 0..1; `a` is brightness. */
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, r: number, g: number, b: number, a: number): boolean {
    if (this.count >= this.capacity) return false;
    const d = this.data;
    const o = this.count * FLOATS;
    d[o] = ax;
    d[o + 1] = ay;
    d[o + 2] = az;
    d[o + 3] = bx;
    d[o + 4] = by;
    d[o + 5] = bz;
    d[o + 6] = width;
    d[o + 7] = r;
    d[o + 8] = g;
    d[o + 9] = b;
    d[o + 10] = a;
    this.count++;
    return true;
  }

  end(): void {
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, this.count * FLOATS);
      this.buffer.needsUpdate = true;
    }
  }
}
