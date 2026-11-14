/**
 * The squad leader's controls after the owner's second set of notes (polish pass 2):
 *
 * - the command wheel follows the mouse while the game holds the pointer (pointer lock): fed
 *   through the real input path (mouse events with movementX / movementY, the input manager,
 *   the controller), the highlight moves from entry to entry;
 * - while the wheel is open the left mouse button picks the highlighted entry and closes the
 *   wheel, and fires nothing (not on that click, and not while that button stays down);
 * - a quick tap of the wheel button leaves it open to point and click; the number keys still work;
 * - smoke and mark have their own buttons, which go to the server as their own bits;
 * - the kaiju's warnings: guns charging at it are found, and placed on the screen or its edge.
 *
 * A headless browser garbles locked-pointer movement, so this is where the locked pointer is
 * tried; the playtest script tries the rest in a real browser.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Btn, CITY_SEED, createCityQuery, createCityState, getCity, type SnapKaiju, type SnapUnit } from '@mb/shared';
import { HumanController, WHEEL_TAP_TIME } from '../src/game/controllers/humanController';
import type { ControlContext } from '../src/game/controllers/types';
import { InputManager } from '../src/game/input/inputManager';
import { mapOrderFor } from '../src/ui/mapView';
import { screenSpot, squadThreats } from '../src/ui/threats';
import { FakeBrowser } from './fakeBrowser';

const FRAME = 1 / 60;
const FAR = 20000;

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
    stunned: false,
    stun: 0,
    ...over,
  };
}

describe('the command wheel with the pointer captured', () => {
  let browser: FakeBrowser;
  let input: InputManager;
  let uninstall: () => void;
  let c: HumanController;
  const u = unit();

  /** A context the controller can run in: a lone tank far outside the city, nothing in the way. */
  function context(): ControlContext {
    const frame = {
      localKaiju: null,
      localUnit: u,
      kaijus: [],
      units: [u],
      squads: [],
      smokes: [],
      match: { stage: 1, phase: 'playing' },
      bounds: { minX: FAR - 500, maxX: FAR + 500, minZ: FAR - 500, maxZ: FAR + 500 },
    };
    return {
      session: { mirror: { query: emptyQuery() }, aimYaw: 0, aimPitch: 0 },
      renderer: { kaijuCamAnchor: () => null },
      input: input.state,
      frame,
      dt: FRAME,
      now: 0,
      mapOpen: false,
    } as unknown as ControlContext;
  }

  /** One frame: read the devices, run the controller, and (like the runtime) take one 30 Hz sample. */
  function frame(sample = true): number {
    input.poll(FRAME);
    const ctx = context();
    c.update(ctx);
    if (!sample) return -1;
    const out = c.sample(ctx);
    input.sampleTaken();
    lastWheel = out.wheel;
    return out.buttons;
  }
  let lastWheel: string | undefined;

  /** Moves the mouse in small steps (as a hand does), a frame each. */
  function move(dx: number, dy: number, steps = 6): void {
    for (let i = 0; i < steps; i++) {
      browser.mouseMove(dx / steps, dy / steps);
      frame();
    }
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
    c = new HumanController(false);
    frame();
  });

  afterEach(() => {
    input.detach();
    uninstall();
  });

  it('moves the highlight with the mouse while the pointer is captured, entry to entry', () => {
    browser.mouseDown(2);
    frame();
    expect(c.wheel.open).toBe(true);
    expect(c.wheel.highlight).toBeNull();
    move(80, 0);
    expect(c.wheel.highlight).toBe('moveTo');
    move(-160, 0);
    expect(c.wheel.highlight).toBe('holdCharge');
    // The mouse pushed forward (movementY negative) is up the wheel: follow me.
    move(80, -160);
    expect(c.wheel.highlight).toBe('follow');
    move(0, 320);
    expect(c.wheel.highlight).toBe('fireAtWill');
    // Letting the right button go picks it, as before.
    browser.mouseUp(2);
    frame();
    expect(c.wheel.open).toBe(false);
    expect(lastWheel).toBe('fireAtWill');
  });

  it('picks with a left click while open, and the click fires nothing, then or while held', () => {
    browser.mouseDown(2);
    frame();
    move(90, 0);
    expect(c.wheel.highlight).toBe('moveTo');
    browser.mouseDown(0);
    const buttons = frame();
    expect(c.wheel.open).toBe(false);
    expect(lastWheel).toBe('moveTo');
    expect(buttons & Btn.fire).toBe(0);
    // Still holding the left button (and the right one): no shot.
    for (let i = 0; i < 10; i++) expect(frame() & Btn.fire).toBe(0);
    browser.mouseUp(0);
    browser.mouseUp(2);
    expect(frame() & Btn.fire).toBe(0);
    frame();
    // The next click is a shot again.
    browser.mouseDown(0);
    expect(frame() & Btn.fire).toBe(Btn.fire);
    browser.mouseUp(0);
  });

  it('does not lose the pick to a click that is over before the next sample', () => {
    browser.mouseDown(2);
    frame();
    move(0, 90);
    // Press and release inside one frame, and no 30 Hz sample on that frame.
    browser.mouseDown(0);
    browser.mouseUp(0);
    frame(false);
    expect(c.wheel.open).toBe(false);
    // The latched click reaches the next samples as a click; they must not fire it.
    expect(frame() & Btn.fire).toBe(0);
    expect(frame() & Btn.fire).toBe(0);
  });

  it('stays open after a quick tap of the wheel button, to point and click', () => {
    browser.mouseDown(2);
    frame();
    browser.mouseUp(2);
    frame();
    expect(c.wheel.open).toBe(true);
    expect(c.wheel.sticky).toBe(true);
    move(-90, 0);
    expect(c.wheel.highlight).toBe('holdCharge');
    browser.mouseDown(0);
    expect(frame() & Btn.fire).toBe(0);
    expect(lastWheel).toBe('holdCharge');
    expect(c.wheel.open).toBe(false);
    browser.mouseUp(0);
  });

  it('closes, picking nothing, when the button is held a while and let go in the middle', () => {
    browser.keyDown('KeyQ', 'q');
    frame();
    for (let t = 0; t < WHEEL_TAP_TIME + 0.1; t += FRAME) frame();
    browser.keyUp('KeyQ', 'q');
    frame();
    expect(c.wheel.open).toBe(false);
    expect(lastWheel).toBeUndefined();
  });

  it('takes a number key while open, and closes', () => {
    browser.mouseDown(2);
    frame();
    browser.mouseUp(2);
    frame();
    expect(c.wheel.open).toBe(true);
    browser.keyDown('Digit3', '3');
    frame();
    browser.keyUp('Digit3', '3');
    expect(lastWheel).toBe('fireAtWill');
    expect(c.wheel.open).toBe(false);
  });

  it('sends smoke and mark on their own buttons', () => {
    browser.keyDown('KeyG', 'g');
    expect(frame() & Btn.smoke).toBe(Btn.smoke);
    browser.keyUp('KeyG', 'g');
    frame();
    browser.keyDown('KeyR', 'r');
    expect(frame() & Btn.mark).toBe(Btn.mark);
    browser.keyUp('KeyR', 'r');
    frame();
    expect(frame() & (Btn.smoke | Btn.mark)).toBe(0);
  });
});

const city = getCity(CITY_SEED);
const query = createCityQuery(city.index, createCityState(city.city));
/** The shipped city (the controller's aim ray is cast against it; the tank stands far outside it). */
function emptyQuery() {
  return query;
}

describe('the kaiju’s warnings of charging guns', () => {
  const k = { id: 0, kind: 'lizard', stage: 1, x: 0, z: 0, alive: true } as SnapKaiju;

  it('finds each squad with guns charging at the kaiju, and none hidden in smoke or aimed elsewhere', () => {
    const toward = (x: number, z: number): number => Math.atan2(-x, -z);
    const units = [
      unit({ id: 1, squad: 0, type: 'army_rocket_infantry', laser: true, charge: 0.4, x: 100, z: 0, aimYaw: toward(100, 0) }),
      unit({ id: 2, squad: 0, type: 'army_rocket_infantry', laser: true, charge: 0.9, x: 104, z: 6, aimYaw: toward(104, 6) }),
      // Aimed well away.
      unit({ id: 5, squad: 1, type: 'army_rocket_infantry', laser: true, charge: 1, x: 0, z: 100, aimYaw: 0 }),
      // In smoke.
      unit({ id: 9, squad: 2, type: 'army_rocket_infantry', laser: true, charge: 1, x: -100, z: 0, aimYaw: toward(-100, 0) }),
      // Out of range.
      unit({ id: 13, squad: 3, type: 'army_rocket_infantry', laser: true, charge: 1, x: 0, z: -900, aimYaw: toward(0, -900) }),
    ];
    const threats = squadThreats(k, units, [{ x: -100, z: 0, radius: 12, height: 10 }]);
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

describe('orders on the map', () => {
  it('places the picked order with a left click, and the guns with a right click, only when the squad has guns', () => {
    expect(mapOrderFor(0, 'moveTo', false)).toBe('moveTo');
    expect(mapOrderFor(0, 'moveTo', true)).toBe('moveTo');
    expect(mapOrderFor(0, 'callIn', true)).toBe('callIn');
    expect(mapOrderFor(2, 'moveTo', true)).toBe('callIn');
    expect(mapOrderFor(2, 'moveTo', false)).toBeNull();
    expect(mapOrderFor(0, 'callIn', false)).toBeNull();
    expect(mapOrderFor(1, 'moveTo', true)).toBeNull();
  });
});
