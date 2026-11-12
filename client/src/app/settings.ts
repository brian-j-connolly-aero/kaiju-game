/**
 * The player's settings: master volume, mouse sensitivity and inverted look. They are kept in
 * the browser's storage, so they are still there the next time the game is opened, and anything
 * unreadable in there falls back to the defaults. (Fullscreen is a setting on the panel too,
 * but a browser only enters it in answer to a click, so it is never restored by itself.)
 */

import type { KeyValueStore } from '../net/session';

export interface Settings {
  /** Master volume, 0 to 1. */
  volume: number;
  /** Mouse look speed as a multiple of the default. */
  sensitivity: number;
  /** Pushing the mouse or the stick forward looks down. */
  invertY: boolean;
}

export const SETTINGS_KEY = 'mb.settings';
export const DEFAULT_SETTINGS: Readonly<Settings> = { volume: 0.9, sensitivity: 1, invertY: false };
/** The slowest and fastest mouse the slider offers: a quarter of the default speed up to four times it. */
export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 4;

function clampNumber(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}

/** Makes settings out of anything (stored text that was parsed, or nothing at all). */
export function cleanSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    volume: clampNumber(r.volume, 0, 1, DEFAULT_SETTINGS.volume),
    sensitivity: clampNumber(r.sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX, DEFAULT_SETTINGS.sensitivity),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : DEFAULT_SETTINGS.invertY,
  };
}

export function loadSettings(store: KeyValueStore): Settings {
  try {
    const text = store.getItem(SETTINGS_KEY);
    return cleanSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(store: KeyValueStore, settings: Settings): void {
  store.setItem(SETTINGS_KEY, JSON.stringify(cleanSettings(settings)));
}

/**
 * The sensitivity slider is even in ratios, not in amounts: its middle is the default speed,
 * and each step to the right multiplies the speed by the same factor.
 */
export function sensitivityFromSlider(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return SENSITIVITY_MIN * Math.pow(SENSITIVITY_MAX / SENSITIVITY_MIN, u);
}

export function sliderFromSensitivity(sensitivity: number): number {
  const s = Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, sensitivity));
  return Math.log(s / SENSITIVITY_MIN) / Math.log(SENSITIVITY_MAX / SENSITIVITY_MIN);
}
