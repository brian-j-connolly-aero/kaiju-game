/**
 * The monster's looks (docs/ROADMAP.md phase 3): the look of each attack picked from the tick
 * it began (so every screen shows the same one), the looks themselves, the slash trails, the
 * stripes the models mark, and the civilians squashed and eaten (client only, a puff, no gore).
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Btn, createMatchConfig, createWorld, DT, kaijuKindDef, type KaijuActionEvent, type PlayerInput, type SnapKaiju } from '@mb/shared';
import type { AssetStore } from '../src/assets/assetStore';
import { proceduralModel } from '../src/assets/procedural/models';
import type { SpriteInfo } from '../src/assets/spriteAtlas';
import { Crowd } from '../src/render/crowd';
import type { Effects } from '../src/render/effects';
import { ATTACK_VARIANTS, attackVariant, computeKaijuPose, createKaijuPose, SNACK_GULP, type KaijuAnimInput } from '../src/render/kaijuAnimator';
import { TrailRibbons } from '../src/render/kaijuTrails';
import { KaijuView } from '../src/render/kaijuView';
import { LineBatch } from '../src/render/lineBatch';
import { createMaterials, STRIPE_MASK } from '../src/render/materials';
import type { QuadBatch } from '../src/render/quadBatch';

const A = kaijuKindDef('lizard').actions;

function kaiju(over: Partial<SnapKaiju> = {}): SnapKaiju {
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

describe('the look of an attack', () => {
  it('is a pure function of the tick it began, and every look of every attack turns up', () => {
    for (const [action, n] of Object.entries(ATTACK_VARIANTS) as Array<[keyof typeof ATTACK_VARIANTS, number]>) {
      const seen = new Set<number>();
      for (let t = 0; t < 400; t++) {
        const v = attackVariant(action, t, 0);
        expect(v).toBe(attackVariant(action, t, 0));
        expect(v >= 0 && v < n).toBe(true);
        seen.add(v);
      }
      expect(seen.size, action).toBe(n);
    }
    expect(attackVariant('grab', 77)).toBe(0);
  });

  it('can be read off any snapshot: its tick less its phase time is the tick of the phase event', () => {
    // (Every screen gets the same snapshots and events, so every screen arrives at the same look.)
    const config = createMatchConfig({ humans: [{ name: 'Tester', role: 'kaiju' }], fast: true, anchor: 1 });
    const world = createWorld({ seed: 11, config });
    for (let i = 0; i < 400 && world.match.phase !== 'playing'; i++) world.step([]);
    const input = (buttons: number, seq: number): PlayerInput => ({ seq, moveX: 0, moveZ: 0, aimYaw: world.kaijus[0].yaw, aimPitch: 0, buttons });
    const phaseStarts = new Map<string, number>();
    let checked = 0;
    for (let i = 0; i < 40; i++) {
      for (const e of world.step([input(i === 0 ? Btn.strike : 0, i + 1)])) {
        if (e.type === 'kaijuAction' && (e as KaijuActionEvent).action === 'swipe') phaseStarts.set((e as KaijuActionEvent).phase, e.tick);
      }
      const k = world.kaijus[0];
      if (k.action !== 'swipe') continue;
      expect(Math.round(world.tick - k.phaseTime / DT), `${k.phase} at tick ${world.tick}`).toBe(phaseStarts.get(k.phase));
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    expect([...phaseStarts.keys()]).toEqual(['windup', 'active', 'recover', 'idle']);
  });
});

describe('the looks', () => {
  const base: KaijuAnimInput = { time: 0, walkPhase: 0, speed: 0, headYaw: 0, headPitch: 0, action: 'none', phase: 'idle', phaseTime: 0, phaseDuration: 0, holding: false, height: 4.5 };
  const pose = createKaijuPose();
  const at = (over: Partial<KaijuAnimInput>): Map<string, { x: number; y: number; z: number }> => {
    computeKaijuPose({ ...base, ...over }, pose);
    return new Map([...pose.rotations].map(([k, v]) => [k, { ...v }]));
  };

  it('turns the swipe over for the left claw, raises both for the rake, and waits for the look before choosing an arm', () => {
    const end = { action: 'swipe' as const, phase: 'windup' as const, phaseTime: A.swipe.timing.windup, phaseDuration: A.swipe.timing.windup };
    const right = at({ ...end, variant: 0 });
    const left = at({ ...end, variant: 1 });
    expect(right.get('arm_R')?.x).toBeLessThan(-1.5);
    expect(left.get('arm_L')?.x).toBeCloseTo(right.get('arm_R')?.x ?? 0, 6);
    expect(left.get('torso')?.y).toBeCloseTo(-(right.get('torso')?.y ?? 0), 6);
    const rake = at({ ...end, variant: 2 });
    expect(rake.get('arm_L')?.x).toBeLessThan(-1.5);
    expect(rake.get('arm_R')?.x).toBeLessThan(-1.5);
    const unknown = at({ ...end, variant: null });
    expect(unknown.get('arm_L')?.x).toBeCloseTo(unknown.get('arm_R')?.x ?? 0, 6);
    expect(unknown.get('arm_R')?.x).toBeGreaterThan(-1.5);
  });

  it('stomps with either foot or hops on both, and keeps the feet down until the look is known', () => {
    const top = { action: 'stomp' as const, phase: 'windup' as const, phaseTime: A.stomp.timing.windup, phaseDuration: A.stomp.timing.windup };
    expect(at({ ...top, variant: 0 }).get('leg_R')?.x).toBeLessThan(-0.8);
    expect(at({ ...top, variant: 1 }).get('leg_L')?.x).toBeLessThan(-0.8);
    const hop = at({ ...top, variant: 2 });
    expect(hop.get('leg_L')?.x).toBeLessThan(-0.5);
    expect(hop.get('leg_R')?.x).toBeLessThan(-0.5);
    expect(pose.hipsLift).toBeGreaterThan(0.3);
    const unknown = at({ ...top, phaseTime: 0.3, variant: null });
    expect(Math.abs(unknown.get('leg_L')?.x ?? 1) + Math.abs(unknown.get('leg_R')?.x ?? 1)).toBeLessThan(1e-6);
  });

  it('sweeps the tail either way round, lifts the roar head or thrusts it low', () => {
    const coil = { action: 'tailSweep' as const, phase: 'windup' as const, phaseTime: A.tailSweep.timing.windup, phaseDuration: A.tailSweep.timing.windup };
    expect(at({ ...coil, variant: 0 }).get('tail_1')?.y).toBeGreaterThan(0.25);
    expect(at({ ...coil, variant: 1 }).get('tail_1')?.y).toBeLessThan(-0.25);
    const roar = { action: 'roar' as const, phase: 'roar' as const, phaseTime: A.roar.timing.active / 2, phaseDuration: A.roar.timing.active };
    expect(at({ ...roar, variant: 0 }).get('torso')?.x).toBeLessThan(-0.2);
    expect(at({ ...roar, variant: 1 }).get('torso')?.x).toBeGreaterThan(0.2);
  });
});

describe('the kaiju view', () => {
  const assets = fakeAssets();
  const materials = createMaterials(assets);
  const run = (view: KaijuView, k: SnapKaiju, tick: number, frames = 3, override: Parameters<KaijuView['update']>[3] = null): { calls: Record<string, number> } => {
    const { fx, calls } = countingEffects();
    for (let i = 0; i < frames; i++) view.update(k, 1 / 30, 1 + i / 30, override, null, new LineBatch(256), fx, { firstPerson: false, insideHead: false, tick });
    return { calls };
  };

  it('draws the look of the tick the attack began, keeps it through the strike, and reckons it back for a page that joins late', () => {
    const start = 5000;
    const look = attackVariant('swipe', start, 0);
    const view = new KaijuView(assets, materials, {}, new TrailRibbons());
    run(view, kaiju({ action: 'swipe', phase: 'windup', phaseTime: 0.2, phaseDuration: 0.45 }), start + 0.2 / DT);
    expect(view.attackLook).toBe(look);
    // The active phase begins 14 ticks in (0.45 s); a fresh page that only saw the strike agrees.
    const strike = kaiju({ action: 'swipe', phase: 'active', phaseTime: 0.05, phaseDuration: 0.15 });
    run(view, strike, start + 14 + 0.05 / DT);
    expect(view.attackLook).toBe(look);
    const late = new KaijuView(assets, materials);
    run(late, strike, start + 14 + 0.05 / DT);
    expect(late.attackLook).toBe(look);
    // The local press shown before the server's phase reaches the view: not known yet.
    run(view, kaiju(), start + 100, 1, { action: 'swipe', phase: 'windup', phaseTime: 0.1, phaseDuration: 0.45 });
    expect(view.attackLook).toBeNull();
  });

  it('draws a slash trail through the strike and the follow-through only, and a shock ring where a stomp lands', () => {
    const ribbons = new TrailRibbons();
    const view = new KaijuView(assets, materials, {}, ribbons);
    const trail = (k: SnapKaiju, tick: number): number => {
      ribbons.begin();
      run(view, k, tick, 1);
      return ribbons.size;
    };
    expect(trail(kaiju({ action: 'swipe', phase: 'windup', phaseTime: 0.3, phaseDuration: 0.45 }), 900 + 9)).toBe(0);
    expect(trail(kaiju({ action: 'swipe', phase: 'active', phaseTime: 0.1, phaseDuration: 0.15 }), 900 + 14 + 3)).toBeGreaterThan(5);
    expect(trail(kaiju({ action: 'tailSweep', phase: 'active', phaseTime: 0.1, phaseDuration: 0.15 }), 2000 + 11 + 3)).toBeGreaterThan(5);
    const { fx, calls } = countingEffects();
    const e: KaijuActionEvent = { type: 'kaijuAction', tick: 3000, kaiju: 0, action: 'stomp', phase: 'active', duration: 0.1, x: 0, z: 0, yaw: 0 };
    view.onAction(e, kaiju(), fx);
    expect(calls.ring).toBeGreaterThanOrEqual(2);
  });

  it('gives each kaiju its own glowing stripes, faint without rage and bright with it', () => {
    const a = new KaijuView(assets, materials);
    const b = new KaijuView(assets, materials);
    run(a, kaiju({ rage: 0 }), 100);
    run(b, kaiju({ rage: 100 }), 100);
    const skin = (v: KaijuView): THREE.Color => (v as unknown as { skin: { stripe: THREE.Color } }).skin.stripe;
    expect(skin(b).r).toBeGreaterThan(skin(a).r * 3);
    expect(skin(a).r).toBeGreaterThan(0);
  });

  it('gulps a handful at once when the monster does anything else', () => {
    const view = new KaijuView(assets, materials);
    view.startSnack();
    run(view, kaiju(), 100, 2);
    expect(view.snack).toBeLessThan(SNACK_GULP);
    run(view, kaiju({ action: 'stomp', phase: 'windup', phaseTime: 0.1, phaseDuration: 0.9 }), 120, 1);
    expect(view.snack).toBeGreaterThanOrEqual(SNACK_GULP);
  });
});

describe('the stripes the models mark', () => {
  /** The alpha of COLOR_0 at every vertex of a .glb (its JSON and binary chunks, read by hand). */
  const alphas = (file: string): number[] => {
    const buf = readFileSync(new URL(`../public/assets/models/${file}`, import.meta.url));
    const jsonLength = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as {
      meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
      accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }>;
      bufferViews: Array<{ byteOffset?: number; byteStride?: number }>;
    };
    const bin = 20 + jsonLength + 8;
    const out: number[] = [];
    for (const mesh of json.meshes) {
      for (const p of mesh.primitives) {
        const a = json.accessors[p.attributes.COLOR_0];
        if (!a || a.type !== 'VEC4') continue;
        const view = json.bufferViews[a.bufferView];
        const size = a.componentType === 5126 ? 4 : a.componentType === 5123 ? 2 : 1;
        const stride = view.byteStride ?? size * 4;
        for (let i = 0; i < a.count; i++) {
          const o = bin + (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride + size * 3;
          out.push(size === 4 ? buf.readFloatLE(o) : size === 2 ? buf.readUInt16LE(o) / 65535 : buf.readUInt8(o) / 255);
        }
      }
    }
    return out;
  };

  it('carry the stripe mark the body material reads (alpha 0.5), the rest of the hide 1', () => {
    for (const stage of [1, 2, 3]) {
      const values = alphas(`kaiju_lizard_s${stage}.glb`);
      const stripes = values.filter((a) => a >= STRIPE_MASK.from && a < STRIPE_MASK.to).length;
      const hide = values.filter((a) => a >= STRIPE_MASK.to).length;
      expect(stripes, `stage ${stage}`).toBeGreaterThan(300);
      expect(hide + stripes, `stage ${stage}: every vertex is hide or stripe`).toBe(values.length);
    }
  });
});

describe('civilians', () => {
  const sprite: SpriteInfo = { id: 'civilian_1', worldHeight: 2.2, aspect: 0.75, anims: new Map([['run', { facings: 4, frames: 4, fps: 10, uv: new Float32Array(64) }]]), procedural: true, blend: 'alpha' };
  const assets = { civilianSprites: () => ['civilian_1'], sprite: () => sprite } as unknown as AssetStore;
  const pushed: number[] = [];
  const batch = { push: () => pushed.push(1) > 0 } as unknown as QuadBatch;
  const crowdAt = (spots: Array<[number, number]>): Crowd => {
    const crowd = new Crowd(assets, batch, 0);
    const people = (crowd as unknown as { people: object[] }).people;
    for (const [x, z] of spots) people.push({ x, z, dirX: 0, dirZ: 1, sprite, wander: 1, panic: 0, pace: 1, frozen: 0 });
    return crowd;
  };

  it('are squashed under a foot or the tail, each in a puff, and nobody outside it', () => {
    const { fx, calls } = countingEffects();
    const crowd = crowdAt([[0, 0], [0.8, 0], [3, 1], [0, -5], [5, 5]]);
    expect(crowd.squash(0, 0, 1, fx)).toBe(2);
    expect(calls.cartoonPuff).toBe(2);
    // The tail's sweep: the rear half (behind is -z here) within 6 m.
    expect(crowd.squashArc(0, 0, Math.PI, 6, Math.PI / 2, fx)).toBe(1);
    expect(crowd.count).toBe(2);
    expect(crowd.tally.squashed).toBe(3);
  });

  it('come up in a handful from a grab that took nothing, nearest first, and are gulped at the mouth', () => {
    const crowd = crowdAt([[0, 2], [0.5, 3], [-0.5, 4], [0, 5.5], [0, 30], [0, -3]]);
    expect(crowd.takeHandful(0, 0, 0, 0, 6, Math.PI / 4, 3)).toBe(3);
    expect(crowd.holding(0)).toBe(true);
    expect(crowd.count).toBe(3);
    const hand = { hand: new THREE.Vector3(0, 2, 1), mouth: new THREE.Vector3(0, 3, 2), hasHand: true, snack: 0.2 as number | null, firstPerson: false };
    const camera = new THREE.PerspectiveCamera();
    const { fx, calls } = countingEffects();
    const gulps: number[] = [];
    crowd.updateHandfuls(1 / 30, 0, camera, () => hand, () => 4.5, fx, (_x, _y, _z, n) => gulps.push(n));
    expect(gulps).toEqual([]);
    hand.snack = SNACK_GULP + 0.01;
    crowd.updateHandfuls(1 / 30, 0, camera, () => hand, () => 4.5, fx, (_x, _y, _z, n) => gulps.push(n));
    expect(gulps).toEqual([3]);
    expect(calls.cartoonPuff).toBe(1);
    expect(crowd.holding(0)).toBe(false);
    expect(crowd.tally.eaten).toBe(3);
    // Nobody in reach: the hand stays empty.
    expect(crowd.takeHandful(0, 100, 100, 0, 6, Math.PI / 4, 3)).toBe(0);
  });
});
