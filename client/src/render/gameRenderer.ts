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
import { Crowd } from './crowd';
import { Effects } from './effects';
import { buildGround } from './ground';
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
  /** First person from a unit: its lead member is not drawn. */
  hideLocalLead: boolean;
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
}

const FOG: Record<StageId, FogRange> = {
  1: { near: 140, far: 1500 },
  2: { near: 280, far: 2700 },
  3: { near: 520, far: 4400 },
};
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
  private time = 0;
  private shownStage: StageId | 0 = 0;
  private readonly marks: GroundMark[] = [];
  private readonly ringUv = [0, 0, 0, 0];
  private readonly triangleUv = [0, 0, 0, 0];
  private resolution: number;

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
    this.scene.add(this.ground, this.city.group);
  }

  /** A match begins (or is joined): show its city state and forget the last match's leftovers. */
  beginMatch(mirror: CityMirror, stage: StageId, bounds: Bounds): void {
    this.setCity(mirror.city);
    this.mirror = mirror;
    this.city?.syncFrom(mirror);
    this.clearTransient();
    this.applyStage(stage, true);
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
  }

  private applyStage(stage: StageId, immediate: boolean): void {
    if (this.shownStage === stage && !immediate) return;
    this.shownStage = stage;
    this.sky.setTime(stageDef(stage).timeOfDay, FOG[stage], immediate ? 0 : 5);
  }

  resize(width: number, height: number): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * this.resolution;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  // --- events ----------------------------------------------------------------------------------

  private kaijuAt(id: number): SnapKaiju | undefined {
    return this.lastFrame?.kaijus[id];
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
        this.projectiles.spawn(e, k ? kaijuStageDef(k.kind, k.stage).bodyRadius * 0.9 : 3);
        if (e.owner === 'unit') {
          this.units.noteFired(e.ownerId, this.time);
          fx.flash(e.x, e.y, e.z, e.projectile === 'rocket' ? 2.5 : 5, 0xffe9a8, 0.1);
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
          fx.explosion(e.x, Math.max(0.5, e.y), e.z, r, e.projectile === 'thrown' ? 0xd8c9a8 : 0xffd27a);
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
            fx.flash(info.x, info.height * 0.6, info.z, info.radius, 0xffe0b0, 0.08);
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
          if (def.value > 0) fx.flash(p.x, def.height * 0.6, p.z, def.radius * 2.2, 0xffe2a8, 0.08);
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
        fx.ring(e.x, e.z, e.radius, 0xff9a3c, 1.0, 0.8);
        fx.ring(e.x, e.z, e.radius * 0.6, 0xffd9a0, 0.7, 0.6);
        break;
      }
      case 'kaijuHit': {
        const k = this.kaijuAt(e.kaiju);
        if (!k || e.damage + e.nerve <= 0) break;
        const st = kaijuStageDef(k.kind, k.stage);
        fx.flash(k.x, st.height * 0.6, k.z, st.bodyRadius * (e.braced ? 1.2 : 2), e.braced ? 0x9fd8ff : 0xffffff, 0.08);
        break;
      }
      case 'kaijuStagger': {
        const k = this.kaijuAt(e.kaiju);
        if (k && e.on) {
          const st = kaijuStageDef(k.kind, k.stage);
          fx.ring(k.x, k.z, st.bodyRadius * 5, 0x7dfcff, 0.8);
          fx.flash(k.x, st.height * 0.6, k.z, st.bodyRadius * 5, 0xbffcff, 0.2);
        }
        break;
      }
      case 'nerveBreak':
        fx.ring(e.x, e.z, 40, 0xffffff, 0.5);
        break;
      case 'unitHit':
        fx.flash(e.x, 1.5, e.z, 3, 0xffb080, 0.08);
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
        fx.flash(e.x, e.killRadius * 0.5, e.z, e.killRadius * 3, 0xffe0b0, 0.3);
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
          kv = new KaijuView(this.assets, this.materials, { onStep: (kk) => this.cues.onStep?.(kk) });
          this.kaijuViews[i] = kv;
          this.scene.add(kv.group);
        }
        kv.update(k, dt, time, this.overrideFor(k, view), query, this.lines, this.effects);
        const st = kaijuStageDef(k.kind, k.stage);
        if (k.phase !== 'cocoon' || k.id === view.localKaiju || view.seesKaiju) {
          this.decals.push(k.x, 0.12, k.z, st.bodyRadius * 3.4, st.bodyRadius * 3.4, this.ringShadowUv(), 0, 0, 0, 0, 0.6);
        }
        // An orange triangle marks the kaiju for the humans when it is far away and known.
        const dist = Math.hypot(k.x - this.camera.position.x, k.z - this.camera.position.z);
        if (k.id !== view.localKaiju && (k.known || view.seesKaiju) && k.alive && dist > st.height * 5) {
          const size = Math.min(60, Math.max(3, dist * 0.03));
          this.markers.push(k.x, st.height + size, k.z, size, size, this.triangleUv, 0, 1, 0.48, 0.1, 0.95);
        }
      });
      for (let i = frame.kaijus.length; i < this.kaijuViews.length; i++) this.kaijuViews[i]?.hide();

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
        },
        this.lines,
        this.effects,
      );

      const focus = frame.kaijus[0];
      if (query && focus) {
        const st = kaijuStageDef(focus.kind, focus.stage);
        const spread = Math.min(420, 90 + st.height * 4);
        this.crowd.update(dt, time, query, frame.bounds, frame.kaijus, focus.x, focus.z, spread, 25 + st.height * 3, this.camera);
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
      this.applyStage(frame.match.stage, false);
    }

    this.stats.chunks = this.city ? this.city.update(dt) : 0;
    // Props are drawn out to a distance that grows with the camera's height.
    const cam = this.camera.position;
    this.stats.props = this.city ? this.city.updateProps(cam.x, cam.z, Math.min(950, 330 + cam.y * 2.6)) : 0;
    this.effects.update(dt);
    this.boundary.update(dt, time);
    this.sky.update(dt, this.camera, time);
    this.materials.setNight(this.sky.night);
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
