import { describe, expect, it } from 'vitest';
import { CITY_SEED, createCityQuery, createCityState, getCity, KAIJU_ACTION_IDS, KAIJU_PHASES, structureAt, unitTypeDef } from '@mb/shared';
import { clearOfWalls, easeClearance } from '../src/game/controllers/cameraClearance';
import { defaultBindings, glyphFor, keyGlyph, mergeBindings, BUTTON_ACTIONS } from '../src/game/input/actions';
import { computeKaijuPose, createKaijuPose } from '../src/render/kaijuAnimator';
import { memberOffset } from '../src/render/unitsView';
import { emptyManifest, normalizeManifest } from '../src/assets/manifest';
import { iconArt, skylinePath } from '../src/ui/iconArt';

describe('action map', () => {
  it('binds every action on the keyboard, and the game verbs on the gamepad', () => {
    const b = defaultBindings();
    for (const action of BUTTON_ACTIONS) expect(b.keyboard[action].length, action).toBeGreaterThan(0);
    for (const action of ['strike', 'grab', 'block', 'roar', 'special', 'molt', 'fire', 'callIn', 'wheel', 'map', 'camera'] as const) {
      expect(b.gamepad[action].length, action).toBeGreaterThan(0);
    }
  });

  it('shows the glyph of the device in use', () => {
    const b = defaultBindings();
    expect(glyphFor(b, 'strike', 'keyboard')).toEqual({ icon: 'ms_left', label: '' });
    expect(glyphFor(b, 'strike', 'gamepad')).toEqual({ icon: 'gp_rt', label: '' });
    expect(glyphFor(b, 'roar', 'keyboard')).toEqual({ icon: 'kb_key', label: 'Q' });
    expect(keyGlyph('Digit3')).toEqual({ icon: 'kb_key', label: '3' });
    expect(glyphFor(b, 'moveForward', 'gamepad')).toBeNull();
  });

  it('merges stored bindings over the defaults and ignores nonsense', () => {
    const merged = mergeBindings({ keyboard: { roar: ['KeyG'], strike: 'nope', bogus: ['KeyZ'] }, gamepad: { roar: [3, 'x'] } });
    expect(merged.keyboard.roar).toEqual(['KeyG']);
    expect(merged.keyboard.strike).toEqual(['Mouse0']);
    expect(merged.gamepad.roar).toEqual(defaultBindings().gamepad.roar);
    expect(mergeBindings(null)).toEqual(defaultBindings());
  });
});

describe('kaiju animation', () => {
  it('gives a finite pose for every action in every phase', () => {
    const pose = createKaijuPose();
    for (const action of KAIJU_ACTION_IDS) {
      for (const phase of KAIJU_PHASES) {
        for (const t of [0, 0.2, 5]) {
          computeKaijuPose(
            { time: 3.3, walkPhase: 1.1, speed: 0.7, headYaw: 0.4, headPitch: -0.2, action, phase, phaseTime: t, phaseDuration: phase === 'brace' ? 0 : 0.45, holding: t > 1, height: 32 },
            pose,
          );
          for (const [name, r] of pose.rotations) {
            expect(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z), `${action}/${phase}/${name}`).toBe(true);
            expect(Math.abs(r.x) + Math.abs(r.y) + Math.abs(r.z), `${action}/${phase}/${name}`).toBeLessThan(9);
          }
          expect(Number.isFinite(pose.hipsLift)).toBe(true);
        }
      }
    }
  });

  it('makes the wind-ups readable: a swipe raises the right arm, a stomp lifts the right leg', () => {
    const pose = createKaijuPose();
    const base = { time: 0, walkPhase: 0, speed: 0, headYaw: 0, headPitch: 0, holding: false, height: 4.5, phaseDuration: 0.45 };
    computeKaijuPose({ ...base, action: 'swipe', phase: 'windup', phaseTime: 0.45 }, pose);
    expect(pose.rotations.get('arm_R')?.x).toBeLessThan(-1.5);
    computeKaijuPose({ ...base, action: 'stomp', phase: 'windup', phaseTime: 0.45 }, pose);
    expect(pose.rotations.get('leg_R')?.x).toBeLessThan(-0.8);
    computeKaijuPose({ ...base, action: 'none', phase: 'idle', phaseTime: 0 }, pose);
    expect(Math.abs(pose.rotations.get('arm_R')?.x ?? 1)).toBeLessThan(0.1);
  });
});

describe('unit members', () => {
  it('keeps every member inside the unit body', () => {
    const out = { x: 0, z: 0 };
    for (const type of ['army_rocket_infantry', 'army_tank', 'army_tank_troop'] as const) {
      const def = unitTypeDef(type);
      for (let i = 0; i < def.members; i++) {
        memberOffset(def, 7, i, def.members, out);
        expect(Math.hypot(out.x, out.z), `${type} member ${i}`).toBeLessThanOrEqual(def.radius);
      }
    }
  });
});

describe('manifest and placeholder art', () => {
  it('accepts a missing or malformed manifest', () => {
    expect(normalizeManifest(null)).toEqual(emptyManifest());
    expect(normalizeManifest({ models: [], sfx: 'x' })).toEqual(emptyManifest());
    const m = normalizeManifest({ models: { a: { file: 'models/a.glb' } } });
    expect(Object.keys(m.models)).toEqual(['a']);
    expect(m.voice).toEqual({});
  });

  it('has placeholder art without text for any icon id', () => {
    for (const id of ['cmd_follow', 'k_swipe', 'st_health', 'lb_ready', 'tl_tower', 'gp_rt', 'something_new']) {
      const art = iconArt(id);
      expect(art.length).toBeGreaterThan(20);
      expect(art).not.toContain('<text');
    }
    expect(skylinePath(400, 44)).toMatch(/^M0 44 .* Z$/);
  });
});

describe('camera clearance', () => {
  const { city, index } = getCity(CITY_SEED);
  const query = createCityQuery(index, createCityState(city));
  // A tall, unrotated block with open street in front of its +Z face.
  const tower = city.structures.find((s) => s.height > 40 && !s.passable && s.yaw === 0 && structureAt(query, s.x, s.z + s.hz + 12) < 0);
  if (!tower) throw new Error('the test city has no tower with a street in front of it');
  const face = tower.z + tower.hz;

  it('lets the camera be when nothing is in the way', () => {
    const pivot = { x: tower.x, y: 20, z: face + 10 };
    const eye = { x: tower.x, y: 20, z: face + 4 };
    expect(clearOfWalls(query, pivot, eye, 1)).toBe(1);
  });

  it('stops a camera that would be inside a building a margin short of the wall', () => {
    const pivot = { x: tower.x, y: 20, z: face + 9 };
    const eye = { x: tower.x, y: 20, z: face - 2 };
    const f = clearOfWalls(query, pivot, eye, 1.5);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    const z = pivot.z + (eye.z - pivot.z) * f;
    expect(z - face).toBeCloseTo(1.5, 5);
    // A camera still outside, but closer to the wall than the margin, is pulled back too.
    const close = { x: tower.x, y: 20, z: face + 0.5 };
    const g = clearOfWalls(query, pivot, close, 1.5);
    expect(pivot.z + (close.z - pivot.z) * g - face).toBeCloseTo(1.5, 5);
  });

  it('looks over a building that is lower than the camera, and ignores rubble', () => {
    const pivot = { x: tower.x, y: tower.height + 5, z: face + 9 };
    const eye = { x: tower.x, y: tower.height + 5, z: face - 2 };
    expect(clearOfWalls(query, pivot, eye, 1.5)).toBe(1);
    const rubble = createCityQuery(index, createCityState(city));
    rubble.structureHp[tower.id] = 0;
    expect(clearOfWalls(rubble, { x: tower.x, y: 20, z: face + 9 }, { x: tower.x, y: 20, z: face - 2 }, 1.5)).toBe(1);
  });

  it('gives up when the body itself is inside a building (a titan wading through a tower)', () => {
    const pivot = { x: tower.x, y: 20, z: tower.z };
    const eye = { x: tower.x, y: 20, z: tower.z + 1 };
    expect(clearOfWalls(query, pivot, eye, 1.5)).toBe(1);
  });

  it('gives way to a wall at once and comes back out gradually', () => {
    expect(easeClearance(1, 0.4, 0.016)).toBe(0.4);
    const back = easeClearance(0.4, 1, 0.1);
    expect(back).toBeGreaterThan(0.4);
    expect(back).toBeLessThan(1);
    let v = 0.4;
    for (let i = 0; i < 120; i++) v = easeClearance(v, 1, 1 / 60);
    expect(v).toBeGreaterThan(0.99);
  });
});
