/**
 * The player cameras: first and third person look the same way, with the same limits, so the
 * view toggle (V) changes where the camera sits and never what the player is looking at. And
 * the squad's command wheel: every entry can be picked by pointing and letting go, and every
 * order has its own key.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CITY_SEED, COMMAND_IDS, createCityQuery, createCityState, getCity, kaijuKindDef, wrapAngle, type CommandId, type SnapKaiju, type SnapUnit } from '@mb/shared';
import { createActionState, type ActionState, type ButtonAction } from '../src/game/input/actions';
import { HUMAN_PITCH_LIMIT, HumanController, WHEEL_LAYOUT } from '../src/game/controllers/humanController';
import { KAIJU_PITCH_LIMIT, KaijuController } from '../src/game/controllers/kaijuController';
import type { ControlContext } from '../src/game/controllers/types';

const { city, index } = getCity(CITY_SEED);
const query = createCityQuery(index, createCityState(city));
// Far outside the city: nothing in the way of either camera.
const FAR = 20000;

function kaiju(over: Partial<SnapKaiju> = {}): SnapKaiju {
  return {
    id: 0,
    player: 0,
    kind: 'lizard',
    stage: 1,
    alive: true,
    moltAvailable: false,
    wading: false,
    inWater: false,
    submerge: 0,
    known: true,
    spotted: false,
    marked: false,
    x: FAR,
    z: FAR,
    vx: 0,
    vz: 0,
    yaw: 0,
    aimYaw: 0,
    aimPitch: 0,
    hp: 500,
    maxHp: 500,
    nerve: 0,
    nerveImmune: 0,
    rage: 0,
    action: 'none',
    phase: 'idle',
    phaseTime: 0,
    phaseDuration: 0,
    held: null,
    cooldowns: {} as SnapKaiju['cooldowns'],
    ...over,
  };
}

function unit(over: Partial<SnapUnit> = {}): SnapUnit {
  return {
    id: 0,
    squad: 0,
    type: 'army_tank',
    state: 'idle' as SnapUnit['state'],
    alive: true,
    veteran: false,
    driven: true,
    rooted: false,
    inWater: false,
    laser: false,
    wreck: false,
    x: FAR,
    z: FAR,
    vx: 0,
    vz: 0,
    y: 0,
    yaw: 0,
    aimYaw: 0,
    aimPitch: 0,
    hp: 100,
    maxHp: 100,
    members: 1,
    nerve: 0,
    shaken: 0,
    charge: 0,
    cooldown: 0,
    ...over,
  };
}

function context(input: ActionState, body: { k?: SnapKaiju; u?: SnapUnit }): ControlContext {
  const frame = {
    localKaiju: body.k ?? null,
    localUnit: body.u ?? null,
    kaijus: body.k ? [body.k] : [],
    units: body.u ? [body.u] : [],
    squads: [],
    match: { stage: 1, phase: 'playing' },
    bounds: { minX: FAR - 500, maxX: FAR + 500, minZ: FAR - 500, maxZ: FAR + 500 },
  };
  return {
    session: { mirror: { query }, aimYaw: 0, aimPitch: 0 },
    renderer: { kaijuCamAnchor: () => null },
    input,
    frame,
    dt: 1 / 60,
    now: 0,
    mapOpen: false,
  } as unknown as ControlContext;
}

/** One frame with these buttons pressed (down for one frame) and this much look. */
function frameInput(input: ActionState, look: { x?: number; y?: number } = {}, press: ButtonAction[] = [], hold: ButtonAction[] = []): ActionState {
  for (const key of Object.keys(input.down) as ButtonAction[]) {
    const down = press.includes(key) || hold.includes(key);
    input.pressed[key] = press.includes(key);
    input.released[key] = input.down[key] && !down;
    input.down[key] = down;
    input.held[key] = down;
  }
  input.lookX = look.x ?? 0;
  input.lookY = look.y ?? 0;
  input.pointerY = look.y ?? 0;
  return input;
}

/** The camera's heading and elevation after the controller placed it. */
function cameraDirection(camera: THREE.PerspectiveCamera): { yaw: number; pitch: number } {
  const d = camera.getWorldDirection(new THREE.Vector3());
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) };
}

function expectSameDirection(a: { yaw: number; pitch: number }, b: { yaw: number; pitch: number }): void {
  expect(Math.abs(wrapAngle(a.yaw - b.yaw))).toBeLessThan(1e-4);
  expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(1e-4);
}

describe('kaiju cameras', () => {
  const lead = kaijuKindDef('lizard').headLeadMax;

  it('keep the look direction when the view switches between first and third person', () => {
    const input = createActionState();
    const k = kaiju({ yaw: 0.7 });
    const ctx = context(input, { k });
    const c = new KaijuController(false);
    const camera = new THREE.PerspectiveCamera();
    // Every few looks, switch the view: the camera must point the same way before and after.
    const looks = [
      [0.3, 0.2],
      [-0.5, -0.4],
      [0.2, 0.9],
      [-1.2, -1.5],
      [2.5, 0.3],
    ];
    for (const [x, y] of looks) {
      c.update(context(frameInput(input, { x, y }), { k }));
      c.applyCamera(ctx, camera);
      const before = cameraDirection(camera);
      c.update(context(frameInput(input, {}, ['camera']), { k }));
      c.applyCamera(ctx, camera);
      const after = cameraDirection(camera);
      expectSameDirection(before, after);
      c.update(context(frameInput(input), { k }));
      c.applyCamera(ctx, camera);
      expectSameDirection(after, cameraDirection(camera));
    }
  });

  it('give both views the same limits: up and down to the pitch limit, and the head’s reach from the body', () => {
    for (const third of [false, true]) {
      const input = createActionState();
      const k = kaiju({ yaw: -2.4 });
      const c = new KaijuController(third);
      const camera = new THREE.PerspectiveCamera();
      const ctx = context(input, { k });
      c.update(context(frameInput(input, { y: 5 }), { k }));
      c.applyCamera(ctx, camera);
      expect(cameraDirection(camera).pitch, `third person: ${third}`).toBeCloseTo(KAIJU_PITCH_LIMIT, 4);
      c.update(context(frameInput(input, { y: -10 }), { k }));
      c.applyCamera(ctx, camera);
      expect(cameraDirection(camera).pitch, `third person: ${third}`).toBeCloseTo(-KAIJU_PITCH_LIMIT, 4);
      // A flick far to one side: the head goes to its reach and waits for the body.
      c.update(context(frameInput(input, { x: -2, y: 5 }), { k }));
      c.applyCamera(ctx, camera);
      expect(wrapAngle(cameraDirection(camera).yaw - k.yaw), `third person: ${third}`).toBeCloseTo(lead, 4);
    }
  });

  it('turn all the way round in both views as the body follows the head', () => {
    for (const third of [false, true]) {
      const input = createActionState();
      const k = kaiju({ yaw: 0 });
      const c = new KaijuController(third);
      const camera = new THREE.PerspectiveCamera();
      let turned = 0;
      let last = 0;
      for (let i = 0; i < 40; i++) {
        c.update(context(frameInput(input, { x: -0.3 }), { k }));
        c.applyCamera(context(input, { k }), camera);
        const now = cameraDirection(camera).yaw;
        turned += wrapAngle(now - last);
        last = now;
        // The body lumbers after the head.
        k.yaw = wrapAngle(k.yaw + 0.3);
      }
      expect(turned, `third person: ${third}`).toBeGreaterThan(Math.PI * 2);
    }
  });

  it('ride the head while the beam drags it, in both views', () => {
    for (const third of [false, true]) {
      const input = createActionState();
      const special = kaijuKindDef('lizard').actions.special;
      const k = kaiju({ action: 'special', phase: special.activePhase, aimYaw: 0.4, aimPitch: -0.2 });
      const c = new KaijuController(third);
      const camera = new THREE.PerspectiveCamera();
      c.update(context(frameInput(input, { x: 1 }), { k }));
      c.applyCamera(context(input, { k }), camera);
      expectSameDirection(cameraDirection(camera), { yaw: 0.4, pitch: -0.2 });
    }
  });
});

describe('squad cameras', () => {
  it('keep the look direction when the view switches, with the same limits in both', () => {
    const input = createActionState();
    const u = unit();
    const c = new HumanController(false);
    const camera = new THREE.PerspectiveCamera();
    for (const [x, y] of [
      [0.4, 0.3],
      [-2, -0.6],
      [1, 1.2],
    ]) {
      c.update(context(frameInput(input, { x, y }), { u }));
      c.applyCamera(context(input, { u }), camera);
      const before = cameraDirection(camera);
      c.update(context(frameInput(input, {}, ['camera']), { u }));
      c.applyCamera(context(input, { u }), camera);
      expectSameDirection(before, cameraDirection(camera));
    }
    for (const third of [false, true]) {
      c.thirdPerson = third;
      c.update(context(frameInput(input, { y: 9 }), { u }));
      c.applyCamera(context(input, { u }), camera);
      expect(cameraDirection(camera).pitch).toBeCloseTo(HUMAN_PITCH_LIMIT, 4);
      c.update(context(frameInput(input, { y: -19 }), { u }));
      c.applyCamera(context(input, { u }), camera);
      expect(cameraDirection(camera).pitch).toBeCloseTo(-HUMAN_PITCH_LIMIT, 4);
    }
  });
});

describe('the command wheel', () => {
  /** Opens the wheel, moves the pointer (x right, y up), lets go: what goes to the server. */
  function pick(c: HumanController, u: SnapUnit, dx: number, dy: number): CommandId | undefined {
    const input = createActionState();
    c.update(context(frameInput(input, {}, ['wheel']), { u }));
    // Held for a moment (a quick tap with nothing pointed at leaves the wheel open: squadControls.test.ts).
    for (let i = 0; i < 24; i++) c.update(context(frameInput(input, { x: dx / 24, y: dy / 24 }, [], ['wheel']), { u }));
    expect(c.wheel.open).toBe(true);
    const highlighted = c.wheel.highlight;
    c.update(context(frameInput(input), { u }));
    expect(c.wheel.open).toBe(false);
    const sent = c.sample(context(input, { u })).wheel;
    expect(sent).toBe(highlighted ?? undefined);
    return sent;
  }

  it('sends every entry it has, each picked by pointing toward it and letting go', () => {
    const u = unit();
    const c = new HumanController(false);
    const step = 0.25;
    const toward: Record<string, [number, number]> = { up: [0, step], right: [step, 0], down: [0, -step], left: [-step, 0] };
    const places = ['up', 'right', 'down', 'left'];
    const picked = WHEEL_LAYOUT.map((_, i) => pick(c, u, ...toward[places[i]]));
    expect(picked).toEqual([...COMMAND_IDS]);
    // Letting go in the middle picks nothing.
    expect(pick(c, u, 0.01, 0.01)).toBeUndefined();
  });

  it('does not turn the view while it is open, and turns it again once closed', () => {
    const u = unit();
    const c = new HumanController(false);
    const input = createActionState();
    c.update(context(frameInput(input), { u }));
    const yaw = c.viewYaw;
    c.update(context(frameInput(input, {}, ['wheel']), { u }));
    c.update(context(frameInput(input, { x: 0.3 }, [], ['wheel']), { u }));
    expect(c.viewYaw).toBe(yaw);
    c.update(context(frameInput(input), { u }));
    c.update(context(frameInput(input, { x: 0.3 }), { u }));
    expect(c.viewYaw).not.toBe(yaw);
  });

  it('gives each order its own key as well', () => {
    const u = unit();
    const c = new HumanController(false);
    const keys: Array<[ButtonAction, CommandId]> = [
      ['cmdFollow', 'follow'],
      ['cmdMoveTo', 'moveTo'],
      ['cmdFireAtWill', 'fireAtWill'],
      ['cmdHoldCharge', 'holdCharge'],
    ];
    for (const [key, command] of keys) {
      const input = createActionState();
      c.update(context(frameInput(input, {}, [key]), { u }));
      expect(c.sample(context(input, { u })).wheel).toBe(command);
    }
  });
});
