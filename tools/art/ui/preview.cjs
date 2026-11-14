#!/usr/bin/env node
/**
 * UI pictogram contact sheets and checks (docs/ASSETS.md section 5).
 *
 *   node tools/art/ui/preview.cjs                 check every icon, then write the sheets to docs/art/previews/
 *   node tools/art/ui/preview.cjs --check         check only (no pictures)
 *   node tools/art/ui/preview.cjs --out DIR       write the sheets somewhere else (scratch, while iterating)
 *   node tools/art/ui/preview.cjs --only kaiju    only the sheet of one group (see GROUPS below)
 *
 * The icons are hand-written SVG files in client/public/assets/ui/. This script never writes
 * them; it only looks at them. It needs the headless Chromium that ships with the pre-installed
 * Playwright (never run "playwright install").
 *
 * Sheets (PNG):
 *   ui_icons.png            every icon at 128, 64 and 32 px, on a dark and on a light background
 *   ui_icons_<group>.png    the same, one group per file (small enough to judge on screen)
 *   ui_icons_32px.png       every icon at true 32 px in the game's colors, plus the same pixels
 *                           enlarged 3 times without smoothing: this is the legibility test
 *   ui_icons_32px_light.png the same test, dark on light
 *   ui_icons_real_sizes.png every icon at the sizes the client really draws it (18 to 52 px, from
 *                           client/src/styles.css) over afternoon, sunset and night skies: true
 *                           pixels and the same pixels enlarged. THE sheet to judge legibility on
 *   ui_icons_client_fixes.png  before and after, for the changes only the client can make
 *                           (docs/art/client-notes-ui-icons.md)
 *   ui_skyline.png          the destruction-bar skyline in the client's 560 x 46 px bar: whole,
 *                           with the three marks, and crumbling
 *   ui_icons_in_context.png a mock-up of the two heads-up displays, the lobby and the tally
 *
 * Checks (a failure exits with code 1):
 *   exists      every name in the contract has a file; nothing else is in the folder (warning)
 *   xml         the file is well-formed SVG with the right namespace
 *   viewbox     64 x 64 (the skyline: 400 x 64, with preserveAspectRatio="none")
 *   color       every fill and stroke is "none" or "currentColor"; no style attributes or sheets
 *   no-text     no text, tspan, image, script, style, foreignObject, use, or id attributes
 *   weight      every stroke-width is the set's one weight (5)
 *   ink         the drawing is not empty and nothing is cut off by the edge of the viewBox
 *   margin      the drawing stays 2 units away from every edge (inside 2 .. 62)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const UI_DIR = path.join(ROOT, 'client', 'public', 'assets', 'ui');
const DEFAULT_OUT = path.join(ROOT, 'docs', 'art', 'previews');

const STROKE_WEIGHT = '5';
const SKYLINE = 'skyline';
const SKYLINE_VIEWBOX = '0 0 400 64';
const ICON_VIEWBOX = '0 0 64 64';
/** Icons keep this many units clear of every edge of their 64 x 64 box. */
const MARGIN = 2;
/** The client's destruction bar (client/src/styles.css, .bar): the skyline is stretched into it. */
const BAR_BOX = { width: 560, height: 46 };

/** The contract: docs/ASSETS.md section 5. `tint` is the color the group wears in the game. */
const GROUPS = [
  {
    id: 'kaiju',
    title: 'Kaiju verbs',
    tint: 'kaiju',
    icons: ['k_swipe', 'k_stomp', 'k_grab', 'k_throw', 'k_eat', 'k_brace', 'k_roar', 'k_special', 'k_molt', 'k_swim', 'k_charge', 'k_tailsweep'],
  },
  {
    id: 'status',
    title: 'Status',
    tint: 'plain',
    icons: [
      'st_health', 'st_nerve', 'st_rage', 'st_charge', 'st_reload', 'st_veteran', 'st_spotted', 'st_crossfire',
      'st_callin', 'st_shaken', 'st_map', 'st_camera', 'st_sun', 'st_moon',
    ],
  },
  {
    id: 'lobby',
    title: 'Lobby',
    tint: 'plain',
    icons: ['lb_kaiju', 'lb_human', 'lb_ready', 'lb_host', 'lb_bot', 'lb_link', 'lb_play', 'lb_back', 'lb_create', 'lb_join'],
  },
  { id: 'factions', title: 'Factions', tint: 'human', icons: ['fac_army', 'fac_air', 'fac_science', 'fac_faith'] },
  {
    id: 'tally',
    title: 'Tally pictograms',
    tint: 'rubble',
    icons: [
      'tl_car', 'tl_kiosk', 'tl_house', 'tl_shop', 'tl_apartment', 'tl_office', 'tl_tower',
      'tl_factory', 'tl_bridge', 'tl_landmark',
    ],
  },
  { id: 'keyboard_mouse', title: 'Keyboard and mouse', tint: 'plain', icons: ['kb_key', 'ms_left', 'ms_right', 'ms_middle', 'ms_move'] },
  {
    id: 'gamepad',
    title: 'Gamepad',
    tint: 'plain',
    icons: [
      'gp_a', 'gp_b', 'gp_x', 'gp_y', 'gp_lb', 'gp_rb', 'gp_lt', 'gp_rt', 'gp_ls', 'gp_rs', 'gp_dpad',
      'gp_dpad_up', 'gp_dpad_right', 'gp_dpad_down', 'gp_dpad_left', 'gp_start', 'gp_back',
    ],
  },
  {
    id: 'system',
    title: 'System',
    tint: 'plain',
    icons: ['ui_offline', 'ui_warning', 'ui_copy', 'ui_skull', 'ui_trophy', 'ui_clock', 'ui_newspaper', 'ui_sound', 'ui_asleep', 'ui_outdated'],
  },
  {
    id: 'settings',
    title: 'Settings and the drone',
    tint: 'plain',
    icons: ['ui_settings', 'ui_controls', 'ui_invert', 'ui_fullscreen', 'ui_lowres', 'ui_rise', 'ui_sink'],
  },
];

/** Palette anchors from docs/ASSETS.md section 2. */
const COLORS = {
  dark: '#171a24',
  darkPanel: '#232838',
  light: '#eceef3',
  lightPanel: '#ffffff',
  onDark: '#f2f4f8',
  onLight: '#171a24',
  human: '#1ec8e0',
  kaiju: '#ff7a1a',
  volley: '#ffd91a',
  rubble: '#8d8d94',
  grass: '#4fbf5f',
  plain: '#f2f4f8',
  // Colors the client's stylesheet uses next to the palette anchors (client/src/styles.css).
  danger: '#ff3b5c',
  health: '#ff5468',
  nerve: '#7dfcff',
  moon: '#c9d6ff',
  ink: '#f4f6fb',
  paperInk: '#2a2620',
  asleep: '#9db8ff',
};

/** A few icons wear a color of their own in the game: the color language, doubled by the shape. */
const OWN_TINT = {
  st_charge: 'volley',
  st_reload: 'human',
  st_rage: 'kaiju',
  st_spotted: 'kaiju',
  st_crossfire: 'volley',
  lb_kaiju: 'kaiju',
  lb_human: 'human',
  ui_offline: 'danger',
  ui_warning: 'danger',
  ui_copy: 'danger',
  ui_skull: 'rubble',
  ui_trophy: 'volley',
  ui_outdated: 'danger',
  ui_asleep: 'asleep',
};

function parseArgs(argv) {
  const args = { check: false, out: DEFAULT_OUT, only: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function readIcon(name) {
  const file = path.join(UI_DIR, `${name}.svg`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/** Checks that need no browser. Returns a list of problems (empty when fine). */
function staticProblems(name, text) {
  const problems = [];
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  const viewBox = name === SKYLINE ? SKYLINE_VIEWBOX : ICON_VIEWBOX;
  const root = /<svg\b[^>]*>/.exec(body);
  if (!root) return ['xml: no <svg> root element'];
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(root[0])) problems.push('xml: the root needs xmlns="http://www.w3.org/2000/svg"');
  const vb = /viewBox="([^"]*)"/.exec(root[0]);
  if (!vb || vb[1].trim().replace(/\s+/g, ' ') !== viewBox) problems.push(`viewbox: expected "${viewBox}", found "${vb ? vb[1] : 'none'}"`);
  if (name === SKYLINE && !/preserveAspectRatio="none"/.test(root[0])) {
    problems.push('viewbox: the skyline root needs preserveAspectRatio="none" (it is stretched into the bar)');
  }
  if (name !== SKYLINE && /preserveAspectRatio=/.test(root[0])) problems.push('viewbox: icons must not set preserveAspectRatio');
  for (const tag of ['text', 'tspan', 'textPath', 'image', 'script', 'style', 'foreignObject', 'use', 'a', 'font']) {
    if (new RegExp(`<${tag}[\\s>/]`).test(body)) problems.push(`no-text: <${tag}> is not allowed`);
  }
  if (/\sstyle=/.test(body)) problems.push('color: style attributes are not allowed (use fill / stroke attributes)');
  if (/\sid=/.test(body)) problems.push('no-text: id attributes are not allowed (icons are inlined many times into one page)');
  if (/\b(href|xlink:href)=/.test(body)) problems.push('no-text: no links or references');
  let sawCurrent = false;
  for (const m of body.matchAll(/\s(fill|stroke|stop-color|flood-color|color)="([^"]*)"/g)) {
    if (m[2] === 'currentColor') sawCurrent = true;
    else if (m[2] !== 'none') problems.push(`color: ${m[1]}="${m[2]}" (only "currentColor" and "none" are allowed)`);
  }
  if (!sawCurrent) problems.push('color: nothing uses currentColor');
  if (name !== SKYLINE) {
    const weights = new Set([...body.matchAll(/\sstroke-width="([^"]*)"/g)].map((m) => m[1]));
    for (const w of weights) if (w !== STROKE_WEIGHT) problems.push(`weight: stroke-width="${w}" (the set uses ${STROKE_WEIGHT} everywhere)`);
    if (!/stroke-linecap="round"/.test(root[0]) || !/stroke-linejoin="round"/.test(root[0])) {
      problems.push('weight: the root must set stroke-linecap="round" and stroke-linejoin="round"');
    }
  }
  return problems;
}

/**
 * Checks that need a renderer: well-formed XML, and the ink (what is actually painted).
 * Runs in the page. Returns { name: { problems: [], ink: {x0, y0, x1, y1, cover} } }.
 */
async function renderedProblems(page, icons) {
  return page.evaluate(async ({ list, margin }) => {
    const out = {};
    for (const { name, text, wide } of list) {
      const problems = [];
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') {
        out[name] = { problems: ['xml: not well-formed'], ink: null };
        continue;
      }
      // Paint the file the way an <img> would, 4 px per unit, and look at the alpha channel.
      const scale = 4;
      const w = (wide ? 400 : 64) * scale;
      const h = 64 * scale;
      const sized = text.replace(/<svg\b/, `<svg width="${w}" height="${h}"`);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
      try {
        await img.decode();
      } catch {
        out[name] = { problems: ['xml: the browser cannot draw this file'], ink: null };
        continue;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0, edge = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 64) {
            count++;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
            // The skyline is meant to run off the left, right and bottom edges; only its top must be clear.
            if (y === 0 || (!wide && (x === 0 || x === w - 1 || y === h - 1))) edge++;
          }
        }
      }
      if (count === 0) problems.push('ink: the icon is empty');
      if (edge > 0) problems.push('ink: the drawing touches the edge of the viewBox (something is cut off)');
      const ink = { x0: x0 / scale, y0: y0 / scale, x1: (x1 + 1) / scale, y1: (y1 + 1) / scale, cover: count / (w * h) };
      if (!wide && count > 0 && (ink.x1 - ink.x0 < 36 && ink.y1 - ink.y0 < 36)) problems.push('ink: the drawing is very small inside its 64 x 64 box');
      // A quarter of a unit of slack: the measurement is made on a 4 px per unit raster.
      const lo = margin - 0.25;
      const hi = 64 - margin + 0.25;
      if (!wide && count > 0 && (ink.x0 < lo || ink.y0 < lo || ink.x1 > hi || ink.y1 > hi)) {
        problems.push(`margin: the drawing must stay inside ${margin} .. ${64 - margin}; it covers ${ink.x0}, ${ink.y0} .. ${ink.x1}, ${ink.y1}`);
      }
      out[name] = { problems, ink };
    }
    return out;
  }, { list: icons, margin: MARGIN });
}

// ---------------------------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------------------------

const SHEET_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font: 12px/1.2 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; background: ${COLORS.dark}; color: #aab1c2; }
  #sheet { display: inline-block; padding: 14px; background: ${COLORS.dark}; }
  h1 { font-size: 17px; margin: 0 0 4px; color: #fff; font-weight: 600; }
  h2 { font-size: 13px; margin: 14px 0 6px; color: #fff; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  p.note { margin: 0 0 8px; max-width: 900px; }
  .grid { display: grid; gap: 8px; }
  .cell { display: flex; flex-direction: column; gap: 3px; }
  .pair { display: flex; gap: 4px; }
  .panel { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 4px; }
  .panel.dark { background: ${COLORS.darkPanel}; color: ${COLORS.onDark}; }
  .panel.light { background: ${COLORS.lightPanel}; color: ${COLORS.onLight}; }
  .panel svg { display: block; flex: none; }
  .s128 { width: 128px; height: 128px; } .s64 { width: 64px; height: 64px; } .s32 { width: 32px; height: 32px; }
  .name { font-size: 12px; color: #d5d9e3; padding-left: 2px; }
  .missing { width: 128px; height: 128px; border: 2px dashed #e0457b; color: #e0457b; display: flex; align-items: center; justify-content: center; }
  .tiny { display: grid; gap: 16px; padding: 16px; border-radius: 4px; }
  .tiny svg { width: 32px; height: 32px; display: block; }
  .zoom { image-rendering: pixelated; display: block; }
`;

function iconMarkup(name, cls) {
  const text = readIcon(name);
  if (!text) return `<div class="missing ${cls}">?</div>`;
  // Inline, the way the client uses the files, so that currentColor takes the panel's color.
  return text.replace(/<\?xml[^>]*\?>/, '').replace(/<svg\b/, `<svg class="${cls}"`);
}

function cellHtml(name) {
  const sizes = ['s128', 's64', 's32'];
  const panel = (kind) => `<div class="panel ${kind}">${sizes.map((s) => iconMarkup(name, s)).join('')}</div>`;
  return `<div class="cell"><div class="pair">${panel('dark')}${panel('light')}</div><div class="name">${name}</div></div>`;
}

function groupHtml(group, columns) {
  return `<h2>${group.title}</h2><div class="grid" style="grid-template-columns: repeat(${columns}, max-content)">${group.icons
    .map(cellHtml)
    .join('')}</div>`;
}

function pageHtml(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${SHEET_CSS}</style></head><body><div id="sheet">${inner}</div></body></html>`;
}

async function shoot(page, html, file) {
  await page.setContent(html, { waitUntil: 'load' });
  const el = await page.$('#sheet');
  const buffer = await el.screenshot({ path: file || undefined, type: 'png' });
  return buffer;
}

/**
 * The legibility test. Pass 1 paints every icon at true 32 px; pass 2 shows those very pixels
 * again, three times larger and not smoothed, so that what a player gets can be judged.
 */
async function sheet32(page, groups, file, light) {
  const columns = 10;
  const cells = groups.flatMap((g) =>
    g.icons.map((n) => {
      const color = light ? COLORS.onLight : COLORS[OWN_TINT[n] || g.tint];
      return `<div style="color: ${color}" title="${n}">${iconMarkup(n, 's32')}</div>`;
    }),
  );
  const grid = `<div class="tiny" style="grid-template-columns: repeat(${columns}, 32px); background: ${
    light ? COLORS.lightPanel : COLORS.darkPanel
  }">${cells.join('')}</div>`;
  const raw = await shoot(page, pageHtml(grid), null);
  const uri = `data:image/png;base64,${raw.toString('base64')}`;
  const width = raw.readUInt32BE(16); // the PNG header holds the picture's width
  const html = pageHtml(
    `<h1>UI pictograms at 32 px, ${light ? 'dark on light' : 'in the colors they wear in the game'}</h1>` +
      `<p class="note">Top: true size. Bottom: the very same pixels enlarged 3 times. Order: ${groups
        .map((g) => g.title.toLowerCase())
        .join(', ')}.</p>` +
      `<img src="${uri}" style="display:block"><div style="height:10px"></div><img class="zoom" src="${uri}" style="width:${width * 3}px">`,
  );
  await shoot(page, html, file);
}

/** Sky backdrops close to the game's three times of day, to judge icons that sit straight on the picture. */
const SKIES = {
  afternoon: 'linear-gradient(#4f9be6 0%, #9cc9f2 55%, #b9bcc6 56%, #8f96a8 100%)',
  sunset: 'linear-gradient(#5b3a78 0%, #e8743a 50%, #ffc46b 56%, #3a3340 57%, #2a2630 100%)',
  night: 'linear-gradient(#0a0e1e 0%, #1a2340 55%, #11131c 56%, #0b0c12 100%)',
};

/**
 * The destruction bar the way the client should build it from skyline.svg: the file stretched
 * into a box of the given size (the root carries preserveAspectRatio="none"), the class
 * "sky-city" clipped from the left by the fill, the class "sky-rubble" in rubble grey, an orange
 * edge at the fill line, and the mark icons hanging under the three marks (18 px, as in the client).
 */
function barHtml(width, height, fill, id, withMarks = true) {
  const text = readIcon(SKYLINE);
  if (!text) return '';
  const pct = (fill * 100).toFixed(1);
  const marks = withMarks
    ? [0.21, 0.57, 1]
        .map((m, i) => {
          const color = fill >= m ? COLORS.kaiju : 'rgba(255,255,255,.55)';
          return `<span class="ic" style="position:absolute;top:100%;left:${m * 100}%;transform:translateX(-100%);width:18px;height:18px;color:${color}">${iconMarkup(
            i === 2 ? 'lb_kaiju' : 'k_molt',
            '',
          )}</span>`;
        })
        .join('')
    : '';
  const edge = fill > 0 ? `<i style="position:absolute;top:0;bottom:0;left:calc(${pct}% - 1.5px);width:3px;background:${COLORS.kaiju}"></i>` : '';
  return (
    `<div class="${id}" style="position:relative;width:${width}px;height:${height}px;color:#e9edf7">` +
    `<style>.${id} .sky-city { clip-path: inset(0 0 0 ${pct}%); } .${id} .sky-rubble { color: ${COLORS.rubble}; }</style>` +
    text.replace(/<\?xml[^>]*\?>/, '').replace(/<svg\b/, `<svg style="display:block;width:100%;height:100%;filter:drop-shadow(0 2px 2px rgba(0,0,0,.6))"`) +
    edge +
    marks +
    `</div>`
  );
}

async function sheetSkyline(page, file) {
  if (!readIcon(SKYLINE)) return false;
  let n = 0;
  const row = (label, sky, width, height, fill) =>
    `<div style="margin:8px 0 3px;color:#d5d9e3">${label}</div>` +
    `<div style="display:inline-block;background:${SKIES[sky]};padding:10px 16px 28px;border-radius:4px">${barHtml(width, height, fill, `sk${n++}`)}</div>`;
  const { width: W, height: H } = BAR_BOX;
  const html = pageHtml(
    `<style>.ic { display: inline-block; flex: none; } .ic svg { width: 100%; height: 100%; display: block; }</style>` +
      `<h1>skyline.svg: the destruction bar</h1><p class="note">viewBox 0 0 400 64, drawn to be stretched into the client's bar, ${W} x ${H} px ` +
      `(1.4 px per unit across, 0.72 px per unit up). The three towers end at x = 84, 228 and 400 (21%, 57%, 100%). The UI clips the class ` +
      `"sky-city" from the left as the bar fills; the class "sky-rubble" underneath stays. The mark icons are k_molt, k_molt and lb_kaiju at 18 px.</p>` +
      `<h2>Whole</h2>` +
      row(`${W} x ${H} px: the client's box, true pixels`, 'afternoon', W, H, 0) +
      row(`${W * 2} x ${H * 2} px: the same, twice the size`, 'afternoon', W * 2, H * 2, 0) +
      row(`397 x ${H} px: 62% of a 640 px wide screen`, 'sunset', 397, H, 0) +
      `<h2>Crumbling left to right (rubble in grey, orange edge at the fill line)</h2>` +
      [0.1, 0.19, 0.21, 0.4, 0.57, 0.8, 0.97, 1].map((f) => row(`filled ${Math.round(f * 100)}%`, f < 0.3 ? 'afternoon' : f < 0.6 ? 'sunset' : 'night', W, H, f)).join(''),
  );
  await shoot(page, html, file);
  return true;
}

/**
 * The legibility test that matters: every icon at the sizes the client's stylesheet really uses
 * (client/src/styles.css), in the colors it wears there, over the three skies. Each strip is
 * painted at true size and then shown again enlarged without smoothing.
 */
async function sheetRealSizes(page, file) {
  const C = COLORS;
  const shadow = 'filter:drop-shadow(0 1px 1px #000);';
  const gap = (px) => `<span style="display:inline-block;width:${px}px"></span>`;
  const strips = [];
  const add = (label, sky, html) => strips.push({ label, bg: SKIES[sky] || sky, html });

  // Button glyphs: 18 px (small glyphs), .hint-glyph 24 px (19 px on small screens).
  const pad = GROUPS.find((g) => g.id === 'gamepad').icons;
  const mouse = ['ms_left', 'ms_right', 'ms_middle', 'ms_move'];
  for (const px of [18, 19, 24]) {
    add(
      `button glyphs at ${px} px (${px === 18 ? 'small glyphs' : px === 19 ? 'verb hints, small screens' : 'verb hints'}): ${pad.join(' ')} | ${mouse.join(' ')} | kb_key W, M, 1`,
      px === 19 ? 'afternoon' : C.darkPanel,
      [...pad, ...mouse].map((n) => `<span style="margin-right:6px;${shadow}">${ic(n, px, C.ink)}</span>`).join('') +
        ['W', 'M', '1'].map((l) => `<span style="margin-right:6px;${shadow}">${keycap(l, px, C.ink)}</span>`).join(''),
    );
  }

  // HUD: meters 20 px, bar marks 18 px, clock 26 / 20 px, stage pips 18 / 28 / 42 px. No panel behind them.
  const meters = [['st_health', C.health], ['st_nerve', C.nerve], ['st_rage', C.kaiju], ['st_charge', C.volley], ['st_reload', C.human]];
  const marks = [['k_molt', 'rgba(255,255,255,.55)'], ['k_molt', C.kaiju], ['k_molt', C.volley], ['lb_kaiju', 'rgba(255,255,255,.55)'], ['lb_kaiju', C.kaiju]];
  for (const sky of ['afternoon', 'sunset', 'night']) {
    add(
      `HUD on the ${sky} sky: meters 20 px (health, nerve, rage, charge, reload) | bar marks 18 px (k_molt idle, reached, ready; lb_kaiju idle, reached) | clock sun 26, moon 20 | stage pips 18, 28, 42`,
      sky,
      meters.map(([n, c]) => `<span style="margin-right:8px;${shadow}">${ic(n, 20, c)}</span>`).join('') +
        gap(14) +
        marks.map(([n, c]) => `<span style="margin-right:8px">${ic(n, 18, c)}</span>`).join('') +
        gap(14) +
        `<span style="margin-right:8px;filter:drop-shadow(0 0 4px rgba(0,0,0,.8))">${ic('st_sun', 26, C.volley)}</span>${ic('st_moon', 20, C.moon)}` +
        gap(14) +
        [18, 28, 42].map((px) => `<span style="margin-right:4px">${ic('lb_kaiju', px, C.kaiju)}</span>`).join(''),
    );
  }

  // Verb hints: a 32 px icon in a 46 px tile (26 in 38 on small screens).
  const tile = (n, px, box, color, border = 'rgba(255,255,255,.3)') =>
    `<span style="display:inline-flex;align-items:center;justify-content:center;width:${box}px;height:${box}px;border-radius:10px;background:rgba(14,18,30,.7);border:2px solid ${border};margin-right:6px">${ic(n, px, color)}</span>`;
  const kaijuVerbs = [...GROUPS.find((g) => g.id === 'kaiju').icons, 'st_camera'];
  const humanVerbs = ['st_reload', 'st_charge', 'st_map', 'st_camera'];
  for (const [px, box] of [[32, 46], [26, 38]]) {
    add(
      `verb hints, ${px} px in a ${box} px tile: ${kaijuVerbs.join(' ')} | ${humanVerbs.join(' ')}`,
      px === 32 ? 'afternoon' : 'night',
      kaijuVerbs.map((n) => tile(n, px, box, C.ink)).join('') + gap(16) + humanVerbs.map((n) => tile(n, px, box, C.ink)).join(''),
    );
  }
  add(
    `verb hints, 26 px, the states: unavailable (dimmed), ready (yellow), active (cyan)`,
    'sunset',
    kaijuVerbs.map((n) => tile(n, 26, 38, 'rgba(255,255,255,.4)')).join('') +
      gap(16) +
      ['k_special', 'k_molt'].map((n) => tile(n, 26, 38, C.volley, C.volley)).join('') +
      tile('k_brace', 26, 38, C.human, C.human),
  );

  // Status pictures: 52 px (spotted 30, eliminated 34), straight on the picture.
  const status = [
    ['st_crossfire', C.volley, 52], ['st_spotted', C.kaiju, 30], ['st_shaken', C.danger, 52], ['st_nerve', C.nerve, 52],
    ['st_charge', C.volley, 52], ['st_callin', C.danger, 52], ['ui_offline', C.danger, 52], ['ui_skull', C.rubble, 34],
  ];
  for (const sky of ['afternoon', 'sunset', 'night']) {
    add(
      `status pictures on the ${sky} sky: crossfire, spotted (30), shaken, nerve break, volley, call-in, offline, eliminated (34)`,
      sky,
      status.map(([n, c, px]) => `<span style="margin-right:12px;filter:drop-shadow(0 2px 3px #000)">${ic(n, px, c)}</span>`).join(''),
    );
  }

  // End screen: tally icons at 22 px, side by side (no overlap), on the panel and on newsprint.
  const tally = GROUPS.find((g) => g.id === 'tally').icons;
  const group = (n, count, color) =>
    `<span style="display:inline-flex;align-items:center;margin-right:10px">${Array.from({ length: count }, () => `<span style="margin-right:2px">${ic(n, 22, color)}</span>`).join('')}</span>`;
  add(`end screen tally at 22 px, 2 px apart: ${tally.join(' ')}`, C.darkPanel, tally.map((n) => group(n, 3, C.ink)).join(''));
  add('the same on newsprint', '#efe9d8', tally.map((n) => group(n, 3, C.paperInk)).join(''));
  add(
    'end banner: winner 44 px, trophy 31 px, reason 26 px (tl_tower, ui_skull, ui_clock) | front page stand-in 54 px',
    C.darkPanel,
    [['lb_kaiju', C.kaiju, 44], ['ui_trophy', C.volley, 31], ['tl_tower', C.ink, 26], ['ui_skull', C.ink, 26], ['ui_clock', C.ink, 26]]
      .map(([n, c, px]) => `<span style="margin-right:10px">${ic(n, px, c)}</span>`)
      .join('') +
      gap(16) +
      `<span style="display:inline-flex;align-items:center;justify-content:center;width:96px;height:72px;background:#8d8d94">${ic('ui_newspaper', 54, '#efe9d8')}</span>`,
  );

  // Lobby and home: seats 30 / 22 px, flags 24 px, buttons 30 and 44 px, notices 36 px, factions 30 and 20 px.
  add(
    'lobby: seats 30 and 22 px, flags 24, buttons 30 and 44, notices 36 (offline, warning, copy), factions 30 and 20, sound 30',
    C.darkPanel,
    [
      ['lb_kaiju', C.kaiju, 30], ['lb_human', C.human, 30], ['lb_bot', C.ink, 30], ['lb_kaiju', C.kaiju, 22], ['lb_human', C.human, 22], ['lb_bot', C.ink, 22],
      ['lb_host', C.volley, 24], ['lb_ready', '#49d17d', 24], ['ui_offline', C.ink, 24], ['lb_link', C.ink, 30], ['lb_back', C.ink, 30],
      ['lb_create', C.ink, 44], ['lb_join', C.ink, 44], ['lb_play', C.ink, 44], ['ui_offline', C.danger, 36], ['ui_warning', C.danger, 36], ['ui_copy', C.danger, 36],
      ['fac_army', C.human, 30], ['fac_air', C.human, 30], ['fac_science', C.human, 30], ['fac_faith', C.human, 30],
      ['fac_army', C.human, 20], ['fac_air', C.human, 20], ['fac_science', C.human, 20], ['fac_faith', C.human, 20], ['ui_sound', C.ink, 30],
    ]
      .map(([n, c, px]) => `<span style="margin-right:10px">${ic(n, px, c)}</span>`)
      .join(''),
  );

  // Paint each strip at true size (wrapped at 500 px, so the enlargement stays narrow enough to
  // look at), then show the same pixels again, enlarged.
  const zoom = 3;
  const parts = [];
  for (const strip of strips) {
    const raw = await shoot(
      page,
      pageHtml(
        `<style>${CONTEXT_CSS}</style><div style="display:flex;flex-wrap:wrap;align-items:center;row-gap:8px;max-width:500px;padding:8px 10px;background:${strip.bg}">${strip.html}</div>`,
      ).replace(
        'padding: 14px',
        'padding: 0',
      ),
      null,
    );
    const w = raw.readUInt32BE(16);
    const h = raw.readUInt32BE(20);
    const uri = `data:image/png;base64,${raw.toString('base64')}`;
    parts.push(
      `<div style="margin:10px 0 3px;color:#d5d9e3;max-width:1500px">${strip.label}</div>` +
        `<img src="${uri}" style="display:block;margin-bottom:3px"><img class="zoom" src="${uri}" style="width:${w * zoom}px;height:${h * zoom}px">`,
    );
  }
  await shoot(
    page,
    pageHtml(
      `<h1>UI pictograms at the sizes the client really uses</h1><p class="note" style="max-width:1500px">Sizes and colors are those of client/src/styles.css. ` +
        `For each strip: the true pixels, then the same pixels enlarged ${zoom} times. An icon that cannot be named from the top strip is not finished.</p>` +
        parts.join(''),
    ),
    file,
  );
}

/**
 * Before and after pictures for the changes that only the client can make (they are written up
 * in docs/art/client-notes-ui-icons.md): each row shows what the client's stylesheet and code do
 * now, and what they should do, at true size and enlarged.
 */
async function sheetClientFixes(page, file) {
  const C = COLORS;
  const rows = [];
  const add = (label, bg, now, wanted) => rows.push({ label, bg: SKIES[bg] || bg, now, wanted });
  const font = `font-family:'Trebuchet MS','Segoe UI',Verdana,'DejaVu Sans',sans-serif`;

  // Note 3. Tally icons: 22 px, margin-right -8 px (overlapping) against 2 px.
  const tally = GROUPS.find((g) => g.id === 'tally').icons;
  const tallyRow = (margin) =>
    tally
      .map((n) => `<span style="display:inline-flex;align-items:center;margin-right:10px">${Array.from({ length: 3 }, () => `<span style="margin-right:${margin}px">${ic(n, 22, C.ink)}</span>`).join('')}</span>`)
      .join('');
  add('Note 3. End screen tally (.tally-icon, 22 px): margin-right -8px now, 2px wanted', C.darkPanel, tallyRow(-8), tallyRow(2));

  // Note 4. The letter on the keycap: centered on the whole glyph now, on the key's top face wanted.
  const key = (label, px, inset) =>
    `<span style="position:relative;display:inline-block;width:${px}px;height:${px}px;line-height:0;margin-right:6px;color:${C.ink};filter:drop-shadow(0 1px 1px #000)">` +
    `${ic('kb_key', px, C.ink)}<span style="position:absolute;inset:${inset};display:flex;align-items:center;justify-content:center;font-size:${px * 0.48}px;font-weight:700;line-height:1;${font}">${label}</span></span>`;
  const keys = (inset) => [19, 24, 40].map((px) => ['W', 'M', 'Q', '1', '␣', '⇧', '⏎'].map((l) => key(l, px, inset)).join('')).join('<span style="display:inline-block;width:10px"></span>');
  add('Note 4. Key letter (.glyph-label) at 19, 24 and 40 px: inset 0 now, inset 0 0 17% 0 wanted', C.darkPanel, keys('0'), keys('0 0 17% 0'));

  // Note 7. Orange and pale icons straight on the sky: one soft shadow now, a dark outline wanted.
  const hud = (filter, markFilter) =>
    [['st_health', C.health], ['st_nerve', C.nerve], ['st_rage', C.kaiju], ['st_charge', C.volley], ['st_reload', C.human]]
      .map(([n, c]) => `<span style="margin-right:8px;filter:${filter}">${ic(n, 20, c)}</span>`)
      .join('') +
    `<span style="display:inline-block;width:12px"></span>` +
    [['k_molt', 'rgba(255,255,255,.55)'], ['k_molt', C.kaiju], ['k_molt', C.volley], ['lb_kaiju', C.kaiju]]
      .map(([n, c]) => `<span style="margin-right:8px;filter:${markFilter}">${ic(n, 18, c)}</span>`)
      .join('') +
    `<span style="display:inline-block;width:12px"></span>` +
    [18, 28, 42].map((px) => `<span style="margin-right:4px;filter:${markFilter}">${ic('lb_kaiju', px, C.kaiju)}</span>`).join('');
  const outline = 'drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000) drop-shadow(0 1px 1px #000)';
  add('Note 7. HUD icons with no panel behind them, on the sunset sky: meters, bar marks, stage pips. Now: one shadow (meters) or none; wanted: ' + outline, 'sunset', hud('drop-shadow(0 1px 1px #000)', 'none'), hud(outline, outline));
  add('Note 7, the same on the afternoon sky', 'afternoon', hud('drop-shadow(0 1px 1px #000)', 'none'), hud(outline, outline));

  // Note 8. The spotted mark: the thing spotted is the kaiju, so it wears the kaiju's orange.
  const spotted = (c) => `<span style="filter:drop-shadow(0 2px 3px #000)">${ic('st_spotted', 30, c)}</span>`;
  add('Note 8. st_spotted (.status-spotted, 30 px): human cyan now, kaiju orange wanted', 'afternoon', spotted(C.human), spotted(C.kaiju));

  const zoom = 3;
  const parts = [];
  for (const row of rows) {
    const cells = [];
    for (const [title, html] of [['now', row.now], ['wanted', row.wanted]]) {
      const raw = await shoot(
        page,
        pageHtml(`<style>${CONTEXT_CSS}</style><div style="display:flex;flex-wrap:wrap;align-items:center;row-gap:8px;max-width:480px;padding:8px 10px;background:${row.bg}">${html}</div>`).replace(
          'padding: 14px',
          'padding: 0',
        ),
        null,
      );
      const w = raw.readUInt32BE(16);
      const h = raw.readUInt32BE(20);
      const uri = `data:image/png;base64,${raw.toString('base64')}`;
      cells.push(
        `<div style="margin-bottom:6px"><div style="color:${title === 'now' ? '#ff9d9d' : '#9de0a8'};margin-bottom:2px">${title}</div>` +
          `<img src="${uri}" style="display:block;margin-bottom:3px"><img class="zoom" src="${uri}" style="width:${w * zoom}px;height:${h * zoom}px"></div>`,
      );
    }
    parts.push(`<div style="margin:12px 0 4px;color:#fff;max-width:1450px">${row.label}</div>${cells.join('')}`);
  }
  await shoot(
    page,
    pageHtml(
      `<h1>UI pictograms: what the client has to change (docs/art/client-notes-ui-icons.md)</h1><p class="note" style="max-width:1450px">` +
        `The numbers are the note numbers of that page. For each: what the client's stylesheet or code does now, then what it should do. True pixels, then the same pixels enlarged ${zoom} times.</p>` +
        parts.join(''),
    ),
    file,
  );
}

/** An icon at a size and in a color, for the mock-ups below. */
function ic(name, px, color) {
  return `<span class="ic" style="width:${px}px;height:${px}px;color:${color}">${iconMarkup(name, '')}</span>`;
}

/**
 * A keycap with its letter, the way the UI adds it: the letter is centered on (32, 26.5) of the
 * 64 x 64 box, which is 50% across and 41.4% down, and is about 0.4 of the icon's size.
 */
function keycap(letter, px, color) {
  return `<span class="ic key" style="width:${px}px;height:${px}px;color:${color}">${iconMarkup('kb_key', '')}<b style="font-size:${
    px * 0.4
  }px">${letter}</b></span>`;
}

const CONTEXT_CSS = `
  .ic { display: inline-block; flex: none; position: relative; }
  .ic svg { width: 100%; height: 100%; display: block; }
  .key b { position: absolute; left: 0; right: 0; top: 41.4%; transform: translateY(-50%); text-align: center; font-weight: 700; line-height: 1; }
  .row { display: flex; align-items: center; gap: 8px; }
  .scene { position: relative; width: 560px; height: 340px; border-radius: 6px; overflow: hidden; }
  .scene.kaiju { background: linear-gradient(#3b2a52, #a2543f 62%, #2b3040 62%, #1a1d28); }
  .scene.human { background: linear-gradient(#27456b, #6c8fb5 62%, #2b3040 62%, #1a1d28); }
  .tile { width: 46px; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .tile .face { width: 46px; height: 46px; border-radius: 8px; background: rgba(10, 12, 18, .62); display: flex; align-items: center; justify-content: center; }
  .meter { width: 120px; height: 9px; border-radius: 5px; background: rgba(10, 12, 18, .62); overflow: hidden; }
  .meter i { display: block; height: 100%; border-radius: 5px; }
  .chip { display: flex; align-items: center; gap: 4px; padding: 4px 7px; border-radius: 16px; background: rgba(10, 12, 18, .62); }
  .slot { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; background: ${COLORS.darkPanel}; }
  .btn { display: flex; align-items: center; justify-content: center; width: 50px; height: 50px; border-radius: 10px; background: ${COLORS.darkPanel}; }
`;

/** The destruction bar as the UI builds it from skyline.svg, in the proportion of the client's bar. */
function skylineBar(width, fill, id) {
  return barHtml(width, Math.round((width * BAR_BOX.height) / BAR_BOX.width), fill, id);
}

/**
 * The icons where they will live: a mock-up of the two heads-up displays, the lobby and the end
 * screen tally. It is not the real UI, only a way to judge the set in use, in color, at the
 * sizes the game is likely to draw it.
 */
async function sheetInContext(page, file) {
  const C = COLORS;
  const verb = (icon, glyph, hot) =>
    `<div class="tile"><div class="face" style="${hot ? `outline:2px solid ${C.volley}` : ''}">${ic(icon, 36, C.kaiju)}</div>${glyph}</div>`;
  const meter = (icon, color, amount) =>
    `<div class="row">${ic(icon, 24, color)}<div class="meter"><i style="width:${amount}%;background:${color}"></i></div></div>`;

  const kaijuHud =
    `<div class="scene kaiju">` +
    `<div style="position:absolute;left:70px;top:12px">${skylineBar(420, 0.34, 'skyA')}</div>` +
    `<div class="row" style="position:absolute;left:12px;top:92px">${ic('st_sun', 22, C.onDark)}<div style="width:150px;height:3px;border-radius:2px;background:rgba(255,255,255,.35);position:relative"><i style="position:absolute;left:38%;top:-4px;width:11px;height:11px;border-radius:6px;background:${C.onDark}"></i></div>${ic('st_moon', 22, C.onDark)}</div>` +
    `<div style="position:absolute;left:12px;bottom:84px;display:flex;flex-direction:column;gap:6px">${meter('st_health', C.onDark, 72)}${meter('st_nerve', C.onDark, 38)}${meter('st_rage', C.kaiju, 86)}</div>` +
    `<div class="row" style="position:absolute;left:12px;bottom:10px;gap:6px;align-items:flex-start">` +
    verb('k_swipe', ic('ms_left', 22, C.onDark)) +
    verb('k_stomp', ic('ms_left', 22, C.onDark)) +
    verb('k_grab', ic('ms_right', 22, C.onDark)) +
    verb('k_throw', ic('ms_right', 22, C.onDark)) +
    verb('k_eat', ic('ms_right', 22, C.onDark)) +
    verb('k_brace', keycap('Q', 22, C.onDark)) +
    verb('k_roar', keycap('R', 22, C.onDark)) +
    verb('k_special', keycap('F', 22, C.onDark)) +
    verb('k_molt', keycap('E', 22, C.onDark), true) +
    `</div></div>`;

  const unit = (extra) => `<div class="chip"><i style="width:14px;height:14px;border-radius:7px;background:${C.human}"></i>${extra}</div>`;
  const humanHud =
    `<div class="scene human">` +
    `<div style="position:absolute;left:70px;top:12px">${skylineBar(420, 0.34, 'skyB')}</div>` +
    `<div style="position:absolute;left:12px;bottom:10px;display:flex;flex-direction:column;gap:5px">` +
    unit(ic('st_health', 16, C.onDark)) +
    unit(ic('st_veteran', 16, C.onDark) + ic('st_charge', 16, C.volley)) +
    unit(ic('st_charge', 16, C.volley)) +
    unit(ic('st_shaken', 16, C.onDark)) +
    `</div>` +
    `<div style="position:absolute;right:12px;top:92px;display:flex;flex-direction:column;gap:8px;align-items:flex-end">` +
    `<div class="chip">${ic('st_spotted', 26, C.kaiju)}</div>` +
    `<div class="chip">${ic('st_crossfire', 26, C.volley)}</div>` +
    `</div>` +
    `<div class="row" style="position:absolute;right:12px;bottom:10px">${ic('st_map', 26, C.onDark)}${ic('gp_back', 20, C.onDark)}<span style="width:8px"></span>${ic('st_camera', 26, C.onDark)}${ic('gp_rs', 20, C.onDark)}</div>` +
    `</div>`;

  const slot = (who, color, faction, extra) =>
    `<div class="slot">${ic(who, 34, color)}${faction ? ic(faction, 26, C.onDark) : ''}${extra}</div>`;
  const lobby =
    `<div class="row" style="gap:10px;flex-wrap:wrap">` +
    slot('lb_kaiju', C.kaiju, null, ic('lb_host', 22, C.volley) + ic('lb_ready', 22, C.grass)) +
    slot('lb_human', C.human, 'fac_army', ic('lb_ready', 22, C.grass)) +
    slot('lb_human', C.human, 'fac_air', ic('lb_ready', 22, '#4a5068')) +
    slot('lb_bot', C.human, 'fac_science', '') +
    slot('lb_bot', C.human, 'fac_faith', '') +
    `<span style="width:14px"></span>` +
    ['lb_back', 'lb_link', 'lb_create', 'lb_join'].map((n) => `<div class="btn">${ic(n, 30, C.onDark)}</div>`).join('') +
    `<div class="btn" style="background:${C.volley}">${ic('lb_play', 32, C.dark)}</div>` +
    `</div>`;

  const tally = [
    ['tl_car', 9], ['tl_kiosk', 4], ['tl_house', 6], ['tl_shop', 3], ['tl_apartment', 3],
    ['tl_office', 2], ['tl_tower', 1], ['tl_factory', 2], ['tl_bridge', 1], ['tl_landmark', 1],
  ]
    .map(([n, count]) => `<div class="row" style="gap:1px">${Array.from({ length: count }, () => ic(n, 26, '#3a3d48')).join('')}</div>`)
    .join('<span style="width:10px"></span>');

  const html = pageHtml(
    `<style>${CONTEXT_CSS}</style>` +
      `<h1>UI pictograms in context</h1><p class="note">A mock-up to judge the set in use, not the real screens. Humans cyan, kaiju orange, volley yellow; ` +
      `keycaps get their letter from code.</p>` +
      `<h2>Kaiju view: bar, clock, meters, verbs with their buttons</h2><div class="row" style="align-items:flex-start;gap:12px">${kaijuHud}` +
      `<div><h2 style="margin-top:0">Human view: squad, alerts</h2>${humanHud}</div></div>` +
      `<h2>Lobby</h2>${lobby}` +
      `<h2>End screen tally</h2><div style="background:#e9e4d6;border-radius:6px;padding:10px 12px;display:flex;flex-wrap:wrap;align-items:center;max-width:1132px;row-gap:6px">${tally}</div>`,
  );
  await shoot(page, html, file);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const groups = args.only ? GROUPS.filter((g) => g.id === args.only) : GROUPS;
  if (args.only && args.only !== SKYLINE && groups.length === 0) {
    console.error(`no group "${args.only}". Groups: ${GROUPS.map((g) => g.id).join(', ')}, ${SKYLINE}`);
    process.exit(2);
  }
  const expected = [...GROUPS.flatMap((g) => g.icons), SKYLINE];

  // --- checks ---
  let failed = 0;
  const report = {};
  const present = [];
  for (const name of expected) {
    const text = readIcon(name);
    if (text === null) {
      report[name] = ['exists: the file is missing'];
      failed++;
    } else {
      report[name] = staticProblems(name, text);
      present.push({ name, text, wide: name === SKYLINE });
    }
  }
  const strays = fs.existsSync(UI_DIR)
    ? fs.readdirSync(UI_DIR).filter((f) => f.endsWith('.svg') && !expected.includes(f.slice(0, -4)))
    : [];

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  let ink = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><html><body></body></html>');
    const rendered = await renderedProblems(page, present);
    for (const [name, r] of Object.entries(rendered)) {
      report[name].push(...r.problems);
      ink[name] = r.ink;
    }

    for (const name of expected) {
      const problems = report[name];
      if (problems.length) {
        if (!problems[0].startsWith('exists')) failed++;
        console.log(`FAIL ${name}`);
        for (const p of problems) console.log(`       ${p}`);
      } else if (args.check) {
        const k = ink[name];
        console.log(`ok   ${name.padEnd(16)} ink ${k.x0.toFixed(1)},${k.y0.toFixed(1)} .. ${k.x1.toFixed(1)},${k.y1.toFixed(1)}  cover ${(k.cover * 100).toFixed(0)}%`);
      }
    }
    for (const s of strays) console.log(`WARN ${s}: not in the contract (docs/ASSETS.md section 5)`);
    console.log(`${expected.length - failed} of ${expected.length} icons pass.`);

    // --- sheets ---
    if (!args.check) {
      fs.mkdirSync(args.out, { recursive: true });
      const written = [];
      for (const g of groups) {
        const file = path.join(args.out, `ui_icons_${g.id}.png`);
        const extra =
          g.id === 'keyboard_mouse'
            ? `<style>${CONTEXT_CSS}</style><h2>kb_key with its letter (added in code, centered on 32, 26.5)</h2>` +
              `<div class="row" style="background:${COLORS.darkPanel};padding:10px;border-radius:4px;width:max-content">` +
              ['W', 'A', 'S', 'D', 'E', 'M', '1'].map((l) => keycap(l, 64, COLORS.onDark)).join('') +
              ['W', 'A', 'S', 'D', 'E', 'M', '1'].map((l) => keycap(l, 32, COLORS.onDark)).join('') +
              `</div>`
            : '';
        await shoot(page, pageHtml(`<h1>UI pictograms: ${g.title.toLowerCase()}</h1>${groupHtml(g, 2)}${extra}`), file);
        written.push(file);
      }
      if (!args.only) {
        const all = path.join(args.out, 'ui_icons.png');
        await shoot(
          page,
          pageHtml(
            `<h1>Monster Battle 9001: UI pictograms</h1><p class="note">Every icon at 128, 64 and 32 px, light on dark and dark on light. ` +
              `One 64 x 64 grid, one stroke weight (5), round corners, one color (currentColor).</p>` +
              GROUPS.map((g) => groupHtml(g, 3)).join(''),
          ),
          all,
        );
        written.push(all);
        for (const light of [false, true]) {
          const tiny = path.join(args.out, light ? 'ui_icons_32px_light.png' : 'ui_icons_32px.png');
          await sheet32(page, GROUPS, tiny, light);
          written.push(tiny);
        }
      }
      if (!args.only) {
        const real = path.join(args.out, 'ui_icons_real_sizes.png');
        await sheetRealSizes(page, real);
        written.push(real);
        const fixes = path.join(args.out, 'ui_icons_client_fixes.png');
        await sheetClientFixes(page, fixes);
        written.push(fixes);
        const context = path.join(args.out, 'ui_icons_in_context.png');
        await sheetInContext(page, context);
        written.push(context);
      }
      if (!args.only || args.only === SKYLINE) {
        const sky = path.join(args.out, 'ui_skyline.png');
        if (await sheetSkyline(page, sky)) written.push(sky);
      }
      for (const f of written) console.log(`wrote ${path.relative(process.cwd(), f)}`);
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
