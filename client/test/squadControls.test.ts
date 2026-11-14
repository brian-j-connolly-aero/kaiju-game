/**
 * The squad leader's controls after the first multiplayer playtest (docs/ROADMAP.md phase 1):
 * two buttons, and real tank driving at stages 2 and 3.
 *
 * - Fed through the real input path (mouse events, the input manager, the controller) with the
 *   pointer captured: the left button sends Fire and the right button sends Volley for as long
 *   as it is held (the simulation works out press and release); a click shorter than the gap
 *   between two samples still reaches one sample; the old squad keys send nothing.
 * - On foot the stick is turned into the aim's frame; a tank's stick goes as it is (W and S the
 *   throttle, A and D the hull's turn), and the gun's aim follows the turret, not the view.
 * - The turret is predicted the way the simulation turns it, so the gun reticle does not jitter.
 * - The volley meter's bookkeeping: what it shows from the newest snapshot, and the five-second
 *   window another squad's charged volley opens.
 * - The kaiju's warnings: guns charging at it are found, and placed on the screen or its edge.
 *
 * A headless browser garbles locked-pointer movement, so this is where the locked pointer is
 * tried; the playtest script tries the rest in a real browser.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Btn,
  CITY_SEED,
  COMBAT_RULES,
  createCityQuery,
  createCityState,
  DT,
  getCity,
  neutralInput,
  stepMovement,
  unitMoveParams,
  unitTypeDef,
  wrapAngle,
  type MoveBody,
  type PlayerInput,
  type SimEvent,
  type SnapKaiju,
  type SnapUnit,
} from '@mb/shared';
import { chaseOffset, drivesLikeTank, HumanController } from '../src/game/controllers/humanController';
import type { ControlContext } from '../src/game/controllers/types';
import { InputManager } from '../src/game/input/inputManager';
import { createPredictor, predictedTurret, predictStep, reconcile } from '../src/net/prediction';
import { screenSpot, squadThreats } from '../src/ui/threats';
import { mateLooks, shownCharge, VolleyPartner } from '../src/ui/volleyMeter';
import { FakeBrowser } from './fakeBrowser';

const FRAME = 1 / 60;
const FAR = 20000;

function unit(over: Partial<SnapUnit> = {}): SnapUnit {
  return {
    id: 0,
    squad: 0,
    type: 'army_rocket_infantry',
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
    stunned: false,
    stun: 0,
    ...over,
  };
}

const city = getCity(CITY_SEED);
const query = createCityQuery(city.index, createCityState(city.city));
const BOUNDS = { minX: FAR - 500, maxX: FAR + 500, minZ: FAR - 500, maxZ: FAR + 500 };

/** A context the controller can run in: the unit far outside the city, nothing in the way. */
function contextFor(input: InputManager['state'], u: SnapUnit, stage = 1): ControlContext {
  const frame = {
    localKaiju: null,
    localUnit: u,
    kaijus: [],
    units: [u],
    squads: [],
    match: { stage, phase: 'playing' },
    bounds: BOUNDS,
  };
  return {
    session: { mirror: { query, city: city.city }, aimYaw: 0, aimPitch: 0 },
    renderer: { kaijuCamAnchor: () => null },
    input,
    frame,
    dt: FRAME,
    now: 0,
    mapOpen: false,
  } as unknown as ControlContext;
}

describe('the squad leader’s two buttons, with the pointer captured', () => {
  let browser: FakeBrowser;
  let input: InputManager;
  let uninstall: () => void;
  let c: HumanController;
  let u: SnapUnit;

  /** One frame: read the devices, run the controller, and (like the runtime) take one 30 Hz sample. */
  function frame(sample = true): number {
    input.poll(FRAME);
    const ctx = contextFor(input.state, u);
    c.update(ctx);
    if (!sample) return -1;
    const out = c.sample(ctx);
    input.sampleTaken();
    return out.buttons;
  }

  beforeEach(async () => {
    browser = new FakeBrowser();
    uninstall = browser.install();
    input = new InputManager(browser.canvas as unknown as HTMLElement);
    input.attach();
    input.wantCapture = true;
    // The click on the view that captures the pointer, and the settle time after it.
    browser.mouseDown(0);
    await browser.settle();
    browser.mouseUp(0);
    browser.advance(200);
    input.poll(FRAME);
    input.sampleTaken();
    expect(browser.locked).toBe(true);
    u = unit();
    c = new HumanController(true);
    frame();
  });

  afterEach(() => {
    input.detach();
    uninstall();
  });

  it('sends Volley for as long as the right button is held, and Fire with the left', () => {
    browser.mouseDown(2);
    for (let i = 0; i < 10; i++) {
      const buttons = frame();
      expect(buttons & Btn.volley, `held, frame ${i}`).toBe(Btn.volley);
      expect(buttons & Btn.fire).toBe(0);
      expect(c.volleyHeld).toBe(true);
    }
    browser.mouseUp(2);
    expect(frame() & Btn.volley).toBe(0);
    expect(c.volleyHeld).toBe(false);
    browser.mouseDown(0);
    expect(frame()).toBe(Btn.fire);
    // Both at once: the leader fires while the squad-mates charge.
    browser.mouseDown(2);
    expect(frame()).toBe(Btn.fire | Btn.volley);
    // Let go: the volley goes in the very next sample (Fire's latch keeps it for one sample more).
    browser.mouseUp(0);
    browser.mouseUp(2);
    expect(frame() & Btn.volley).toBe(0);
    expect(frame()).toBe(0);
  });

  it('does not lose a quick right click that is over before the next sample', () => {
    browser.mouseDown(2);
    browser.mouseUp(2);
    frame(false);
    expect(frame() & Btn.volley).toBe(Btn.volley);
    expect(frame() & Btn.volley).toBe(0);
  });

  it('sends nothing for the old squad keys (the wheel, the number keys, smoke, mark, artillery)', () => {
    for (const [code, key] of [
      ['KeyQ', 'q'],
      ['Digit1', '1'],
      ['Digit2', '2'],
      ['Digit3', '3'],
      ['Digit4', '4'],
      ['KeyG', 'g'],
      ['KeyR', 'r'],
      ['KeyE', 'e'],
    ] as const) {
      browser.keyDown(code, key);
      const ctx = contextFor(input.poll(FRAME), u);
      c.update(ctx);
      const out = c.sample(ctx);
      input.sampleTaken();
      expect(out.buttons, code).toBe(0);
      expect(Object.keys(out).sort(), code).toEqual(['aimPitch', 'aimYaw', 'buttons', 'moveX', 'moveZ']);
      browser.keyUp(code, key);
      frame();
    }
  });
});

describe('the stick: on foot relative to the view, a tank by throttle and turn', () => {
  /** One update and sample with W and D held, the view turned `apart` from the aim sent. */
  function sampled(u: SnapUnit, apart: number): { moveX: number; moveZ: number; tank: boolean } {
    const c = new HumanController(true);
    const state = new InputManager({} as HTMLElement).state;
    state.moveX = Math.SQRT1_2;
    state.moveZ = Math.SQRT1_2;
    const ctx = contextFor(state, u);
    c.update(ctx);
    // In third person the aim sent is the line from the unit to what the camera's ray lands on;
    // it can differ from the view's heading.
    c.viewYaw = wrapAngle(c.aimYaw + apart);
    const out = c.sample(ctx);
    return { moveX: out.moveX, moveZ: out.moveZ, tank: c.tank };
  }

  it('turns an infantry stick into the aim’s frame', () => {
    const out = sampled(unit({ type: 'army_rocket_infantry' }), 0.7);
    expect(out.tank).toBe(false);
    // W and D are forward-right of the VIEW; the server reads the stick relative to the aim.
    expect(Math.hypot(out.moveX, out.moveZ)).toBeCloseTo(1, 6);
    expect(Math.atan2(out.moveX, out.moveZ)).toBeCloseTo(Math.PI / 4 - 0.7, 6);
  });

  it('sends a tank’s stick as it is, whatever the view and the aim do (stages 2 and 3)', () => {
    for (const type of ['army_tank', 'army_tank_troop'] as const) {
      expect(unitTypeDef(type).drive, type).toBeDefined();
      const out = sampled(unit({ type }), 0.7);
      expect(out.tank, type).toBe(true);
      expect(out.moveX, type).toBeCloseTo(Math.SQRT1_2, 9);
      expect(out.moveZ, type).toBeCloseTo(Math.SQRT1_2, 9);
    }
    // A squad-mate of a tank level is not driven like a tank (nobody drives it).
    expect(drivesLikeTank({ type: 'army_tank', driven: false })).toBe(false);
  });

  it('aims the gun along the turret, not the view, and the chase camera sees over the tank', () => {
    const state = new InputManager({} as HTMLElement).state;
    // The view looks along +Z, level; the turret still points 0.6 rad to the side.
    state.aimOverride = { yaw: 0, pitch: 0 };
    const u = unit({ type: 'army_tank', aimYaw: 0.6 });
    const c = new HumanController(true);
    const ctx = contextFor(state, u);
    c.update(ctx);
    c.applyCamera(ctx, { position: { set() {} }, up: { set() {} }, lookAt() {}, fov: 58, near: 0.25, far: 9000, updateProjectionMatrix() {} } as never);
    expect(Math.atan2(c.gunPoint.x - u.x, c.gunPoint.z - u.z)).toBeCloseTo(0.6, 6);
    expect(Math.atan2(c.aimPoint.x - u.x, c.aimPoint.z - u.z)).toBeCloseTo(0, 6);
    // The camera hangs behind and above; its level center ray passes over the tank's roof.
    const { back, up } = chaseOffset('army_tank');
    expect(back).toBeGreaterThan(unitTypeDef('army_tank').radius * 3);
    expect(up).toBeGreaterThan(unitTypeDef('army_tank').height + 2);
    expect(chaseOffset('army_tank_troop').back).toBeGreaterThan(back);
  });
});

describe('the predicted turret', () => {
  const def = unitTypeDef('army_tank');
  const params = unitMoveParams(def, { alive: true, rooted: false, driven: true }, BOUNDS);
  const input = (seq: number, aimYaw: number): PlayerInput => ({ ...neutralInput(seq), aimYaw });

  it('turns toward the aim at the turret’s own rate, exactly as the simulation does, with no correction', () => {
    expect(params.steer).toBe('tank');
    const server: MoveBody = { x: FAR, z: FAR, yaw: 0, vx: 0, vz: 0, radius: def.radius, aimYaw: 0 };
    const p = createPredictor();
    reconcile(p, { ...server }, def.radius, 0, query, params, true);
    const sent: PlayerInput[] = [];
    for (let seq = 1; seq <= 20; seq++) {
      const i = input(seq, 2);
      sent.push(i);
      predictStep(p, i, query, params, true);
    }
    // 20 ticks at the turret's rate, not at once.
    const turned = predictedTurret(p) as number;
    expect(turned).toBeCloseTo(Math.min(2, (def.drive?.turretRate ?? 0) * DT * 20), 6);
    // Halfway through the newest tick, the drawn turret is halfway along that tick's turn.
    const half = predictedTurret(p, 0.5) as number;
    expect(turned - half).toBeCloseTo(((def.drive?.turretRate ?? 0) * DT) / 2, 6);
    // The server plays the first 12 of them; its turret there, the rest replayed: nothing to correct.
    for (const i of sent.slice(0, 12)) stepMovement(server, i, DT, query, params);
    reconcile(p, { ...server }, def.radius, 12, query, params, true);
    expect(p.errAim).toBeCloseTo(0, 9);
    expect(predictedTurret(p)).toBeCloseTo(turned, 9);
  });

  it('leaves the turret alone for a body that does not steer like a tank', () => {
    const p = createPredictor();
    const foot = unitMoveParams(unitTypeDef('army_rocket_infantry'), { alive: true, rooted: false, driven: true }, BOUNDS);
    reconcile(p, { x: FAR, z: FAR, yaw: 0, vx: 0, vz: 0, aimYaw: 1 }, 3, 0, query, foot, true);
    predictStep(p, input(1, 2), query, foot, true);
    expect(predictedTurret(p)).toBeNull();
  });
});

describe('the volley meter', () => {
  const mates = (charges: number[], over: Partial<SnapUnit> = {}): SnapUnit[] => [
    unit({ id: 4, squad: 1, driven: true }),
    ...charges.map((charge, i) => unit({ id: 5 + i, squad: 1, driven: false, rooted: true, laser: true, charge, ...over })),
  ];

  it('shows the squad’s charge while Volley is held, carried forward between snapshots, and nothing once let go', () => {
    const units = mates([0.5, 0.3, 0.4]);
    expect(shownCharge(units, 1, true, 0)).toBeCloseTo(0.4, 6);
    expect(shownCharge(units, 1, true, 0.45)).toBeCloseTo(0.4 + 0.45 / COMBAT_RULES.chargeTime, 6);
    // A stall is not carried forward for ever, and the meter never passes full.
    expect(shownCharge(units, 1, true, 5)).toBeLessThan(0.6);
    expect(shownCharge(mates([1, 1, 1]), 1, true, 0.3)).toBe(1);
    expect(shownCharge(units, 1, false, 0)).toBe(0);
    // Held, but nobody planted yet (the press is on its way to the server): an empty meter.
    expect(shownCharge(mates([0, 0, 0], { rooted: false, laser: false }), 1, true, 0.2)).toBe(0);
  });

  it('pictures each squad-mate: charging, following, unable to charge, gone', () => {
    const units = [
      unit({ id: 4, squad: 1, driven: true }),
      unit({ id: 5, squad: 1, driven: false, rooted: true, laser: true, charge: 0.5 }),
      unit({ id: 6, squad: 1, driven: false }),
      unit({ id: 7, squad: 1, driven: false, stun: 1.2, stunned: true }),
      unit({ id: 8, squad: 2, driven: false, alive: false }),
    ];
    expect(mateLooks(units, 1)).toEqual(['charging', 'ready', 'out']);
    expect(mateLooks([...units.slice(0, 3), unit({ id: 7, squad: 1, driven: false, alive: false })], 1)).toEqual(['charging', 'ready', 'dead']);
  });

  it('opens the five-second window when another squad’s charged volley lands, and pairs this squad’s inside it', () => {
    const spawn = (id: number, ownerId: number, volley: boolean): SimEvent => ({ type: 'projectileSpawn', tick: 0, id, ownerId, owner: 'unit', volley }) as unknown as SimEvent;
    const hit = (id: number, target: string): SimEvent => ({ type: 'projectileHit', tick: 0, id, target }) as unknown as SimEvent;
    const partner = new VolleyPartner(1);
    // Squad 2's ragged shot and a charged one that hits a building: no window.
    partner.onEvent(spawn(1, 9, false), 0);
    partner.onEvent(hit(1, 'kaiju'), 0.5);
    partner.onEvent(spawn(2, 9, true), 0);
    partner.onEvent(hit(2, 'structure'), 0.5);
    expect(partner.remaining(0.6)).toBe(0);
    // Squad 2's charged volley lands on the kaiju (unit 9 is squad 2's): the window opens.
    partner.onEvent(spawn(3, 9, true), 1);
    partner.onEvent(hit(3, 'kaiju'), 2);
    expect(partner.partner).toBe(2);
    expect(partner.remaining(2)).toBeCloseTo(COMBAT_RULES.volleyBreakWindow, 6);
    expect(partner.remaining(4)).toBeCloseTo(COMBAT_RULES.volleyBreakWindow - 2, 6);
    expect(partner.remaining(2 + COMBAT_RULES.volleyBreakWindow + 0.1)).toBe(0);
    // This squad's own (unit 5 is squad 1's) lands 3 s later: the pair is made, the window closes.
    partner.onEvent(spawn(4, 5, true), 3);
    partner.onEvent(hit(4, 'kaiju'), 5);
    expect(partner.pairedAt).toBe(5);
    expect(partner.remaining(5)).toBe(0);
  });
});

describe('the kaiju’s warnings of charging guns', () => {
  const k = { id: 0, kind: 'lizard', stage: 1, x: 0, z: 0, alive: true } as SnapKaiju;

  it('finds each squad with guns charging at the kaiju, and none aimed elsewhere or out of range', () => {
    const toward = (x: number, z: number): number => Math.atan2(-x, -z);
    const units = [
      unit({ id: 1, squad: 0, type: 'army_rocket_infantry', laser: true, charge: 0.4, x: 100, z: 0, aimYaw: toward(100, 0) }),
      unit({ id: 2, squad: 0, type: 'army_rocket_infantry', laser: true, charge: 0.9, x: 104, z: 6, aimYaw: toward(104, 6) }),
      // Aimed well away.
      unit({ id: 5, squad: 1, type: 'army_rocket_infantry', laser: true, charge: 1, x: 0, z: 100, aimYaw: 0 }),
      // Out of range.
      unit({ id: 13, squad: 3, type: 'army_rocket_infantry', laser: true, charge: 1, x: 0, z: -900, aimYaw: toward(0, -900) }),
    ];
    const threats = squadThreats(k, units);
    expect(threats.map((t) => t.squad)).toEqual([0]);
    expect(threats[0].charge).toBeCloseTo(0.9, 6);
    expect(threats[0].x).toBeCloseTo(102, 6);
  });

  it('puts a gun in view where it is, and one beside or behind the head on the screen’s edge toward it', () => {
    const fov = (66 * Math.PI) / 180;
    const spot = { x: 0, y: 0, onScreen: false, angle: 0 };
    // Straight ahead (the camera looks down -z).
    screenSpot(0, 0, -50, fov, 16 / 9, 0.06, spot);
    expect(spot).toMatchObject({ onScreen: true, x: 0.5, y: 0.5 });
    // Far to the right, in front: the right edge.
    screenSpot(200, 0, -10, fov, 16 / 9, 0.06, spot);
    expect(spot.onScreen).toBe(false);
    expect(spot.x).toBeCloseTo(0.94, 6);
    // Behind and to the left: the left half of the screen, low.
    screenSpot(-30, 0, 40, fov, 16 / 9, 0.06, spot);
    expect(spot.onScreen).toBe(false);
    expect(spot.x).toBeLessThan(0.5);
    expect(spot.y).toBeGreaterThan(0.5);
    // Straight behind: the bottom edge.
    screenSpot(0, 0, 40, fov, 16 / 9, 0.06, spot);
    expect(spot.y).toBeCloseTo(0.94, 6);
  });
});
