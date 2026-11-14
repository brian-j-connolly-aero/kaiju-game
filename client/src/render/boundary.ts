/**
 * The quarantine line: a thin glowing square around the playable bounds of the current stage
 * (DESIGN.md section 2). A bright line on the ground and a faint curtain above it, so it reads
 * from a hatchling's eye level and from a titan's.
 */

import * as THREE from 'three';
import type { Bounds } from '@mb/shared';

const COLOR = new THREE.Color(0xff3b5c);

export class Boundary {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.MeshBasicMaterial;
  private current: Bounds | null = null;
  private target: Bounds | null = null;
  private height = 6;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  /** Sets the bounds to show. They slide outward when a new stage widens them. */
  set(bounds: Bounds, curtainHeight: number, immediate = false): void {
    this.target = bounds;
    this.height = curtainHeight;
    if (!this.current || immediate) {
      this.current = { ...bounds };
      this.rebuild();
    }
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
    this.current = null;
  }

  update(dt: number, time: number): void {
    const c = this.current;
    const t = this.target;
    if (!c || !t) return;
    const k = 1 - Math.exp(-dt * 2.5);
    const moved =
      Math.abs(c.minX - t.minX) + Math.abs(c.minZ - t.minZ) + Math.abs(c.maxX - t.maxX) + Math.abs(c.maxZ - t.maxZ) > 0.05;
    if (moved) {
      c.minX += (t.minX - c.minX) * k;
      c.minZ += (t.minZ - c.minZ) * k;
      c.maxX += (t.maxX - c.maxX) * k;
      c.maxZ += (t.maxZ - c.maxZ) * k;
      this.rebuild();
    }
    this.material.opacity = 0.75 + Math.sin(time * 3) * 0.2;
  }

  private rebuild(): void {
    const b = this.current;
    if (!b) return;
    const corners = [
      [b.minX, b.minZ],
      [b.maxX, b.minZ],
      [b.maxX, b.maxZ],
      [b.minX, b.maxZ],
    ];
    const position: number[] = [];
    const color: number[] = [];
    const line = Math.max(0.3, this.height * 0.07);
    const add = (x: number, y: number, z: number, brightness: number): void => {
      position.push(x, y, z);
      color.push(COLOR.r * brightness, COLOR.g * brightness, COLOR.b * brightness);
    };
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      // The curtain: bright at the ground, gone at the top.
      const bands: Array<[number, number, number, number]> = [
        [0.05, line, 1.5, 1.5],
        [line, this.height, 0.2, 0],
      ];
      for (const [y0, y1, c0, c1] of bands) {
        add(ax, y0, az, c0);
        add(bx, y0, bz, c0);
        add(bx, y1, bz, c1);
        add(ax, y0, az, c0);
        add(bx, y1, bz, c1);
        add(ax, y1, az, c1);
      }
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    this.geometry.computeBoundingSphere();
  }
}
