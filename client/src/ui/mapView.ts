/**
 * The top-down map (DESIGN.md section 5). It can be opened at any time and the game does not
 * pause. It shows the quarantine bounds, the streets, standing buildings and rubble, friendly
 * units, and the kaiju when the humans know where it is. A human can place a move-to marker
 * (click, or the confirm button) and, with artillery, a call-in (right click, or the call-in
 * button). North is up: +Z up the screen, which puts +X on the left, exactly as seen from above.
 *
 * Port Meridian is drawn as itself: each district's ground in its map tint (docs/CITY.md
 * section 2) with its name, the real road network, the river and the bay, bridges as roads over
 * the water, and every landmark as a small picture of its own model.
 */

import { kaijuStageDef, type Bounds, type CityData, type District, type SquadCommand } from '@mb/shared';
import type { ActionState } from '../game/input/actions';
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

export class MapView {
  readonly root = el('div', 'map hidden');
  open = false;
  /** Called when the player places a marker. */
  onCommand: ((command: SquadCommand) => void) | null = null;

  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private city: CityData | null = null;
  private cursorX = 0;
  private cursorZ = 0;
  private cursorSet = false;
  private view: Bounds = { minX: -1, minZ: -1, maxX: 1, maxZ: 1 };
  private frames = 0;
  private pendingClick: { x: number; y: number; button: number } | null = null;
  private pictureSource: (() => Map<string, HTMLCanvasElement>) | null = null;
  private pictures: Map<string, HTMLCanvasElement> | null = null;

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.root.append(this.canvas);
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pendingClick = { x: e.clientX - rect.left, y: e.clientY - rect.top, button: e.button };
      e.preventDefault();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const p = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      this.cursorX = p.x;
      this.cursorZ = p.z;
      this.cursorSet = true;
    });
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

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('hidden', !open);
    this.cursorSet = false;
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

  private toWorld(px: number, py: number): { x: number; z: number } {
    const v = this.view;
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? px / rect.width : 0;
    const sy = rect.height > 0 ? py / rect.height : 0;
    return { x: v.maxX - sx * (v.maxX - v.minX), z: v.maxZ - sy * (v.maxZ - v.minZ) };
  }

  private place(session: MatchSession, frame: FrameState, x: number, z: number, callIn: boolean): void {
    if (session.role.kind !== 'human') return;
    const squad = frame.squads[session.role.squadId];
    if (!squad || squad.eliminated) return;
    const b = frame.bounds;
    const cx = Math.min(b.maxX, Math.max(b.minX, x));
    const cz = Math.min(b.maxZ, Math.max(b.minZ, z));
    if (callIn) {
      if (squad.level >= 3) this.onCommand?.({ type: 'callIn', callIn: 'artillery', x: cx, z: cz });
    } else {
      this.onCommand?.({ type: 'moveTo', x: cx, z: cz });
    }
  }

  /** Handles input and redraws. Call every frame while the map is open. */
  update(frame: FrameState, session: MatchSession, input: ActionState, dt: number): void {
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
    if (!this.cursorSet) {
      const me = frame.localUnit ?? frame.localKaiju;
      this.cursorX = me ? me.x : (b.minX + b.maxX) / 2;
      this.cursorZ = me ? me.z : (b.minZ + b.maxZ) / 2;
      this.cursorSet = true;
    }
    // Gamepad or keys move a cursor (the map's +X is to the left).
    const speed = (b.maxX - b.minX) * 0.6 * dt;
    this.cursorX = Math.min(b.maxX, Math.max(b.minX, this.cursorX - input.moveX * speed));
    this.cursorZ = Math.min(b.maxZ, Math.max(b.minZ, this.cursorZ + input.moveZ * speed));
    if (input.pressed.confirm) this.place(session, frame, this.cursorX, this.cursorZ, false);
    if (input.pressed.callIn) this.place(session, frame, this.cursorX, this.cursorZ, true);
    if (this.pendingClick) {
      const p = this.toWorld(this.pendingClick.x, this.pendingClick.y);
      this.place(session, frame, p.x, p.z, this.pendingClick.button === 2);
      this.pendingClick = null;
    }
    // A full redraw a few times a second is plenty.
    if (this.frames++ % 4 === 0) this.draw(frame, session);
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
      ctx.fillStyle = ZONE_GROUND[d.zone] ?? COLORS.land;
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

    // Squad markers: where the local squad was told to go.
    const own = frame.squads[session.role.squadId];
    if (own && own.moveOrder === 'moveTo') {
      const m = this.toMap(own.moveTargetX, own.moveTargetZ);
      ctx.strokeStyle = COLORS.human;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
      ctx.moveTo(m.x - 13, m.y);
      ctx.lineTo(m.x + 13, m.y);
      ctx.moveTo(m.x, m.y - 13);
      ctx.lineTo(m.x, m.y + 13);
      ctx.stroke();
    }

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

    // Cursor.
    const cm = this.toMap(this.cursorX, this.cursorZ);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cm.x - 10, cm.y);
    ctx.lineTo(cm.x - 3, cm.y);
    ctx.moveTo(cm.x + 3, cm.y);
    ctx.lineTo(cm.x + 10, cm.y);
    ctx.moveTo(cm.x, cm.y - 10);
    ctx.lineTo(cm.x, cm.y - 3);
    ctx.moveTo(cm.x, cm.y + 3);
    ctx.lineTo(cm.x, cm.y + 10);
    ctx.stroke();
  }
}
