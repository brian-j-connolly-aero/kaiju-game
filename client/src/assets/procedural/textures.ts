/**
 * Procedural stand-ins for the textures of docs/ASSETS.md section 3: the five ground tiles, the
 * cloud layers, and the wall tile that gives placeholder buildings their windows. All are tiny
 * canvases drawn with a fixed pseudo-random sequence, so they look the same on every run.
 */

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

/** A small deterministic generator (the shared seeded one is for the simulation). */
export function sequence(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function speckle(base: string, flecks: string[], seed: number, density: number, size = 64): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  const ctx = context(canvas);
  const next = sequence(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const count = Math.round(size * size * density);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = flecks[Math.floor(next() * flecks.length)];
    const w = next() < 0.8 ? 1 : 2;
    ctx.fillRect(Math.floor(next() * size), Math.floor(next() * size), w, w);
  }
  return canvas;
}

const GROUND: Record<string, () => HTMLCanvasElement> = {
  ground_asphalt: () => speckle('#2b3040', ['#323848', '#262a38', '#3a4052'], 11, 0.12),
  ground_sidewalk: () => {
    const canvas = speckle('#b9bcc6', ['#c4c7d0', '#aeb1bb'], 12, 0.1);
    const ctx = context(canvas);
    ctx.fillStyle = '#a3a6b0';
    for (let i = 0; i < 64; i += 16) {
      ctx.fillRect(i, 0, 1, 64);
      ctx.fillRect(0, i, 64, 1);
    }
    return canvas;
  },
  ground_grass: () => speckle('#4fbf5f', ['#5bcb6b', '#45b055', '#63d273', '#3fa652'], 13, 0.3),
  ground_water: () => {
    const canvas = speckle('#2f7fd6', ['#3a8be0', '#2a74c8'], 14, 0.08);
    const ctx = context(canvas);
    const next = sequence(15);
    ctx.fillStyle = '#6fb0f0';
    for (let i = 0; i < 14; i++) ctx.fillRect(Math.floor(next() * 58), Math.floor(next() * 64), 3 + Math.floor(next() * 5), 1);
    return canvas;
  },
  ground_rubble: () => speckle('#8d8d94', ['#9b9ba2', '#77777e', '#a8a8ae', '#6a6a70'], 16, 0.4),
  ground_plaza: () => {
    const canvas = speckle('#d6cdb8', ['#dfd7c4', '#cbc2ad'], 17, 0.1);
    const ctx = context(canvas);
    ctx.fillStyle = '#bfb6a1';
    for (let i = 0; i < 64; i += 32) {
      ctx.fillRect(i, 0, 1, 64);
      ctx.fillRect(0, i, 64, 1);
    }
    return canvas;
  },
  ground_far: () => speckle('#7c9a78', ['#86a482', '#72906e'], 18, 0.2),
};

function clouds(seed: number): HTMLCanvasElement {
  const canvas = makeCanvas(256, 128);
  const ctx = context(canvas);
  const next = sequence(seed);
  ctx.clearRect(0, 0, 256, 128);
  for (let c = 0; c < 5; c++) {
    const cx = 20 + next() * 216;
    const cy = 50 + next() * 50;
    const puffs = 6 + Math.floor(next() * 6);
    for (let p = 0; p < puffs; p++) {
      const x = cx + (next() - 0.5) * 70;
      const y = cy - next() * 30;
      const r = 8 + next() * 16;
      ctx.fillStyle = y < cy - 12 ? '#ffffff' : '#e3e8f2';
      // Chunky pixel puffs, not smooth circles: the sky is painted scenery.
      ctx.fillRect(Math.round(x - r), Math.round(y - r * 0.6), Math.round(r * 2), Math.round(r * 1.2));
      ctx.fillRect(Math.round(x - r * 0.6), Math.round(y - r), Math.round(r * 1.2), Math.round(r * 2));
    }
    ctx.fillStyle = '#c3cbdb';
    ctx.fillRect(Math.round(cx - 40), Math.round(cy + 6), 80, 5);
  }
  // Drawn on a horizon ring that never repeats vertically: keep the edge rows clear.
  ctx.clearRect(0, 0, 256, 1);
  ctx.clearRect(0, 127, 256, 1);
  return canvas;
}

/**
 * The wall tile for placeholder buildings: white wall with a 4 x 4 grid of windows. Walls
 * repeat it per storey; vertex and instance colors tint the white. The bottom-left pixels are
 * plain wall, which is where roofs point their texture coordinates.
 */
export function windowTile(lit: boolean): HTMLCanvasElement {
  const size = 64;
  const canvas = makeCanvas(size, size);
  const ctx = context(canvas);
  const next = sequence(lit ? 31 : 32);
  ctx.fillStyle = lit ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const on = next() < 0.45;
      if (lit) ctx.fillStyle = on ? (next() < 0.5 ? '#ffd98a' : '#fff2c4') : '#05070c';
      else ctx.fillStyle = next() < 0.5 ? '#5d7186' : '#6d8298';
      ctx.fillRect(col * 16 + 4, row * 16 + 4, 9, 9);
    }
  }
  return canvas;
}

/** The stand-in canvas for a texture id, or a plain white one for ids this file does not know. */
export function proceduralTexture(id: string): HTMLCanvasElement {
  const ground = GROUND[id];
  if (ground) return ground();
  if (id === 'clouds_a') return clouds(41);
  if (id === 'clouds_b') return clouds(42);
  if (id === 'city_atlas_emissive') {
    const canvas = makeCanvas(4, 4);
    const ctx = context(canvas);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 4, 4);
    return canvas;
  }
  const canvas = makeCanvas(4, 4);
  const ctx = context(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 4, 4);
  return canvas;
}
