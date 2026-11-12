/**
 * The ground of the city, built from CityData: sidewalk-colored land, roads from the road
 * graph, parks, plazas and the river as flat painted areas (a model-city table), and a far
 * plain out to the haze. A handful of merged meshes, one per surface.
 */

import * as THREE from 'three';
import type { CityData } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';

/**
 * What each surface is multiplied by at full night. Pale paving under blue moonlight read as
 * water from a squad's eye; at night it goes to a dim warm grey, so asphalt, paving, grass and
 * the river stay four different things.
 */
const NIGHT_TINT = {
  paving: 0x857b6e,
  grass: 0x9c9c90,
  asphalt: 0xb3a99c,
  water: 0x9aa6b8,
};

interface NightSurface {
  material: THREE.MeshLambertMaterial;
  night: THREE.Color;
}

/** Darkens the ground toward its night colors: 0 by day, 1 at night (`Sky.night`). */
export function setGroundNight(ground: THREE.Group, amount: number): void {
  const surfaces = ground.userData.nightSurfaces as NightSurface[] | undefined;
  if (!surfaces || ground.userData.night === amount) return;
  ground.userData.night = amount;
  for (const s of surfaces) s.material.color.setRGB(1, 1, 1).lerp(s.night, Math.max(0, Math.min(1, amount)));
}

/** Meters of ground one texture tile covers. */
const TILE = 8;

/**
 * `layer` 0 is the base; higher layers are painted over it. They sit a few centimeters higher
 * and are also pulled toward the camera in depth, so they do not flicker from far away.
 */
function surface(texture: THREE.Texture, layer = 0): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ map: texture });
  if (layer > 0) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2 * layer;
    material.polygonOffsetUnits = -2 * layer;
  }
  return material;
}

/** A flat mesh at height `y` from triangles given as x, z pairs; texture coordinates follow the world. */
function flatMesh(xz: number[], y: number, material: THREE.Material): THREE.Mesh {
  const count = xz.length / 2;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    position[i * 3] = xz[i * 2];
    position[i * 3 + 1] = y;
    position[i * 3 + 2] = xz[i * 2 + 1];
    normal[i * 3 + 1] = 1;
    uv[i * 2] = xz[i * 2] / TILE;
    uv[i * 2 + 1] = xz[i * 2 + 1] / TILE;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

/** Two triangles for the quad a-b-c-d, wound so the face looks up (+Y). */
function quad(out: number[], ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): void {
  // Up-facing means counter-clockwise seen from above, which is clockwise in (x, z) numbers.
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  if (cross > 0) out.push(ax, az, cx, cz, bx, bz, ax, az, dx, dz, cx, cz);
  else out.push(ax, az, bx, bz, cx, cz, ax, az, cx, cz, dx, dz);
}

export function buildGround(city: CityData, assets: AssetStore): THREE.Group {
  const group = new THREE.Group();
  const half = city.half;
  const nightSurfaces: NightSurface[] = [];
  group.userData.nightSurfaces = nightSurfaces;
  const night = (material: THREE.MeshLambertMaterial, color: number): THREE.MeshLambertMaterial => {
    nightSurfaces.push({ material, night: new THREE.Color(color) });
    return material;
  };

  // Far plain: out to where the fog ends.
  const far: number[] = [];
  const F = 9000;
  quad(far, -F, -F, F, -F, F, F, -F, F);
  const farTexture = assets.texture('ground_far');
  group.add(flatMesh(far, -0.25, night(surface(farTexture), NIGHT_TINT.paving)));

  // The city square.
  const land: number[] = [];
  quad(land, -half, -half, half, -half, half, half, -half, half);
  group.add(flatMesh(land, 0, night(surface(assets.texture('ground_sidewalk')), NIGHT_TINT.paving)));

  // Parks, plazas, water.
  const byKind: Record<string, number[]> = { water: [], park: [], plaza: [] };
  for (const area of city.areas) {
    const contour = area.polygon.map((p) => new THREE.Vector2(p.x, p.z));
    if (contour.length < 3) continue;
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    const out = byKind[area.kind];
    if (!out) continue;
    for (const [a, b, c] of triangles) {
      const pa = contour[a];
      const pb = contour[b];
      const pc = contour[c];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (cross > 0) out.push(pa.x, pa.y, pc.x, pc.y, pb.x, pb.y);
      else out.push(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y);
    }
  }
  if (byKind.park.length > 0) group.add(flatMesh(byKind.park, 0.03, night(surface(assets.texture('ground_grass'), 1), NIGHT_TINT.grass)));
  if (byKind.plaza.length > 0) group.add(flatMesh(byKind.plaza, 0.03, night(surface(assets.texture('ground_plaza'), 1), NIGHT_TINT.paving)));
  if (byKind.water.length > 0) {
    const water = flatMesh(byKind.water, 0.05, night(surface(assets.texture('ground_water'), 2), NIGHT_TINT.water));
    water.name = 'water';
    group.add(water);
  }

  // Roads: a quad per edge and a square per junction (bridge decks carry their own roadway).
  const roads: number[] = [];
  const nodeWidth = new Float32Array(city.roads.nodes.length);
  for (const edge of city.roads.edges) {
    const a = city.roads.nodes[edge.a];
    const b = city.roads.nodes[edge.b];
    if (!a || !b) continue;
    nodeWidth[edge.a] = Math.max(nodeWidth[edge.a], edge.width);
    nodeWidth[edge.b] = Math.max(nodeWidth[edge.b], edge.width);
    if (edge.kind === 'bridge') continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = (-dz / len) * (edge.width / 2);
    const nz = (dx / len) * (edge.width / 2);
    quad(roads, a.x + nx, a.z + nz, b.x + nx, b.z + nz, b.x - nx, b.z - nz, a.x - nx, a.z - nz);
  }
  city.roads.nodes.forEach((node, i) => {
    const w = nodeWidth[i] / 2;
    if (w > 0) quad(roads, node.x - w, node.z - w, node.x + w, node.z - w, node.x + w, node.z + w, node.x - w, node.z + w);
  });
  if (roads.length > 0) group.add(flatMesh(roads, 0.08, night(surface(assets.texture('ground_asphalt'), 3), NIGHT_TINT.asphalt)));
  return group;
}
