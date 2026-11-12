/** The shape of public/assets/manifest.json (docs/ASSETS.md section 7). Every section may be missing. */

export interface ModelEntry {
  file: string;
  kind?: 'kaiju' | 'vehicle' | 'projectile' | 'structure' | 'landmark' | 'prop' | 'misc';
  nodes?: string[];
  size?: [number, number, number];
  tris?: number;
  rig?: string;
  chunks?: number;
  /**
   * Per-instance paint for props and buildings: vertex color alpha 1 marks the faces that take
   * the tint. Buildings also give `base`, the wall color the model was painted in.
   */
  tint?: { colors?: string[]; base?: string };
  /** Kaiju: pose targets, degrees per node relative to the rest pose (ASSETS.md section 7). */
  poses?: Record<string, Record<string, [number, number, number]>>;
}

export interface SpriteAnim {
  /** One row for every facing (front, left, back, right), or a single row for all of them. */
  rows: number[];
  col?: number;
  frames: number;
  fps: number;
}

export interface SpriteEntry {
  file: string;
  frame: [number, number];
  worldHeight: number;
  anims: Record<string, SpriteAnim>;
  /** Effects: drawn with ordinary alpha blending (full-color pictures) or added (white light). */
  blend?: 'alpha' | 'add';
}

export interface TextureEntry {
  file: string;
  tile?: boolean;
  grid?: [number, number];
  /** Clouds: a panorama on a horizon ring (client/src/render/sky.ts). */
  ring?: { repeats: number; bottomDeg: number; sunGap: [number, number] };
}

export interface MusicEntry {
  base: string;
  loop?: [number, number];
  bpm?: number;
  group?: string;
  duration?: number;
  /** Seconds into the track where its moment lands (the audio engine starts it early to meet it). */
  mark?: number;
}

export interface SfxEntry {
  variants: string[];
  gain?: number;
  loop?: [number, number];
}

export interface VoiceEntry {
  base: string;
  duration?: number;
}

export interface UiEntry {
  file: string;
}

export interface Manifest {
  models: Record<string, ModelEntry>;
  sprites: Record<string, SpriteEntry>;
  textures: Record<string, TextureEntry>;
  music: Record<string, MusicEntry>;
  sfx: Record<string, SfxEntry>;
  voice: Record<string, VoiceEntry>;
  ui: Record<string, UiEntry>;
}

export function emptyManifest(): Manifest {
  return { models: {}, sprites: {}, textures: {}, music: {}, sfx: {}, voice: {}, ui: {} };
}

function section<T>(raw: unknown): Record<string, T> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, T>) : {};
}

/** Accepts whatever was loaded and returns a manifest with every section present. Never throws. */
export function normalizeManifest(raw: unknown): Manifest {
  const r = section<unknown>(raw);
  return {
    models: section(r.models),
    sprites: section(r.sprites),
    textures: section(r.textures),
    music: section(r.music),
    sfx: section(r.sfx),
    voice: section(r.voice),
    ui: section(r.ui),
  };
}
