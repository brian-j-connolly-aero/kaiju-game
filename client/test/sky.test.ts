import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { blendLeg, middlePreset, SKY_PRESETS, type SkyPreset } from '../src/render/sky';

type ColorKey = 'top' | 'horizon' | 'ground' | 'fog' | 'sun' | 'hemiSky' | 'hemiGround' | 'cloud' | 'disc';
const KEYS: ColorKey[] = ['top', 'horizon', 'ground', 'fog', 'sun', 'hemiSky', 'hemiGround', 'cloud', 'disc'];

/** How strongly pink-magenta a color is: its chroma (0..255) when its hue is 290 to 350 degrees, else 0. */
function pink(hex: number): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  if (chroma === 0) return 0;
  const sector = max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  const hue = sector * 60;
  return hue >= 290 && hue <= 350 ? chroma : 0;
}

/** The faintest tint that reads as pink on screen; the old straight blend reached 51 (the sun's light). */
const PINK_LIMIT = 10;

/** The color the sky shows at blend `t`, mixed the way `Sky.apply` mixes it. */
function shown(from: SkyPreset, to: SkyPreset, key: ColorKey, t: number): number {
  const [f, g, u] = blendLeg(from, to, middlePreset(from, to), t);
  return new THREE.Color(f[key]).lerp(new THREE.Color(g[key]), u).getHex();
}

describe('the change from sunset to night', () => {
  const { sunset, night } = SKY_PRESETS;

  it('passes through dusk, never through pink-magenta, in either direction', () => {
    for (const [from, to] of [
      [sunset, night],
      [night, sunset],
    ]) {
      for (const key of KEYS) {
        for (let t = 0; t <= 1.0001; t += 0.025) expect(pink(shown(from, to, key, t)), `${key} at ${t.toFixed(3)}`).toBeLessThanOrEqual(PINK_LIMIT);
      }
    }
  });

  it('starts and ends exactly on the two times of day, with no jump at the middle', () => {
    for (const key of KEYS) {
      expect(shown(sunset, night, key, 0)).toBe(new THREE.Color(sunset[key]).getHex());
      expect(shown(sunset, night, key, 1)).toBe(new THREE.Color(night[key]).getHex());
      const a = new THREE.Color(shown(sunset, night, key, 0.4999));
      const b = new THREE.Color(shown(sunset, night, key, 0.5001));
      expect(Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)), key).toBeLessThan(0.01);
    }
    expect(middlePreset(SKY_PRESETS.afternoon, sunset)).toBeNull();
  });
});
