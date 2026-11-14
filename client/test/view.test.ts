/**
 * The view's pure pieces: the kaiju's pose targets and first-person claws, the chase camera's
 * rise over a wall, the cloud rings' sun gap, the drawing buffer's pixel cap and the stand-in
 * icons the art notes asked for.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CITY_SEED, createCityQuery, createCityState, getCity, structureAt } from '@mb/shared';
import { clearOfWalls } from '../src/game/controllers/cameraClearance';
import { liftOverWalls } from '../src/game/controllers/kaijuController';
import { defaultBindings, glyphFor } from '../src/game/input/actions';
import { computeKaijuPose, createKaijuPose, FALLBACK_POSES, posesFromManifest, type KaijuAnimInput } from '../src/render/kaijuAnimator';
import { GameRenderer } from '../src/render/gameRenderer';
import { ringOffset } from '../src/render/sky';
import { iconArt } from '../src/ui/iconArt';

const manifest = JSON.parse(readFileSync(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')) as {
  models: Record<string, { poses?: unknown }>;
};

const base: KaijuAnimInput = {
  time: 0,
  walkPhase: 0,
  speed: 0,
  headYaw: 0,
  headPitch: 0,
  action: 'none',
  phase: 'idle',
  phaseTime: 0,
  phaseDuration: 0,
  holding: false,
  height: 4.5,
};
const D = Math.PI / 180;

describe('kaiju pose targets', () => {
  const poses = posesFromManifest(manifest.models.kaiju_lizard_s1?.poses);

  it('reads the manifest poses in radians', () => {
    expect(poses).not.toBeNull();
    for (const name of ['fp_claws', 'grab', 'hold', 'eat', 'brace', 'throw_windup', 'throw_release', 'swipe_hit', 'stagger']) {
      expect(poses?.[name], name).toBeDefined();
    }
    expect(poses?.fp_claws.arm_R?.[0]).toBeCloseTo(-123 * D, 6);
    expect(posesFromManifest(undefined)).toBeNull();
    expect(posesFromManifest({ hold: { arm_R: [1, 'x', 3] } })).toEqual({ hold: {} });
  });

  it('holds both claws up in the first-person view, and nowhere else', () => {
    const pose = createKaijuPose();
    computeKaijuPose({ ...base, poses: poses ?? undefined, firstPerson: true }, pose);
    expect(pose.rotations.get('arm_R')?.x).toBeCloseTo(-123 * D, 2);
    expect(pose.rotations.get('arm_L')?.x).toBeCloseTo(-123 * D, 2);
    computeKaijuPose({ ...base, poses: poses ?? undefined, firstPerson: false }, pose);
    expect(Math.abs(pose.rotations.get('arm_R')?.x ?? 1)).toBeLessThan(0.05);
    // Dead or in the cocoon the camera is outside: no claws held up.
    computeKaijuPose({ ...base, poses: poses ?? undefined, firstPerson: true, phase: 'dead' }, pose);
    expect(pose.rotations.get('arm_L')?.x).toBeCloseTo(0.6, 2);
  });

  it('carries a held thing in the right hand in every phase, the left claw staying up', () => {
    const pose = createKaijuPose();
    computeKaijuPose({ ...base, poses: poses ?? undefined, firstPerson: true, holding: true, phase: 'windup', action: 'stomp', phaseTime: 0, phaseDuration: 0.5 }, pose);
    expect(pose.rotations.get('arm_R')?.x).toBeCloseTo(-123 * D, 2);
    expect(pose.rotations.get('hand_R')?.z).toBeCloseTo(22 * D, 2);
    expect(pose.rotations.get('hand_L')?.z).toBeCloseTo(-10 * D, 2);
  });

  it('crosses both arms in front for the brace, wholly replacing the base pose', () => {
    const pose = createKaijuPose();
    computeKaijuPose({ ...base, poses: poses ?? undefined, firstPerson: true, phase: 'brace', action: 'brace' }, pose);
    expect(pose.rotations.get('forearm_L')?.y).toBeCloseTo(28 * D, 2);
    expect(pose.rotations.get('forearm_R')?.y).toBeCloseTo(-28 * D, 2);
    expect(pose.rotations.get('torso')?.x).toBeGreaterThan(15 * D);
  });

  it('reels back in a stagger (chest open to the front) instead of slumping over it', () => {
    const pose = createKaijuPose();
    computeKaijuPose({ ...base, poses: poses ?? undefined, phase: 'stagger', phaseDuration: 5 }, pose);
    expect(pose.rotations.get('torso')?.x).toBeLessThan(0);
    expect(pose.rotations.get('head')?.x).toBeLessThan(0);
    // The stand-in uses the same stagger target.
    computeKaijuPose({ ...base, phase: 'stagger', phaseDuration: 5 }, pose);
    expect(pose.rotations.get('torso')?.x).toBeCloseTo(FALLBACK_POSES.stagger.torso[0], 2);
  });

  it('blends a swipe from its wind-up to the art target for the hit', () => {
    const pose = createKaijuPose();
    computeKaijuPose({ ...base, poses: poses ?? undefined, action: 'swipe', phase: 'active', phaseTime: 1, phaseDuration: 1 }, pose);
    expect(pose.rotations.get('arm_R')?.y).toBeCloseTo(54 * D, 2);
  });
});

describe('chase camera over a wall', () => {
  const { city, index } = getCity(CITY_SEED);
  const query = createCityQuery(index, createCityState(city));
  const tower = city.structures.find((s) => s.height > 40 && s.height < 80 && !s.passable && s.yaw === 0 && structureAt(query, s.x, s.z + s.hz + 14) < 0);
  if (!tower) throw new Error('the test city has no tower with a street in front of it');
  const face = tower.z + tower.hz;

  it('rises just high enough to see over a wall behind the kaiju', () => {
    // A stage 2 kaiju (32 m) with its back 14 m from the tower's face; the camera 92 m behind.
    const pivot = { x: tower.x, y: 27, z: face + 14 };
    const wanted = { x: tower.x, y: 37, z: face + 14 - 92 };
    expect(clearOfWalls(query, pivot, wanted, 3)).toBeLessThan(0.5);
    const lift = liftOverWalls(query, pivot, wanted, 32, 3);
    expect(lift).toBeGreaterThan(0);
    // The lifted line clears; one step lower does not.
    const up = (l: number) => [
      { ...pivot, y: pivot.y + l * 32 },
      { ...wanted, y: wanted.y + l * 32 },
    ];
    const [p1, w1] = up(lift);
    expect(clearOfWalls(query, p1, w1, 3)).toBe(1);
    const [p0, w0] = up(lift - 2 / 12);
    expect(clearOfWalls(query, p0, w0, 3)).toBeLessThan(1);
    // Nothing in the way (a camera straight above the shoulders): no lift at all.
    expect(liftOverWalls(query, pivot, { ...pivot, y: pivot.y + 40 }, 32, 3)).toBe(0);
  });
});

describe('view details', () => {
  it('turns each cloud ring so its sun gap stands at the sunset sun', () => {
    expect(ringOffset({ repeats: 4, bottomDeg: -5, sunGap: [258, 72] })).toBeCloseTo(0.2547, 3);
    expect(ringOffset({ repeats: 3, bottomDeg: -5, sunGap: [414, 58] })).toBeCloseTo(0.8756, 3);
  });

  it('never draws more than a 1080p screen of pixels', () => {
    expect(GameRenderer.pixelRatio(1920, 1080, 1, 1)).toBe(1);
    expect(GameRenderer.pixelRatio(1280, 720, 2, 1)).toBeCloseTo(1.5, 6);
    const r = GameRenderer.pixelRatio(3840, 2160, 1, 1);
    expect(3840 * 2160 * r * r).toBeCloseTo(1920 * 1080, 0);
    expect(GameRenderer.pixelRatio(1920, 1080, 1, 0.5)).toBe(0.5);
  });

  it('has stand-ins that are neither a well-known logo nor a symbol of a faith', () => {
    // A trefoil of three ellipses at 60 degree steps, or a cross in a circle, must not come back.
    expect(iconArt('fac_science')).not.toContain('rotate(60');
    expect(iconArt('fac_faith')).not.toContain('<circle');
    for (const id of ['st_reload', 'gp_dpad_up', 'gp_dpad_right', 'gp_dpad_down', 'gp_dpad_left', 'ui_lowres']) {
      expect(iconArt(id), id).not.toBe(iconArt('something_new'));
    }
    // The four commands on the directional pad each show their own arm of it.
    const b = defaultBindings();
    const pads = (['cmdFollow', 'cmdMoveTo', 'cmdFireAtWill', 'cmdHoldCharge'] as const).map((a) => glyphFor(b, a, 'gamepad')?.icon);
    expect(new Set(pads)).toEqual(new Set(['gp_dpad_up', 'gp_dpad_right', 'gp_dpad_down', 'gp_dpad_left']));
  });
});
