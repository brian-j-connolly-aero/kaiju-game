/**
 * The special buildings on screen (docs/ROADMAP.md phase 2; DESIGN.md section 7, "Special
 * buildings"): every starting neighborhood has a power substation, a gas station and a radio
 * mast, and each must read as special from across the city and pay its reward in a way anyone
 * can see.
 *
 * - Standing, each has a moving light at the effect points its model marks
 *   (docs/art/client-notes-city.md section 7): the substation's insulators crackle with blue
 *   sparks under a humming blue glow, the gas station's lights flicker over its pumps, the radio
 *   mast's red lamps blink. The glows grow with distance (as the markers do), so a few pixels of
 *   each still show from a titan's height; the lights of a damaged one stutter.
 * - The substation's burst (`powerSurge`): a blue-white flash, a ring and arcs of lightning that
 *   leap from the insulators to the monster for a second and a half. (The surge crackling on
 *   the monster's own body for its eight seconds is drawn with the monster.)
 * - The gas station's fireball (`fireball`): a white flash, shock rings, then puffs of flame,
 *   white-hot in the middle and orange round them, rolling up into a cap of dark smoke
 *   (fireball.ts, phase 3), burning debris, then fire on the ruin and a column of black smoke for
 *   several seconds.
 * - The radio mast: its fall is the city view's (it falls like any tall building, without its top,
 *   which tumbles off); here, sparks at the break while it falls and a shower of them where it lands.
 */

import * as THREE from 'three';
import {
  archetypeDef,
  archetypeModelId,
  archetypeSpecial,
  kaijuStageDef,
  type CityData,
  type SimEvent,
  type SnapKaiju,
  type SpecialKind,
  type Structure,
} from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { frameRect } from '../assets/spriteAtlas';
import type { Effects } from './effects';
import { Fireballs } from './fireball';
import { LineBatch } from './lineBatch';
import { QuadBatch } from './quadBatch';

/** One special building and its effect points in the world. */
interface Special {
  id: number;
  kind: SpecialKind;
  s: Structure;
  /** Effect points (sparks, lights, lamps), world space. */
  points: THREE.Vector3[];
  /** Seconds to its next crackle (substation). */
  next: number;
}

/** Arcs of the substation's burst, leaping to a kaiju. */
interface Burst {
  structure: number;
  kaiju: number;
  t: number;
  duration: number;
}

/** Fire and smoke over a ruin for a while (the gas station). */
interface Blaze {
  x: number;
  z: number;
  radius: number;
  t: number;
  duration: number;
  fireTimer: number;
  smokeTimer: number;
}

const BURST_TIME = 1.5;
const BLAZE_TIME = 9;
/** Lights of a special building are drawn out to this far (fog hides them sooner by day). */
const LIGHT_RANGE = 2600;
const SPARK_BLUE = 0xbfe4ff;

/** Effect points by node-name prefix in the model (`spark_00`...), in the building's own frame. */
function anchorsOf(assets: AssetStore, modelId: string, prefix: string): THREE.Vector3[] {
  if (!assets.hasModel(modelId)) return [];
  const model = assets.model(modelId);
  const out: THREE.Vector3[] = [];
  const pattern = new RegExp(`^${prefix}_\\d+$`);
  model.nodes.forEach((node, i) => {
    if (!pattern.test(node.name)) return;
    const p = new THREE.Vector3();
    for (let j = i; j >= 0; j = model.nodes[j].parent) p.add(model.nodes[j].position);
    out.push(p);
  });
  return out;
}

/** Where the effect points of a special building are when its model has none (the box stand-ins). */
function fallbackAnchors(kind: SpecialKind, w: number, h: number, d: number): THREE.Vector3[] {
  if (kind === 'substation') return [-0.3, -0.1, 0.1, 0.3].map((f) => new THREE.Vector3(f * w, h * 0.5, 0));
  if (kind === 'gasstation') return [-0.1, 0.1].flatMap((f) => [new THREE.Vector3(f * w, 2.7, d * 0.3), new THREE.Vector3(f * w, 2.7, d * 0.05)]);
  return [0.98, 0.65, 0.33].map((f) => new THREE.Vector3(0, h * f, 0));
}

export class SpecialsView {
  readonly group = new THREE.Group();
  /** The lights' halos: added, one draw call (they carry the night). */
  private readonly lights: QuadBatch;
  /** The lights' bright cores: blended, one draw call (an added glow vanishes against a sunlit street). */
  private readonly cores: QuadBatch;
  /** Arcs and sparks drawn as lines: one draw call. */
  readonly lines = new LineBatch(96);
  private readonly specials: Special[] = [];
  private readonly byId = new Map<number, Special>();
  private readonly bursts: Burst[] = [];
  private readonly blazes: Blaze[] = [];
  /** The fireballs' puffs of flame and smoke: one mesh. */
  readonly fireballs = new Fireballs();
  private readonly glowUv = [0, 0, 0, 0];
  private readonly tmp = new THREE.Vector3();
  private seed = 4242;
  private time = 0;

  constructor(city: CityData, assets: AssetStore) {
    const atlas = assets.atlas;
    if (!atlas) throw new Error('special buildings need the sprite atlas');
    this.lights = new QuadBatch(atlas.texture, { mode: 'facing', capacity: 256, additive: true, renderOrder: 17 });
    this.cores = new QuadBatch(atlas.texture, { mode: 'facing', capacity: 128, renderOrder: 16 });
    const anim = [...assets.sprite('fx_glow').anims.values()][0];
    if (anim) frameRect(anim, 0, 0, this.glowUv, 0);
    this.group.add(this.cores.mesh, this.lights.mesh, this.lines.mesh, this.fireballs.mesh);
    const prefix: Record<SpecialKind, string> = { substation: 'spark', gasstation: 'light', radiomast: 'lamp' };
    for (const s of city.structures) {
      const kind = archetypeSpecial(s.archetype);
      if (kind === null) continue;
      const def = archetypeDef(s.archetype);
      let local = anchorsOf(assets, archetypeModelId(def), prefix[kind]);
      if (local.length === 0) local = fallbackAnchors(kind, def.footprint[0], def.height, def.footprint[1]);
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const sx = (s.hx * 2) / def.footprint[0];
      const sy = s.height / def.height;
      const sz = (s.hz * 2) / def.footprint[1];
      // The building's own frame turned by its yaw (three.js: +X goes to (cos, -sin)).
      const points = local.map((p) => new THREE.Vector3(s.x + p.x * sx * c + p.z * sz * sn, p.y * sy, s.z - p.x * sx * sn + p.z * sz * c));
      const special: Special = { id: s.id, kind, s, points, next: 0 };
      this.specials.push(special);
      this.byId.set(s.id, special);
    }
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** How many special buildings the city has (tests). */
  get count(): number {
    return this.specials.length;
  }

  /** The effect points of a special building (world space), or an empty list. */
  pointsOf(id: number): readonly THREE.Vector3[] {
    return this.byId.get(id)?.points ?? [];
  }

  clear(): void {
    this.bursts.length = 0;
    this.blazes.length = 0;
    this.fireballs.clear();
  }

  // --- rewards -----------------------------------------------------------------------------------

  /** The rewards' events (the renderer hands every event here; most are not for it). */
  handleEvent(e: SimEvent, effects: Effects): void {
    switch (e.type) {
      case 'powerSurge': {
        const special = this.byId.get(e.structure);
        const h = special ? special.s.height : 9;
        // The substation lets go: a blue-white flash over the yard (light, not fire), a ring, a
        // fountain of sparks.
        effects.glowAt(e.x, h * 0.6, e.z, h * 9, 0xd8f0ff, 0.5, 1);
        effects.glowAt(e.x, h * 0.6, e.z, h * 3.5, 0xffffff, 0.25, 1);
        effects.ring(e.x, e.z, h * 4.5, 0xbfe4ff, 0.6, 1);
        for (const p of special?.points ?? []) effects.sparks(p.x, p.y, p.z, 2.5, 6, SPARK_BLUE, 0.6);
        // (The flash over the monster as the surge takes it is the weapons' picture: weaponsFx.ts.)
        this.bursts.push({ structure: e.structure, kaiju: e.kaiju, t: 0, duration: BURST_TIME });
        break;
      }
      case 'fireball':
        this.fireball(e.x, e.z, e.radius, effects);
        break;
      case 'mastFall': {
        // The mast breaks at its foot: sparks from the lamps' wiring.
        effects.sparks(e.x, 1.5, e.z, 2.5, 10, 0xffe0a0, 0.7);
        effects.dust(e.x, 0.5, e.z, 5, 6);
        break;
      }
      default:
        break;
    }
  }

  /**
   * The gas station goes up: a white flash, shock rings, torn metal and sparks, then the fireball
   * itself, puffs of flame as big as the blast rolling up into dark smoke (fireball.ts), flames
   * licking up from the ruin at once, and fire and black smoke on it for a while.
   */
  fireball(x: number, z: number, radius: number, effects: Effects): void {
    const r = Math.max(4, radius);
    effects.glowAt(x, r * 0.6, z, r * 7, 0xffb050, 0.7, 1);
    effects.flash(x, r * 0.5, z, r * 3.2, 0xffffff, 0.22);
    effects.ring(x, z, r * 2.4, 0xffd9a0, 0.8, 1);
    effects.ring(x, z, r * 2, 0xffa050, 1.1, 0.7, r * 0.5);
    effects.debris(x, r * 0.3, z, r * 1.2, 10, 0x6b5a4a, 1.2);
    effects.sparks(x, r * 0.3, z, r * 1.2, 14, 0xffc070, 0.9);
    for (let i = 0; i < 5; i++) effects.fire(x + (this.rand() - 0.5) * r * 0.6, 0, z + (this.rand() - 0.5) * r * 0.6, r * (0.3 + this.rand() * 0.2));
    this.fireballs.burst(x, z, r);
    this.blazes.push({ x, z, radius: r * 0.55, t: 0, duration: BLAZE_TIME, fireTimer: 0, smokeTimer: 0 });
  }

  // --- per frame ---------------------------------------------------------------------------------

  /**
   * Draws the lights of the special buildings still standing (`stageOf` gives a structure's
   * visual stage), the burst's arcs, the fireballs and the fires.
   */
  update(dt: number, camera: THREE.Camera, stageOf: (id: number) => number, kaijus: readonly SnapKaiju[], effects: Effects, fog: { near: number; far: number; color?: THREE.Color }): void {
    this.time += dt;
    const time = this.time;
    const cam = camera.position;
    this.lights.begin();
    this.cores.begin();
    this.lines.begin();
    for (const sp of this.specials) {
      const stage = stageOf(sp.id);
      if (stage >= 3) continue;
      const dist = Math.hypot(sp.s.x - cam.x, sp.s.z - cam.z);
      if (dist > LIGHT_RANGE) continue;
      // A light is never smaller on screen than about this share of its distance (markers grow
      // the same way): a few pixels across from the far side of the starting neighborhood.
      const far = dist * 0.018;
      if (sp.kind === 'radiomast') this.lamps(sp, stage, time, far);
      else if (sp.kind === 'gasstation') this.pumps(sp, stage, time, far);
      else this.crackle(sp, stage, dt, time, far, dist, effects);
    }
    this.updateBursts(dt, kaijus, effects);
    // The fireballs' smoke is lit as brightly as the day is (the fog's color says how bright).
    const f = fog.color;
    const light = f ? Math.min(1, Math.max(0.25, 0.25 + 1.05 * (0.2126 * f.r + 0.7152 * f.g + 0.0722 * f.b))) : 1;
    this.fireballs.update(dt, camera, light);
    this.updateBlazes(dt, effects);
    this.lines.setFog(fog.near, fog.far);
    this.lights.end();
    this.cores.end();
    this.lines.end();
  }

  /** A light: a bright core anyone sees by day (`core` meters across) and a halo for the night. */
  private light(x: number, y: number, z: number, core: number, halo: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0.01) return;
    this.cores.push(x, y, z, core, core, this.glowUv, 0, r, g, b, Math.min(1, a * 1.2));
    this.lights.push(x, y, z, halo, halo, this.glowUv, 0, r, g, b, a * 0.8);
  }

  /** The radio mast's red lamps blink, the top one brightest (a damaged mast's falter). */
  private lamps(sp: Special, stage: number, time: number, far: number): void {
    const phase = (time + sp.id * 0.37) % 1.6;
    const falter = stage > 0 && Math.sin(time * 23 + sp.id) > 0.6;
    const on = phase < 0.8 && !falter;
    sp.points.forEach((p, i) => {
      if (!on) return;
      const size = Math.max(i === 0 ? 1.6 : 1.2, far * (i === 0 ? 0.8 : 0.5));
      this.light(p.x, p.y, p.z, size, size * 3, 1, 0.12, 0.08, i === 0 ? 1 : 0.8);
    });
  }

  /** The gas station's lights over the pumps flicker, now and then all together (more when damaged). */
  private pumps(sp: Special, stage: number, time: number, far: number): void {
    const together = Math.sin(time * 1.7 + sp.id) > 0.92 ? 0.35 : 1;
    sp.points.forEach((p, i) => {
      const flick = Math.sin(time * (31 + i * 7) + i * 3.1 + sp.id) > (stage > 0 ? 0.2 : 0.75) ? 0.25 : 1;
      const size = Math.max(1.3, far * 0.35);
      this.light(p.x, p.y + 0.2, p.z, size, size * 2.5, 1, 0.92, 0.6, flick * together);
    });
    // A warm glow over the canopy, so the station reads from afar.
    const glow = Math.max(9, far * 1.4);
    this.lights.push(sp.s.x, sp.s.height + 2, sp.s.z, glow, glow, this.glowUv, 0, 1, 0.78, 0.4, 0.22 * together);
  }

  /** The substation hums under a blue glow and its insulators crackle (a damaged one, much more). */
  private crackle(sp: Special, stage: number, dt: number, time: number, far: number, dist: number, effects: Effects): void {
    const hum = 0.28 + 0.08 * Math.sin(time * 50 + sp.id) + 0.06 * Math.sin(time * 3.1);
    const glow = Math.max(12, far * 1.6);
    this.lights.push(sp.s.x, sp.s.height * 0.75, sp.s.z, glow, glow, this.glowUv, 0, 0.7, 0.85, 1, hum);
    for (const p of sp.points) {
      const a = 0.45 + 0.35 * Math.sin(time * 37 + p.x * 3);
      const size = Math.max(0.9, far * 0.25);
      this.light(p.x, p.y + 0.2, p.z, size, size * 2.5, 0.72, 0.88, 1, a);
    }
    sp.next -= dt;
    if (sp.next > 0 || sp.points.length < 2) return;
    sp.next = (stage > 0 ? 0.15 : 0.6) + this.rand() * (stage > 0 ? 0.4 : 1.4);
    // A crackle: a spark jumps between two insulators, with a flash of blue (close by: sparks too).
    const a = sp.points[Math.floor(this.rand() * sp.points.length)];
    let b = sp.points[Math.floor(this.rand() * sp.points.length)];
    if (a === b) b = sp.points[(sp.points.indexOf(a) + 1) % sp.points.length];
    this.arc(a.x, a.y, a.z, b.x, b.y, b.z, Math.max(0.15, far * 0.06), 1);
    effects.glowAt(a.x, a.y, a.z, Math.max(4, far * 0.6), 0xbfe4ff, 0.12, 0.9);
    // The flash of the crackle, bright enough for a sunny day, a little above the yard.
    const flash = Math.max(2.5, far * 1.0);
    this.cores.push(a.x, a.y + 0.6, a.z, flash, flash, this.glowUv, 0, 0.85, 0.95, 1, 1);
    if (dist < 220) effects.sparks(a.x, a.y, a.z, 1.2, 4, SPARK_BLUE, 0.4);
  }

  /** A jagged bolt from a to b as a few line segments (new kinks every frame). */
  private arc(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, alpha: number): void {
    const n = 6;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const jag = len * 0.12;
    let px = ax;
    let py = ay;
    let pz = az;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const off = i === n ? 0 : jag;
      const x = ax + (bx - ax) * f + (this.rand() - 0.5) * off;
      const y = ay + (by - ay) * f + (this.rand() - 0.5) * off;
      const z = az + (bz - az) * f + (this.rand() - 0.5) * off;
      this.lines.push(px, py, pz, x, y, z, width * 2.6, 0.55, 0.75, 1, alpha * 0.5);
      this.lines.push(px, py, pz, x, y, z, width, 0.92, 0.97, 1, alpha);
      px = x;
      py = y;
      pz = z;
    }
  }

  private updateBursts(dt: number, kaijus: readonly SnapKaiju[], effects: Effects): void {
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i];
      b.t += dt;
      const k = kaijus[b.kaiju];
      const sp = this.byId.get(b.structure);
      if (b.t > b.duration || !k || !sp) {
        this.bursts.splice(i--, 1);
        continue;
      }
      const st = kaijuStageDef(k.kind, k.stage);
      const fade = 1 - b.t / b.duration;
      // Three arcs at a time from the insulators to the monster's body, each flickering.
      const count = b.t < 0.5 ? 4 : 2;
      const from = sp.points.length > 0 ? sp.points : [this.tmp.set(sp.s.x, sp.s.height * 0.6, sp.s.z)];
      for (let j = 0; j < count; j++) {
        if (this.rand() < 0.25) continue;
        const p = from[Math.floor(this.rand() * from.length)];
        const a = this.rand() * Math.PI * 2;
        const tx = k.x + Math.sin(a) * st.bodyRadius * 0.6;
        const ty = st.height * (0.3 + this.rand() * 0.45);
        const tz = k.z + Math.cos(a) * st.bodyRadius * 0.6;
        const width = Math.max(0.15, st.height * 0.025);
        this.arc(p.x, p.y, p.z, tx, ty, tz, width, fade);
        if (this.rand() < 0.4) effects.glowAt(tx, ty, tz, st.bodyRadius * 2, 0xbfe4ff, 0.08, fade);
      }
    }
  }

  private updateBlazes(dt: number, effects: Effects): void {
    for (let i = 0; i < this.blazes.length; i++) {
      const b = this.blazes[i];
      b.t += dt;
      if (b.t > b.duration) {
        this.blazes.splice(i--, 1);
        continue;
      }
      const dying = Math.max(0, 1 - b.t / b.duration);
      b.fireTimer -= dt;
      if (b.fireTimer <= 0) {
        b.fireTimer = 0.12;
        const a = this.rand() * Math.PI * 2;
        const d = Math.sqrt(this.rand()) * b.radius;
        effects.fire(b.x + Math.cos(a) * d, 0, b.z + Math.sin(a) * d, b.radius * (0.35 + this.rand() * 0.35) * (0.4 + 0.6 * dying));
      }
      b.smokeTimer -= dt;
      if (b.smokeTimer <= 0) {
        b.smokeTimer = 0.3;
        // The column: black smoke rising high and spreading.
        effects.plume(b.x + (this.rand() - 0.5) * b.radius * 0.5, b.radius * 0.6, b.z + (this.rand() - 0.5) * b.radius * 0.5, b.radius * 0.8, 9, 0x2a2624, 6, 0.75 * (0.4 + 0.6 * dying));
      }
    }
  }
}
