/**
 * The top-down map (DESIGN.md section 5). It can be opened at any time and the game does not
 * pause. It shows the quarantine bounds, the streets, standing buildings and rubble, friendly
 * units, and the kaiju when the humans know where it is. North is up: +Z up the screen, which
 * puts +X on the left, exactly as seen from above.
 *
 * Orders on the map (polish pass 2: "placing an order on the map should be left click"): a
 * left click places the order picked at the map's side. That is the move-to marker unless the
 * artillery has been picked (a click on its picture, or the call-in button); the guns are
 * then called with the next left click and the picker goes back to move-to. The confirm
 * button (A on a controller, Space) places the picked order at the map cursor, which the stick
 * or the movement keys move. A right click still calls the guns at once.
 *
 * Port Meridian is drawn as itself: each district's ground in its map tint (docs/CITY.md
 * section 2) with its name, the real road network, the river and the bay, bridges as roads over
 * the water, and every landmark as a small picture of its own model.
 */

import { callInDef, factionLevelDef, inSmoke, kaijuStageDef, type Bounds, type CityData, type District, type SnapSquad, type SquadCommand } from '@mb/shared';
import type { ActionState } from '../game/input/actions';
import type { FrameState, MatchSession } from '../net/matchSession';
import { el, icon } from './icons';

/** The orders a left click on the map can place. */
export type MapTool = 'moveTo' | 'callIn';

/**
 * The order a click on the map places: the left button (0) places the picked order, the right
 * button (2) calls the guns at once; anything else, or the guns without any, places nothing.
 */
export function mapOrderFor(button: number, tool: MapTool, guns: boolean): MapTool | null {
  const order: MapTool | null = button === 0 ? tool : button === 2 ? 'callIn' : null;
  return order === 'callIn' && !guns ? null : order;
}

/** Whether a squad has artillery to call at this level (stage 3). */
function hasCallIn(squad: SnapSquad | undefined): boolean {
  return !!squad && !squad.eliminated && factionLevelDef(squad.faction, squad.level).callIns.length > 0;
}

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
  smoke: 'rgba(214, 218, 224, 0.55)',
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
  /** The order the next left click (or the confirm button) places. */
  tool: MapTool = 'moveTo';

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
  /** The order picker at the map's side: a picture per order, the picked one lit. */
  private readonly tools = el('div', 'map-tools');
  private readonly toolButtons: Record<MapTool, HTMLElement>;
  private callInRadius = 28;

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.toolButtons = {
      moveTo: el('div', 'map-tool map-tool-moveto on', [icon('cmd_moveto')]),
      callIn: el('div', 'map-tool map-tool-callin', [icon('st_callin'), el('div', 'map-tool-cover')]),
    };
    for (const id of ['moveTo', 'callIn'] as const) {
      const button = this.toolButtons[id];
      button.dataset.tool = id;
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.pick(id);
      });
      this.tools.append(button);
    }
    this.root.append(this.canvas, this.tools);
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
    this.pick('moveTo');
  }

  /** Picks the order the next left click places. */
  pick(tool: MapTool): void {
    this.tool = tool;
    for (const id of ['moveTo', 'callIn'] as const) this.toolButtons[id].classList.toggle('on', id === tool);
    this.canvas.classList.toggle('calling', tool === 'callIn');
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
      const callIns = factionLevelDef(squad.faction, squad.level).callIns;
      if (callIns.length > 0) this.onCommand?.({ type: 'callIn', callIn: callIns[0], x: cx, z: cz });
      // One call and the picker goes back to the squad's own marker.
      this.pick('moveTo');
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
    // The order picker: the artillery only when the squad has it (stage 3).
    const own = session.role.kind === 'human' ? frame.squads[session.role.squadId] : undefined;
    const guns = hasCallIn(own);
    this.toolButtons.callIn.classList.toggle('hidden', !guns);
    this.tools.classList.toggle('hidden', !guns);
    if (!guns && this.tool === 'callIn') this.pick('moveTo');
    if (guns && own) {
      const id = factionLevelDef(own.faction, own.level).callIns[0];
      const def = id ? callInDef(id) : null;
      this.callInRadius = def ? def.scatterRadius : this.callInRadius;
      const wait = def ? own.callInCooldowns[0] / def.cooldown : 0;
      const cover = this.toolButtons.callIn.lastElementChild as HTMLElement;
      const height = `${Math.round(Math.min(1, Math.max(0, wait)) * 100)}%`;
      if (cover.style.height !== height) cover.style.height = height;
    }
    // The call-in button picks the guns; the confirm button places the picked order at the cursor.
    if (input.pressed.callIn && guns) this.pick('callIn');
    if (input.pressed.confirm) this.place(session, frame, this.cursorX, this.cursorZ, this.tool === 'callIn');
    if (this.pendingClick) {
      const p = this.toWorld(this.pendingClick.x, this.pendingClick.y);
      // Left click: the picked order. Right click: the guns, at once.
      const order = mapOrderFor(this.pendingClick.button, this.tool, guns);
      if (order) this.place(session, frame, p.x, p.z, order === 'callIn');
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

    // Smoke: grey clouds (the kaiju sees them too: it sees the smoke, not who is in it).
    for (const c of frame.smokes) {
      const m = this.toMap(c.x, c.z);
      ctx.fillStyle = COLORS.smoke;
      ctx.beginPath();
      ctx.arc(m.x, m.y, Math.max(4, c.radius * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // Units: cyan circles, yellow diamonds while charging. The kaiju player sees only the lasers,
    // and not those of guns standing in smoke.
    const viewerIsKaiju = session.role.kind === 'kaiju';
    for (const u of frame.units) {
      if (!u.alive) continue;
      if (viewerIsKaiju && (!u.laser || inSmoke(frame.smokes, u.x, u.z))) continue;
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
      // Marked by a squad: a ring round it for the army (the kaiju player is not told).
      if (k.marked && !viewerIsKaiju) {
        ctx.strokeStyle = COLORS.kaiju;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(m.x, m.y, r * 1.9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Cursor. With the guns picked, the circle the shells will fall in.
    const cm = this.toMap(this.cursorX, this.cursorZ);
    if (this.tool === 'callIn') {
      ctx.strokeStyle = COLORS.volley;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(cm.x, cm.y, Math.max(8, this.callInRadius * scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
