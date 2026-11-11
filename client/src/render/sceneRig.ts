/**
 * SceneRig: one posable copy of a RigModel as ordinary scene objects. Animation code names
 * nodes and gives rotations relative to the rest pose; a node the model does not have is
 * silently ignored, so the same animation drives the art file and the box stand-in.
 *
 * Rotation signs follow the art contract (tools/art/README.md section 8): x positive is nose
 * down (a jaw opens, an arm swings back), y positive turns to the model's left (same sign as
 * the game's heading), z positive rolls the left side up.
 */

import * as THREE from 'three';
import type { RigModel } from '../assets/rigModel';
import type { Materials } from './materials';

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();

export class SceneRig {
  readonly model: RigModel;
  readonly root = new THREE.Group();
  private readonly objects: THREE.Object3D[] = [];
  private readonly byName = new Map<string, number>();

  constructor(model: RigModel, materials: Materials) {
    this.model = model;
    model.nodes.forEach((node, i) => {
      const object = new THREE.Group();
      object.name = node.name;
      object.position.copy(node.position);
      object.quaternion.copy(node.quaternion);
      for (const part of node.parts) {
        const mesh = new THREE.Mesh(part.geometry, materials.byKind(part.material));
        mesh.frustumCulled = false;
        object.add(mesh);
      }
      (node.parent >= 0 ? this.objects[node.parent] : this.root).add(object);
      this.objects.push(object);
      if (!this.byName.has(node.name)) this.byName.set(node.name, i);
    });
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  node(name: string): THREE.Object3D | null {
    const i = this.byName.get(name);
    return i === undefined ? null : this.objects[i];
  }

  /** Sets a node's rotation relative to its rest pose (radians, three.js Euler XYZ). */
  setRotation(name: string, x: number, y: number, z: number): void {
    const i = this.byName.get(name);
    if (i === undefined) return;
    quat.setFromEuler(euler.set(x, y, z, 'XYZ'));
    this.objects[i].quaternion.copy(this.model.nodes[i].quaternion).multiply(quat);
  }

  /** Moves a node away from its rest position (model units). */
  setOffset(name: string, x: number, y: number, z: number): void {
    const i = this.byName.get(name);
    if (i === undefined) return;
    const rest = this.model.nodes[i].position;
    this.objects[i].position.set(rest.x + x, rest.y + y, rest.z + z);
  }

  setVisible(name: string, visible: boolean): void {
    const i = this.byName.get(name);
    if (i !== undefined) this.objects[i].visible = visible;
  }

  /** World position of a node; false (and `out` untouched) when the model has no such node. */
  worldPosition(name: string, out: THREE.Vector3): boolean {
    const i = this.byName.get(name);
    if (i === undefined) return false;
    this.objects[i].getWorldPosition(out);
    return true;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
