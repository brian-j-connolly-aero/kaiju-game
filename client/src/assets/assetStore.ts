/**
 * AssetStore: the one place that knows which art and audio files exist.
 *
 * It loads public/assets/manifest.json (written by `npm run assets:manifest`) and hands out
 * models, textures, sprites and file addresses by id. Every lookup has a procedural fallback:
 * an id that is not in the manifest, or whose file fails to load, gets a stand-in and one
 * console warning, never an error (ARCHITECTURE.md section 5). The manifest may be missing
 * altogether; then everything is procedural.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { emptyManifest, normalizeManifest, type Manifest, type SpriteEntry } from './manifest';
import { proceduralModel } from './procedural/models';
import { armySheet, civilianSheet, fxSheet, FX_SPRITE_IDS, markerSheet, SOLDIER_SPRITE_IDS } from './procedural/sprites';
import { makeCanvas, proceduralTexture, windowTile } from './procedural/textures';
import { rigModelFromScene, type RigModel } from './rigModel';
import { buildSpriteAtlas, type SpriteAtlas, type SpriteInfo, type SpriteSheetSource } from './spriteAtlas';

export interface AssetProgress {
  loaded: number;
  total: number;
}

export interface AssetReport {
  manifest: boolean;
  models: { real: number; procedural: number };
  textures: { real: number; procedural: number };
  sprites: { real: number; procedural: number };
  failed: string[];
}

const TEXTURE_IDS = [
  'ground_asphalt',
  'ground_sidewalk',
  'ground_grass',
  'ground_water',
  'ground_rubble',
  'clouds_a',
  'clouds_b',
  'city_atlas',
  'city_atlas_emissive',
];

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

export class AssetStore {
  manifest: Manifest = emptyManifest();
  /** True once a manifest was actually read. */
  hasManifest = false;
  /** Folder the manifest's paths are relative to, with a trailing slash. */
  readonly base: string;
  atlas: SpriteAtlas | null = null;
  readonly failed: string[] = [];

  private readonly models = new Map<string, RigModel>();
  private readonly realModels = new Set<string>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly realTextures = new Set<string>();
  private readonly svgText = new Map<string, Promise<string | null>>();
  private readonly warned = new Set<string>();
  private audioExt: string | null = null;

  constructor(base = 'assets/') {
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`assets: ${message}`);
  }

  url(path: string): string {
    return this.base + path;
  }

  /** Reads the manifest. With `disabled`, or when it cannot be read, everything stays procedural. */
  async loadManifest(disabled = false): Promise<void> {
    if (disabled) {
      console.warn('assets: manifest ignored on request; every asset is a procedural stand-in.');
      return;
    }
    try {
      const response = await fetch(this.url('manifest.json'), { cache: 'no-cache' });
      if (!response.ok) throw new Error(`status ${response.status}`);
      this.manifest = normalizeManifest(await response.json());
      this.hasManifest = true;
    } catch (err) {
      console.warn(`assets: no usable manifest.json (${err instanceof Error ? err.message : String(err)}); using procedural stand-ins.`);
      this.manifest = emptyManifest();
    }
  }

  /**
   * Loads every model, texture and sprite sheet the manifest lists, then builds the sprite
   * atlas. A file that fails is reported once and replaced by its stand-in. Never rejects.
   */
  async preload(onProgress?: (p: AssetProgress) => void): Promise<void> {
    const jobs: Array<() => Promise<void>> = [];
    const gltf = new GLTFLoader();
    for (const [id, entry] of Object.entries(this.manifest.models)) {
      jobs.push(async () => {
        try {
          const loaded = await gltf.loadAsync(this.url(entry.file));
          this.models.set(id, rigModelFromScene(id, loaded.scene));
          this.realModels.add(id);
        } catch (err) {
          this.fail(`model "${id}"`, entry.file, err);
        }
      });
    }
    const textureLoader = new THREE.TextureLoader();
    for (const [id, entry] of Object.entries(this.manifest.textures)) {
      jobs.push(async () => {
        try {
          const texture = await textureLoader.loadAsync(this.url(entry.file));
          this.textures.set(id, this.prepareTexture(texture, entry.tile === true || id.startsWith('ground_')));
          this.realTextures.add(id);
        } catch (err) {
          this.fail(`texture "${id}"`, entry.file, err);
        }
      });
    }
    // Sprite sheets: several sprite ids usually share one file.
    const sheetFiles = new Map<string, Record<string, SpriteEntry>>();
    for (const [id, entry] of Object.entries(this.manifest.sprites)) {
      if (typeof entry.file !== 'string' || !Array.isArray(entry.frame)) continue;
      const entries = sheetFiles.get(entry.file) ?? {};
      entries[id] = entry;
      sheetFiles.set(entry.file, entries);
    }
    const sheets: SpriteSheetSource[] = [];
    for (const [file, entries] of sheetFiles) {
      jobs.push(async () => {
        try {
          const image = await loadImage(this.url(file));
          sheets.push({ key: file, image, entries, procedural: false });
        } catch (err) {
          this.fail(`sprite sheet`, file, err);
        }
      });
    }

    let done = 0;
    const total = jobs.length;
    onProgress?.({ loaded: 0, total });
    // A few at a time: plenty for small files, and gentle on a tunnel.
    const queue = jobs.slice();
    const worker = async (): Promise<void> => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        await job();
        done++;
        onProgress?.({ loaded: done, total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, Math.max(1, total)) }, worker));

    this.buildAtlas(sheets);
  }

  private fail(what: string, file: string, err: unknown): void {
    this.failed.push(file);
    console.warn(`assets: ${what} could not be loaded from ${file} (${err instanceof Error ? err.message : String(err)}); using a stand-in.`);
  }

  private prepareTexture(texture: THREE.Texture, tile: boolean): THREE.Texture {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = tile ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
    texture.generateMipmaps = tile;
    texture.colorSpace = THREE.SRGBColorSpace;
    if (tile) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    }
    texture.needsUpdate = true;
    return texture;
  }

  private buildAtlas(realSheets: SpriteSheetSource[]): void {
    const sheets = realSheets.slice();
    const have = new Set<string>();
    for (const sheet of sheets) for (const id of Object.keys(sheet.entries)) have.add(id);
    const addMissing = (make: () => { canvas: HTMLCanvasElement; entries: Record<string, SpriteEntry> }, key: string, wanted: (id: string) => boolean): void => {
      const sheet = make();
      const entries: Record<string, SpriteEntry> = {};
      for (const [id, entry] of Object.entries(sheet.entries)) if (!have.has(id) && wanted(id)) entries[id] = entry;
      if (Object.keys(entries).length === 0) return;
      for (const id of Object.keys(entries)) have.add(id);
      sheets.push({ key: key, image: sheet.canvas, entries, procedural: true });
    };
    addMissing(armySheet, 'procedural:army', () => true);
    // Civilians have no fixed ids: any real sprite whose id starts with "civ" replaces the stand-ins.
    const realCivilians = [...have].some((id) => id.startsWith('civ'));
    addMissing(civilianSheet, 'procedural:civilians', () => !realCivilians);
    addMissing(fxSheet, 'procedural:fx', () => true);
    addMissing(markerSheet, 'procedural:markers', () => true);
    this.atlas = buildSpriteAtlas(sheets, makeCanvas);
    const missing = [...SOLDIER_SPRITE_IDS, ...FX_SPRITE_IDS].filter((id) => this.atlas?.sprites.get(id)?.procedural);
    if (missing.length > 0 && this.hasManifest) {
      this.warnOnce('sprites', `no sprite art yet for ${missing.join(', ')}; drawing stand-ins.`);
    }
  }

  // --- lookups ---------------------------------------------------------------------------------

  /** True when a real file was loaded for this model id. */
  hasModel(id: string): boolean {
    return this.realModels.has(id);
  }

  /** The model for an id: the art file when it loaded, otherwise a box stand-in. Cached. */
  model(id: string): RigModel {
    let model = this.models.get(id);
    if (!model) {
      const entry = this.manifest.models[id];
      model = proceduralModel(id, entry?.size);
      this.models.set(id, model);
      // Ids that only exist in the client (the chunk in a kaiju's hand) are always generated.
      if (this.hasManifest && !id.startsWith('held_')) this.warnOnce(`model:${id}`, `no model "${id}" yet; drawing a box stand-in.`);
    }
    return model;
  }

  /** Paint colors a prop model may be tinted with (ASSETS.md manifests), or an empty list. */
  modelTints(id: string): string[] {
    const colors = this.manifest.models[id]?.tint?.colors;
    return Array.isArray(colors) ? colors.filter((c) => typeof c === 'string') : [];
  }

  hasTexture(id: string): boolean {
    return this.realTextures.has(id);
  }

  /** The texture for an id: the art file when it loaded, otherwise a procedural canvas. Cached. */
  texture(id: string): THREE.Texture {
    let texture = this.textures.get(id);
    if (!texture) {
      const canvas = id === 'window_tile' ? windowTile(false) : id === 'window_tile_lit' ? windowTile(true) : proceduralTexture(id);
      const tile = id.startsWith('ground_') || id.startsWith('window_tile') || id.startsWith('clouds_');
      texture = this.prepareTexture(new THREE.CanvasTexture(canvas), tile);
      this.textures.set(id, texture);
      if (this.hasManifest && TEXTURE_IDS.includes(id)) this.warnOnce(`texture:${id}`, `no texture "${id}" yet; drawing a stand-in.`);
    }
    return texture;
  }

  /** A sprite by id. Unknown ids fall back to the white square so nothing ever fails to draw. */
  sprite(id: string): SpriteInfo {
    const atlas = this.atlas;
    if (!atlas) throw new Error('assets: sprite atlas requested before preload finished');
    const sprite = atlas.sprites.get(id);
    if (sprite) return sprite;
    this.warnOnce(`sprite:${id}`, `no sprite "${id}"; drawing a white square.`);
    return atlas.sprites.get('fx_white') as SpriteInfo;
  }

  /** Ids of the civilian sprites available (real ones when the art has landed). */
  civilianSprites(): string[] {
    const ids = this.atlas ? [...this.atlas.sprites.keys()].filter((id) => id.startsWith('civ')) : [];
    return ids.sort();
  }

  /** Address of a UI art file (icon, portrait), or null when there is none yet. */
  uiUrl(id: string): string | null {
    const entry = this.manifest.ui[id];
    return entry && typeof entry.file === 'string' ? this.url(entry.file) : null;
  }

  /** The markup of a real .svg icon, or null when the icon does not exist (use the stand-in). */
  uiSvg(id: string): Promise<string | null> {
    const url = this.uiUrl(id);
    if (!url || !url.toLowerCase().endsWith('.svg')) return Promise.resolve(null);
    let pending = this.svgText.get(id);
    if (!pending) {
      pending = fetch(url)
        .then((r) => (r.ok ? r.text() : null))
        .then((text) => (text && text.includes('<svg') ? text : null))
        .catch(() => null);
      this.svgText.set(id, pending);
    }
    return pending;
  }

  /** Full address of an audio file given its manifest path without extension. */
  audioUrl(base: string): string {
    if (this.audioExt === null) {
      let ogg = false;
      try {
        ogg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
      } catch {
        ogg = false;
      }
      this.audioExt = ogg ? '.ogg' : '.mp3';
    }
    return this.url(base + this.audioExt);
  }

  report(): AssetReport {
    const sprites = this.atlas ? [...this.atlas.sprites.values()] : [];
    return {
      manifest: this.hasManifest,
      models: { real: this.realModels.size, procedural: this.models.size - this.realModels.size },
      textures: { real: this.realTextures.size, procedural: this.textures.size - this.realTextures.size },
      sprites: { real: sprites.filter((s) => !s.procedural).length, procedural: sprites.filter((s) => s.procedural).length },
      failed: this.failed.slice(),
    };
  }
}
