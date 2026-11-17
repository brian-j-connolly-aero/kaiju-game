/**
 * The monster's line of sight on its own screen (docs/ROADMAP.md round 5: "when a shot, a volley
 * or an attack cannot reach because something is in the way, the screen must say so"). Pictures,
 * and one- or two-word labels beside them:
 *
 * - **What it cannot reach.** The controller (game/controllers/kaijuController.ts, `aim.warning`)
 *   says when a throw cannot get to the crosshair's point ('Too far', 'Blocked', 'Too close'), the
 *   beam is stopped by a building short of it ('Blocked'), or a charge's lane meets a building too
 *   tall to smash ('Too tall'). The word sits just under that point (kept on the screen), and,
 *   when it is what the crosshair is on (a throw, the beam), a red ring with a bar through it
 *   closes round the crosshair. The throw's preview turns red with it
 *   (render/throwPreview.ts), so red means the same thing everywhere.
 * - **Who hit it.** Every army shot that hits the monster: for two seconds a red ring over the
 *   squad that fired it, seen through any building in front, or, when it is off the screen, a red
 *   wedge on the screen's edge pointing at it. (Measured in bot matches, round 5: 60 to 76% of the
 *   hits came from squads more than 46 degrees off the view, and only charging volleys had a
 *   warning.)
 * - **Who is stunned.** A squad its roar stunned that a building hides: its stars, seen through
 *   the building, while the stun lasts.
 */

import { lineOfSight, unitTypeDef, type CityQuery, type SimEvent, type SnapUnit } from '@mb/shared';
import type { AimWarning } from '../render/throwPreview';
import { el } from './icons';
import { screenSpot, type ScreenSpot, type ThreatCamera } from './threats';

/** Seconds a hit's mark stays (it fades over the last of them). */
const HIT_TIME = 2;
/** Most hit marks at once (one per shooter), and stunned squads' stars. */
const HIT_POOL = 8;
const STAR_POOL = 10;
/** Shots remembered until they land (a squad fires a few a second; a shot lives a few seconds). */
const MAX_SHOTS = 600;

interface Shot {
  /** The unit that fired it, or -1 (artillery). */
  unit: number;
  x: number;
  y: number;
  z: number;
}

/** An army shot that hit the monster: who fired it (or -1), where from, and when (local seconds). */
export interface HitMark {
  unit: number;
  x: number;
  y: number;
  z: number;
  at: number;
}

/**
 * The army's shots that hit the monster lately, read from the simulation's events: every shot is
 * remembered from its `projectileSpawn` until its `projectileHit`, and one that hit the monster
 * leaves a mark for its shooter (one per shooter: a burst keeps it fresh) for HIT_TIME seconds.
 */
export class HitLog {
  private readonly shots = new Map<number, Shot>();
  readonly marks: HitMark[] = [];

  onEvent(e: SimEvent, now: number, kaiju: number): void {
    if (e.type === 'projectileSpawn') {
      if (e.owner === 'kaiju') return;
      if (this.shots.size >= MAX_SHOTS) {
        // Forget the oldest (a Map keeps the order things went in).
        const first = this.shots.keys().next();
        if (!first.done) this.shots.delete(first.value);
      }
      this.shots.set(e.id, { unit: e.owner === 'unit' ? e.ownerId : -1, x: e.x, y: e.y, z: e.z });
    } else if (e.type === 'projectileHit') {
      const shot = this.shots.get(e.id);
      if (!shot) return;
      this.shots.delete(e.id);
      if (e.target !== 'kaiju' || e.targetId !== kaiju || kaiju < 0) return;
      const same = shot.unit >= 0 ? this.marks.find((h) => h.unit === shot.unit) : undefined;
      if (same) {
        same.at = now;
        return;
      }
      if (this.marks.length >= HIT_POOL) this.marks.shift();
      this.marks.push({ unit: shot.unit, x: shot.x, y: shot.y, z: shot.z, at: now });
    }
  }

  /** Drops the marks older than HIT_TIME; returns those left. */
  live(now: number): readonly HitMark[] {
    for (let i = this.marks.length - 1; i >= 0; i--) if (now - this.marks[i].at > HIT_TIME) this.marks.splice(i, 1);
    return this.marks;
  }
}

interface Mark {
  root: HTMLElement;
  key: string;
}

/** Camera-space point of a world point (three.js matrices are column-major). */
function toCamera(m: ArrayLike<number>, x: number, y: number, z: number, out: { x: number; y: number; z: number }): void {
  out.x = m[0] * x + m[4] * y + m[8] * z + m[12];
  out.y = m[1] * x + m[5] * y + m[9] * z + m[13];
  out.z = m[2] * x + m[6] * y + m[10] * z + m[14];
}

export class KaijuSight {
  readonly root = el('div', 'kaiju-sight hidden');
  private readonly ring = el('div', 'sight-ring hidden');
  private readonly word = el('div', 'sight-word lbl hidden');
  private wordKey = '';
  private readonly hitMarks: Mark[] = [];
  private readonly starMarks: Mark[] = [];
  readonly hits = new HitLog();
  private readonly spot: ScreenSpot = { x: 0, y: 0, onScreen: false, angle: 0 };
  private readonly cam = { x: 0, y: 0, z: 0 };
  private readonly eye = { x: 0, y: 0, z: 0 };
  private readonly target = { x: 0, y: 0, z: 0 };
  /** Squads already marked this frame (one mark per squad, however many of its men hit). */
  private readonly marked = new Set<number>();

  constructor() {
    for (let i = 0; i < HIT_POOL; i++) {
      const root = el('div', 'sight-hit hidden', [el('div', 'sight-hit-wedge')]);
      this.hitMarks.push({ root, key: '' });
    }
    for (let i = 0; i < STAR_POOL; i++) {
      const root = el('div', 'sight-stars hidden', ['★★★']);
      this.starMarks.push({ root, key: '' });
    }
    this.root.append(...this.starMarks.map((m) => m.root), ...this.hitMarks.map((m) => m.root), this.ring, this.word);
  }

  /** A simulation event: army shots that hit `kaiju` (the local monster) are marked. */
  onEvent(e: SimEvent, now: number, kaiju: number): void {
    this.hits.onEvent(e, now, kaiju);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /**
   * Places everything for this frame, seen through `camera` (already placed). `warning`: what the
   * monster aims at and cannot reach, or null. `query`: the city, to tell which stunned squads a
   * building hides (null: none shown).
   */
  update(units: readonly SnapUnit[], camera: ThreatCamera & { position: { x: number; y: number; z: number } }, warning: AimWarning | null, query: CityQuery | null, now: number): void {
    this.root.classList.remove('hidden');
    const m = camera.matrixWorldInverse.elements;
    const fovY = (camera.fov * Math.PI) / 180;
    // What cannot be reached: the word under it, and the red ring round the crosshair.
    if (warning) {
      toCamera(m, warning.x, warning.y, warning.z, this.cam);
      const spot = screenSpot(this.cam.x, this.cam.y, this.cam.z, fovY, camera.aspect, 0.08, this.spot);
      const key = `${warning.word}:${spot.x.toFixed(3)}:${spot.y.toFixed(3)}:${warning.crosshair ? 1 : 0}`;
      if (key !== this.wordKey) {
        this.wordKey = key;
        this.word.textContent = warning.word;
        this.word.style.left = `${(spot.x * 100).toFixed(2)}%`;
        this.word.style.top = `${(spot.y * 100).toFixed(2)}%`;
        this.word.classList.remove('hidden');
        this.ring.classList.toggle('hidden', !warning.crosshair);
      }
    } else if (this.wordKey !== '') {
      this.wordKey = '';
      this.word.classList.add('hidden');
      this.ring.classList.add('hidden');
    }
    this.placeHits(units, m, fovY, camera.aspect, now);
    this.placeStars(units, m, fovY, camera.aspect, camera.position, query);
  }

  /** Who hit the monster in the last two seconds: a ring over the squad, or a wedge on the edge toward it. */
  private placeHits(units: readonly SnapUnit[], m: ArrayLike<number>, fovY: number, aspect: number, now: number): void {
    let used = 0;
    this.marked.clear();
    // Newest first: a squad's mark is where its latest shot came from.
    const live = this.hits.live(now);
    for (let i = live.length - 1; i >= 0; i--) {
      const h = live[i];
      // Where the shooter is now (it may have moved), else where the shot came from.
      const u = h.unit >= 0 ? (units[h.unit]?.id === h.unit ? units[h.unit] : units.find((v) => v.id === h.unit)) : undefined;
      if (u) {
        if (this.marked.has(u.squad)) continue;
        this.marked.add(u.squad);
      }
      const x = u && u.alive ? u.x : h.x;
      const y = u && u.alive ? u.y + unitTypeDef(u.type).height * 0.5 : h.y;
      const z = u && u.alive ? u.z : h.z;
      toCamera(m, x, y, z, this.cam);
      const spot = screenSpot(this.cam.x, this.cam.y, this.cam.z, fovY, aspect, 0.05, this.spot);
      const fade = Math.min(1, (HIT_TIME - (now - h.at)) / 0.6);
      const mark = this.hitMarks[used++];
      const key = `${spot.x.toFixed(3)}:${spot.y.toFixed(3)}:${spot.onScreen ? 1 : 0}:${spot.angle.toFixed(2)}:${fade.toFixed(2)}`;
      if (mark.key === key) continue;
      mark.key = key;
      const r = mark.root;
      r.classList.remove('hidden');
      r.classList.toggle('edge', !spot.onScreen);
      r.style.left = `${(spot.x * 100).toFixed(2)}%`;
      r.style.top = `${(spot.y * 100).toFixed(2)}%`;
      r.style.opacity = fade.toFixed(2);
      r.style.setProperty('--angle', `${spot.angle.toFixed(3)}rad`);
    }
    for (let i = used; i < this.hitMarks.length; i++) {
      const mark = this.hitMarks[i];
      if (mark.key === '') continue;
      mark.key = '';
      mark.root.classList.add('hidden');
    }
  }

  /** Stunned squads a building hides: their stars, over them, through the building. */
  private placeStars(units: readonly SnapUnit[], m: ArrayLike<number>, fovY: number, aspect: number, eye: { x: number; y: number; z: number }, query: CityQuery | null): void {
    let used = 0;
    if (query) {
      this.eye.x = eye.x;
      this.eye.y = eye.y;
      this.eye.z = eye.z;
      for (const u of units) {
        if (used >= this.starMarks.length) break;
        if (!u.alive || !u.stunned) continue;
        const def = unitTypeDef(u.type);
        this.target.x = u.x;
        this.target.y = u.y + def.height + 1;
        this.target.z = u.z;
        // In plain sight the stars over it are seen as they are.
        if (lineOfSight(query, this.eye, this.target)) continue;
        toCamera(m, this.target.x, this.target.y, this.target.z, this.cam);
        const spot = screenSpot(this.cam.x, this.cam.y, this.cam.z, fovY, aspect, 0.05, this.spot);
        if (!spot.onScreen) continue;
        const mark = this.starMarks[used++];
        const key = `${spot.x.toFixed(3)}:${spot.y.toFixed(3)}`;
        if (mark.key === key) continue;
        mark.key = key;
        mark.root.classList.remove('hidden');
        mark.root.style.left = `${(spot.x * 100).toFixed(2)}%`;
        mark.root.style.top = `${(spot.y * 100).toFixed(2)}%`;
      }
    }
    for (let i = used; i < this.starMarks.length; i++) {
      const mark = this.starMarks[i];
      if (mark.key === '') continue;
      mark.key = '';
      mark.root.classList.add('hidden');
    }
  }
}
