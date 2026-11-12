/**
 * The city as the client draws it (docs/art/client-notes-city.md): building paint (the model's
 * wall colors and the district tint on the masked walls), the damage shade, the three states as
 * instanced batches, the collapse pieces from the art's own chunk meshes, the night ground, and
 * the follow-ups of the city task: the lobby's sleeping seats, the autopilot's volleys, the
 * thrown object leaving the hand.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { archetypeModelId, getCity, type LobbyState, type SnapUnit } from '@mb/shared';
import type { AssetStore } from '../src/assets/assetStore';
import { box, merge, paint } from '../src/assets/procedural/geo';
import { proceduralModel } from '../src/assets/procedural/models';
import type { RigModel } from '../src/assets/rigModel';
import { seatAsleep } from '../src/app/screens/lobby';
import { snapSquadCharge, volleyVerdict } from '../src/game/autoplay';
import { CityView, insidePolygon, shadeOf, wallPaint } from '../src/render/cityView';
import { buildGround, setGroundNight } from '../src/render/ground';
import { pictureTriangles } from '../src/render/landmarkPictures';
import { createMaterials, INSTANCE_SHADE } from '../src/render/materials';
import { HAND_BLEND, handBlend } from '../src/render/projectilesView';
import { hasIconArt } from '../src/ui/iconArt';
import { chunkMesh } from '../src/render/structureGeometry';

const BASE = '#f3e3b3';
const COLORS = ['#f3e3b3', '#f2a48b', '#a8d4f0'];

/** A building file as the art kit makes it: intact, damaged, rubble and two chunks, all `city_atlas`. */
function fakeBuilding(id: string): RigModel {
  const atlas = (g: THREE.BufferGeometry): { geometry: THREE.BufferGeometry; material: 'city_atlas' } => ({ geometry: g, material: 'city_atlas' });
  // Walls masked (alpha 1), a roof that is not (alpha 0).
  const intact = merge([box(4, 3, 4, 0xffffff, 0, 1.5, 0, 1), paint(new THREE.BoxGeometry(4.4, 0.4, 4.4).translate(0, 3.2, 0), 0xc8573b, 0)]);
  const node = (name: string, parts: THREE.BufferGeometry[], position = new THREE.Vector3()): RigModel['nodes'][number] => ({
    name,
    parent: -1,
    position,
    quaternion: new THREE.Quaternion(),
    parts: parts.map(atlas),
  });
  const piece = (): THREE.BufferGeometry => box(1, 1, 1, 0xffffff, 0, 0, 0, 1);
  return {
    id,
    nodes: [
      node('intact', [intact]),
      node('damaged', [intact.clone()]),
      node('rubble', [box(4, 0.6, 4, 0x888888, 0, 0.3, 0, 0)]),
      node('chunk_00', [piece()], new THREE.Vector3(-1, 2.5, 0)),
      node('chunk_01', [piece()], new THREE.Vector3(1, 0.5, 0)),
    ],
    bounds: new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 3.4, 2)),
    procedural: false,
  };
}

function fakeAssets(): AssetStore {
  const models = new Map<string, RigModel>();
  const fake = {
    hasModel: (id: string) => id.startsWith('bld_') || id.startsWith('lm_'),
    model: (id: string) => {
      let m = models.get(id);
      if (!m) {
        m = id.startsWith('bld_') || id.startsWith('lm_') ? fakeBuilding(id) : proceduralModel(id);
        models.set(id, m);
      }
      return m;
    },
    modelTint: (id: string) => (id.startsWith('bld_') || id.startsWith('lm_') ? { base: BASE, colors: COLORS } : null),
    modelTints: () => [],
    texture: () => new THREE.Texture(),
  };
  return fake as unknown as AssetStore;
}

describe('building paint', () => {
  it('turns the model base color into the chosen wall color, times the district tint', () => {
    const district = 0xd8e0ec;
    for (let id = 0; id < 40; id++) {
      const { tone, paint: p } = wallPaint({ base: BASE, colors: COLORS }, id, district);
      // The masked wall shows base * paint = tone.
      const base = new THREE.Color(BASE);
      expect(base.r * p.r).toBeCloseTo(tone.r, 5);
      expect(base.g * p.g).toBeCloseTo(tone.g, 5);
      expect(base.b * p.b).toBeCloseTo(tone.b, 5);
      // And tone is one of the colors, times the district tint.
      const d = new THREE.Color(district);
      const matches = COLORS.some((c) => {
        const t = new THREE.Color(c).multiply(d);
        return Math.abs(t.r - tone.r) < 1e-6 && Math.abs(t.g - tone.g) < 1e-6 && Math.abs(t.b - tone.b) < 1e-6;
      });
      expect(matches).toBe(true);
    }
  });

  it('varies the color from building to building and keeps the base when the tint is white', () => {
    const picked = new Set<string>();
    for (let id = 0; id < 60; id++) picked.add(wallPaint({ base: BASE, colors: COLORS }, id, 0xffffff).tone.getHexString());
    expect(picked.size).toBe(COLORS.length);
    const none = wallPaint(null, 3, 0xffffff);
    expect(none.paint.getHex()).toBe(0xffffff);
  });

  it('darkens damaged buildings, the deeper the damage the darker, and not the rubble', () => {
    expect(shadeOf(0)).toBe(1);
    expect(shadeOf(1)).toBeLessThan(1);
    expect(shadeOf(2)).toBeLessThan(shadeOf(1));
    expect(shadeOf(3)).toBe(1);
  });

  it('finds the district a point is in', () => {
    const square = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ];
    expect(insidePolygon(5, 5, square)).toBe(true);
    expect(insidePolygon(15, 5, square)).toBe(false);
  });
});

describe('collapse pieces', () => {
  it('keeps a chunk as triangles centered on its own middle, with the tint mask', () => {
    const g = box(2, 1, 1, 0xffffff, 5, 3, 0, 1);
    const mesh = chunkMesh([g], new THREE.Vector3(5, 3, 0));
    expect(mesh.position.length / 3).toBe(36);
    expect(mesh.uv.length / 2).toBe(36);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < mesh.position.length; i += 3) {
      minX = Math.min(minX, mesh.position[i]);
      maxX = Math.max(maxX, mesh.position[i]);
    }
    expect(minX).toBeCloseTo(-1, 5);
    expect(maxX).toBeCloseTo(1, 5);
    for (let i = 3; i < mesh.color.length; i += 4) expect(mesh.color[i]).toBe(1);
  });
});

describe('the city view on Port Meridian', () => {
  const city = getCity().city;
  const assets = fakeAssets();
  const materials = createMaterials(assets);
  const view = new CityView(city, assets, materials);
  const meshes = (): THREE.InstancedMesh[] => view.group.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh === true);

  it('draws every structure once, from the atlas with a wall mask, inside the draw-call budget', () => {
    const structureMeshes = meshes().filter((m) => m.material === materials.cityTint);
    const shown = structureMeshes.reduce((n, m) => n + m.count, 0);
    expect(shown).toBe(city.structures.length);
    // One batch per archetype and state: at most 40 x 3 for the whole city.
    const archetypes = new Set(city.structures.map((s) => s.archetype)).size;
    expect(structureMeshes.length).toBe(archetypes * 3);
    expect(structureMeshes.filter((m) => m.visible).length).toBe(archetypes);
    for (const m of structureMeshes) expect(m.geometry.getAttribute(INSTANCE_SHADE)).toBeTruthy();
  });

  it('moves a building between its states with the right shade and keeps its paint', () => {
    const s = city.structures.find((x) => x.landmark === null && x.cls === 'house') ?? city.structures[0];
    const batchOf = (): { mesh: THREE.InstancedMesh; index: number } => {
      for (const m of meshes()) {
        if (m.material !== materials.cityTint) continue;
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, tmp);
          const p = new THREE.Vector3().setFromMatrixPosition(tmp);
          if (Math.abs(p.x - s.x) < 1e-3 && Math.abs(p.z - s.z) < 1e-3) return { mesh: m, index: i };
        }
      }
      throw new Error('structure not drawn');
    };
    const tmp = new THREE.Matrix4();
    const intact = batchOf();
    const paintBefore = new THREE.Color();
    intact.mesh.getColorAt(intact.index, paintBefore);
    const district = city.districts.find((d) => insidePolygon(s.x, s.z, d.polygon));
    const expected = wallPaint({ base: BASE, colors: COLORS }, s.id, district?.tint ?? 0xffffff).paint;
    expect(paintBefore.r).toBeCloseTo(expected.r, 5);
    expect(paintBefore.b).toBeCloseTo(expected.b, 5);

    view.setStage(s.id, 1, false);
    view.flush();
    const damaged = batchOf();
    expect(damaged.mesh).not.toBe(intact.mesh);
    expect((damaged.mesh.geometry.getAttribute(INSTANCE_SHADE) as THREE.BufferAttribute).getX(damaged.index)).toBeCloseTo(shadeOf(1), 5);
    view.setStage(s.id, 2, false);
    view.flush();
    const deeper = batchOf();
    expect(deeper.mesh).toBe(damaged.mesh);
    expect((deeper.mesh.geometry.getAttribute(INSTANCE_SHADE) as THREE.BufferAttribute).getX(deeper.index)).toBeCloseTo(shadeOf(2), 5);
    const paintAfter = new THREE.Color();
    deeper.mesh.getColorAt(deeper.index, paintAfter);
    expect(paintAfter.equals(paintBefore)).toBe(true);
    view.reset();
  });

  it('throws the art pieces of a collapsing building, in one buffer, and lets them settle', () => {
    const s = city.structures.find((x) => x.landmark === null) ?? city.structures[0];
    const info = view.setStage(s.id, 3, true);
    view.flush();
    expect(info).not.toBeNull();
    const pieces = view.group.children.find((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true && !(o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.Mesh).material === materials.cityAtlas);
    expect(pieces).toBeTruthy();
    expect(view.update(0.05)).toBe(2);
    const drawn = pieces?.geometry.drawRange.count ?? 0;
    // Two cubes of 12 triangles each.
    expect(drawn).toBe(2 * 36);
    // The pieces carry the building's paint on their masked faces.
    const color = pieces?.geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(color.getX(0)).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) view.update(0.05);
    expect(pieces?.geometry.drawRange.count).toBe(0);
    view.reset();
  });

  it('keeps the landmarks in their own colors', () => {
    const lm = city.structures.find((x) => x.landmark !== null);
    expect(lm).toBeTruthy();
    expect(view.toneOf(lm?.id ?? 0).getHex()).toBe(0xffffff);
  });

  it('lists the landmarks for the map pictures', () => {
    const landmarks = view.landmarkModels();
    const expected = new Set(city.structures.filter((s) => s.landmark !== null).map((s) => s.archetype));
    expect(new Set(landmarks.map((l) => l.id))).toEqual(expected);
    for (const l of landmarks) expect(archetypeModelId({ id: l.id, landmark: 'x' } as never)).toBe(`lm_${l.id}`);
  });
});

describe('landmark pictures for the map', () => {
  it('fits the model in the square, paints back to front and leaves out the faces turned away', () => {
    const g = box(10, 20, 10, 0xffffff, 0, 10, 0);
    const triangles = pictureTriangles([g], null, 96);
    // A box shows at most three of its six sides to a viewer: six triangles.
    expect(triangles.length).toBe(6);
    for (const t of triangles) for (const c of t.points) expect(c).toBeGreaterThanOrEqual(0), expect(c).toBeLessThanOrEqual(96);
    for (let i = 1; i < triangles.length; i++) expect(triangles[i].depth).toBeLessThanOrEqual(triangles[i - 1].depth);
    // The roof (facing up, toward the sun) is the brightest.
    const brightest = Math.max(...triangles.map((t) => t.color[0]));
    expect(brightest).toBeGreaterThan(200);
  });
  it('takes the color under each face from the atlas', () => {
    const g = box(4, 4, 4, 0xffffff, 0, 2, 0);
    const red = { width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]) };
    for (const t of pictureTriangles([g], red, 64)) expect(t.color[1]).toBe(0);
  });
});

describe('the ground at night', () => {
  it('dims the pale paving toward a warm grey, so it does not read as water under the moon', () => {
    const city = getCity().city;
    const ground = buildGround(city, fakeAssets());
    const surfaces = ground.userData.nightSurfaces as { material: THREE.MeshLambertMaterial }[];
    expect(surfaces.length).toBeGreaterThanOrEqual(4);
    setGroundNight(ground, 0);
    for (const s of surfaces) expect(s.material.color.getHex()).toBe(0xffffff);
    setGroundNight(ground, 1);
    const paving = surfaces[1].material.color;
    expect(paving.r).toBeLessThan(0.5);
    // Warm, not blue: red at least as strong as blue.
    expect(paving.r).toBeGreaterThanOrEqual(paving.b);
  });
});

describe('lobby: who the start no longer waits for', () => {
  const lobby = {
    host: 0,
    players: [
      { seat: 0, connected: true, ready: false, waited: true },
      { seat: 1, connected: true, ready: false, waited: true },
      { seat: 2, connected: true, ready: true, waited: true },
      { seat: 3, connected: true, ready: false, waited: false },
      { seat: 4, connected: false, ready: false, waited: true },
    ],
  } as unknown as LobbyState;
  it('marks a connected player who has not readied up in time, never the host, a ready player or one who has gone', () => {
    expect(lobby.players.map((p) => seatAsleep(lobby, p))).toEqual([false, true, false, false, false]);
  });
  it('has pictures for a sleeping seat and for a page that is out of date', () => {
    expect(hasIconArt('ui_asleep')).toBe(true);
    expect(hasIconArt('ui_outdated')).toBe(true);
  });
});

function unit(squad: number, over: Partial<SnapUnit>): SnapUnit {
  return { id: 0, squad, type: 'infantry', state: 'charging', alive: true, veteran: false, driven: false, rooted: true, inWater: false, laser: true, wreck: false, x: 0, z: 0, vx: 0, vz: 0, y: 0, yaw: 0, aimYaw: 0, aimPitch: 0, hp: 1, maxHp: 1, members: 3, nerve: 1, shaken: 0, charge: 0, cooldown: 0, ...over } as SnapUnit;
}

describe('the autopilot squad charges its volleys', () => {
  const lead = unit(0, { driven: true, rooted: false, laser: false });
  it('holds its fire while charging and on the move', () => {
    const units = [lead, unit(0, { charge: 0.4 }), unit(0, { charge: 0.5 })];
    expect(snapSquadCharge(units, 0)).toBeCloseTo(0.45, 5);
    expect(volleyVerdict(units, 0, true, false, 0)).toBe('hold');
    expect(volleyVerdict(units, 0, false, false, 0)).toBe('hold');
  });
  it('fires a full charge, but waits a moment for a squad that is nearly charged', () => {
    const mine = [lead, unit(0, { charge: 1 }), unit(0, { charge: 1 })];
    expect(volleyVerdict(mine, 0, true, false, 0)).toBe('fire');
    const withNeighbor = [...mine, unit(1, { charge: 0.8 }), unit(1, { charge: 0.7 })];
    expect(volleyVerdict(withNeighbor, 0, true, false, 0)).toBe('wait');
    expect(volleyVerdict(withNeighbor, 0, true, false, 3)).toBe('fire');
    const farBehind = [...mine, unit(1, { charge: 0.2 })];
    expect(volleyVerdict(farBehind, 0, true, false, 0)).toBe('fire');
  });
  it('shoots freely at a helpless kaiju and when it has nobody left to charge with', () => {
    expect(volleyVerdict([lead, unit(0, { charge: 0.1 })], 0, true, true, 0)).toBe('fire');
    expect(volleyVerdict([lead], 0, false, false, 0)).toBe('fire');
  });
});

describe('a thrown object leaves the hand', () => {
  it('starts at the hand and is on the simulation path from the blend time on', () => {
    expect(handBlend(0)).toBe(1);
    expect(handBlend(HAND_BLEND / 2)).toBeCloseTo(0.5, 5);
    expect(handBlend(HAND_BLEND)).toBe(0);
    expect(handBlend(1)).toBe(0);
  });
});
