/**
 * GameRenderer: owns the three.js renderer and scene and draws one frame of the match from a
 * FrameState. It follows the style rules of docs/ASSETS.md section 2 (flat shading, saturated
 * colors, fog for scale, no shadow maps, additive glows) and the budget of ARCHITECTURE.md
 * section 5: the city is instanced per archetype and state, every vehicle of a kind is one
 * instanced rig, and every sprite in the game is in one batch.
 *
 * It knows nothing about input, the network or the HUD: controllers move `camera`, the match
 * screen calls `update` and `render`, and simulation events are handed to `handleEvent`.
 */

import * as THREE from 'three';
import {
  kaijuKindDef,
  kaijuStageDef,
  PROP_KINDS,
  stageDef,
  unitTypeDef,
  type Bounds,
  type CityData,
  type SimEvent,
  type SnapKaiju,
  type StageId,
} from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { frameRect } from '../assets/spriteAtlas';
import type { CityMirror } from '../net/cityMirror';
import { hintPose, type ActionHint, type FrameState } from '../net/matchSession';
import { Boundary } from './boundary';
import { CityView } from './cityView';
import { atlasPixels, renderLandmarkPictures } from './landmarkPictures';
import { Crowd } from './crowd';
import { Effects } from './effects';
import { buildGround, setGroundNight } from './ground';
import { KaijuView, type KaijuOverride } from './kaijuView';
import { LineBatch } from './lineBatch';
import { createMaterials, type Materials } from './materials';
import { ProjectilesView } from './projectilesView';
import { QuadBatch } from './quadBatch';
import { Sky, type FogRange } from './sky';
import { UnitsView } from './unitsView';

export interface RenderView {
  /** The kaiju the local player controls, or -1. */
  localKaiju: number;
  /** The unit the local player drives, or -1. */
  localUnit: number;
  localSquad: number;
  /** First person from a unit: the local unit's own members are not drawn. */
  hideLocalLead: boolean;
  /** The camera is in the local kaiju's head (first person, not the cinematic camera). */
  kaijuFirstPerson: boolean;
  /** ... and has been pulled back inside its skull by a wall ahead. */
  kaijuInsideHead: boolean;
  /** Whether the viewer may see where the kaiju is even when the humans have lost it. */
  seesKaiju: boolean;
  /** The local kaiju's wind-up that the server has not confirmed yet. */
  hint: ActionHint | null;
  /** Local time in seconds (the hint's clock). */
  now: number;
}

export interface RenderStats {
  calls: number;
  triangles: number;
  particles: number;
  projectiles: number;
  chunks: number;
  sprites: number;
  /** Props (and wrecks) in the instance buffers right now. */
  props: number;
}

/** Sounds and shakes the picture asks for; the match screen wires them to audio and the camera. */
export interface RenderCues {
  onStep?: (k: SnapKaiju) => void;
  /** The kaiju went into the water to swim, or came up (sim/swim.ts). */
  onSplash?: (k: SnapKaiju) => void;
}

const FOG: Record<StageId, FogRange> = {
  1: { near: 140, far: 1500 },
  2: { near: 280, far: 2700 },
  3: { near: 520, far: 4400 },
};
const NO_KAIJUS: SnapKaiju[] = [];
/** The most pixels the 3D view is drawn with: a 1080p screen's worth. */
const MAX_PIXELS = 1920 * 1080;

/** The weak point's light (art notes for the kaiju, section 5): violet, never the humans' cyan. */
const WEAK_POINT_COLOR = 0xc9a6ff;

/** Height of the faint curtain above the quarantine line, by stage: a line first, a wall never. */
const CURTAIN: Record<StageId, number> = { 1: 2.5, 2: 7, 3: 20 };

interface GroundMark {
  /** Call-in mission id. */
  id: number;
  x: number;
  z: number;
  radius: number;
  until: number;
  r: number;
  g: number;
  b: number;
}

/** Seconds a roar's shockwave takes to reach the edge of its radius. */
const ROAR_WAVE = 0.8;

/**
 * An effect due a moment from now: the dust thrown up along a roar's spreading front, and a
 * unit jolted when that front reaches it.
 */
interface PendingFx {
  at: number;
  kind: 'front' | 'jolt';
  x: number;
  z: number;
  /** Front: how far out the front is. Jolt: the unit's radius. */
  r: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 9000);
  readonly materials: Materials;
  readonly sky: Sky;
  readonly effects: Effects;
  readonly lines = new LineBatch(128);
  readonly stats: RenderStats = { calls: 0, triangles: 0, particles: 0, projectiles: 0, chunks: 0, sprites: 0, props: 0 };
  cues: RenderCues = {};

  private readonly assets: AssetStore;
  private readonly sprites: QuadBatch;
  private readonly decals: QuadBatch;
  private readonly markers: QuadBatch;
  private readonly glow: QuadBatch;
  private readonly units: UnitsView;
  private readonly crowd: Crowd;
  private readonly projectiles: ProjectilesView;
  private readonly boundary = new Boundary();
  private readonly kaijuViews: KaijuView[] = [];
  private city: CityView | null = null;
  private cityData: CityData | null = null;
  private ground: THREE.Group | null = null;
  private mirror: CityMirror | null = null;
  private lastFrame: FrameState | null = null;
  private lastView: RenderView | null = null;
  private time = 0;
  private shownStage: StageId | 0 = 0;
  /**
   * False from `beginMatch` until the first frame of the match: that frame's stage is shown at
   * once, so joining (or a sandbox starting) at stage 3 never opens on a fading afternoon sky.
   */
  private stageSeen = false;
  private readonly marks: GroundMark[] = [];
  private readonly pending: PendingFx[] = [];
  /** The latest roar, so that the units it shakes jolt when its front reaches them. */
  private lastRoar = { x: 0, z: 0, radius: 0, time: -1e9 };
  private readonly ringUv = [0, 0, 0, 0];
  private readonly triangleUv = [0, 0, 0, 0];
  private resolution: number;
  private quality = 1;
  private readonly size = { w: 0, h: 0 };

  constructor(canvas: HTMLCanvasElement, assets: AssetStore, resolution = 1) {
    this.assets = assets;
    this.resolution = resolution;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x101420, 1);
    this.materials = createMaterials(assets);
    this.sky = new Sky(this.scene, assets);
    this.effects = new Effects(assets);

    const atlas = assets.atlas;
    if (!atlas) throw new Error('renderer needs the sprite atlas (call AssetStore.preload first)');
    this.sprites = new QuadBatch(atlas.texture, { mode: 'upright', capacity: 2600, alphaTest: 0.5 });
    this.decals = new QuadBatch(atlas.texture, { mode: 'ground', capacity: 300, renderOrder: 3, depthBias: 4 });
    this.markers = new QuadBatch(atlas.texture, { mode: 'facing', capacity: 128, renderOrder: 18, fog: false });
    this.glow = new QuadBatch(atlas.texture, { mode: 'facing', capacity: 256, additive: true, renderOrder: 17 });
    this.units = new UnitsView(assets, this.materials, this.sprites, this.decals, this.markers);
    this.crowd = new Crowd(assets, this.sprites);
    this.projectiles = new ProjectilesView(assets, this.materials, this.glow);
    this.scene.add(
      this.units.group,
      this.projectiles.group,
      this.sprites.mesh,
      this.decals.mesh,
      this.markers.mesh,
      this.glow.mesh,
      this.effects.group,
      this.lines.mesh,
      this.boundary.mesh,
    );
    const first = (id: string, out: number[]): void => {
      const anim = [...assets.sprite(id).anims.values()][0];
      if (anim) frameRect(anim, 0, 0, out, 0);
    };
    first('fx_ring', this.ringUv);
    first('mk_triangle', this.triangleUv);
    this.camera.position.set(0, 300, -500);
    this.camera.lookAt(0, 0, 0);
    this.applyStage(1, true);
  }

  // --- set-up ----------------------------------------------------------------------------------

  /** Builds the ground and the city (once per city; a different seed rebuilds them). */
  setCity(city: CityData): void {
    if (this.cityData === city) return;
    this.cityData = city;
    if (this.city) this.scene.remove(this.city.group);
    if (this.ground) this.scene.remove(this.ground);
    this.ground = buildGround(city, this.assets);
    this.city = new CityView(city, this.assets, this.materials);
    this.pictures = null;
    this.scene.add(this.ground, this.city.group);
  }

  /**
   * Pictures of the landmarks for the map, by archetype id (drawn on first use, then kept).
   * Empty when the landmarks have no art files.
   */
  landmarkPictures(): Map<string, HTMLCanvasElement> {
    if (!this.pictures) {
      const atlas = this.materials.cityAtlas.map;
      this.pictures = renderLandmarkPictures(this.city ? this.city.landmarkModels() : [], atlasPixels(atlas?.image));
    }
    return this.pictures;
  }

  private pictures: Map<string, HTMLCanvasElement> | null = null;

  /** A match begins (or is joined): show its city state and forget the last match's leftovers. */
  beginMatch(mirror: CityMirror, stage: StageId, bounds: Bounds): void {
    this.setCity(mirror.city);
    this.mirror = mirror;
    this.city?.syncFrom(mirror);
    this.clearTransient();
    this.applyStage(stage, true);
    this.stageSeen = false;
    this.boundary.set(bounds, CURTAIN[stage], true);
  }

  /** Shows the quarantine line for these bounds (they slide outward when a stage widens them). */
  showBounds(bounds: Bounds, stage: StageId): void {
    this.boundary.set(bounds, CURTAIN[stage]);
  }

  /** The city was replaced wholesale (reconnection). */
  resync(): void {
    if (this.mirror) this.city?.syncFrom(this.mirror);
  }

  /** Back to the pristine city (menus). */
  endMatch(): void {
    this.mirror = null;
    this.lastFrame = null;
    this.city?.reset();
    this.clearTransient();
    this.boundary.hide();
    for (const view of this.kaijuViews) view.hide();
    this.applyStage(1, true);
  }

  private clearTransient(): void {
    this.effects.clear();
    this.projectiles.clear();
    this.units.clear();
    this.crowd.clear();
    this.marks.length = 0;
    this.pending.length = 0;
    this.lastRoar.time = -1e9;
  }

  private applyStage(stage: StageId, immediate: boolean): void {
    if (this.shownStage === stage && !immediate) return;
    this.shownStage = stage;
    this.sky.setTime(stageDef(stage).timeOfDay, FOG[stage], immediate ? 0 : 5);
  }

  /**
   * The player's resolution setting (1, or 0.5 for weak graphics hardware), on top of the
   * page's `?res=` flag. Applied at once.
   */
  setQuality(scale: number): void {
    this.quality = Math.min(1, Math.max(0.25, scale));
    if (this.size.w > 0) this.resize(this.size.w, this.size.h);
  }

  /** The drawing buffer's pixel ratio for a view of this size (exported for tests). */
  static pixelRatio(width: number, height: number, devicePixelRatio: number, scale: number): number {
    let ratio = Math.min(devicePixelRatio || 1, 2) * scale;
    // Never more pixels than a 1080p screen holds: a 4K or high-density laptop screen would
    // otherwise draw four times as many, and blended effects cost by the pixel.
    const pixels = width * height * ratio * ratio;
    if (pixels > MAX_PIXELS) ratio *= Math.sqrt(MAX_PIXELS / pixels);
    return ratio;
  }

  resize(width: number, height: number): void {
    this.size.w = width;
    this.size.h = height;
    this.renderer.setPixelRatio(GameRenderer.pixelRatio(width, height, window.devicePixelRatio, this.resolution * this.quality));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  // --- events ----------------------------------------------------------------------------------

  private kaijuAt(id: number): SnapKaiju | undefined {
    return this.lastFrame?.kaijus[id];
  }

  /** Whether the camera is inside this kaiju's head (the local kaiju in first person). */
  private insideKaiju(id: number): boolean {
    const v = this.lastView;
    return !!v && v.kaijuFirstPerson && v.localKaiju === id;
  }

  /**
   * The view is about to skip a stretch nobody saw (a hidden tab's backlog): whatever was in
   * the air when the frames stopped, explosions and shells alike, is long over.
   */
  skipMoment(): void {
    this.effects.clear();
    this.projectiles.clear();
    this.pending.length = 0;
  }

  /**
   * An event whose moment passed while nothing was drawn (a hidden tab): only what lasts is
   * taken over. The city ends up in the right state, marks and the stage are kept, a shell that
   * was in flight is removed; nothing is launched, nothing flashes and nothing falls.
   */
  private applyQuietly(e: SimEvent): void {
    const city = this.city;
    switch (e.type) {
      case 'projectileHit':
        this.projectiles.hit(e);
        break;
      case 'structureStage':
        if (city) {
          city.setStage(e.id, e.stage, false);
          city.flush();
        }
        break;
      case 'propsDestroyed': {
        if (!city || !this.cityData) break;
        for (const id of e.ids) {
          const p = this.cityData.props[id];
          if (!p) continue;
          city.setPropAlive(id, false);
          if (PROP_KINDS[p.kind].leavesWreck) city.setWreck(id, true);
        }
        city.flushProps();
        break;
      }
      case 'kaijuHeld':
      case 'callin':
      case 'stageChange':
        // These only change lasting state: handled as always.
        this.handleEvent(e);
        break;
      default:
        break;
    }
  }

  /**
   * Turns a simulation event into what is seen. Sound is the audio layer's job. With `quiet`
   * the event is long past (see MatchSession.catchingUp): its lasting effect is applied and
   * nothing is shown happening.
   */
  handleEvent(e: SimEvent, quiet = false): void {
    if (quiet) {
      this.applyQuietly(e);
      return;
    }
    const fx = this.effects;
    const city = this.city;
    switch (e.type) {
      case 'projectileSpawn': {
        const k = e.owner === 'kaiju' ? this.kaijuAt(e.ownerId) : undefined;
        // A thrown thing leaves the model's hand (the simulation throws it from a point of its own).
        const view = e.owner === 'kaiju' && e.projectile === 'thrown' ? this.kaijuViews[e.ownerId] : undefined;
        this.projectiles.spawn(e, k ? kaijuStageDef(k.kind, k.stage).bodyRadius * 0.9 : 3, view?.hasHand ? view.hand : null);
        if (e.owner === 'unit') {
          this.units.noteFired(e.ownerId, this.time);
          fx.flash(e.x, e.y, e.z, e.projectile === 'rocket' ? 2.5 : 5, 0xffffff, 0.1);
          fx.puff(e.x, e.y, e.z, e.projectile === 'rocket' ? 1.5 : 3, 0xd8d2c4, 0.6, 0.5);
        }
        break;
      }
      case 'projectileHit': {
        this.projectiles.hit(e);
        const r = Math.max(2, e.splash);
        if (e.target === 'water') fx.splash(e.x, e.z, r);
        else if (e.target === 'none') fx.puff(e.x, e.y, e.z, r * 0.6);
        else {
          fx.explosion(e.x, Math.max(0.5, e.y), e.z, r, e.projectile === 'thrown' ? 0xd8c9a8 : 0xff8a1a);
          if (e.projectile === 'thrown') fx.dust(e.x, 0.3, e.z, r, 6);
        }
        break;
      }
      case 'structureStage': {
        if (!city) break;
        const info = city.setStage(e.id, e.stage, true);
        city.flush();
        if (info) {
          if (e.stage >= 3) {
            fx.dust(info.x, 0.5, info.z, info.radius * 1.3, Math.min(22, 8 + Math.round(info.height / 6)));
            fx.dust(info.x, info.height * 0.35, info.z, info.radius, 6);
            fx.ring(info.x, info.z, info.radius * 2.2, 0xd8cfbd, 0.9, 0.6);
          } else {
            fx.dust(info.x, info.height * 0.5, info.z, info.radius * 0.6, 4);
            fx.glowAt(info.x, info.height * 0.6, info.z, info.radius * 1.6, 0xffe0b0, 0.08);
          }
        }
        break;
      }
      case 'propsDestroyed': {
        if (!city || !this.cityData) break;
        for (const id of e.ids) {
          const p = this.cityData.props[id];
          if (!p) continue;
          city.setPropAlive(id, false);
          const def = PROP_KINDS[p.kind];
          if (def.leavesWreck) city.setWreck(id, true);
          fx.dust(p.x, def.height * 0.5, p.z, Math.max(1, def.radius), def.value > 0 ? 3 : 1);
          if (def.value > 0) fx.glowAt(p.x, def.height * 0.6, p.z, def.radius * 3.5, 0xffe2a8, 0.08);
        }
        city.flushProps();
        break;
      }
      case 'kaijuHeld': {
        if (!city) break;
        if (e.source === 'prop') city.setPropAlive(e.sourceId, false);
        else if (e.source === 'propWreck') city.setWreck(e.sourceId, false);
        city.flushProps();
        break;
      }
      case 'kaijuAction': {
        const k = this.kaijuAt(e.kaiju);
        if (!k) break;
        const st = kaijuStageDef(k.kind, k.stage);
        const def = kaijuKindDef(k.kind);
        if (e.action === 'stomp' && e.phase === 'active') {
          const radius = def.actions.stomp.radius * st.bodyRadius;
          fx.ring(e.x, e.z, radius, 0xfff1d0, 0.55);
          fx.dust(e.x, 0.3, e.z, radius * 0.6, 14);
        } else if (e.action === 'swipe' && e.phase === 'active') {
          const reach = def.actions.swipe.reach * st.bodyRadius * 0.7;
          fx.dust(e.x + Math.sin(e.yaw) * reach, st.handHeight * 0.6, e.z + Math.cos(e.yaw) * reach, st.bodyRadius * 0.8, 5);
        }
        break;
      }
      case 'roar': {
        // A shockwave anyone can see from anywhere: a ring on the ground, rings in the air up
        // the kaiju's height (over the rooftops, so the streets do not hide it), dust thrown up
        // along the spreading front, and every unit it shakes jolts as the front reaches it.
        const k = this.kaijuAt(e.kaiju);
        const st = k ? kaijuStageDef(k.kind, k.stage) : null;
        const h = st ? st.height : 10;
        fx.ring(e.x, e.z, e.radius, 0xff9a3c, ROAR_WAVE, 1.0);
        fx.ring(e.x, e.z, e.radius * 0.97, 0xffd9a0, ROAR_WAVE * 1.15, 0.7, h * 0.35);
        fx.ring(e.x, e.z, e.radius * 0.9, 0xffb060, ROAR_WAVE * 1.3, 0.55, h * 0.8);
        if (k && st && !this.insideKaiju(e.kaiju)) {
          const fwd = st.mouthForward;
          fx.glowAt(e.x + Math.sin(k.aimYaw) * fwd, st.mouthHeight, e.z + Math.cos(k.aimYaw) * fwd, st.bodyRadius * 4, 0xffc070, 0.35, 0.8);
        }
        for (let i = 1; i <= 4; i++) this.pending.push({ at: this.time + (ROAR_WAVE * i) / 4, kind: 'front', x: e.x, z: e.z, r: (e.radius * i) / 4 });
        this.lastRoar = { x: e.x, z: e.z, radius: e.radius, time: this.time };
        break;
      }
      case 'unitShaken': {
        const u = this.lastFrame?.units[e.unit];
        if (!u) break;
        const roar = this.lastRoar;
        const radius = unitTypeDef(u.type).radius;
        const d = Math.hypot(u.x - roar.x, u.z - roar.z);
        // Shaken by the roar that went off just now: when its front gets there. Otherwise at once.
        const delay = this.time - roar.time < 0.1 && d <= roar.radius + radius ? (Math.min(d, roar.radius) / Math.max(1, roar.radius)) * ROAR_WAVE : 0;
        this.pending.push({ at: this.time + delay, kind: 'jolt', x: u.x, z: u.z, r: radius });
        break;
      }
      case 'kaijuHit': {
        const k = this.kaijuAt(e.kaiju);
        if (!k || e.damage + e.nerve <= 0) break;
        // Not for the kaiju's own eyes: from inside its head the flash, which sits on the body
        // right behind the camera, would blank part of the view on every hit.
        if (this.insideKaiju(e.kaiju)) break;
        const st = kaijuStageDef(k.kind, k.stage);
        fx.glowAt(k.x, st.height * 0.6, k.z, st.bodyRadius * (e.braced ? 1.8 : 3), e.braced ? 0x9fd8ff : 0xfff0d8, 0.08, 0.8);
        break;
      }
      case 'kaijuStagger': {
        const k = this.kaijuAt(e.kaiju);
        if (k && e.on) {
          // The weak point's violet (cyan is the humans' color).
          const st = kaijuStageDef(k.kind, k.stage);
          fx.ring(k.x, k.z, st.bodyRadius * 5, WEAK_POINT_COLOR, 0.8);
          if (!this.insideKaiju(e.kaiju)) fx.glowAt(k.x, st.height * 0.6, k.z, st.bodyRadius * 6, WEAK_POINT_COLOR, 0.2, 0.9);
        }
        break;
      }
      case 'nerveBreak':
        fx.ring(e.x, e.z, 40, 0xffffff, 0.5);
        break;
      case 'unitHit':
        fx.glowAt(e.x, 1.5, e.z, 4.5, 0xffb080, 0.08);
        break;
      case 'memberLost': {
        const u = this.lastFrame?.units[e.unit];
        if (u) this.units.noteMembersLost(u, e.count);
        break;
      }
      case 'unitDestroyed': {
        const def = unitTypeDef(e.unitType);
        if (def.body === 'infantry') fx.dust(e.x, 0.5, e.z, def.radius, 5);
        else fx.explosion(e.x, 1.5, e.z, def.radius * 1.2);
        break;
      }
      case 'volley':
        fx.ring(e.x, e.z, 6 + e.charge * 8, 0xffd91a, 0.4);
        break;
      case 'smoke':
        // The canister bursts; the screen itself is drawn from the snapshots while it stands.
        fx.dust(e.x, 0.5, e.z, e.radius * 0.6, 8, 0xd6d6d0);
        break;
      case 'mark': {
        // The squads see the marker pulse over it as it is marked (the kaiju is not told).
        const k = this.lastFrame?.kaijus[e.kaiju];
        if (k && this.lastView && e.kaiju !== this.lastView.localKaiju) {
          const h = kaijuStageDef(k.kind, k.stage).height;
          fx.ring(k.x, k.z, kaijuStageDef(k.kind, k.stage).bodyRadius * 3, 0xff7a1a, 0.7, 0.9);
          fx.glowAt(k.x, h * 1.2, k.z, h * 0.8, 0xff7a1a, 0.4, 0.8);
        }
        break;
      }
      case 'callin': {
        if (e.phase === 'marked') {
          // Kept until the mission reports 'done' (or, if that never comes, a while after the barrage).
          this.marks.push({ id: e.id, x: e.x, z: e.z, radius: e.radius, until: this.time + e.delay + 8, r: 1, g: 0.3, b: 0.2 });
        } else if (e.phase === 'done') {
          const i = this.marks.findIndex((m) => m.id === e.id);
          if (i >= 0) this.marks.splice(i, 1);
        }
        break;
      }
      case 'cocoon':
        fx.dust(e.x, 0.5, e.z, 6, 10, 0xb89a80);
        break;
      case 'moltBlast': {
        fx.ring(e.x, e.z, e.shoveRadius, 0xffa040, 1.1);
        fx.ring(e.x, e.z, e.killRadius, 0xffffff, 0.6);
        fx.glowAt(e.x, e.killRadius * 0.5, e.z, e.killRadius * 4, 0xffe0b0, 0.3);
        fx.dust(e.x, 1, e.z, e.killRadius, 20);
        break;
      }
      case 'stageChange':
        this.applyStage(e.stage, false);
        this.boundary.set(e.bounds, CURTAIN[e.stage]);
        break;
      default:
        break;
    }
  }

  // --- per frame -------------------------------------------------------------------------------

  /** Spawns the effects whose moment has come (see `PendingFx`). */
  private runPending(): void {
    const fx = this.effects;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (p.at > this.time) continue;
      this.pending[i] = this.pending[this.pending.length - 1];
      this.pending.pop();
      i--;
      if (p.kind === 'front') {
        // A dozen puffs of dust around the circle the front has reached, each a little bigger further out.
        const n = 12;
        const size = Math.max(2, p.r * 0.12);
        const turn = p.r * 0.37;
        for (let j = 0; j < n; j++) {
          const a = turn + (j / n) * Math.PI * 2;
          fx.dust(p.x + Math.sin(a) * p.r, 0.5, p.z + Math.cos(a) * p.r, size, 1, 0xd8c8b0);
        }
      } else {
        // The unit jolts: a puff of dust kicked up, a pale flash and a small ring round it.
        fx.dust(p.x, 0.5, p.z, p.r * 1.4, 5, 0xe0d4c0);
        fx.ring(p.x, p.z, p.r * 2.5, 0xffe0a0, 0.8, 0.9);
        fx.glowAt(p.x, p.r * 0.8 + 1, p.z, p.r * 2.2, 0xfff0c8, 0.5, 0.9);
      }
    }
  }

  /** First-person camera anchor of a kaiju (the rig's `cam_fp`), valid after `update`. */
  kaijuCamAnchor(id: number): THREE.Vector3 | null {
    return this.kaijuViews[id]?.camAnchor ?? null;
  }

  /** The local kaiju's own press, shown ahead of the server (see `hintPose`). */
  private overrideFor(k: SnapKaiju, view: RenderView): KaijuOverride | null {
    return k.id === view.localKaiju ? hintPose(k, view.hint, view.now) : null;
  }

  /**
   * Updates everything for this frame. `frame` is null in the menus (the city alone is drawn).
   * The camera must already be where the controller wants it.
   */
  update(frame: FrameState | null, dt: number, view: RenderView | null): void {
    this.time += dt;
    const time = this.time;
    this.lastFrame = frame;
    this.lastView = view;
    this.sprites.begin();
    this.decals.begin();
    this.markers.begin();
    this.glow.begin();
    this.lines.begin();

    if (frame && view) {
      const query = this.mirror?.query ?? null;
      frame.kaijus.forEach((k, i) => {
        let kv = this.kaijuViews[i];
        if (!kv) {
          kv = new KaijuView(this.assets, this.materials, { onStep: (kk) => this.cues.onStep?.(kk), onSplash: (kk) => this.cues.onSplash?.(kk) });
          this.kaijuViews[i] = kv;
          this.scene.add(kv.group);
        }
        const own = k.id === view.localKaiju && view.kaijuFirstPerson;
        kv.update(k, dt, time, this.overrideFor(k, view), query, this.lines, this.effects, {
          firstPerson: own,
          insideHead: own && view.kaijuInsideHead,
          camera: this.camera.position,
        });
        const st = kaijuStageDef(k.kind, k.stage);
        if (k.phase !== 'cocoon' || k.id === view.localKaiju || view.seesKaiju) {
          this.decals.push(k.x, 0.12, k.z, st.bodyRadius * 3.4, st.bodyRadius * 3.4, this.ringShadowUv(), 0, 0, 0, 0, 0.6);
        }
        // An orange triangle over the kaiju, far away, only while a squad has marked it or a
        // squad leader has it in plain sight (the spotting rules): not always (polish pass 2).
        // A mark makes it bigger and pulse.
        const dist = Math.hypot(k.x - this.camera.position.x, k.z - this.camera.position.z);
        if (k.id !== view.localKaiju && (k.marked || k.spotted) && k.alive && dist > st.height * 5) {
          const size = Math.min(k.marked ? 44 : 30, Math.max(3, dist * (k.marked ? 0.026 : 0.018)));
          const glow = k.marked ? 0.75 + 0.25 * Math.sin(time * 6) : 0.85;
          this.markers.push(k.x, st.height + size, k.z, size, size, this.triangleUv, 0, 1, 0.48, 0.1, glow);
        }
      });
      for (let i = frame.kaijus.length; i < this.kaijuViews.length; i++) this.kaijuViews[i]?.hide();
      this.effects.setClouds(frame.smokes);

      this.units.update(
        frame.units,
        {
          camera: this.camera,
          time,
          dt,
          localUnit: view.localUnit,
          localSquad: view.localSquad,
          hideLocalLead: view.hideLocalLead,
          city: query,
          kaijus: frame.kaijus,
          veil: view.localKaiju >= 0 ? frame.smokes : null,
        },
        this.lines,
        this.effects,
      );

      // The crowd is kept around the kaiju and runs from it, but only where the viewer may know
      // where it is: a squad that has lost the kaiju gets its crowd around its own camera and
      // nobody fleeing, so empty and busy streets give nothing away.
      const focus = frame.kaijus[0];
      if (query && focus) {
        const st = kaijuStageDef(focus.kind, focus.stage);
        const spread = Math.min(420, 90 + st.height * 4);
        const known = view.seesKaiju || focus.known;
        const cam = this.camera.position;
        this.crowd.update(dt, time, query, frame.bounds, known ? frame.kaijus : NO_KAIJUS, known ? focus.x : cam.x, known ? focus.z : cam.z, spread, 25 + st.height * 3, this.camera);
      }

      // Squad move-to markers and call-in marks on the ground.
      for (const squad of frame.squads) {
        if (squad.id !== view.localSquad || squad.moveOrder !== 'moveTo') continue;
        const pulse = 0.6 + 0.3 * Math.sin(time * 5);
        this.decals.push(squad.moveTargetX, 0.2, squad.moveTargetZ, 9, 9, this.ringUv, 0, 0.12, 0.78, 0.88, pulse);
      }
      for (let i = 0; i < this.marks.length; i++) {
        const m = this.marks[i];
        if (m.until < time) {
          this.marks[i] = this.marks[this.marks.length - 1];
          this.marks.pop();
          i--;
          continue;
        }
        const pulse = 0.55 + 0.4 * Math.sin(time * 9);
        this.decals.push(m.x, 0.2, m.z, m.radius * 2, m.radius * 2, this.ringUv, 0, m.r, m.g, m.b, pulse);
      }

      this.projectiles.update(frame.tick, dt, this.effects, this.camera);
      this.applyStage(frame.match.stage, !this.stageSeen);
      this.stageSeen = true;
    }

    this.stats.chunks = this.city ? this.city.update(dt) : 0;
    // Props are drawn out to a distance that grows with the camera's height.
    const cam = this.camera.position;
    this.stats.props = this.city ? this.city.updateProps(cam.x, cam.z, Math.min(950, 330 + cam.y * 2.6)) : 0;
    this.runPending();
    this.effects.update(dt, this.camera);
    this.boundary.update(dt, time);
    this.sky.update(dt, this.camera);
    this.materials.setNight(this.sky.night, view?.kaijuFirstPerson === true);
    if (this.ground) setGroundNight(this.ground, this.sky.night, this.sky.sunset);
    this.lines.setFog(this.sky.fog.near, this.sky.fog.far);

    this.stats.sprites = this.sprites.size;
    this.sprites.end();
    this.decals.end();
    this.markers.end();
    this.glow.end();
    this.lines.end();
    this.stats.particles = this.effects.count;
    this.stats.projectiles = this.projectiles.count;
  }

  private shadowUvCache: number[] | null = null;
  private ringShadowUv(): number[] {
    if (!this.shadowUvCache) {
      this.shadowUvCache = [0, 0, 0, 0];
      const anim = [...this.assets.sprite('fx_shadow').anims.values()][0];
      if (anim) frameRect(anim, 0, 0, this.shadowUvCache, 0);
    }
    return this.shadowUvCache;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
  }
}
