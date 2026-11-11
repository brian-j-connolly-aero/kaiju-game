/**
 * RigModel: a model reduced to what the renderer needs, whether it came from a .glb file or
 * from the procedural box generator. It is a flat list of named nodes, each with a rest
 * position relative to its parent and the mesh parts that hang on it. Animation code only ever
 * names nodes (docs/ASSETS.md section 3), so a real model and a placeholder are interchangeable.
 */

import * as THREE from 'three';

/** The three material names models may use; the client supplies the materials. */
export type MaterialKind = 'vcol' | 'glow' | 'city_atlas';

export interface RigPart {
  geometry: THREE.BufferGeometry;
  material: MaterialKind;
}

export interface RigNode {
  name: string;
  /** Index of the parent node in RigModel.nodes, or -1 for a root. Parents come before children. */
  parent: number;
  /** Rest position relative to the parent: the joint this node turns around. */
  position: THREE.Vector3;
  /** Rest rotation (identity for models that follow the contract). */
  quaternion: THREE.Quaternion;
  parts: RigPart[];
}

export interface RigModel {
  id: string;
  nodes: RigNode[];
  /** Bounding box of the rest pose, in model space. */
  bounds: THREE.Box3;
  /** True when this is a generated stand-in, not an art file. */
  procedural: boolean;
}

export function rigNodeIndex(model: RigModel, name: string): number {
  for (let i = 0; i < model.nodes.length; i++) if (model.nodes[i].name === name) return i;
  return -1;
}

/** World-space (model-space) rest matrices of every node. */
export function restMatrices(model: RigModel): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const one = new THREE.Vector3(1, 1, 1);
  for (const node of model.nodes) {
    const local = new THREE.Matrix4().compose(node.position, node.quaternion, one);
    out.push(node.parent >= 0 ? out[node.parent].clone().multiply(local) : local);
  }
  return out;
}

export function computeRigBounds(nodes: RigNode[]): THREE.Box3 {
  const box = new THREE.Box3();
  const rest = restMatrices({ id: '', nodes, bounds: box, procedural: false });
  const tmp = new THREE.Box3();
  nodes.forEach((node, i) => {
    for (const part of node.parts) {
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
      if (!part.geometry.boundingBox) continue;
      tmp.copy(part.geometry.boundingBox).applyMatrix4(rest[i]);
      box.union(tmp);
    }
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  return box;
}

const MATERIAL_KINDS: readonly string[] = ['vcol', 'glow', 'city_atlas'];

function materialKindOf(mesh: THREE.Mesh, modelId: string): MaterialKind {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const name = mat?.name ?? '';
  if (MATERIAL_KINDS.includes(name)) return name as MaterialKind;
  console.warn(`assets: model "${modelId}" uses an unknown material "${name}"; drawn as vcol.`);
  return 'vcol';
}

/**
 * Converts a loaded glTF scene into a RigModel. The loader splits a node with several materials
 * into a group named after the node with children `<name>_1`, `<name>_2`: those children become
 * parts of the one named node, so node names stay exactly as authored.
 */
export function rigModelFromScene(id: string, scene: THREE.Object3D): RigModel {
  const nodes: RigNode[] = [];
  const visit = (object: THREE.Object3D, parent: number): void => {
    const mesh = object as THREE.Mesh;
    const splitPart =
      mesh.isMesh === true &&
      parent >= 0 &&
      object.parent !== null &&
      object.name.startsWith(`${object.parent.name}_`) &&
      /^\d+$/.test(object.name.slice(object.parent.name.length + 1)) &&
      object.position.lengthSq() < 1e-12;
    if (splitPart) {
      nodes[parent].parts.push({ geometry: mesh.geometry, material: materialKindOf(mesh, id) });
      return;
    }
    const node: RigNode = {
      name: object.name,
      parent,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      parts: [],
    };
    if (mesh.isMesh === true) node.parts.push({ geometry: mesh.geometry, material: materialKindOf(mesh, id) });
    const index = nodes.push(node) - 1;
    for (const child of object.children) visit(child, index);
  };
  // The scene object itself is only a container.
  for (const child of scene.children) visit(child, -1);
  return { id, nodes, bounds: computeRigBounds(nodes), procedural: false };
}
