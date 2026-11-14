/**
 * The monster's controls in the client (docs/ROADMAP.md phase 1: one move per button): which
 * wind-up a press shows ahead of the server, what the controller sends (the new buttons and a
 * molt card on exactly one input, also outside play), and that the new moves have readable poses.
 */

import { describe, expect, it } from 'vitest';
import { Btn, kaijuKindDef, type KaijuMoveId, type SnapKaiju } from '@mb/shared';
import { idleSample } from '../src/app/matchRuntime';
import { KaijuController } from '../src/game/controllers/kaijuController';
import type { ControlContext } from '../src/game/controllers/types';
import { createActionState, type ActionState, type ButtonAction } from '../src/game/input/actions';
import { hintVerb } from '../src/net/matchSession';
import { computeKaijuPose, createKaijuPose, type KaijuAnimInput } from '../src/render/kaijuAnimator';

const A = kaijuKindDef('lizard').actions;

function kaiju(over: Partial<SnapKaiju> = {}): SnapKaiju {
  const cooldowns = {} as SnapKaiju['cooldowns'];
  for (const verb of Object.keys(A) as Array<keyof typeof A>) cooldowns[verb] = 0;
  return {
    id: 0,
    player: 0,
    kind: 'lizard',
    stage: 2,
    alive: true,
    moltAvailable: false,
    wading: false,
    inWater: false,
    submerge: 0,
    known: true,
    spotted: false,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    yaw: 0,
    aimYaw: 0,
    aimPitch: 0,
    hp: 1000,
    maxHp: 1000,
    nerve: 0,
    nerveImmune: 0,
    rage: 0,
    action: 'none',
    phase: 'idle',
    phaseTime: 0,
    phaseDuration: 0,
    held: null,
    cooldowns,
    moves: ['none', 'none'],
    offer: [],
    ...over,
  };
}

const press = (k: SnapKaiju, buttons: number): ReturnType<typeof hintVerb> => hintVerb(k, buttons, buttons);

describe("the local kaiju's wind-up follows one move per button", () => {
  it('shows the starting kit on its own buttons, and the hand decides between swipe and throw, grab and eat', () => {
    expect(press(kaiju(), Btn.stomp)).toBe('stomp');
    expect(press(kaiju(), Btn.strike)).toBe('swipe');
    expect(press(kaiju(), Btn.grab)).toBe('grab');
    const holding = kaiju({ held: { kind: 'wreck', wreck: 'car' } });
    expect(press(holding, Btn.strike)).toBe('throw');
    expect(press(holding, Btn.grab)).toBe('eat');
    // A meal too recent: Grab with something in the hand does nothing.
    holding.cooldowns.eat = 4;
    expect(press(holding, Btn.grab)).toBeNull();
  });

  it('shows nothing for an empty move slot, and the move in the slot when it is ready', () => {
    expect(press(kaiju(), Btn.move1)).toBeNull();
    expect(press(kaiju(), Btn.move2)).toBeNull();
    const k = kaiju({ moves: ['roar', 'charge'] });
    expect(press(k, Btn.move1)).toBe('roar');
    expect(press(k, Btn.move2)).toBe('charge');
    k.cooldowns.roar = 3;
    expect(press(k, Btn.move1)).toBeNull();
    // The beam needs its rage; the tail sweep its cooldown.
    const beam = kaiju({ moves: ['beam', 'tailSweep'] });
    expect(press(beam, Btn.move1)).toBeNull();
    beam.rage = A.special.rageCost;
    expect(press(beam, Btn.move1)).toBe('special');
    expect(press(beam, Btn.move2)).toBe('tailSweep');
  });

  it('holds the brace for as long as its button is down, and keeps the simulation order', () => {
    const k = kaiju({ moves: ['roar', 'brace'] });
    // Held from before (not a fresh press): still the brace.
    expect(hintVerb(k, Btn.move2, 0)).toBe('brace');
    // Molt, brace, the first move, the second, stomp, strike, grab.
    expect(press(k, Btn.move1 | Btn.stomp | Btn.strike)).toBe('roar');
    expect(press(kaiju({ moves: ['charge', 'none'] }), Btn.stomp | Btn.strike | Btn.grab)).toBe('stomp');
    // A molt on offer: the cocoon starts, and nothing is shown ahead of the server.
    expect(press(kaiju({ moltAvailable: true }), Btn.molt | Btn.strike)).toBeNull();
    // The old buttons are gone: nothing presses them any more.
    expect('block' in Btn || 'roar' in Btn || 'special' in Btn).toBe(false);
  });
});

function context(input: ActionState, mapOpen = false): ControlContext {
  return { input, mapOpen } as unknown as ControlContext;
}

function held(...actions: ButtonAction[]): ActionState {
  const s = createActionState();
  for (const a of actions) {
    s.down[a] = true;
    s.held[a] = true;
  }
  return s;
}

describe('the kaiju controller', () => {
  it('sends Strike, Grab, Stomp, the two move buttons and Molt as they are held', () => {
    const c = new KaijuController();
    expect(c.sample(context(held('strike', 'stomp', 'move2'))).buttons).toBe(Btn.strike | Btn.stomp | Btn.move2);
    expect(c.sample(context(held('grab', 'move1', 'molt'))).buttons).toBe(Btn.grab | Btn.move1 | Btn.molt);
  });

  it('carries a picked molt card on exactly one input, even with the map open', () => {
    const c = new KaijuController();
    c.pickCard(2);
    const first = c.sample(context(held(), true));
    expect(first.card).toBe(2);
    expect(first.buttons).toBe(0);
    expect(c.sample(context(held())).card).toBeUndefined();
    // Nothing but 1 to 3.
    c.pickCard(4);
    expect(c.sample(context(held())).card).toBeUndefined();
  });

  it('still sends the card outside play (the intermission), with nothing else', () => {
    const c = new KaijuController();
    c.pickCard(3);
    const out = idleSample(c.sample(context(held('strike', 'move1'))), 0.5, -0.1);
    expect(out).toEqual({ moveX: 0, moveZ: 0, aimYaw: 0.5, aimPitch: -0.1, buttons: 0, card: 3 });
    expect(idleSample(null, 0, 0).card).toBeUndefined();
  });
});

describe('the new moves have readable poses', () => {
  const base: KaijuAnimInput = { time: 0, walkPhase: 0, speed: 0, headYaw: 0, headPitch: 0, action: 'none', phase: 'idle', phaseTime: 0, phaseDuration: 0, holding: false, height: 32 };
  const pose = createKaijuPose();
  const at = (action: KaijuAnimInput['action'], phase: KaijuAnimInput['phase'], phaseTime: number, phaseDuration: number): Map<string, { x: number; y: number; z: number }> => {
    computeKaijuPose({ ...base, action, phase, phaseTime, phaseDuration }, pose);
    return new Map([...pose.rotations].map(([k, v]) => [k, { ...v }]));
  };

  it('lowers the head for the charge, runs low and forward, and buckles a knee in the stumble', () => {
    const c = A.charge.timing;
    const windup = at('charge', 'windup', c.windup, c.windup);
    expect(windup.get('head')?.x).toBeGreaterThan(0.25);
    expect(windup.get('torso')?.x).toBeGreaterThan(0.25);
    const run = at('charge', 'charge', 1, c.active);
    expect(run.get('torso')?.x).toBeGreaterThan(0.35);
    // The arms are tucked back (positive x swings a hanging limb back).
    expect(run.get('arm_L')?.x).toBeGreaterThan(0.4);
    const stumble = at('charge', 'stumble', c.recover * 0.3, c.recover);
    expect(stumble.get('shin_L')?.x).toBeGreaterThan(0.8);
    expect(stumble.get('torso')?.x).toBeGreaterThan(0.5);
    // ...and it is back up by the end.
    const after = at('charge', 'stumble', c.recover, c.recover);
    expect(Math.abs(after.get('shin_L')?.x ?? 1)).toBeLessThan(0.05);
  });

  it('draws the tail round to one side in the tail sweep, then lashes it across to the other', () => {
    const t = A.tailSweep.timing;
    const coiled = at('tailSweep', 'windup', t.windup, t.windup);
    const lashed = at('tailSweep', 'active', t.active, t.active);
    expect(coiled.get('tail_1')?.y).toBeGreaterThan(0.25);
    expect(lashed.get('tail_1')?.y).toBeLessThan(-0.4);
    // The feet stay planted: the legs turn against the hips.
    expect((lashed.get('hips')?.y ?? 0) + (lashed.get('leg_L')?.y ?? 0)).toBeCloseTo(0, 5);
  });

  it('every move a molt can give has a picture', async () => {
    const { MOVE_ICON } = await import('../src/ui/kaijuKit');
    const { hasIconArt } = await import('../src/ui/iconArt');
    const moves: KaijuMoveId[] = ['beam', 'roar', 'charge', 'tailSweep', 'brace'];
    for (const move of moves) {
      const id = MOVE_ICON[move as Exclude<KaijuMoveId, 'none'>];
      expect(hasIconArt(id), `${move}: ${id}`).toBe(true);
    }
  });
});
