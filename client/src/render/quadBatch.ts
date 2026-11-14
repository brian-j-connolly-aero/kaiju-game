/**
 * QuadBatch: one draw call for any number of textured quads from the sprite atlas. Three
 * flavors share the shader:
 *
 *   'upright'  stands on its bottom edge and turns about the vertical axis to face the camera
 *              (soldiers, civilians, markers)
 *   'facing'   centered on its point and fully facing the camera (glows, smoke, sparks)
 *   'ground'   lies flat on the ground (blob shadows, shockwave rings, markers)
 *
 * The batch is refilled every frame: begin(); push(...) for each quad; end().
 */

import * as THREE from 'three';

export type QuadMode = 'upright' | 'facing' | 'ground';

export interface QuadBatchOptions {
  mode: QuadMode;
  capacity: number;
  /** Add the color to what is behind it (glows); otherwise ordinary transparency. */
  additive?: boolean;
  /** Cut out pixels more transparent than this instead of blending (crisp pixel art that writes depth). */
  alphaTest?: number;
  /** Draw order among transparent things. */
  renderOrder?: number;
  fog?: boolean;
  /** Skip the depth test (markers that must show through walls). */
  overlay?: boolean;
  /** Pull the quads toward the camera in depth so flat decals do not flicker against the ground. */
  depthBias?: number;
}

const VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUv;
attribute vec4 iColor;
attribute float iRot;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vUv = mix(iUv.xy, iUv.zw, uv);
  vColor = iColor;
  vec2 corner = position.xy;
  #if defined(MODE_UPRIGHT)
    vec3 right = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
    float len = length(right);
    right = len > 0.0001 ? right / len : vec3(1.0, 0.0, 0.0);
    vec3 world = iPos + right * (corner.x * iSize.x) + vec3(0.0, (corner.y + 0.5) * iSize.y, 0.0);
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  #elif defined(MODE_FACING)
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 off = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * iSize;
    vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
    mvPosition.xy += off;
  #else
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 off = corner * iSize;
    vec3 world = iPos + vec3(off.x * c + off.y * s, 0.0, off.y * c - off.x * s);
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  #endif
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 texel = texture2D(map, vUv);
  vec4 color = texel * vColor;
  #ifdef ALPHA_CUT
    if (color.a < ALPHA_CUT) discard;
  #endif
  gl_FragColor = color;
  #include <colorspace_fragment>
  #ifdef ADDITIVE
    // Fog dims a glow instead of tinting it toward the fog color.
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float glowFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float glowFog = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor.rgb *= (1.0 - glowFog);
    #endif
    gl_FragColor.rgb *= gl_FragColor.a;
  #else
    #include <fog_fragment>
  #endif
}
`;

const FLOATS = 14;

export class QuadBatch {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private readonly data: Float32Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private count = 0;

  constructor(texture: THREE.Texture, options: QuadBatchOptions) {
    this.capacity = options.capacity;
    this.data = new Float32Array(options.capacity * FLOATS);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const buffer = new THREE.InstancedInterleavedBuffer(this.data, FLOATS);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('iSize', new THREE.InterleavedBufferAttribute(buffer, 2, 3));
    geometry.setAttribute('iUv', new THREE.InterleavedBufferAttribute(buffer, 4, 5));
    geometry.setAttribute('iColor', new THREE.InterleavedBufferAttribute(buffer, 4, 9));
    geometry.setAttribute('iRot', new THREE.InterleavedBufferAttribute(buffer, 1, 13));
    geometry.instanceCount = 0;
    this.geometry = geometry;
    this.buffer = buffer;

    const defines: Record<string, string | number> = {};
    defines[options.mode === 'upright' ? 'MODE_UPRIGHT' : options.mode === 'facing' ? 'MODE_FACING' : 'MODE_GROUND'] = 1;
    if (options.additive) defines.ADDITIVE = 1;
    if (options.alphaTest !== undefined) defines.ALPHA_CUT = options.alphaTest.toFixed(3);
    const cut = options.alphaTest !== undefined;
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines,
      fog: options.fog !== false,
      transparent: !cut,
      depthWrite: cut,
      depthTest: !options.overlay,
      side: THREE.DoubleSide,
      blending: options.additive ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (options.additive) {
      material.blendEquation = THREE.AddEquation;
      material.blendSrc = THREE.OneFactor;
      material.blendDst = THREE.OneFactor;
    }
    if (options.depthBias) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -options.depthBias;
      material.polygonOffsetUnits = -options.depthBias;
    }
    material.uniforms.map.value = texture;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? 0;
  }

  begin(): void {
    this.count = 0;
  }

  /**
   * Adds a quad. `uv` holds u0, v0, u1, v1 at `uvOffset`. Colors are linear 0..1 and multiply
   * the texture; `a` is opacity. Returns false when the batch is full (the quad is dropped).
   */
  push(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    uv: ArrayLike<number>,
    uvOffset: number,
    r: number,
    g: number,
    b: number,
    a: number,
    rotation = 0,
  ): boolean {
    if (this.count >= this.capacity) return false;
    const d = this.data;
    const o = this.count * FLOATS;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = width;
    d[o + 4] = height;
    d[o + 5] = uv[uvOffset];
    d[o + 6] = uv[uvOffset + 1];
    d[o + 7] = uv[uvOffset + 2];
    d[o + 8] = uv[uvOffset + 3];
    d[o + 9] = r;
    d[o + 10] = g;
    d[o + 11] = b;
    d[o + 12] = a;
    d[o + 13] = rotation;
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

  get size(): number {
    return this.count;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
