/**
 * The top-down map (DESIGN.md section 5). It can be opened at any time and the game does not
 * pause. It shows the quarantine bounds, the streets, standing buildings and rubble, friendly
 * units, and the kaiju when the humans know where it is. North is up: +Z up the screen, which
 * puts +X on the left, exactly as seen from above. It is a view only: nothing is placed on it
 * (the map orders went with the command wheel, docs/ROADMAP.md phase 1).
 *
 * Port Meridian is drawn as itself: each district's ground in its map tint (docs/CITY.md
 * section 2) with its name, the real road network, the river and the bay, bridges as roads over
 * the water, and every landmark as a small picture of its own model.
 *
 * Phase 2: the army's supply crates show as the picture of what they hold. While a fallen radio
 * mast's static lasts (`match.staticUntil`), the squads' map shows nothing but animated static.
 */

import { kaijuStageDef, PICKUP_IDS, type Bounds, type CityData, type District, type PickupKind } from '@mb/shared';
import type { FrameState, MatchSession } from '../net/matchSession';
import { el } from './icons';

const COLORS = {
  background: '#141926',
  outside: '#0c0f18',
  land: '#252c3d',
  road: '#414a63',
  water: '#235a96',
  park: '#27583a',
  plaza: '#4a4638',
  standing: '#9aa7bd',
  damaged: '#c98f5a',
  rubble: '#4c4f58',
  bounds: '#ff3b5c',
  human: '#1ec8e0',
  kaiju: '#ff7a1a',
  volley: '#ffd91a',
  bridge: '#6b7590',
  districtName: 'rgba(232, 238, 250, 0.8)',
};

/** District ground on the map, by zone: the map tints of docs/CITY.md section 2, darkened for a night-blue map. */
/**
 * Whether a player of this role sees static on the map at this tick: the squads (and nobody
 * else) while a fallen radio mast's static lasts (DESIGN.md section 7, "Special buildings").
 */
export function mapShowsStatic(role: 'kaiju' | 'human' | 'spectator', tick: number, staticUntil: number): boolean {
  return role === 'human' && staticUntil > 0 && tick < staticUntil;
}

/** Frames of static, made once and shown in turn. */
const STATIC_FRAMES = 4;
const STATIC_SIZE = 128;

const ZONE_GROUND: Record<District['zone'], string> = {
  downtown: '#2b3653',
  oldtown: '#3b3426',
  temple: '#3e2c35',
  suburb: '#25392c',
  university: '#33304c',
  industrial: '#37302a',
  harbor: '#273643',
  boardwalk: '#41302a',
};

/**
 * A district's ground on the map: its roof color (phase 3, roofs colored by district), sunk into
 * the night-blue map, so each district, and each starting neighborhood, is its own place on the
 * map as it is from the monster's height. The buildings on it keep the colors of their state.
 * A district without a roof color keeps its zone's ground.
 */
export function districtGround(d: Pick<District, 'zone' | 'roof'>): string {
  const roof = d.roof;
  if (roof === undefined) return ZONE_GROUND[d.zone] ?? COLORS.land;
  const mix = (shift: number, dark: number): number => Math.round(dark + (((roof >> shift) & 255) - dark) * 0.38);
  const r = mix(16, 0x1e);
  const g = mix(8, 0x23);
  const b = mix(0, 0x30);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export class MapView {
  readonly root = el('div', 'map hidden');
  open = false;

  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private city: CityData | null = null;
  private view: Bounds = { minX: -1, minZ: -1, maxX: 1, maxZ: 1 };
  private frames = 0;
  private pictureSource: (() => Map<string, HTMLCanvasElement>) | null = null;
  private pictures: Map<string, HTMLCanvasElement> | null = null;
  /** The pick-ups' pictures for the crates (cyan, decoded once they are asked for). */
  private readonly pickups = new Map<PickupKind, HTMLImageElement>();
  private noise: HTMLCanvasElement[] = [];
  /** True while the map shows static (for the sound of it, and the automation hook). */
  staticShown = false;

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.root.append(this.canvas);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setCity(city: CityData): void {
    this.city = city;
    this.pictures = null;
  }

  /** Where the landmark pictures come from (asked once, when the map is first drawn). */
  setLandmarkPictures(source: () => Map<string, HTMLCanvasElement>): void {
    this.pictureSource = source;
    this.pictures = null;
  }

  /** Where the pick-ups' pictures come from (each asked for once). */
  setPickupPictures(source: (kind: PickupKind) => Promise<HTMLImageElement | null>): void {
    for (const kind of PICKUP_IDS) {
      if (kind === 'none') continue;
      void source(kind).then((img) => {
        if (img) this.pickups.set(kind, img);
      });
    }
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('hidden', !open);
    this.frames = 0;
  }

  private size(): number {
    return this.canvas.width;
  }

  private toMap(x: number, z: number): { x: number; y: number } {
    const v = this.view;
    const s = this.size();
    return { x: ((v.maxX - x) / (v.maxX - v.minX)) * s, y: ((v.maxZ - z) / (v.maxZ - v.minZ)) * s };
  }

  /** Redraws. Call every frame while the map is open. */
  update(frame: FrameState, session: MatchSession): void {
    if (!this.open || !this.city) return;
    // Fit the canvas to the smaller side of the window.
    const side = Math.max(200, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.84));
    if (this.canvas.width !== side) {
      this.canvas.width = side;
      this.canvas.height = side;
      this.frames = 0;
    }
    // The playable square plus a margin.
    const b = frame.bounds;
    const pad = (b.maxX - b.minX) * 0.08;
    this.view = { minX: b.minX - pad, minZ: b.minZ - pad, maxX: b.maxX + pad, maxZ: b.maxZ + pad };
    // Static (a radio mast fell): nothing but the noise, a new frame of it every frame.
    this.staticShown = mapShowsStatic(session.role.kind, frame.tick, frame.match.staticUntil);
    if (this.staticShown) {
      this.drawStatic(this.frames++);
      return;
    }
    // A full redraw a few times a second is plenty.
    if (this.frames++ % 4 === 0) this.draw(frame, session);
  }

  /**
   * The map's static: grey snow, rolling bands and a dark frame. It says "no signal" without a
   * word: nothing on it is the city, the squads or the kaiju.
   */
  private drawStatic(n: number): void {
    const ctx = this.ctx;
    const s = this.size();
    if (this.noise.length === 0) {
      let seed = 12345;
      for (let f = 0; f < STATIC_FRAMES; f++) {
        const c = document.createElement('canvas');
        c.width = STATIC_SIZE;
        c.height = STATIC_SIZE;
        const pen = c.getContext('2d');
        if (!pen) break;
        const img = pen.createImageData(STATIC_SIZE, STATIC_SIZE);
        for (let i = 0; i < img.data.length; i += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const v = 30 + ((seed >>> 24) * 190) / 255;
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v + 8;
          img.data[i + 3] = 255;
        }
        pen.putImageData(img, 0, 0);
        this.noise.push(c);
      }
    }
    const noise = this.noise[n % this.noise.length];
    if (!noise) return;
    ctx.imageSmoothingEnabled = false;
    // Shifted a little every frame so the snow never stands still.
    const shift = (n * 37) % STATIC_SIZE;
    const cell = s / STATIC_SIZE;
    ctx.save();
    ctx.translate(-shift * cell, 0);
    ctx.drawImage(noise, 0, 0, s, s);
    ctx.drawImage(noise, s, 0, s, s);
    ctx.restore();
    // Two bands rolling down it, and the screen's dark edge.
    for (let b = 0; b < 2; b++) {
      const y = (((n * 6 + b * s * 0.5) % s) + s) % s;
      ctx.fillStyle = b === 0 ? 'rgba(255, 255, 255, 0.13)' : 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(0, y, s, s * 0.06);
    }
    const edge = ctx.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.75);
    edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
    edge.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, s, s);
    ctx.imageSmoothingEnabled = true;
  }

  private draw(frame: FrameState, session: MatchSession): void {
    const ctx = this.ctx;
    const city = this.city as CityData;
    const s = this.size();
    const v = this.view;
    const scale = s / (v.maxX - v.minX);
    const inView = (x: number, z: number, r: number): boolean => x + r > v.minX && x - r < v.maxX && z + r > v.minZ && z - r < v.maxZ;

    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, s, s);
    const c0 = this.toMap(city.half, city.half);
    const c1 = this.toMap(-city.half, -city.half);
    ctx.fillStyle = COLORS.land;
    ctx.fillRect(c0.x, c0.y, c1.x - c0.x, c1.y - c0.y);
    const polygon = (points: readonly { x: number; z: number }[]): void => {
      ctx.beginPath();
      points.forEach((p, i) => {
        const m = this.toMap(p.x, p.z);
        if (i === 0) ctx.moveTo(m.x, m.y);
        else ctx.lineTo(m.x, m.y);
      });
      ctx.closePath();
    };
    for (const d of city.districts) {
      ctx.fillStyle = districtGround(d);
      polygon(d.polygon);
      ctx.fill();
    }

    for (const area of city.areas) {
      ctx.fillStyle = area.kind === 'water' ? COLORS.water : area.kind === 'park' ? COLORS.park : COLORS.plaza;
      polygon(area.polygon);
      ctx.fill();
    }

    ctx.strokeStyle = COLORS.road;
    ctx.lineCap = 'square';
    for (const edge of city.roads.edges) {
      const a = city.roads.nodes[edge.a];
      const b = city.roads.nodes[edge.b];
      if (!a || !b || (!inView(a.x, a.z, 20) && !inView(b.x, b.z, 20))) continue;
      const ma = this.toMap(a.x, a.z);
      const mb = this.toMap(b.x, b.z);
      ctx.lineWidth = Math.max(1, edge.width * scale);
      ctx.beginPath();
      ctx.moveTo(ma.x, ma.y);
      ctx.lineTo(mb.x, mb.y);
      ctx.stroke();
    }

    const stages = session.mirror.structureStage;
    for (const st of city.structures) {
      const r = Math.max(st.hx, st.hz) * 1.5;
      if (!inView(st.x, st.z, r)) continue;
      const stage = stages[st.id];
      ctx.fillStyle = stage >= 3 ? COLORS.rubble : stage > 0 ? COLORS.damaged : st.cls === 'bridge' ? COLORS.bridge : COLORS.standing;
      const m = this.toMap(st.x, st.z);
      const w = Math.max(1.5, st.hx * 2 * scale);
      const h = Math.max(1.5, st.hz * 2 * scale);
      if (Math.abs(Math.sin(st.yaw)) < 0.01 || scale < 0.4) {
        ctx.fillRect(m.x - w / 2, m.y - h / 2, w, h);
      } else {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(-st.yaw);
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }
    }

    // Landmarks: a picture of each one's own model, faded once it has fallen.
    if (!this.pictures && this.pictureSource) this.pictures = this.pictureSource();
    const pictures = this.pictures;
    if (pictures && pictures.size > 0) {
      for (const st of city.structures) {
        if (st.landmark === null) continue;
        const picture = pictures.get(st.archetype);
        if (!picture) continue;
        const r = Math.max(st.hx, st.hz);
        if (!inView(st.x, st.z, r)) continue;
        const m = this.toMap(st.x, st.z);
        const side = Math.min(64, Math.max(30, r * 2 * scale * 1.2));
        ctx.globalAlpha = stages[st.id] >= 3 ? 0.35 : 1;
        ctx.drawImage(picture, m.x - side / 2, m.y - side / 2, side, side);
        ctx.globalAlpha = 1;
      }
    }

    // District names (names are the only words in the game), faint, under everything that moves:
    // in the middle of the district's box, broken into lines to fit its width.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const d of city.districts) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of d.polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      const x = (minX + maxX) / 2;
      const z = (minZ + maxZ) / 2;
      if (!inView(x, z, 0)) continue;
      const width = (maxX - minX) * scale * 0.9;
      const size = Math.round(Math.min(15, Math.max(9, scale * 26)));
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      const lines: string[] = [];
      for (const word of d.name.toUpperCase().split(' ')) {
        const last = lines.length - 1;
        if (last >= 0 && ctx.measureText(`${lines[last]} ${word}`).width <= width) lines[last] = `${lines[last]} ${word}`;
        else lines.push(word);
      }
      const m = this.toMap(x, z);
      lines.forEach((line, i) => {
        const y = m.y + (i - (lines.length - 1) / 2) * size * 1.1;
        ctx.strokeStyle = 'rgba(12, 15, 24, 0.85)';
        ctx.lineWidth = 3;
        ctx.strokeText(line, m.x, y);
        ctx.fillStyle = COLORS.districtName;
        ctx.fillText(line, m.x, y);
      });
    }

    // Quarantine line.
    const b = frame.bounds;
    const b0 = this.toMap(b.maxX, b.maxZ);
    const b1 = this.toMap(b.minX, b.minZ);
    ctx.strokeStyle = COLORS.bounds;
    ctx.lineWidth = 2;
    ctx.strokeRect(b0.x, b0.y, b1.x - b0.x, b1.y - b0.y);

    // Units: cyan circles, yellow diamonds while charging. The kaiju player sees only the lasers.
    const viewerIsKaiju = session.role.kind === 'kaiju';
    for (const u of frame.units) {
      if (!u.alive) continue;
      if (viewerIsKaiju && !u.laser) continue;
      const m = this.toMap(u.x, u.z);
      const mine = u.squad === session.role.squadId;
      const r = u.driven ? 6 : 4.5;
      if (u.laser) {
        ctx.fillStyle = COLORS.volley;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - r - 2);
        ctx.lineTo(m.x + r + 1, m.y);
        ctx.lineTo(m.x, m.y + r + 2);
        ctx.lineTo(m.x - r - 1, m.y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = COLORS.human;
        ctx.globalAlpha = mine ? 1 : 0.6;
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (u.driven && mine) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.x, m.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Supply crates (the squads' map): the picture of what each holds in a dark disc; faint
    // while it is still coming down.
    if (!viewerIsKaiju) {
      for (const c of frame.crates) {
        const m = this.toMap(c.x, c.z);
        const r = 11;
        ctx.globalAlpha = c.fall > 0 ? 0.55 : 1;
        ctx.fillStyle = 'rgba(10, 18, 30, 0.85)';
        ctx.strokeStyle = COLORS.human;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const img = this.pickups.get(c.kind);
        if (img) ctx.drawImage(img, m.x - r * 0.75, m.y - r * 0.75, r * 1.5, r * 1.5);
        ctx.globalAlpha = 1;
      }
    }

    // The kaiju: an orange triangle pointing where it faces, when the viewer may know.
    for (const k of frame.kaijus) {
      const visible = k.alive && (viewerIsKaiju || session.role.kind === 'spectator' || k.known);
      if (!visible) continue;
      const m = this.toMap(k.x, k.z);
      const r = Math.max(9, kaijuStageDef(k.kind, k.stage).bodyRadius * scale * 1.4);
      ctx.save();
      ctx.translate(m.x, m.y);
      // Heading: yaw 0 is +Z, which is up the map; +X is to the left.
      ctx.rotate(-k.yaw);
      ctx.fillStyle = COLORS.kaiju;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.3);
      ctx.lineTo(r, r);
      ctx.lineTo(-r, r);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
