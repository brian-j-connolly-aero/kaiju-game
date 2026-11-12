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
const restTmp = new THREE.Vector3();

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

  /**
   * Hangs a node under another parent (`null`: back under its own), where it sits in the rest
   * pose. The rotations set afterwards are relative to the rest pose as before. Used to let the
   * kaiju's arms ride on its head in the first-person view.
   */
  ride(name: string, parentName: string | null): void {
    const i = this.byName.get(name);
    if (i === undefined) return;
    const own = this.model.nodes[i].parent;
    const p = parentName === null ? own : (this.byName.get(parentName) ?? -1);
    if (p < 0) return;
    const parent = this.objects[p];
    const object = this.objects[i];
    if (object.parent === parent) return;
    if (p === own) {
      object.position.copy(this.model.nodes[i].position);
    } else {
      this.restInModel(i, object.position).sub(this.restInModel(p, restTmp));
    }
    parent.add(object);
  }

  /** A node's rest position in model space (rest rotations are identity by the art contract). */
  private restInModel(index: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    for (let i = index; i >= 0; i = this.model.nodes[i].parent) out.add(this.model.nodes[i].position);
    return out;
  }

  /** Gives the meshes of one node their own material in place of the shared one. */
  setNodeMaterial(name: string, kind: string, material: THREE.Material): number {
    const i = this.byName.get(name);
    if (i === undefined) return 0;
    let n = 0;
    this.model.nodes[i].parts.forEach((part, j) => {
      if (part.material !== kind) return;
      const mesh = this.objects[i].children.filter((c) => (c as THREE.Mesh).isMesh)[j] as THREE.Mesh | undefined;
      if (mesh) {
        mesh.material = material;
        n++;
      }
    });
    return n;
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
