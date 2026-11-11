/**
 * Procedural stand-ins for the sprite sheets of docs/ASSETS.md section 4: soldiers, civilians
 * and effect frames, drawn as chunky pixel figures so crowds and explosions read before the
 * real pixel art lands. Each function returns a sheet canvas and the manifest-style entries
 * that describe it, exactly as a real sheet would be described.
 */

import type { SpriteEntry } from '../manifest';
import { makeCanvas, sequence } from './textures';

export interface ProceduralSheet {
  canvas: HTMLCanvasElement;
  /** Sprite ids on this sheet. `file` is a key for the sheet, not a path. */
  entries: Record<string, SpriteEntry>;
}

type Ctx = CanvasRenderingContext2D;

function ctxOf(canvas: HTMLCanvasElement): Ctx {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

interface FigureStyle {
  skin: string;
  top: string;
  legs: string;
  hat: string | null;
  /** 'tube': rocket launcher on the shoulder; 'rifle'; 'up': arms raised; null: arms down. */
  arms: 'tube' | 'rifle' | 'up' | null;
}

/**
 * One 24 x 32 figure. `facing` 0 front, 1 left, 2 back, 3 right; `step` 0..3 is the walk
 * phase (-1 standing); `flash` draws a muzzle flash.
 */
function figure(ctx: Ctx, ox: number, oy: number, style: FigureStyle, facing: number, step: number, flash = false): void {
  const px = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, oy + y, w, h);
  };
  const side = facing === 1 || facing === 3;
  const flip = facing === 1;
  const X = (x: number, w: number): number => (flip ? 24 - x - w : x);
  // Legs: alternate stride.
  const stride = step < 0 ? 0 : [3, 0, -3, 0][step];
  if (side) {
    px(X(10 + stride, 3), 22, 3, 9, style.legs);
    px(X(11 - stride, 3), 22, 3, 9, style.legs);
  } else {
    px(8, 22, 3, 9 - (step === 0 ? 2 : 0), style.legs);
    px(13, 22, 3, 9 - (step === 2 ? 2 : 0), style.legs);
  }
  // Body and head.
  px(side ? X(9, 6) : 7, 12, side ? 6 : 10, 11, style.top);
  px(side ? X(9, 6) : 9, 5, 6, 7, facing === 2 ? (style.hat ?? style.skin) : style.skin);
  if (style.hat) px(side ? X(8, 8) : 8, 3, 8, 4, style.hat);
  if (facing === 0) {
    px(10, 8, 1, 1, '#1a1a1a');
    px(13, 8, 1, 1, '#1a1a1a');
  } else if (side) {
    px(X(13, 1), 8, 1, 1, '#1a1a1a');
  }
  // Arms and what they carry.
  if (style.arms === 'up') {
    px(side ? X(8, 2) : 5, 3, 2, 10, style.skin);
    px(side ? X(14, 2) : 17, 3, 2, 10, style.skin);
  } else if (style.arms === 'tube') {
    if (side) {
      px(X(4, 16), 9, 16, 3, '#3d4630');
      if (flash) px(X(20, 4), 7, 4, 7, '#ffd91a');
    } else {
      px(15, 4, 4, 12, '#3d4630');
      if (flash) px(14, 0, 6, 4, '#ffd91a');
    }
  } else if (style.arms === 'rifle') {
    if (side) {
      px(X(12, 9), 14, 9, 2, '#2a2c30');
      if (flash) px(X(21, 3), 13, 3, 4, '#ffd91a');
    } else {
      px(16, 10, 2, 10, '#2a2c30');
      if (flash) px(15, 7, 4, 3, '#ffd91a');
    }
  } else {
    px(side ? X(11, 2) : 5, 13, 2, 8, style.top);
    if (!side) px(17, 13, 2, 8, style.top);
  }
}

/** A fallen figure: frames 0..3 go from upright to flat on the ground. */
function fallen(ctx: Ctx, ox: number, oy: number, style: FigureStyle, frame: number): void {
  if (frame === 0) {
    figure(ctx, ox, oy, { ...style, arms: 'up' }, 0, -1);
    return;
  }
  const y = [0, 18, 24, 27][frame];
  const h = [0, 10, 6, 4][frame];
  ctx.fillStyle = style.top;
  ctx.fillRect(ox + 4, oy + y, 12, h);
  ctx.fillStyle = style.skin;
  ctx.fillRect(ox + 16, oy + y, 5, Math.min(h, 5));
  ctx.fillStyle = style.legs;
  ctx.fillRect(ox + 1, oy + y + Math.max(0, h - 3), 4, 3);
}

const ARMY: FigureStyle = { skin: '#e2b48c', top: '#6b7a3a', legs: '#4a5628', hat: '#55622e', arms: 'tube' };

/** Soldiers: idle 1, walk 4, fire 2 frames for each facing, then a row of 4 die frames. */
export function armySheet(): ProceduralSheet {
  const cell: [number, number] = [24, 32];
  const kinds: Array<[string, FigureStyle]> = [
    ['soldier_army_rocket', ARMY],
    ['soldier_army_rifle', { ...ARMY, arms: 'rifle' }],
  ];
  const canvas = makeCanvas(cell[0] * 7, cell[1] * 5 * kinds.length);
  const ctx = ctxOf(canvas);
  const entries: Record<string, SpriteEntry> = {};
  kinds.forEach(([id, style], k) => {
    const row0 = k * 5;
    for (let facing = 0; facing < 4; facing++) {
      const y = (row0 + facing) * cell[1];
      figure(ctx, 0, y, style, facing, -1);
      for (let f = 0; f < 4; f++) figure(ctx, (1 + f) * cell[0], y, style, facing, f);
      figure(ctx, 5 * cell[0], y, style, facing, -1, true);
      figure(ctx, 6 * cell[0], y, style, facing, -1, false);
    }
    for (let f = 0; f < 4; f++) fallen(ctx, f * cell[0], (row0 + 4) * cell[1], style, f);
    const rows = [row0, row0 + 1, row0 + 2, row0 + 3];
    entries[id] = {
      file: 'procedural:army',
      frame: cell,
      worldHeight: 1.9,
      anims: {
        idle: { rows, col: 0, frames: 1, fps: 1 },
        walk: { rows, col: 1, frames: 4, fps: 8 },
        fire: { rows, col: 5, frames: 2, fps: 8 },
        die: { rows: [row0 + 4], col: 0, frames: 4, fps: 6 },
      },
    };
  });
  return { canvas, entries };
}

const CIVILIAN_TOPS = ['#e0372f', '#2f62c9', '#f2c21b', '#8f6fd0', '#2a9d8f', '#f29b85'];
const CIVILIAN_SKINS = ['#e2b48c', '#8d5a3b', '#f1d2b6', '#c68e5f', '#5e3a25', '#e8c39e'];

/** Six civilians running with their arms up: 4 frames for each facing. */
export function civilianSheet(): ProceduralSheet {
  const cell: [number, number] = [24, 32];
  const canvas = makeCanvas(cell[0] * 4, cell[1] * 4 * 6);
  const ctx = ctxOf(canvas);
  const entries: Record<string, SpriteEntry> = {};
  for (let v = 0; v < 6; v++) {
    const style: FigureStyle = {
      skin: CIVILIAN_SKINS[v],
      top: CIVILIAN_TOPS[v],
      legs: v % 2 === 0 ? '#39405a' : '#5b4636',
      hat: null,
      arms: 'up',
    };
    const row0 = v * 4;
    for (let facing = 0; facing < 4; facing++) {
      for (let f = 0; f < 4; f++) figure(ctx, f * cell[0], (row0 + facing) * cell[1], style, facing, f);
    }
    entries[`civilian_${v + 1}`] = {
      file: 'procedural:civilians',
      frame: cell,
      worldHeight: 1.75,
      anims: { run: { rows: [row0, row0 + 1, row0 + 2, row0 + 3], col: 0, frames: 4, fps: 10 } },
    };
  }
  return { canvas, entries };
}

function radial(ctx: Ctx, cx: number, cy: number, r: number, stops: Array<[number, string]>): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** Effect frames, 64 px cells, one effect per row. Drawn white or warm so instances can tint them. */
export function fxSheet(): ProceduralSheet {
  const S = 64;
  const rows: Array<[string, number, number]> = [
    ['fx_explosion', 8, 16],
    ['fx_smoke', 6, 8],
    ['fx_dust', 6, 8],
    ['fx_fire', 6, 10],
    ['fx_debris', 4, 1],
    ['fx_flash', 3, 20],
    ['fx_spark', 1, 1],
    ['fx_glow', 1, 1],
    ['fx_laserdot', 1, 1],
    ['fx_ring', 1, 1],
    ['fx_shadow', 1, 1],
    ['fx_white', 1, 1],
  ];
  const canvas = makeCanvas(S * 8, S * rows.length);
  const ctx = ctxOf(canvas);
  const next = sequence(77);
  const entries: Record<string, SpriteEntry> = {};
  rows.forEach(([id, frames, fps], row) => {
    entries[id] = { file: 'procedural:fx', frame: [S, S], worldHeight: 1, anims: { play: { rows: [row], col: 0, frames, fps } } };
    for (let f = 0; f < frames; f++) {
      const cx = f * S + S / 2;
      const cy = row * S + S / 2;
      const t = frames > 1 ? f / (frames - 1) : 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(f * S, row * S, S, S);
      ctx.clip();
      switch (id) {
        case 'fx_explosion': {
          // A sparkler burst: a hot core that fades while spokes fly outward.
          const core = 26 * (1 - t * 0.7);
          radial(ctx, cx, cy, core, [[0, `rgba(255,255,255,${1 - t * 0.6})`], [0.5, `rgba(255,214,90,${0.9 - t * 0.6})`], [1, 'rgba(255,120,20,0)']]);
          ctx.strokeStyle = `rgba(255,240,170,${1 - t})`;
          ctx.lineWidth = 2;
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 + next() * 0.3;
            const r0 = 6 + t * 16;
            const r1 = 10 + t * 20 + next() * 4;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
            ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
            ctx.stroke();
          }
          break;
        }
        case 'fx_smoke':
        case 'fx_dust': {
          const alpha = 0.75 * (1 - t * 0.85);
          for (let i = 0; i < 7; i++) {
            const r = 9 + t * 8 + next() * 5;
            radial(ctx, cx + (next() - 0.5) * (18 + t * 12), cy + (next() - 0.5) * (18 + t * 12), r, [[0, `rgba(255,255,255,${alpha})`], [1, 'rgba(255,255,255,0)']]);
          }
          break;
        }
        case 'fx_fire': {
          for (let i = 0; i < 5; i++) {
            const x = cx + (next() - 0.5) * 22;
            const h = 18 + next() * 22;
            radial(ctx, x, cy + 22 - h / 2, 12, [[0, 'rgba(255,240,170,0.95)'], [0.5, 'rgba(255,140,30,0.7)'], [1, 'rgba(255,60,0,0)']]);
          }
          break;
        }
        case 'fx_debris': {
          ctx.fillStyle = '#ffffff';
          ctx.translate(cx, cy);
          ctx.rotate(f * 0.8);
          ctx.fillRect(-10 - f, -7, 20 - f * 2, 14 - f);
          break;
        }
        case 'fx_flash':
          radial(ctx, cx, cy, 30 - t * 12, [[0, `rgba(255,255,255,${1 - t * 0.5})`], [0.4, `rgba(255,224,120,${0.9 - t * 0.5})`], [1, 'rgba(255,170,40,0)']]);
          break;
        case 'fx_spark':
          radial(ctx, cx, cy, 10, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,230,150,0.8)'], [1, 'rgba(255,200,80,0)']]);
          break;
        case 'fx_glow':
          radial(ctx, cx, cy, 31, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
          break;
        case 'fx_laserdot':
          radial(ctx, cx, cy, 14, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
          break;
        case 'fx_ring':
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, 28, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'fx_shadow':
          radial(ctx, cx, cy, 31, [[0, 'rgba(255,255,255,0.85)'], [0.6, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
          break;
        default:
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(f * S, row * S, S, S);
      }
      ctx.restore();
    }
  });
  return { canvas, entries };
}

/**
 * World markers in the game's shape language (DESIGN.md section 8): circles for humans,
 * triangles for the kaiju, diamonds for charging volleys. White, tinted per instance. These are
 * the client's own and are always drawn by this function.
 */
export function markerSheet(): ProceduralSheet {
  const S = 32;
  const ids = ['mk_circle', 'mk_triangle', 'mk_diamond', 'mk_chevron', 'mk_cross', 'mk_dot'];
  const canvas = makeCanvas(S * ids.length, S);
  const ctx = ctxOf(canvas);
  const entries: Record<string, SpriteEntry> = {};
  ids.forEach((id, i) => {
    entries[id] = { file: 'procedural:markers', frame: [S, S], worldHeight: 1, anims: { play: { rows: [0], col: i, frames: 1, fps: 1 } } };
    const cx = i * S + S / 2;
    const cy = S / 2;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    if (id === 'mk_circle') ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    else if (id === 'mk_triangle') {
      ctx.moveTo(cx, cy + 12);
      ctx.lineTo(cx - 12, cy - 10);
      ctx.lineTo(cx + 12, cy - 10);
      ctx.closePath();
    } else if (id === 'mk_diamond') {
      ctx.moveTo(cx, cy - 13);
      ctx.lineTo(cx + 11, cy);
      ctx.lineTo(cx, cy + 13);
      ctx.lineTo(cx - 11, cy);
      ctx.closePath();
    } else if (id === 'mk_chevron') {
      ctx.moveTo(cx - 11, cy + 4);
      ctx.lineTo(cx, cy - 8);
      ctx.lineTo(cx + 11, cy + 4);
    } else if (id === 'mk_cross') {
      ctx.moveTo(cx - 10, cy - 10);
      ctx.lineTo(cx + 10, cy + 10);
      ctx.moveTo(cx + 10, cy - 10);
      ctx.lineTo(cx - 10, cy + 10);
    } else {
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    }
    if (id !== 'mk_chevron' && id !== 'mk_cross') ctx.fill();
    ctx.stroke();
  });
  return { canvas, entries };
}

/** Every sprite id the client draws, for reporting which ones the art has not covered yet. */
export const FX_SPRITE_IDS = [
  'fx_explosion',
  'fx_smoke',
  'fx_dust',
  'fx_fire',
  'fx_debris',
  'fx_flash',
  'fx_spark',
  'fx_glow',
  'fx_laserdot',
  'fx_ring',
  'fx_shadow',
  'fx_white',
] as const;
export const SOLDIER_SPRITE_IDS = ['soldier_army_rocket', 'soldier_army_rifle'] as const;
