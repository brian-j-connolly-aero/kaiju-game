/**
 * npx tsx shared/scripts/cityMap.ts [--city meridian|placeholder] [--out DIR] [--only NAME[,NAME]]
 *
 * Draws pictures of a city for people to look at (docs/CITY.md): the whole map colored by
 * district, a value heat map, the stage 1 and stage 2 squares of every neighborhood anchor,
 * a close-up of each district at 1 m per pixel, and an oblique "architect's model" of the whole
 * city as extruded boxes. Plain PNG files, written with node:zlib; no dependencies.
 *
 * North is up and +X is to the LEFT, exactly as the in-game map shows the city.
 *
 * Pictures (in --out, default docs/city): map.png, heat.png, anchors.png, roads.png,
 * model.png, model_downtown.png, district_<name>.png, anchor_<name>.png.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  generateCity,
  generatePortMeridian,
  PROP_KINDS,
  stageBounds,
  valueInBounds,
  type Bounds,
  type CityData,
  type Structure,
  type Vec2,
  type ZoneTag,
} from '../src/index';

// ---------------------------------------------------------------------------------------------
// A tiny canvas
// ---------------------------------------------------------------------------------------------

type RGB = readonly [number, number, number];

class Canvas {
  readonly data: Uint8Array;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.data[i * 3] = bg[0];
      this.data[i * 3 + 1] = bg[1];
      this.data[i * 3 + 2] = bg[2];
    }
  }

  set(x: number, y: number, c: RGB, alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    if (alpha >= 1) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
    } else {
      this.data[i] = Math.round(this.data[i] * (1 - alpha) + c[0] * alpha);
      this.data[i + 1] = Math.round(this.data[i + 1] * (1 - alpha) + c[1] * alpha);
      this.data[i + 2] = Math.round(this.data[i + 2] * (1 - alpha) + c[2] * alpha);
    }
  }

  /** Even-odd fill of a polygon given in pixels. */
  poly(pts: ReadonlyArray<readonly [number, number]>, c: RGB, alpha = 1): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if (a[1] <= yc === b[1] <= yc) continue;
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
        const x1 = Math.min(this.w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
        for (let x = x0; x <= x1; x++) this.set(x, y, c, alpha);
      }
    }
  }

  /** A line of the given width in pixels (drawn as a filled quad, at least one pixel wide). */
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB, alpha = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return;
    const w = Math.max(width, 1) / 2;
    const nx = (-dy / l) * w;
    const ny = (dx / l) * w;
    this.poly(
      [
        [x0 + nx, y0 + ny],
        [x1 + nx, y1 + ny],
        [x1 - nx, y1 - ny],
        [x0 - nx, y0 - ny],
      ],
      c,
      alpha,
    );
  }

  outline(pts: ReadonlyArray<readonly [number, number]>, width: number, c: RGB, alpha = 1): void {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) this.line(pts[j][0], pts[j][1], pts[i][0], pts[i][1], width, c, alpha);
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, alpha = 1): void {
    this.poly(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      c,
      alpha,
    );
  }

  disc(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy) <= r * r) this.set(x, y, c, alpha);
      }
    }
  }

  /** Text in a 5 x 7 pixel font, scaled; (x, y) is the top left corner. A dark halo keeps it readable. */
  text(x: number, y: number, text: string, c: RGB, scale = 1, halo: RGB | null = [255, 255, 255]): void {
    const draw = (ox: number, oy: number, col: RGB): void => {
      let cx = x + ox;
      for (const ch of text.toUpperCase()) {
        const glyph = FONT[ch] ?? FONT['?'];
        for (let r = 0; r < 7; r++) {
          for (let k = 0; k < 5; k++) {
            if (glyph[r][k] !== '#') continue;
            for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.set(cx + k * scale + sx, y + oy + r * scale + sy, col);
          }
        }
        cx += 6 * scale;
      }
    };
    if (halo) {
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox !== 0 || oy !== 0) draw(ox, oy, halo);
    }
    draw(0, 0, c);
  }

  save(file: string): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, encodePng(this.w, this.h, this.data));
  }
}

function textWidth(text: string, scale = 1): number {
  return text.length * 6 * scale - scale;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  head[8] = 8; // bit depth
  head[9] = 2; // RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const FONT: Record<string, string[]> = {};
{
  const rows = (s: string): string[] => s.split('/');
  const glyphs: Record<string, string> = {
    A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
    B: '####./#...#/#...#/####./#...#/#...#/####.',
    C: '.###./#...#/#..../#..../#..../#...#/.###.',
    D: '####./#...#/#...#/#...#/#...#/#...#/####.',
    E: '#####/#..../#..../####./#..../#..../#####',
    F: '#####/#..../#..../####./#..../#..../#....',
    G: '.###./#...#/#..../#.###/#...#/#...#/.###.',
    H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
    I: '.###./..#../..#../..#../..#../..#../.###.',
    J: '..###/...#./...#./...#./...#./#..#./.##..',
    K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
    L: '#..../#..../#..../#..../#..../#..../#####',
    M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
    N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
    O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
    P: '####./#...#/#...#/####./#..../#..../#....',
    Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
    R: '####./#...#/#...#/####./#.#../#..#./#...#',
    S: '.####/#..../#..../.###./....#/....#/####.',
    T: '#####/..#../..#../..#../..#../..#../..#..',
    U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
    V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
    W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
    X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
    Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
    Z: '#####/....#/...#./..#../.#.../#..../#####',
    '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
    '1': '..#../.##../..#../..#../..#../..#../.###.',
    '2': '.###./#...#/....#/...#./..#../.#.../#####',
    '3': '####./....#/....#/.###./....#/....#/####.',
    '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
    '5': '#####/#..../####./....#/....#/#...#/.###.',
    '6': '.###./#..../#..../####./#...#/#...#/.###.',
    '7': '#####/....#/...#./..#../.#.../.#.../.#...',
    '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
    '9': '.###./#...#/#...#/.####/....#/....#/.###.',
    ' ': '...../...../...../...../...../...../.....',
    '.': '...../...../...../...../...../.##../.##..',
    ',': '...../...../...../...../.##../..#../.#...',
    ':': '...../.##../.##../...../.##../.##../.....',
    '-': '...../...../...../#####/...../...../.....',
    '/': '....#/...#./...#./..#../.#.../.#.../#....',
    '%': '##..#/##.#./...#./..#../.#.../.#.##/#..##',
    '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
    ')': '.#.../..#../...#./...#./...#./..#../.#...',
    "'": '..#../..#../...../...../...../...../.....',
    '?': '.###./#...#/....#/...#./..#../...../..#..',
    '+': '...../..#../..#../#####/..#../..#../.....',
    '=': '...../...../#####/...../#####/...../.....',
  };
  for (const [k, v] of Object.entries(glyphs)) FONT[k] = rows(v);
}

// ---------------------------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------------------------

const ZONE_TINT: Record<ZoneTag, RGB> = {
  downtown: [214, 222, 235],
  oldtown: [240, 221, 196],
  harbor: [206, 226, 228],
  industrial: [226, 214, 208],
  suburb: [226, 238, 212],
  university: [232, 222, 240],
  boardwalk: [250, 232, 214],
  temple: [244, 226, 226],
};
const ZONE_INK: Record<ZoneTag, RGB> = {
  downtown: [60, 90, 150],
  oldtown: [170, 100, 40],
  harbor: [30, 120, 130],
  industrial: [130, 80, 60],
  suburb: [70, 130, 50],
  university: [120, 70, 160],
  boardwalk: [220, 110, 40],
  temple: [180, 50, 70],
};
const CLASS_COLOR: Record<string, RGB> = {
  house: [214, 120, 88],
  shop: [226, 176, 60],
  apartment: [200, 140, 150],
  office: [110, 140, 190],
  tower: [60, 80, 150],
  factory: [140, 110, 96],
  bridge: [90, 90, 100],
  landmark: [214, 40, 60],
};
const LAND: RGB = [236, 234, 226];
const WATER: RGB = [112, 170, 222];
const PARK: RGB = [150, 204, 130];
const PLAZA: RGB = [236, 220, 176];
const ROAD: RGB = [250, 250, 250];
const ROAD_EDGE: RGB = [150, 150, 158];
const INK: RGB = [30, 30, 40];

function shade(c: RGB, k: number): RGB {
  return [Math.max(0, Math.min(255, Math.round(c[0] * k))), Math.max(0, Math.min(255, Math.round(c[1] * k))), Math.max(0, Math.min(255, Math.round(c[2] * k)))];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

// ---------------------------------------------------------------------------------------------
// Top-down views
// ---------------------------------------------------------------------------------------------

interface View {
  /** World rectangle shown. */
  b: Bounds;
  /** Pixels per meter. */
  scale: number;
  canvas: Canvas;
}

function makeView(b: Bounds, scale: number, bg: RGB = LAND): View {
  return { b, scale, canvas: new Canvas(Math.round((b.maxX - b.minX) * scale), Math.round((b.maxZ - b.minZ) * scale), bg) };
}

/** World to pixel: +X to the left, +Z up. */
function px(v: View, x: number, z: number): [number, number] {
  return [(v.b.maxX - x) * v.scale, (v.b.maxZ - z) * v.scale];
}

function polyPx(v: View, polygon: readonly Vec2[]): Array<[number, number]> {
  return polygon.map((p) => px(v, p.x, p.z));
}

function corners(s: Structure): Vec2[] {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const out: Vec2[] = [];
  const lx = [-s.hx, s.hx, s.hx, -s.hx];
  const lz = [-s.hz, -s.hz, s.hz, s.hz];
  for (let i = 0; i < 4; i++) out.push({ x: s.x + lx[i] * c + lz[i] * sn, z: s.z - lx[i] * sn + lz[i] * c });
  return out;
}

interface DrawOptions {
  tint?: boolean;
  props?: boolean;
  labels?: boolean;
  anchors?: boolean;
  dim?: boolean;
}

function drawGround(v: View, city: CityData, o: DrawOptions): void {
  const c = v.canvas;
  if (o.tint) for (const d of city.districts) c.poly(polyPx(v, d.polygon), ZONE_TINT[d.zone]);
  for (const a of city.areas) if (a.kind === 'plaza') c.poly(polyPx(v, a.polygon), PLAZA);
  for (const a of city.areas) if (a.kind === 'park') c.poly(polyPx(v, a.polygon), PARK);
  for (const a of city.areas) if (a.kind === 'water') c.poly(polyPx(v, a.polygon), WATER);
}

function drawRoads(v: View, city: CityData): void {
  const c = v.canvas;
  const { nodes, edges } = city.roads;
  for (let pass = 0; pass < 2; pass++) {
    for (const e of edges) {
      const a = px(v, nodes[e.a].x, nodes[e.a].z);
      const b = px(v, nodes[e.b].x, nodes[e.b].z);
      const w = e.width * v.scale;
      if (pass === 0) c.line(a[0], a[1], b[0], b[1], w + 2, e.kind === 'bridge' ? INK : ROAD_EDGE);
      else c.line(a[0], a[1], b[0], b[1], Math.max(w, 1), e.kind === 'bridge' ? [255, 226, 150] : e.kind === 'avenue' ? ROAD : [244, 244, 240]);
    }
    if (pass === 1) {
      for (const e of edges) {
        for (const id of [e.a, e.b]) {
          const p = px(v, nodes[id].x, nodes[id].z);
          c.disc(p[0], p[1], (e.width * v.scale) / 2, e.kind === 'avenue' ? ROAD : [244, 244, 240]);
        }
      }
    }
  }
}

function drawStructures(v: View, city: CityData, dim = false): void {
  const c = v.canvas;
  for (const s of city.structures) {
    if (s.passable) continue;
    const base = CLASS_COLOR[s.cls] ?? [128, 128, 128];
    // Taller is darker: the skyline reads from above.
    const k = 1.12 - Math.min(1, s.height / 170) * 0.62;
    const col = dim ? mix(shade(base, k), LAND, 0.55) : shade(base, k);
    const pts = polyPx(v, corners(s));
    c.poly(pts, col);
    if (v.scale >= 0.75) c.outline(pts, 1, shade(col, 0.7), 0.8);
  }
}

function drawProps(v: View, city: CityData): void {
  const c = v.canvas;
  for (const p of city.props) {
    const def = PROP_KINDS[p.kind];
    const q = px(v, p.x, p.z);
    const tree = p.kind === 'tree_a' || p.kind === 'tree_b';
    const col: RGB = tree ? [60, 140, 70] : def.tally === 'car' ? [200, 60, 60] : p.kind === 'kiosk' ? [240, 150, 30] : [90, 90, 110];
    const r = Math.max(0.6, (tree ? 1.6 : def.tally === 'car' ? 1.3 : p.kind === 'kiosk' ? 1.4 : 0.6) * v.scale);
    c.disc(q[0], q[1], r, col, tree ? 0.8 : 1);
  }
}

function label(v: View, x: number, z: number, text: string, col: RGB, scale = 1, dy = 0): void {
  const p = px(v, x, z);
  v.canvas.text(Math.round(p[0] - textWidth(text, scale) / 2), Math.round(p[1] + dy), text, col, scale);
}

function drawLabels(v: View, city: CityData, scale: number): void {
  for (const s of city.structures) {
    if (!s.landmark) continue;
    const p = px(v, s.x, s.z);
    v.canvas.outline(polyPx(v, corners(s)), 2, [120, 0, 20]);
    label(v, s.x, s.z, s.landmark, [120, 0, 20], scale, Math.max(s.hx, s.hz) * v.scale * 0.6 + 4);
    void p;
  }
}

function drawAnchors(v: View, city: CityData, scale: number): void {
  for (const a of city.anchors) {
    const p = px(v, a.x, a.z);
    v.canvas.disc(p[0], p[1], 5 * scale, [255, 255, 255]);
    v.canvas.disc(p[0], p[1], 3.5 * scale, [255, 122, 26]);
    label(v, a.x, a.z, a.name, [150, 60, 0], scale, -12 * scale - 4);
  }
}

function boundsOutline(v: View, b: Bounds, width: number, col: RGB): void {
  const pts: Array<[number, number]> = [px(v, b.minX, b.minZ), px(v, b.maxX, b.minZ), px(v, b.maxX, b.maxZ), px(v, b.minX, b.maxZ)];
  v.canvas.outline(pts, width, col);
}

function drawCity(v: View, city: CityData, o: DrawOptions): void {
  drawGround(v, city, o);
  drawRoads(v, city);
  drawStructures(v, city, o.dim);
  if (o.props) drawProps(v, city);
}

const whole = (city: CityData): Bounds => ({ minX: -city.half, minZ: -city.half, maxX: city.half, maxZ: city.half });

function renderMap(city: CityData, file: string): void {
  const v = makeView(whole(city), 1);
  drawCity(v, city, { tint: true });
  for (const d of city.districts) {
    let cx = 0;
    let cz = 0;
    for (const p of d.polygon) {
      cx += p.x / d.polygon.length;
      cz += p.z / d.polygon.length;
    }
    label(v, cx, cz, d.name, ZONE_INK[d.zone], 3);
  }
  drawLabels(v, city, 2);
  drawAnchors(v, city, 2);
  v.canvas.save(file);
}

function renderRoads(city: CityData, file: string): void {
  const v = makeView(whole(city), 1, [250, 250, 248]);
  drawGround(v, city, {});
  const { nodes, edges } = city.roads;
  const degree = nodes.map(() => 0);
  for (const e of edges) {
    degree[e.a]++;
    degree[e.b]++;
  }
  for (const e of edges) {
    const a = px(v, nodes[e.a].x, nodes[e.a].z);
    const b = px(v, nodes[e.b].x, nodes[e.b].z);
    const col: RGB = e.kind === 'bridge' ? [220, 40, 40] : e.kind === 'avenue' ? [40, 40, 60] : [110, 110, 140];
    v.canvas.line(a[0], a[1], b[0], b[1], Math.max(1.5, e.width / 5), col);
  }
  nodes.forEach((n, i) => {
    const p = px(v, n.x, n.z);
    v.canvas.disc(p[0], p[1], degree[i] === 1 ? 5 : 2.5, degree[i] === 1 ? [240, 120, 0] : [20, 20, 30]);
  });
  v.canvas.text(12, 12, `${nodes.length} junctions  ${edges.length} streets  bridges red  dead ends orange`, INK, 2);
  v.canvas.save(file);
}

function heatColor(t: number): RGB {
  const stops: RGB[] = [
    [250, 250, 240],
    [255, 224, 130],
    [250, 150, 60],
    [214, 50, 50],
    [110, 20, 90],
  ];
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return mix(stops[i], stops[i + 1], x - i);
}

function renderHeat(city: CityData, file: string): void {
  const cell = 20;
  const n = Math.ceil((city.half * 2) / cell);
  const grid = new Float64Array(n * n);
  const add = (x: number, z: number, value: number): void => {
    const c = Math.min(n - 1, Math.max(0, Math.floor((city.half - x) / cell)));
    const r = Math.min(n - 1, Math.max(0, Math.floor((city.half - z) / cell)));
    grid[r * n + c] += value;
  };
  for (const s of city.structures) add(s.x, s.z, s.value);
  for (const p of city.props) add(p.x, p.z, PROP_KINDS[p.kind].value);
  const v = makeView(whole(city), 1, [250, 250, 240]);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      // Points per hectare, on a square-root scale (towers would drown everything else).
      const perHa = grid[r * n + c] * (10000 / (cell * cell));
      const col = heatColor(Math.sqrt(perHa / 16000));
      v.canvas.rect(c * cell, r * cell, (c + 1) * cell, (r + 1) * cell, col);
    }
  }
  for (const a of city.areas) if (a.kind === 'water') v.canvas.poly(polyPx(v, a.polygon), WATER, 0.85);
  for (const e of city.roads.edges) {
    if (e.kind !== 'avenue' && e.kind !== 'bridge') continue;
    const a = px(v, city.roads.nodes[e.a].x, city.roads.nodes[e.a].z);
    const b = px(v, city.roads.nodes[e.b].x, city.roads.nodes[e.b].z);
    v.canvas.line(a[0], a[1], b[0], b[1], 1.5, [90, 90, 100], 0.6);
  }
  drawAnchors(v, city, 2);
  let total = 0;
  for (const g of grid) total += g;
  v.canvas.text(12, 12, `VALUE PER HECTARE (SQUARE ROOT SCALE)  TOTAL ${Math.round(total)} POINTS`, INK, 2);
  const legend = [0, 250, 1000, 4000, 16000];
  legend.forEach((value, i) => {
    v.canvas.rect(12 + i * 150, 36, 12 + i * 150 + 24, 60, heatColor(Math.sqrt(value / 16000)));
    v.canvas.text(42 + i * 150, 42, String(value), INK, 2);
  });
  v.canvas.save(file);
}

function renderAnchors(city: CityData, file: string): void {
  const cols = 5;
  const rows = Math.ceil(city.anchors.length / cols);
  const scale = 0.2;
  const size = Math.round(city.half * 2 * scale);
  const pad = 8;
  const head = 34;
  const sheet = new Canvas(cols * (size + pad) + pad, rows * (size + pad + head) + pad, [255, 255, 255]);
  city.anchors.forEach((a, i) => {
    const v = makeView(whole(city), scale);
    drawGround(v, city, { tint: true });
    drawStructures(v, city);
    for (const e of city.roads.edges) {
      if (e.kind === 'street') continue;
      const p = px(v, city.roads.nodes[e.a].x, city.roads.nodes[e.a].z);
      const q = px(v, city.roads.nodes[e.b].x, city.roads.nodes[e.b].z);
      v.canvas.line(p[0], p[1], q[0], q[1], 1, e.kind === 'bridge' ? [220, 40, 40] : [120, 120, 130]);
    }
    const b1 = stageBounds(city, a.id, 1);
    const b2 = stageBounds(city, a.id, 2);
    for (const s of city.structures) {
      if (!s.landmark) continue;
      const p = px(v, s.x, s.z);
      v.canvas.disc(p[0], p[1], 3, [214, 40, 60]);
    }
    boundsOutline(v, b2, 3, [255, 122, 26]);
    boundsOutline(v, b1, 3, [20, 150, 190]);
    const q = px(v, a.x, a.z);
    v.canvas.disc(q[0], q[1], 3, [20, 20, 20]);
    const ox = pad + (i % cols) * (size + pad);
    const oy = pad + Math.floor(i / cols) * (size + pad + head) + head;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = (y * v.canvas.w + x) * 3;
        sheet.set(ox + x, oy + y, [v.canvas.data[k], v.canvas.data[k + 1], v.canvas.data[k + 2]]);
      }
    }
    sheet.text(ox, oy - head + 2, `${a.id} ${a.name}`, INK, 2, null);
    sheet.text(ox, oy - head + 20, `STAGE 1: ${valueInBounds(city, b1)}  STAGE 2: ${valueInBounds(city, b2)}`, [90, 90, 100], 1, null);
  });
  sheet.save(file);
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function clampBounds(city: CityData, b: Bounds): Bounds {
  return { minX: Math.max(-city.half, b.minX), minZ: Math.max(-city.half, b.minZ), maxX: Math.min(city.half, b.maxX), maxZ: Math.min(city.half, b.maxZ) };
}

function renderDistrict(city: CityData, index: number, file: string): void {
  const d = city.districts[index];
  let b: Bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const p of d.polygon) {
    b = { minX: Math.min(b.minX, p.x), minZ: Math.min(b.minZ, p.z), maxX: Math.max(b.maxX, p.x), maxZ: Math.max(b.maxZ, p.z) };
  }
  b = clampBounds(city, { minX: b.minX - 20, minZ: b.minZ - 20, maxX: b.maxX + 20, maxZ: b.maxZ + 20 });
  const v = makeView(b, 1);
  drawCity(v, city, { tint: true, props: true });
  v.canvas.outline(polyPx(v, d.polygon), 2, ZONE_INK[d.zone], 0.8);
  drawLabels(v, city, 1);
  drawAnchors(v, city, 1);
  v.canvas.text(8, 8, `${d.name.toUpperCase()}  (${d.zone})  1 M PER PIXEL`, INK, 2);
  v.canvas.save(file);
}

function renderAnchorCloseup(city: CityData, anchor: number, file: string): void {
  const a = city.anchors[anchor];
  const b1 = stageBounds(city, anchor, 1);
  const b = clampBounds(city, { minX: b1.minX - 40, minZ: b1.minZ - 40, maxX: b1.maxX + 40, maxZ: b1.maxZ + 40 });
  const v = makeView(b, 2);
  drawCity(v, city, { tint: true, props: true });
  boundsOutline(v, b1, 3, [20, 150, 190]);
  drawLabels(v, city, 1);
  const q = px(v, a.x, a.z);
  v.canvas.disc(q[0], q[1], 6, [255, 122, 26]);
  v.canvas.text(8, 8, `${a.name.toUpperCase()}  STAGE 1 SQUARE (360 M)  VALUE ${valueInBounds(city, b1)}  2 PX PER M`, INK, 2);
  v.canvas.save(file);
}

// ---------------------------------------------------------------------------------------------
// The oblique model
// ---------------------------------------------------------------------------------------------

interface ModelOptions {
  /** Camera turn about the vertical axis, degrees (0 looks north from the south). */
  turn: number;
  /** Elevation of the view above the ground, degrees. */
  tilt: number;
  /** World rectangle shown. */
  b: Bounds;
  /** Pixels per meter along the ground's screen-horizontal. */
  scale: number;
}

function renderModel(city: CityData, o: ModelOptions, file: string, title: string): void {
  const ct = Math.cos((o.turn * Math.PI) / 180);
  const st = Math.sin((o.turn * Math.PI) / 180);
  const se = Math.sin((o.tilt * Math.PI) / 180);
  const ce = Math.cos((o.tilt * Math.PI) / 180);
  // Screen right is map east (-X) for turn 0; depth grows to the north (+Z).
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    const e = -x;
    const r = e * ct + z * st;
    const d = -e * st + z * ct;
    return [r * o.scale, -(d * se + y * ce) * o.scale, d];
  };
  // Frame the ground rectangle.
  const frame = [proj(o.b.minX, 0, o.b.minZ), proj(o.b.maxX, 0, o.b.minZ), proj(o.b.maxX, 0, o.b.maxZ), proj(o.b.minX, 0, o.b.maxZ)];
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of frame) {
    minU = Math.min(minU, p[0]);
    maxU = Math.max(maxU, p[0]);
    minV = Math.min(minV, p[1]);
    maxV = Math.max(maxV, p[1]);
  }
  const top = 250 * ce * o.scale + 20;
  const pad = 20;
  const w = Math.ceil(maxU - minU + pad * 2);
  const h = Math.ceil(maxV - minV + pad * 2 + top);
  const c = new Canvas(w, h, [246, 244, 238]);
  const at = (x: number, y: number, z: number): [number, number] => {
    const p = proj(x, y, z);
    return [p[0] - minU + pad, p[1] - minV + pad + top];
  };
  const inside = (x: number, z: number): boolean => x >= o.b.minX && x <= o.b.maxX && z >= o.b.minZ && z <= o.b.maxZ;
  const ground = (polygon: readonly Vec2[], col: RGB): void => {
    c.poly(
      polygon.map((p) => at(Math.max(o.b.minX, Math.min(o.b.maxX, p.x)), 0, Math.max(o.b.minZ, Math.min(o.b.maxZ, p.z)))),
      col,
    );
  };
  ground(
    [
      { x: o.b.minX, z: o.b.minZ },
      { x: o.b.maxX, z: o.b.minZ },
      { x: o.b.maxX, z: o.b.maxZ },
      { x: o.b.minX, z: o.b.maxZ },
    ],
    [228, 226, 216],
  );
  for (const d of city.districts) ground(d.polygon, mix(ZONE_TINT[d.zone], [228, 226, 216], 0.3));
  for (const a of city.areas) if (a.kind === 'plaza') ground(a.polygon, PLAZA);
  for (const a of city.areas) if (a.kind === 'park') ground(a.polygon, PARK);
  for (const a of city.areas) if (a.kind === 'water') ground(a.polygon, WATER);
  for (const e of city.roads.edges) {
    const a = city.roads.nodes[e.a];
    const b = city.roads.nodes[e.b];
    if (!inside(a.x, a.z) || !inside(b.x, b.z)) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (e.width / 2);
    const nz = (dx / l) * (e.width / 2);
    c.poly([at(a.x + nx, 0, a.z + nz), at(b.x + nx, 0, b.z + nz), at(b.x - nx, 0, b.z - nz), at(a.x - nx, 0, a.z - nz)], e.kind === 'bridge' ? [200, 190, 170] : [252, 252, 250]);
  }
  // Trees as small green dots, then boxes far to near.
  for (const p of city.props) {
    if ((p.kind !== 'tree_a' && p.kind !== 'tree_b') || !inside(p.x, p.z)) continue;
    const q = at(p.x, 3, p.z);
    c.disc(q[0], q[1], Math.max(1, 2.2 * o.scale), [86, 150, 84]);
  }
  const order = city.structures.filter((s) => inside(s.x, s.z)).map((s) => ({ s, d: proj(s.x, 0, s.z)[2] }));
  order.sort((p, q) => q.d - p.d || p.s.id - q.s.id);
  for (const { s } of order) {
    const base = s.landmark ? CLASS_COLOR.landmark : (CLASS_COLOR[s.cls] ?? [128, 128, 128]);
    const col = mix(base, [250, 246, 236], s.landmark ? 0.15 : 0.45);
    const cs = corners(s);
    const y = s.passable ? 3 : s.height;
    // Walls: draw the far ones first so the near ones cover them.
    const walls = [0, 1, 2, 3].map((i) => {
      const a = cs[i];
      const b = cs[(i + 1) % 4];
      const mid = proj((a.x + b.x) / 2, 0, (a.z + b.z) / 2)[2];
      // Light from the south-west: walls are shaded by which way they face.
      const nx = b.z - a.z;
      const nz = -(b.x - a.x);
      const nl = Math.hypot(nx, nz) || 1;
      const lit = 0.72 + 0.2 * ((nx / nl) * 0.6 + (nz / nl) * -0.8);
      return { a, b, mid, lit };
    });
    walls.sort((p, q) => q.mid - p.mid);
    for (const wl of walls) {
      c.poly([at(wl.a.x, 0, wl.a.z), at(wl.b.x, 0, wl.b.z), at(wl.b.x, y, wl.b.z), at(wl.a.x, y, wl.a.z)], shade(col, wl.lit));
    }
    const roof = cs.map((p) => at(p.x, y, p.z));
    c.poly(roof, shade(col, 1.04));
    c.outline(roof, 1, shade(col, 0.62), 0.7);
  }
  c.text(14, 12, title, INK, 2);
  c.save(file);
}

// ---------------------------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let out = resolve(repo, 'docs', 'city');
  let which = 'meridian';
  let only: string[] | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = resolve(args[++i]);
    else if (args[i] === '--city') which = args[++i];
    else if (args[i] === '--only') only = args[++i].split(',');
    else throw new Error(`unknown option ${args[i]} (see the header of shared/scripts/cityMap.ts)`);
  }
  const city = which === 'placeholder' ? generateCity() : generatePortMeridian();
  const want = (name: string): boolean => only === null || only.some((o) => name.startsWith(o));
  const done: string[] = [];
  const run = (name: string, f: (file: string) => void): void => {
    if (!want(name)) return;
    f(resolve(out, `${name}.png`));
    done.push(name);
  };
  run('map', (f) => renderMap(city, f));
  run('roads', (f) => renderRoads(city, f));
  run('heat', (f) => renderHeat(city, f));
  run('anchors', (f) => renderAnchors(city, f));
  run('model', (f) => renderModel(city, { turn: 24, tilt: 38, b: whole(city), scale: 0.9 }, f, 'PORT MERIDIAN FROM THE SOUTH-WEST (OBLIQUE MODEL: EXTRUDED FOOTPRINTS)'));
  run('model_downtown', (f) =>
    renderModel(city, { turn: -20, tilt: 30, b: { minX: -520, minZ: -520, maxX: 520, maxZ: 420 }, scale: 1.6 }, f, 'DOWNTOWN, THE BAY AND CHAPTER ISLAND FROM THE SOUTH-EAST'),
  );
  city.districts.forEach((d, i) => run(`district_${slug(d.name)}`, (f) => renderDistrict(city, i, f)));
  city.anchors.forEach((a, i) => run(`anchor_${slug(a.name)}`, (f) => renderAnchorCloseup(city, i, f)));
  console.log(`${which}: wrote ${done.length} pictures to ${out}: ${done.join(', ')}`);
}

main();
