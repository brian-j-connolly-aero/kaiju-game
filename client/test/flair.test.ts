/**
 * Round 4's flair on the monster's screen (docs/ROADMAP.md): what glows as something to pick up,
 * the titan standing deep in water, and the monster's rage meter round the crosshair.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { canPickUp, createMatchConfig, createWorld, kaijuKindDef, kaijuStageDef, PROP_KINDS, type PropKindId, type SimEvent, type SnapKaiju, type StageId } from '@mb/shared';
import type { AssetStore } from '../src/assets/assetStore';
import { kaijuBlowLanded } from '../src/game/kaijuBlows';
import { proceduralModel } from '../src/assets/procedural/models';
import type { Effects } from '../src/render/effects';
import { canLift } from '../src/render/grabGlow';
import { KaijuView } from '../src/render/kaijuView';
import { LineBatch } from '../src/render/lineBatch';
import { createMaterials } from '../src/render/materials';
import { gashFills, gashPath, GASHES } from '../src/ui/kaijuFlair';

function kaiju(over: Partial<SnapKaiju> = {}): SnapKaiju {
  const A = kaijuKindDef('lizard').actions;
  const cooldowns = {} as SnapKaiju['cooldowns'];
  for (const verb of Object.keys(A) as Array<keyof typeof A>) cooldowns[verb] = 0;
  return {
    id: 0, player: 0, kind: 'lizard', stage: 1, alive: true, moltAvailable: false, wading: false, inWater: false, submerge: 0, known: true, spotted: false,
    x: 0, z: 0, vx: 0, vz: 0, yaw: 0, aimYaw: 0, aimPitch: 0, hp: 1000, maxHp: 1000, nerve: 0, nerveImmune: 0, rage: 0,
    action: 'none', phase: 'idle', phaseTime: 0, phaseDuration: 0, held: null, cooldowns, moves: ['none', 'none'], offer: [], surge: 0, clubSwings: 0, shieldHp: 0,
    ...over,
  };
}

/** Effects that draw nothing but count what was asked of them. */
function countingEffects(): { fx: Effects; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const fx = new Proxy({}, { get: (_t, name: string) => () => void (calls[name] = (calls[name] ?? 0) + 1) }) as unknown as Effects;
  return { fx, calls };
}

function fakeAssets(): AssetStore {
  const models = new Map<string, ReturnType<typeof proceduralModel>>();
  return {
    hasModel: () => false,
    model: (id: string) => {
      let m = models.get(id);
      if (!m) models.set(id, (m = proceduralModel(id)));
      return m;
    },
    manifest: { models: {} },
    texture: () => new THREE.Texture(),
  } as unknown as AssetStore;
}

describe('the grab glow', () => {
  it('lights exactly what the hand can pick up, at every stage', () => {
    const config = createMatchConfig({ humans: [{ name: 'Tester', role: 'kaiju' }], fast: true, anchor: 1 });
    const world = createWorld({ seed: 3, config });
    const k = world.kaijus[0];
    for (const stage of [1, 2, 3] as StageId[]) {
      k.stage = stage;
      for (const prop of Object.keys(PROP_KINDS) as PropKindId[]) expect(canLift(k.kind, stage, prop), `${prop} at stage ${stage}`).toBe(canPickUp(k, prop));
    }
    // The fallen mast's top at every size; a garage door only while small.
    expect(canLift('lizard', 3, 'mast')).toBe(true);
    expect(canLift('lizard', 2, 'garagedoor')).toBe(false);
  });
});

describe('the titan in deep water', () => {
  const assets = fakeAssets();
  const materials = createMaterials(assets);
  /** How far below the ground the body is drawn after `seconds` of frames. */
  const depth = (k: SnapKaiju, seconds: number, firstPerson = false): { view: KaijuView; sunk: number; calls: Record<string, number> } => {
    const view = new KaijuView(assets, materials);
    const { fx, calls } = countingEffects();
    for (let i = 0; i < seconds * 30; i++) view.update(k, 1 / 30, i / 30, null, null, new LineBatch(64), fx, { firstPerson, insideHead: false });
    const root = view.group.children[0] as THREE.Object3D;
    return { view, sunk: -root.position.y, calls };
  };

  it('stands sunk to its thighs in water, with foam round it; on land, and when it can swim, it does not', () => {
    const h = kaijuStageDef('lizard', 3).height;
    const deep = depth(kaiju({ stage: 3, inWater: true }), 4);
    expect(deep.view.wading).toBe(1);
    expect(deep.sunk).toBeGreaterThan(h * 0.15);
    expect(deep.calls.ring ?? 0).toBeGreaterThan(3);
    expect(depth(kaiju({ stage: 3, inWater: false }), 4).sunk).toBeCloseTo(0);
    // The juvenile swims instead (sim/swim.ts): unchanged.
    expect(depth(kaiju({ stage: 2, inWater: true }), 4).view.wading).toBe(0);
    // Its own first-person view keeps the claws where they were.
    expect(depth(kaiju({ stage: 3, inWater: true }), 4, true).sunk).toBeCloseTo(0);
  });

  it('throws up water at each step and leaves a wake while it walks', () => {
    const st = kaijuStageDef('lizard', 3);
    // (A titan's stride is long: about one step every seven seconds at this pace.)
    const walking = depth(kaiju({ stage: 3, inWater: true, vz: st.topSpeed * 0.7 }), 20);
    expect(walking.calls.splash ?? 0).toBeGreaterThan(2);
    // The wake: a bow wave and a spreading ring behind, several a second; no dust off a dry street.
    expect(walking.calls.ring ?? 0).toBeGreaterThan(100);
    expect(walking.calls.dust ?? 0).toBe(0);
  });
});

describe('the rage meter round the crosshair', () => {
  it('heats its three claw gashes one after the other, clockwise from the bottom', () => {
    expect(gashFills(0)).toEqual([0, 0, 0]);
    expect(gashFills(0.5)).toEqual([1, 0.5, 0]);
    expect(gashFills(1)).toEqual([1, 1, 1]);
    expect(gashPath(0, 0)).toBe('');
    expect(gashPath(2, 1).startsWith('M')).toBe(true);
    // The gap where the throw's arc comes in from the hand: at the lower right, between the last gash and the first.
    expect(GASHES[0].from).toBeGreaterThan(45);
    expect(GASHES[2].to - 360).toBeLessThan(45);
  });

  it('flashes when the monster lands a blow, not for army shots', () => {
    const hit = (cause: string) => ({ type: 'unitHit', tick: 1, unit: 0, damage: 5, hp: 10, cause, x: 0, z: 0 }) as unknown as SimEvent;
    expect(kaijuBlowLanded(hit('swipe'))).toBe(true);
    expect(kaijuBlowLanded(hit('thrown'))).toBe(true);
    expect(kaijuBlowLanded(hit('rocket'))).toBe(false);
    expect(kaijuBlowLanded({ type: 'structureStage', tick: 1, id: 3, stage: 2, cause: 'stomp' } as unknown as SimEvent)).toBe(true);
  });
});
