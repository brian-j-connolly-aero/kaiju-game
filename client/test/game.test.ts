import { describe, expect, it } from 'vitest';
import { KAIJU_ACTION_IDS, KAIJU_PHASES, unitTypeDef } from '@mb/shared';
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
