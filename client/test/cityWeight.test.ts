/**
 * Phase 2's city and the monster's weight on the client (docs/ROADMAP.md): rubble as mounds of
 * the building's own pieces, as high as the simulation's; buildings that fall over lying where the
 * simulation says, for a late joiner too; the radio mast's lattice without its top; the mirrored
 * city following falls and loose city weapons; a stomp swaying the block round it; the camera's
 * thump and the senses of speed.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  archetypeDef,
  buildCityIndex,
  createCityQuery,
  createCityState,
  createMatchConfig,
  createWorld,
  fallTop,
  getCity,
  setStructureFallen,
  structuresInCircle,
  welcomeFor,
  type World,
} from '@mb/shared';
import type { AssetStore } from '../src/assets/assetStore';
import { box, merge } from '../src/assets/procedural/geo';
import { proceduralModel } from '../src/assets/procedural/models';
import type { RigModel } from '../src/assets/rigModel';
import { CameraShake } from '../src/game/controllers/types';
import { speedLensWidening } from '../src/game/controllers/humanController';
import { kaijuLensWidening } from '../src/game/controllers/kaijuController';
import { applyCityEvent, createCityMirror, resyncCityMirror, type CityMirror } from '../src/net/cityMirror';
import { CityView, fallMatrix } from '../src/render/cityView';
import type { Effects } from '../src/render/effects';
import { createMaterials } from '../src/render/materials';
import { latticeBelow, moundGeometry, moundHeight, type ChunkBox } from '../src/render/structureGeometry';
import { squadFade } from '../src/render/unitsView';
import { KaijuWeight } from '../src/render/weight';

/** A building file as the art kit makes it, its size taken from the archetype; a radio mast also has its `top`. */
function fakeBuilding(id: string): RigModel {
  const arch = id.replace(/^(bld|lm)_/, '');
  const def = archetypeDef(arch);
  const [w, d] = def.footprint;
  const h = def.height;
  const atlas = (g: THREE.BufferGeometry): { geometry: THREE.BufferGeometry; material: 'city_atlas' } => ({ geometry: g, material: 'city_atlas' });
  const node = (name: string, parts: THREE.BufferGeometry[], position = new THREE.Vector3()): RigModel['nodes'][number] => ({
    name,
    parent: -1,
    position,
    quaternion: new THREE.Quaternion(),
    parts: parts.map(atlas),
  });
  const body = box(w, h, d, 0xffffff, 0, h / 2, 0, 1);
  const nodes = [
    node('intact', [body]),
    node('damaged', [body.clone()]),
    node('rubble', [box(w, 0.6, d, 0x888888, 0, 0.3, 0, 0)]),
    // Two pieces, each half the building, centered on their own middle.
    node('chunk_00', [box(w, h / 2, d, 0xffffff, 0, 0, 0, 1)], new THREE.Vector3(0, h / 4, 0)),
    node('chunk_01', [box(w, h / 2, d, 0xffffff, 0, 0, 0, 1)], new THREE.Vector3(0, (h * 3) / 4, 0)),
  ];
  if (arch === 'radiomast_a') nodes.push(node('top', [box(1.6, 8, 1.6, 0xffffff, 0, 4, 0, 1)], new THREE.Vector3(0, 16, 0)));
  return { id, nodes, bounds: new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, h, d / 2)), procedural: false };
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
    modelTint: () => null,
    modelTints: () => [],
    texture: () => new THREE.Texture(),
  };
  return fake as unknown as AssetStore;
}

/** Effects that draw nothing (the weight's picture is tested through the city view). */
const NO_EFFECTS = { dust() {}, ring() {}, glass() {}, sparks() {}, debris() {} } as unknown as Effects;

/** A match with a person as the kaiju, past the briefing. */
function playingWorld(seed: number): World {
  const config = createMatchConfig({ humans: [{ name: 'Tester', role: 'kaiju' }], fast: true, anchor: 1 });
  const world = createWorld({ seed, config });
  for (let i = 0; i < 400 && world.match.phase !== 'playing'; i++) world.step([]);
  return world;
}

const city = getCity().city;
const index = buildCityIndex(city);
const assets = fakeAssets();
const view = new CityView(city, assets, createMaterials(assets));

describe('rubble that stays', () => {
  it('piles a collapsed building from its own pieces exactly as high as the mound the shots meet, on its footprint', () => {
    // The drawn mound and the simulation's are the same height for every archetype in the city.
    const seen = new Set<string>();
    for (const s of city.structures) {
      if (seen.has(s.archetype)) continue;
      seen.add(s.archetype);
      expect(moundHeight(archetypeDef(s.archetype))).toBeCloseTo(index.srubble[s.id], 6);
    }
    const def = { id: 'tower_test', footprint: [20, 20] as [number, number], height: 60 };
    const piece = (y: number): ChunkBox => ({
      x: 0,
      y,
      z: 0,
      w: 20,
      h: 30,
      d: 20,
      mesh: { position: new Float32Array(box(20, 30, 20, 0xffffff, 0, 0, 0, 1).toNonIndexed().getAttribute('position').array), uv: new Float32Array(72), color: new Float32Array(144).fill(1) },
    });
    const g = moundGeometry([piece(15), piece(45)], def, 30);
    expect(g).not.toBeNull();
    g?.computeBoundingBox();
    const b = g?.boundingBox as THREE.Box3;
    expect(b.max.y).toBeCloseTo(30, 4);
    expect(Math.max(-b.min.x, b.max.x)).toBeLessThanOrEqual(10 * 1.08 + 1e-4);
    expect(Math.max(-b.min.z, b.max.z)).toBeLessThanOrEqual(10 * 1.08 + 1e-4);
  });

  it("keeps a radio mast's lattice below its top section, and leaves its pad and hut", () => {
    const leg = box(0.4, 24, 0.4, 0xffffff, 0, 12, 0, 1);
    const hut = box(2, 3, 2, 0xffffff, 3, 1.5, 0, 1);
    const fallen = latticeBelow(merge([leg, hut]), 0, 0, 2, 16);
    fallen.computeBoundingBox();
    const b = fallen.boundingBox as THREE.Box3;
    expect(b.max.y).toBeCloseTo(16, 5);
    expect(b.max.x).toBeLessThanOrEqual(0.2 + 1e-6);
    expect(fallen.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('lays a fallen building down where the simulation says it lies, half sunk, and a late joiner sees it so', () => {
    const tall = city.structures.find((s) => s.archetype.startsWith('tower_')) ?? city.structures[0];
    const side = 1;
    view.setStage(tall.id, 3, false);
    view.setFallen(tall.id, side, 2);
    // Half way through its fall it is still up in the air.
    view.update(1);
    const top = new THREE.Vector3();
    expect(view.fallPoint(tall.id, tall.height, top)).toBe(true);
    expect(top.y).toBeGreaterThan(tall.height * 0.4);
    view.land(tall.id);
    const where = fallTop(index, tall.id, side, { x: 0, z: 0 });
    view.fallPoint(tall.id, tall.height, top);
    expect(top.x).toBeCloseTo(where.x, 3);
    expect(top.z).toBeCloseTo(where.z, 3);
    expect(top.y).toBeCloseTo(0, 3);

    // A late joiner: the welcome's city state says it lies fallen toward that side.
    const state = createCityState(city);
    const query = createCityQuery(index, state);
    state.structureHp[tall.id] = 0;
    setStructureFallen(state, tall.id, side);
    const structureStage = new Uint8Array(city.structures.length);
    structureStage[tall.id] = 3;
    const mirror: CityMirror = { city, index, query, structureStage, propWreck: new Uint8Array(Math.ceil(city.props.length / 8)), loose: new Map(), trusted: true };
    const late = new CityView(city, assets, createMaterials(assets));
    late.syncFrom(mirror);
    expect(late.fallen(tall.id)).toBe(true);
    const seen = new THREE.Vector3();
    late.fallPoint(tall.id, tall.height, seen);
    expect(seen.distanceTo(top)).toBeLessThan(1e-3);
    view.reset();
    expect(view.fallen(tall.id)).toBe(false);
  });

  it('turns about the footprint edge: the top lands as far out as the building was tall', () => {
    const standing = new THREE.Matrix4();
    const out = fallMatrix(standing, 5, 0, 1, 0, Math.PI / 2, 5, new THREE.Matrix4());
    // A 40 m building, 10 m deep along the fall: its top (0, 40, 0) lands 40 m beyond the pivot, on the ground.
    const p = new THREE.Vector3(0, 40, 0).applyMatrix4(out);
    expect(p.x).toBeCloseTo(45, 5);
    expect(p.y).toBeCloseTo(0, 5);
    // The far edge of its base rises to its depth, less the sink: half its depth, the mound's height.
    const q = new THREE.Vector3(-5, 0, 0).applyMatrix4(out);
    expect(q.y).toBeCloseTo(5, 5);
  });
});

describe('the mirrored city', () => {
  it('follows a radio mast falling and its top lying loose, and a late welcome carries both', () => {
    const world = playingWorld(41);
    const first = welcomeFor(world, 0);
    const mirror = createCityMirror(first.config.citySeed, first.cityChecksum, first.cityState);
    const k = world.kaijus[0];
    const mast = world.city.structures.filter((s) => s.archetype === 'radiomast_a').sort((a, b) => Math.hypot(a.x - k.x, a.z - k.z) - Math.hypot(b.x - k.x, b.z - k.z))[0];
    world.structureHits.push({ id: mast.id, damage: Infinity, by: 0, cause: 'swipe' });
    let landed = false;
    for (let t = 0; t < 120; t++) {
      for (const e of world.step([])) {
        applyCityEvent(mirror, e);
        if (e.type === 'structureFall' && e.phase === 'landed') landed = true;
      }
    }
    expect(landed).toBe(true);
    expect(mirror.query.structureFall[mast.id]).toBe(world.structureFall[mast.id]);
    expect(mirror.query.fallen).toContain(mast.id);
    const loose = [...mirror.loose.values()];
    expect(loose.map((o) => o.prop)).toEqual(['mast']);
    // Someone joining now, or coming back, gets the same from the welcome.
    const now = welcomeFor(world, 0);
    const late = createCityMirror(now.config.citySeed, now.cityChecksum, now.cityState);
    expect(late.query.structureFall[mast.id]).toBe(world.structureFall[mast.id]);
    expect([...late.loose.values()].map((o) => o.id)).toEqual(loose.map((o) => o.id));
    const back = createCityMirror(first.config.citySeed, first.cityChecksum, first.cityState);
    resyncCityMirror(back, now.cityState);
    expect(back.query.fallen).toContain(mast.id);
    expect(back.loose.size).toBe(1);
    // Picked up: it no longer lies there.
    applyCityEvent(mirror, { type: 'kaijuHeld', tick: world.tick, kaiju: 0, held: { kind: 'prop', prop: 'mast' }, reason: 'grab', source: 'loose', sourceId: loose[0].id });
    expect(mirror.loose.size).toBe(0);
  });
});

describe('the monster\'s weight', () => {
  it('sways the standing buildings within three times a stomp\'s radius and none beyond, and hops the props by a foot', () => {
    const state = createCityState(city);
    const query = createCityQuery(index, state);
    const weight = new KaijuWeight(city, view, NO_EFFECTS);
    const s = city.structures.find((x) => x.cls === 'apartment') ?? city.structures[0];
    // Stage 1: a stomp of 3.6 body radii (8.6 m); its shock reaches three times as far.
    weight.land(s.x + s.hx + 4, s.z, 'lizard', 1, query);
    const near: number[] = [];
    structuresInCircle(query, s.x + s.hx + 4, s.z, 3.6 * 2.4 * 3, near);
    const expected = near.filter((id) => !city.structures[id].passable).length;
    expect(expected).toBeGreaterThan(0);
    expect(view.swaying).toBe(expected);
    // They settle back where they stand.
    for (let i = 0; i < 60; i++) view.update(0.05);
    expect(view.swaying).toBe(0);
    const p = city.props.find((x) => x.kind.startsWith('car_')) ?? city.props[0];
    expect(view.hop(p.x, p.z, 6, 0.4)).toBeGreaterThan(0);
    expect(view.hopping).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) view.updateProps(p.x, p.z, 300, 0.05);
    expect(view.hopping).toBe(0);
  });

  it("thumps the view down and back within half a second, nodding less than a degree (aiming stays possible)", () => {
    const shake = new CameraShake();
    const camera = new THREE.PerspectiveCamera();
    shake.thump(0.5);
    let lowest = 0;
    let nod = 0;
    for (let i = 0; i < 30; i++) {
      camera.position.set(0, 10, 0);
      camera.quaternion.identity();
      shake.apply(camera, 1 / 60, 1);
      lowest = Math.min(lowest, camera.position.y - 10);
      nod = Math.max(nod, camera.quaternion.angleTo(new THREE.Quaternion()));
    }
    expect(lowest).toBeLessThan(-0.3);
    expect(lowest).toBeGreaterThan(-0.6);
    expect(nod).toBeLessThan(Math.PI / 180);
    // Back to rest, all but a hundredth of the kick.
    expect(Math.abs(shake.thumped)).toBeLessThan(0.01);
  });

  it('widens the lens with speed (a little on foot, more in a tank; a few degrees walking, more in a charge) and fades the squad by a third-person camera', () => {
    expect(speedLensWidening(0, false)).toBe(0);
    expect(speedLensWidening(1, false)).toBeCloseTo(3, 6);
    expect(speedLensWidening(1, true)).toBeCloseTo(9, 6);
    expect(speedLensWidening(0.5, true)).toBeLessThan(speedLensWidening(1, true) / 2);
    expect(kaijuLensWidening(1, 0)).toBeCloseTo(5, 6);
    expect(kaijuLensWidening(1, 1)).toBeCloseTo(12, 6);
    expect(kaijuLensWidening(0, 0)).toBe(0);
    expect(squadFade(3)).toBeCloseTo(0.3, 6);
    expect(squadFade(9)).toBeGreaterThan(squadFade(6));
    expect(squadFade(20)).toBe(1);
  });
});
