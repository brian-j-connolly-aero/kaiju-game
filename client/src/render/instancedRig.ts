/**
 * InstancedRig: many copies of one RigModel drawn with one instanced mesh per model part, for
 * things that come in numbers (tanks, wrecks, shells). Each copy can still pose named nodes (a
 * turret turning, a barrel lifting): the node matrices are worked out on the CPU per copy.
 *
 * Usage per frame: begin(); for each copy { pose(...); add(...); } end();
 */

import * as THREE from 'three';
import type { RigModel } from '../assets/rigModel';
import type { Materials } from './materials';

const ONE = new THREE.Vector3(1, 1, 1);
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();

export class InstancedRig {
  readonly group = new THREE.Group();
  readonly capacity: number;
  private readonly model: RigModel;
  private readonly meshes: Array<{ node: number; mesh: THREE.InstancedMesh }> = [];
  private readonly world: THREE.Matrix4[];
  private readonly posed: THREE.Quaternion[];
  private readonly isPosed: boolean[];
  private readonly byName = new Map<string, number>();
  private count = 0;

  constructor(model: RigModel, materials: Materials, capacity: number, paintable = false) {
    this.model = model;
    this.capacity = capacity;
    this.world = model.nodes.map(() => new THREE.Matrix4());
    this.posed = model.nodes.map(() => new THREE.Quaternion());
    this.isPosed = model.nodes.map(() => false);
    model.nodes.forEach((node, i) => {
      if (!this.byName.has(node.name)) this.byName.set(node.name, i);
      for (const part of node.parts) {
        const material = paintable && part.material === 'vcol' ? materials.paint : materials.byKind(part.material);
        const mesh = new THREE.InstancedMesh(part.geometry, material, capacity);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        this.meshes.push({ node: i, mesh });
      }
    });
  }

  begin(): void {
    this.count = 0;
  }

  /** Rotates a named node of the NEXT copy relative to its rest pose. */
  pose(name: string, x: number, y: number, z: number): void {
    const i = this.byName.get(name);
    if (i === undefined) return;
    this.posed[i].setFromEuler(tmpEuler.set(x, y, z, 'XYZ'));
    this.isPosed[i] = true;
  }

  /**
   * Adds a copy at (x, y, z) with heading `yaw`, optional pitch and roll, uniform `scale` and an
   * optional color (for meshes that take a per-instance color). Returns false when full.
   */
  add(x: number, y: number, z: number, yaw: number, scale = 1, color?: THREE.ColorRepresentation, pitch = 0, roll = 0): boolean {
    if (this.count >= this.capacity) {
      this.clearPose();
      return false;
    }
    const nodes = this.model.nodes;
    tmpQuat.setFromEuler(tmpEuler.set(pitch, yaw, roll, 'YXZ'));
    tmpMatrix.compose(tmpPos.set(x, y, z), tmpQuat, tmpScale.set(scale, scale, scale));
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const q = this.isPosed[i] ? tmpQuat.copy(node.quaternion).multiply(this.posed[i]) : node.quaternion;
      const local = this.world[i].compose(node.position, q, ONE);
      local.premultiply(node.parent >= 0 ? this.world[node.parent] : tmpMatrix);
    }
    if (color !== undefined) tmpColor.set(color);
    for (const { node, mesh } of this.meshes) {
      mesh.setMatrixAt(this.count, this.world[node]);
      if (color !== undefined) mesh.setColorAt(this.count, tmpColor);
    }
    this.count++;
    this.clearPose();
    return true;
  }

  private clearPose(): void {
    for (let i = 0; i < this.isPosed.length; i++) this.isPosed[i] = false;
  }

  end(): void {
    for (const { mesh } of this.meshes) {
      mesh.count = this.count;
      mesh.visible = this.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const { mesh } of this.meshes) mesh.dispose();
  }
}
