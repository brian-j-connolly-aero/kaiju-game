/**
 * Phase 2 on screen (docs/ROADMAP.md): the monster's city weapons and power surge, the army's
 * crates, pick-ups and artillery. What is tested is the arithmetic the pictures and sounds rest
 * on: how a weapon is held and flies, where a crate is, which picture a button shows, when the
 * map is static and when a shell's whistle starts.
 */

import * as THREE from 'three';
import { Btn, CRATE_RULES, DT, stepProjectile, type HeldObject, type SnapKaiju } from '@mb/shared';
import { describe, expect, it } from 'vitest';
import type { AudioEngine } from '../src/audio/audioEngine';
import { fallTime, MatchAudio, WHISTLE_SECONDS } from '../src/audio/matchAudio';
import { hintVerb } from '../src/net/matchSession';
import { closingRing } from '../src/render/artilleryView';
import { pickupIcon } from '../src/assets/iconRaster';
import { crateHeight } from '../src/render/cratesView';
import { carryTilt, clubDirection, gripFromRaw, gripRotation } from '../src/render/heldProps';
import { flightAt } from '../src/render/projectilesView';
import { fireIcon } from '../src/ui/hud';
import { grabIcon, strikeIcon } from '../src/ui/kaijuKit';
import { mapShowsStatic } from '../src/ui/mapView';

const prop = (p: string): HeldObject => ({ kind: 'prop', prop: p }) as HeldObject;

describe('a city weapon in the hand', () => {
  it('turns the weapon so its tip points where it is used, its other axis as near the hint as it goes', () => {
    // The antenna (tip up its pole) thrown as a javelin: the tip along the aim, out ahead.
    const antenna = gripFromRaw({ at: [0, 2.8, 0], tip: [0, 1, 0], hold: 'javelin' });
    expect(antenna?.hold).toBe('javelin');
    const aim = new THREE.Vector3(1, 0.2, -0.5).normalize();
    const q = gripRotation(antenna!.tip, antenna!.side, aim, new THREE.Vector3(0, 1, 0), new THREE.Quaternion());
    expect(antenna!.tip.clone().applyQuaternion(q).distanceTo(aim)).toBeLessThan(1e-6);
    // The garage door (its face along +z) as a shield: the face forward, its top kept up.
    const door = gripFromRaw({ at: [0, 1.4, -0.08], tip: [0, 0, 1], hold: 'shield' });
    const forward = new THREE.Vector3(Math.sin(0.7), 0, Math.cos(0.7));
    const d = gripRotation(door!.tip, door!.side, forward, new THREE.Vector3(0, 1, 0), new THREE.Quaternion());
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(d).distanceTo(forward)).toBeLessThan(1e-6);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(d).y).toBeGreaterThan(0.999);
    // Rubbish in the manifest is not a grip.
    expect(gripFromRaw({ at: [0, 1], tip: [0, 0, 0], hold: 'carry' })).toBeNull();
    expect(gripFromRaw({ at: [0, 1, 0], tip: [0, 1, 0], hold: 'juggle' })).toBeNull();
  });

  it('tips a carried weapon forward only as far as it needs to clear the ground', () => {
    expect(carryTilt(1.3, 2.2)).toBe(0);
    const tilt = carryTilt(4.5, 2.2, 0.25);
    expect(tilt).toBeGreaterThan(1);
    // The far end of the water tank stays the clearance off the ground.
    expect(2.2 - 4.5 * Math.cos(tilt)).toBeCloseTo(0.25, 6);
  });

  it('swings the fast-food sign from behind the right shoulder across the front to the left', () => {
    const v = new THREE.Vector3();
    const motion = new THREE.Vector3();
    // Held up at rest; cocked back at the top of the wind-up.
    expect(clubDirection('idle', 0, v).y).toBeGreaterThan(0.9);
    expect(clubDirection('windup', 1, v).z).toBeLessThan(0);
    // The swing: from the right (x < 0, the model's right) through the front to the left.
    expect(clubDirection('active', 0, v).x).toBeLessThan(-0.7);
    expect(clubDirection('active', 0.6, v, motion).z).toBeGreaterThan(0.6);
    expect(motion.x).toBeGreaterThan(0);
    expect(clubDirection('active', 1, v).x).toBeGreaterThan(0.9);
  });

  it('shows on the buttons what they do with what is in the hand', () => {
    expect([strikeIcon(null), grabIcon(null)]).toEqual(['k_swipe', 'k_grab']);
    expect([strikeIcon(prop('car_sedan')), grabIcon(prop('car_sedan'))]).toEqual(['k_throw', 'k_eat']);
    expect([strikeIcon(prop('foodsign')), grabIcon(prop('foodsign'))]).toEqual(['k_club', 'k_drop']);
    expect(strikeIcon(prop('antenna'))).toBe('k_javelin');
    expect(strikeIcon(prop('mast'))).toBe('k_javelin');
    for (const p of ['propane', 'watertank', 'garagedoor']) expect([strikeIcon(prop(p)), grabIcon(prop(p))]).toEqual(['k_throw', 'k_drop']);
  });

  it('shows the right wind-up ahead of the server: a swing for the sign, nothing for a drop', () => {
    const k = { kind: 'lizard', moltAvailable: false, moves: ['none', 'none'], cooldowns: { eat: 0 }, rage: 0, held: prop('foodsign') } as unknown as SnapKaiju;
    expect(hintVerb(k, Btn.strike, Btn.strike)).toBe('club');
    expect(hintVerb({ ...k, held: prop('antenna') }, Btn.strike, Btn.strike)).toBe('throw');
    expect(hintVerb(k, Btn.grab, Btn.grab)).toBeNull();
    expect(hintVerb({ ...k, held: prop('car_sedan') }, Btn.grab, Btn.grab)).toBe('eat');
  });
});

describe('shots in flight', () => {
  it('flies a missile exactly as the simulation does, curve and all', () => {
    const spec = { x: 3, y: 2, z: -4, vx: 40, vy: 12, vz: 55, gravity: 0, ax: -9, ay: -2.5, az: 6, steer: 18 * DT };
    const body = { ...spec };
    const at = { x: 0, y: 0, z: 0 };
    for (let tick = 1; tick <= 60; tick++) {
      stepProjectile(body, DT);
      flightAt(spec, tick * DT, at);
      expect(Math.hypot(at.x - body.x, at.y - body.y, at.z - body.z)).toBeLessThan(1e-6);
    }
  });

  it('times an artillery shell whistle to end where the shell lands', () => {
    const played: Array<{ id: string; at: number }> = [];
    let now = 0;
    // An engine that only notes what is played (and does nothing else asked of it).
    const engine = new Proxy(
      {},
      { get: (_, name) => (name === 'play' ? (id: string) => played.push({ id, at: now }) : name === 'unlocked' ? false : name === 'music' ? '' : () => undefined) },
    ) as unknown as AudioEngine;
    const audio = new MatchAudio(engine);
    // A shell 400 m up, falling at 40 m/s under 9.8 m/s².
    const t = fallTime(400, -40, 9.8);
    expect(400 - 40 * t - 4.9 * t * t).toBeCloseTo(0, 6);
    audio.handleEvent({ type: 'projectileSpawn', tick: 0, id: 1, projectile: 'arty', flight: 'arc', owner: 'callin', ownerId: 0, player: 0, x: 0, y: 400, z: 0, vx: 5, vy: -40, vz: 0, gravity: 9.8, ttl: 20, volley: false });
    expect(played).toEqual([]);
    const frame = { tick: 0, match: { phase: 'playing', stage: 1, clock: 300, phaseTime: 0 }, kaijus: [], squads: [], units: [], crates: [], bounds: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, localUnit: null, localKaiju: null };
    for (now = 0; now < t + 1; now += 0.05) audio.update(frame as never, 0.05);
    const whistle = played.find((p) => p.id === 'arty_incoming');
    expect(whistle).toBeDefined();
    expect(Math.abs((whistle as { at: number }).at + WHISTLE_SECONDS - t)).toBeLessThan(0.11);
  });
});

describe('the army’s pick-ups on screen', () => {
  it('brings a crate straight down from its drop height at a steady speed', () => {
    expect(crateHeight(CRATE_RULES.fallTime)).toBeCloseTo(CRATE_RULES.dropHeight, 6);
    expect(crateHeight(CRATE_RULES.fallTime / 2)).toBeCloseTo(CRATE_RULES.dropHeight / 2, 6);
    expect(crateHeight(0)).toBe(0);
  });

  it('shows the picture of what a squad has: the pick-up file names', () => {
    expect(pickupIcon('machineGun')).toBe('pk_machinegun');
    expect(pickupIcon('artilleryRadio')).toBe('pk_artilleryradio');
    expect(fireIcon({ pickup: 'bigCannon' })).toBe('pk_bigcannon');
    expect(fireIcon({ pickup: 'none' })).toBe('st_reload');
  });

  it('closes the artillery ring onto the scatter circle as the first shell lands', () => {
    expect(closingRing(28, 0, 4)).toBeCloseTo(28 * 3, 6);
    expect(closingRing(28, 2, 4)).toBeCloseTo(28 * 2, 6);
    expect(closingRing(28, 4, 4)).toBeCloseTo(28, 6);
    expect(closingRing(28, 9, 4)).toBeCloseTo(28, 6);
  });

  it('fills only the squads’ map with static while a fallen radio mast’s static lasts', () => {
    expect(mapShowsStatic('human', 100, 600)).toBe(true);
    expect(mapShowsStatic('human', 600, 600)).toBe(false);
    expect(mapShowsStatic('human', 100, 0)).toBe(false);
    expect(mapShowsStatic('kaiju', 100, 600)).toBe(false);
    expect(mapShowsStatic('spectator', 100, 600)).toBe(false);
  });
});
