/**
 * Round 5, the squad's screen after the third playtest ("not sure when could charge", "the weird
 * yellow circle constantly refreshing", "LOS issues/confusion", "1-2 word descriptions needed"):
 * the crosshair against where the unit's shot really goes, the volley chip's words and
 * pictures, the squad-mates' lines, the team-up rule, and the reload the HUD and the gun reticle
 * share. The crosshair test is the round 5 army investigation's, made to check what the screen
 * shows (its checker's advice), not only where the gun points.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CITY_SEED,
  COMBAT_RULES,
  createAimPoint,
  createCityQuery,
  createCityState,
  DT,
  getCity,
  kaijuStageDef,
  pickupWeaponDef,
  resolveAimPoint,
  unitTypeDef,
  weaponDef,
  type SimEvent,
  type SnapKaiju,
  type SnapUnit,
} from '@mb/shared';
import { chaseOffset, HumanController } from '../src/game/controllers/humanController';
import type { ControlContext } from '../src/game/controllers/types';
import { createActionState } from '../src/game/input/actions';
import { fireWord, nextReloadPeak, PICKUP_NAMES, reloadShare } from '../src/ui/hud';
import {
  mateLines,
  mateLooks,
  predictedCharge,
  reloadHolds,
  shownCharge,
  teamUpShown,
  volleyReload,
  volleyWord,
  VolleyPartner,
  WORD_TONE,
  type LineState,
  type MateLook,
} from '../src/ui/volleyMeter';

const city = getCity(CITY_SEED);
const query = createCityQuery(city.index, createCityState(city.city));

function unit(over: Partial<SnapUnit>): SnapUnit {
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
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    y: 0,
    yaw: 0,
    aimYaw: 0,
    aimPitch: 0,
    hp: 100,
    maxHp: 100,
    members: 10,
    nerve: 0,
    shaken: 0,
    charge: 0,
    cooldown: 0,
    stunned: false,
    stun: 0,
    ...over,
  };
}

/** Squad 1: its leader (id 4) and three squad-mates (5, 6, 7) with what each is given. */
function squad(mates: Array<Partial<SnapUnit>>): SnapUnit[] {
  return [unit({ id: 4, squad: 1, driven: true }), ...mates.map((m, i) => unit({ id: 5 + i, squad: 1, driven: false, ...m }))];
}

describe('round 5: the crosshair and where the shot really goes', () => {
  it('on foot, third person: when the crosshair is on the monster and the soldiers’ shot would hit a garage in front, the screen says "Blocked", and the volley still goes at the monster (round 4: the orange "on target" diamond while every rocket hit the garage)', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.25, 9000);
    let looked = 0;
    let blocked = 0;
    let lies = 0;
    let volleyAway = 0;
    const garages = city.city.structures.filter((s) => s.archetype === 'garage_a').slice(0, 80);
    for (const g of garages) {
      for (let side = 0; side < 4; side++) {
        const yaw = g.yaw + (side * Math.PI) / 2;
        const half = side % 2 === 0 ? g.hz : g.hx;
        const sx = Math.sin(yaw);
        const sz = Math.cos(yaw);
        // The squad's leader 3 m behind the garage, the hatchling 60 m beyond it.
        const u = unit({ x: g.x - sx * (half + 3), z: g.z - sz * (half + 3), aimYaw: yaw, yaw });
        const k = { id: 0, alive: true, kind: 'lizard', stage: 1, x: g.x + sx * 60, z: g.z + sz * 60, yaw: yaw + Math.PI, aimYaw: yaw + Math.PI, phase: 'idle', submerge: 0 };
        const st = kaijuStageDef('lizard', 1);
        const eyeUp = chaseOffset(u.type).up;
        const input = { ...createActionState(), lookX: 0, lookY: 0, aimOverride: null };
        const ctx = {
          session: { mirror: { query, city: city.city }, aimYaw: 0, aimPitch: 0 },
          renderer: { kaijuCamAnchor: () => null },
          input,
          frame: { localKaiju: null, localUnit: u, kaijus: [k], units: [u], squads: [], match: { stage: 1, phase: 'playing' }, bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 } },
          dt: 1 / 60,
          now: 0,
          mapOpen: false,
        } as unknown as ControlContext;
        // Look at the hatchling (its head, then lower) from the chase camera's height, as a
        // player would to see it over the garage: the view turned by the mouse.
        const flat = Math.hypot(k.x - u.x, k.z - u.z);
        let c: HumanController | null = null;
        for (const h of [0.95, 0.85, 0.7, 0.5]) {
          const c2 = new HumanController(true);
          input.lookY = Math.atan2(st.height * h - eyeUp, flat + 9);
          for (let f = 0; f < 90; f++) {
            c2.update(ctx);
            input.lookY = 0;
            c2.applyCamera(ctx, camera);
          }
          if (c2.aimPoint.on === 'kaiju') {
            c = c2;
            break;
          }
        }
        if (!c) continue;
        // A spot inside or against another building is not one a player stands in.
        const ahead = resolveAimPoint(query, u.x, 1.7, u.z, yaw, 0, 1500, createAimPoint());
        if (ahead.dist < 1) continue;
        looked++;
        // Where the server sends the soldiers' shot: from the unit's eye along the aim the client sends.
        const shot = resolveAimPoint(query, u.x, u.y + unitTypeDef(u.type).eyeHeight, u.z, c.aimYaw, c.aimPitch, 1500, createAimPoint(), [k as never]);
        if (shot.on !== 'kaiju') blocked++;
        // The screen: the HUD shows "Blocked" exactly when the shot cannot reach the monster.
        if ((shot.on !== 'kaiju') !== c.shotBlocked) lies++;
        // The volley goes at the monster all the same (the squad-mates' own lines are their own).
        if (c.volleyKaiju === 0) volleyAway++;
      }
    }
    expect(looked, 'placements where the crosshair is on the hatchling').toBeGreaterThan(20);
    expect(blocked, 'placements where the garage takes the shot').toBeGreaterThan(0);
    expect(lies, `of ${looked} placements, the screen disagreed with where the shot went`).toBe(0);
    expect(volleyAway, 'placements where the volley point is the monster').toBe(looked);
  });
});

describe('round 5: the volley chip says whether the squad can charge, and why not', () => {
  it('words for every state, first that fits wins', () => {
    const word = (mates: Array<Partial<SnapUnit>>, held = false, charge = 0, lines: Array<LineState | undefined> | null = null): string =>
      volleyWord(mateLooks(squad(mates), 1, lines), held, charge);
    expect(word([{}, {}, {}])).toBe('Ready');
    expect(word([{ alive: false }, { alive: false }, { alive: false }])).toBe('No squad');
    expect(word([{ y: 40 }, { y: 40 }, { alive: false }])).toBe('Landing');
    expect(word([{ stun: 2 }, { stun: 1 }, { y: 30 }])).toBe('Stunned');
    expect(word([{ stun: 2 }, { shaken: 4 }, { alive: false }])).toBe('Shaken');
    // A reload long enough to hold the volley back, on every steady squad-mate.
    expect(word([{ cooldown: 6 }, { cooldown: 6 }, { shaken: 2 }])).toBe('Reload');
    // A short reload changes nothing a player would notice.
    expect(word([{ cooldown: 1 }, { cooldown: 1 }, {}])).toBe('Ready');
    const lines = (a: LineState, b: LineState, c: LineState): Array<LineState | undefined> => Object.assign([], { 5: a, 6: b, 7: c });
    expect(word([{}, {}, {}], false, 0, lines('blocked', 'blocked', 'far'))).toBe('No line');
    expect(word([{}, {}, {}], false, 0, lines('far', 'far', 'far'))).toBe('Too far');
    expect(word([{}, {}, {}], false, 0, lines('blocked', 'clear', 'blocked'))).toBe('Ready');
    // Held: how far the charge has come, and when to let go.
    const planted = { rooted: true, laser: true };
    expect(word([planted, planted, planted], true, 0.3)).toBe('Charging');
    expect(word([planted, planted, planted], true, 0.7)).toBe('Ready');
    expect(word([planted, planted, planted], true, 1)).toBe('Fire!');
    // Held while every one is held back under the notch by its reload.
    expect(word([{ ...planted, charge: 0.59, cooldown: 3 }, { ...planted, charge: 0.59, cooldown: 2 }, { stun: 1 }], true, 0.59)).toBe('Reload');
    // Held with nobody able: the reason, never an empty diamond with no word.
    expect(word([{ shaken: 3 }, { shaken: 3 }, { alive: false }], true, 0)).toBe('Shaken');
    expect(WORD_TONE.Shaken).toBe('cannot');
    expect(WORD_TONE['Fire!']).toBe('go');
  });

  it('pictures each squad-mate with its reason', () => {
    const looks: MateLook[] = mateLooks(
      squad([{ y: 20 }, { cooldown: 7 }, { rooted: true, laser: true, charge: 0.3 }]),
      1,
    );
    expect(looks).toEqual(['landing', 'reload', 'charging']);
    const lines = Object.assign([] as Array<LineState | undefined>, { 5: 'blocked', 6: 'far', 7: 'clear' });
    expect(mateLooks(squad([{}, {}, { shaken: 1 }]), 1, lines)).toEqual(['blocked', 'far', 'shaken']);
    // The reload holds the volley back only when it outlasts the charge's way to the notch.
    expect(reloadHolds(3, 0)).toBe(true);
    expect(reloadHolds(2, 0)).toBe(false);
    expect(reloadHolds(0.5, 0.59)).toBe(true);
    expect(reloadHolds(DT / 2, 0.59)).toBe(false);
  });

  it('words of one or two plain words, everywhere it adds them', () => {
    const words = [...Object.keys(WORD_TONE), ...Object.values(PICKUP_NAMES), fireWord('none'), fireWord('machineGun'), 'Blocked', 'Too far', 'Team up', 'Immune', 'Stagger', 'Hidden'];
    for (const w of words) expect(w.split(' ').length, w).toBeLessThanOrEqual(2);
    expect(fireWord('bigCannon')).toBe('Big cannon');
    expect(fireWord('artilleryRadio')).toBe('Fire');
  });

  it('knows which squad-mates have a line to where the volley goes: a garage in the way, the open street, out of reach', () => {
    const g = city.city.structures.find((s) => s.archetype === 'garage_a')!;
    // Somewhere 60 m out from the garage's front, with open ground behind the squad-mate.
    for (let side = 0; side < 4; side++) {
      const yaw = g.yaw + (side * Math.PI) / 2;
      const half = side % 2 === 0 ? g.hz : g.hx;
      const sx = Math.sin(yaw);
      const sz = Math.cos(yaw);
      const target = { x: g.x + sx * 60, y: 3, z: g.z + sz * 60 };
      const behind = { x: g.x - sx * (half + 2), z: g.z - sz * (half + 2) };
      // Only a side where the target's own spot and the line past the garage are open.
      if (resolveAimPoint(query, behind.x, 1.5, behind.z, yaw, 0, 1500, createAimPoint()).dist > half * 2 + 3) continue;
      const units = squad([
        { x: behind.x, z: behind.z },
        { x: target.x - sx * 40, z: target.z - sz * 40 },
        { x: target.x - sx * 400, z: target.z - sz * 400 },
      ]);
      const lines = mateLines(query, units, 1, target);
      expect(lines[5]).toBe('blocked');
      expect(lines[7]).toBe('far');
      // The one 40 m off on the line: clear unless something else stands in that street.
      const clear = resolveAimPoint(query, units[2].x, 1.5, units[2].z, Math.atan2(target.x - units[2].x, target.z - units[2].z), 0, 40, createAimPoint());
      if (clear.on === 'none') expect(lines[6]).toBe('clear');
      return;
    }
    throw new Error('no garage side to test from');
  });
});

describe('round 5: the charge shown under lag', () => {
  it('carries the charge from the press before the server says anybody planted, less the round trip, and holds a reloading squad-mate under the notch', () => {
    const idle = squad([{}, {}, {}]);
    expect(predictedCharge(idle, 1, 0.1, 0.15)).toBe(0);
    expect(predictedCharge(idle, 1, 1.15, 0.15)).toBeCloseTo(1 / COMBAT_RULES.chargeTime, 6);
    // One shaken: the other two count.
    expect(predictedCharge(squad([{}, {}, { shaken: 3 }]), 1, 1.15, 0.15)).toBeCloseTo(1 / COMBAT_RULES.chargeTime, 6);
    // Reloading for a long while: held just under the notch.
    expect(predictedCharge(squad([{ cooldown: 9 }]), 1, 4, 0)).toBeLessThan(COMBAT_RULES.volleyMinCharge);
    // From the server: a reloading squad-mate is not carried past the notch.
    const planted = squad([{ rooted: true, laser: true, charge: 0.59, cooldown: 3 }]);
    expect(shownCharge(planted, 1, true, 0.4)).toBeLessThan(COMBAT_RULES.volleyMinCharge);
  });
});

describe('round 5: team up (the five seconds to break the monster) instead of the weird yellow circle', () => {
  const boss = (over: Partial<SnapKaiju> = {}): SnapKaiju => ({ kind: 'lizard', nerve: 70, nerveImmune: 0, phase: 'idle', alive: true, ...over }) as SnapKaiju;

  it('shows only while the pair can break the monster and this squad can still fire', () => {
    expect(teamUpShown(3, boss(), true)).toBe(true);
    // Not open, nobody able, nerve too low for the pair, staggered, immune.
    expect(teamUpShown(0, boss(), true)).toBe(false);
    expect(teamUpShown(3, boss(), false)).toBe(false);
    expect(teamUpShown(3, boss({ nerve: 20 }), true)).toBe(false);
    expect(teamUpShown(3, boss({ phase: 'stagger' }), true)).toBe(false);
    expect(teamUpShown(3, boss({ nerveImmune: 4 }), true)).toBe(false);
  });

  it('counts the five seconds from the other squad’s latest hit, as the server does', () => {
    const spawn = (id: number, ownerId: number): SimEvent => ({ type: 'projectileSpawn', tick: 0, id, ownerId, owner: 'unit', volley: true }) as unknown as SimEvent;
    const hit = (id: number): SimEvent => ({ type: 'projectileHit', tick: 0, id, target: 'kaiju' }) as unknown as SimEvent;
    const partner = new VolleyPartner(1);
    for (let i = 0; i < 3; i++) partner.onEvent(spawn(100 + i, 9), 0);
    partner.onEvent(hit(100), 1);
    partner.onEvent(hit(101), 1.3);
    expect(partner.remaining(3)).toBeCloseTo(COMBAT_RULES.volleyBreakWindow - 1.7, 6);
  });
});

describe('round 5: the reload the HUD and the tank’s gun reticle share', () => {
  it('follows the squad’s weapon pick-up (round 4: the reticle used the tank’s own gun, empty for most of a big cannon’s reload)', () => {
    for (const type of ['army_rocket_infantry', 'army_tank'] as const) {
      const own = weaponDef(unitTypeDef(type).weapon);
      expect(reloadShare(0, type, 'none', 0)).toBe(1);
      expect(reloadShare(own.cooldown / 2, type, 'none', own.cooldown)).toBeCloseTo(0.5, 6);
      const cannon = pickupWeaponDef(own, 'bigCannon').cooldown;
      const left = cannon - 1.5;
      expect(reloadShare(left, type, 'bigCannon', nextReloadPeak(left, 0))).toBeCloseTo(1.5 / cannon, 6);
      expect(reloadShare(4, type, 'missilePod', 0)).toBeCloseTo(1 - 4 / 6, 6);
      // The machine gun streams: between two tracers it is loaded; after a volley's long reload it is not.
      expect(reloadShare(0.1, type, 'machineGun', 0.1)).toBe(1);
      const after = volleyReload(type, 'machineGun');
      expect(reloadShare(after / 2, type, 'machineGun', after)).toBeCloseTo(0.5, 6);
    }
    expect(nextReloadPeak(3, 1)).toBe(3);
    expect(nextReloadPeak(0, 5)).toBe(0);
  });
});
