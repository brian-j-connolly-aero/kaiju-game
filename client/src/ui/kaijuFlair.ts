/**
 * The monster's own charge-up round the crosshair (docs/ROADMAP.md round 4: "a charge-up style
 * rage meter of its own, styled differently from the army's diamond", and "the monster's screen
 * gets the same kind of flair as its new attack animations"). Pictures only:
 *
 *   rage        three claw gashes swirling round the crosshair, a gap at the lower right where
 *               the throw's arc comes in from the hand. Rage heats them clockwise from the
 *               bottom: an ember red scar at first, orange, then white-hot. With the beam picked
 *               and its rage there they throb and shed embers: the special is ready.
 *   a hit       the monster's blow landed: three short claw slashes flash over the crosshair
 *               (blue-white in a power surge) and the gashes flare.
 *   a molt      a new body: a hot ring bursts out from the crosshair.
 *
 * With something in the hand the gashes fade right down, so the throw's arc and where it lands
 * (render/throwPreview.ts) stay clear.
 *
 * Its label, "Rage" (round 5, ui/labels.ts), sits outside the gashes at the lower left, faded
 * with them.
 *
 * The power surge's badge is the kit's (ui/kaijuKit.ts); the HUD puts it beside the crosshair.
 */

import { clamp01, COMBAT_RULES, kaijuKindDef, type SnapKaiju } from '@mb/shared';
import { el } from './icons';
import { label, LABELS } from './labels';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The three gashes: start and end angle in degrees (clockwise from screen right, as the SVG
 * draws them), each a little spiral (its radius grows along it) so it reads as a slash, not a
 * ring. The gap between the last and the first is at the lower right.
 */
export const GASHES: ReadonlyArray<{ from: number; to: number }> = [
  { from: 66, to: 146 },
  { from: 186, to: 266 },
  { from: 306, to: 386 },
];
/**
 * The gashes' starting radius and how far each spirals out along its length (a pinwheel of
 * slashes, not a ring), and their widest (a claw's stroke: thick early, a long sharp tail).
 */
const RADIUS = 56;
const SPIRAL = 30;
const WIDTH = 15;
/** Points along a gash's outline. */
const STEPS = 20;
/** The shortest time between two hit flashes (the beam reports several hits a second). */
const HIT_GAP = 0.12;

/** How much of each gash the rage has heated (0..1 each, in order): it fills them one after the other. */
export function gashFills(rage: number): [number, number, number] {
  const f = clamp01(rage) * GASHES.length;
  return [clamp01(f), clamp01(f - 1), clamp01(f - 2)];
}

/**
 * The outline of gash `i` from its start to `upTo` (0..1) of its length: a tapered blade,
 * widest in the middle of the whole gash (so a part-filled gash keeps the full gash's shape).
 */
export function gashPath(i: number, upTo = 1): string {
  const g = GASHES[i];
  const span = Math.max(0, Math.min(1, upTo));
  if (span <= 0) return '';
  const outer: string[] = [];
  const inner: string[] = [];
  for (let s = 0; s <= STEPS; s++) {
    const t = (s / STEPS) * span;
    const a = ((g.from + (g.to - g.from) * t) * Math.PI) / 180;
    const r = RADIUS + SPIRAL * t;
    // Widest a third of the way along, then tapering to a sharp tail.
    const w = WIDTH * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.8) + 0.5;
    const c = Math.cos(a);
    const n = Math.sin(a);
    outer.push(`${((r + w / 2) * c).toFixed(1)} ${((r + w / 2) * n).toFixed(1)}`);
    inner.push(`${((r - w / 2) * c).toFixed(1)} ${((r - w / 2) * n).toFixed(1)}`);
  }
  return `M${outer.join(' L')} L${inner.reverse().join(' L')}Z`;
}

/** The heat's color at a share of rage: ember red, orange, then white-hot. */
export function heatColor(rage: number): string {
  const f = clamp01(rage);
  const stops = [
    [0, 255, 58, 16],
    [0.55, 255, 122, 26],
    [0.85, 255, 190, 70],
    [1, 255, 240, 190],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [b, r1, g1, b1] = stops[i];
    const [a, r0, g0, b0] = stops[i - 1];
    if (f <= b) {
      const u = (f - a) / (b - a);
      return `rgb(${Math.round(r0 + (r1 - r0) * u)},${Math.round(g0 + (g1 - g0) * u)},${Math.round(b0 + (b1 - b0) * u)})`;
    }
  }
  return 'rgb(255,240,190)';
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Restarts a CSS animation by taking its class off and putting it back. */
function replay(node: Element, name: string): void {
  node.classList.remove(name);
  void (node as HTMLElement).getBoundingClientRect();
  node.classList.add(name);
}

export class RageMeter {
  readonly root = el('div', 'rage-meter hidden');
  private readonly heat: SVGPathElement[] = [];
  private readonly gashes: SVGGElement;
  private readonly slashes: HTMLElement;
  private readonly burst: HTMLElement;
  private lastFill = -1;
  private lastReady = false;
  private lastHit = -1;
  private stage = 0;
  /** A new body came out while the crosshair was down (the intermission): the burst waits for it. */
  private molted = false;

  constructor() {
    const box = svg('svg', { viewBox: '-100 -100 200 200', 'aria-hidden': 'true' });
    this.gashes = svg('g', { class: 'rm-gashes' });
    for (let i = 0; i < GASHES.length; i++) {
      this.gashes.append(svg('path', { class: 'rm-scar', d: gashPath(i) }));
      const heat = svg('path', { class: 'rm-heat', d: '' });
      this.heat.push(heat);
      this.gashes.append(heat);
    }
    // Embers shed by the ready gashes (drawn only while ready).
    const embers = svg('g', { class: 'rm-embers' });
    for (let i = 0; i < 9; i++) {
      const g = GASHES[i % 3];
      const a = ((g.from + (g.to - g.from) * (0.2 + 0.3 * Math.floor(i / 3))) * Math.PI) / 180;
      const er = RADIUS + SPIRAL * (0.2 + 0.3 * Math.floor(i / 3));
      const e = svg('circle', { class: 'rm-ember', cx: (Math.cos(a) * er).toFixed(1), cy: (Math.sin(a) * er).toFixed(1), r: (1.6 + (i % 3) * 0.6).toFixed(1) });
      e.style.animationDelay = `${(i * 0.17).toFixed(2)}s`;
      embers.append(e);
    }
    this.gashes.append(embers);
    box.append(this.gashes);
    this.slashes = el('div', 'rm-hit');
    this.slashes.innerHTML =
      `<svg viewBox="-20 -20 40 40" aria-hidden="true"><g fill="currentColor">` +
      [-1, 0, 1].map((k) => `<path d="M${(-11 + k * 7).toFixed(0)} -12 L${(-8 + k * 7).toFixed(0)} -12 L${(9 + k * 7).toFixed(0)} 12 L${(6 + k * 7).toFixed(0)} 12Z"/>`).join('') +
      `</g></svg>`;
    this.burst = el('div', 'rm-burst');
    this.root.append(box, this.slashes, this.burst, label(LABELS.meters.rage, 'rm-label'));
  }

  /**
   * Every frame: `k` the local monster (null: none), `shown` whether the crosshair is up.
   * `now`: local seconds.
   */
  update(k: SnapKaiju | null, shown: boolean, now: number): void {
    const on = shown && !!k && k.alive && k.phase !== 'cocoon';
    if (this.root.classList.contains('hidden') === on) this.root.classList.toggle('hidden', !on);
    if (!k) return;
    // A new body: the ring bursts once the crosshair is back (not on the first frame seen).
    if (this.stage > 0 && k.stage > this.stage) this.molted = true;
    this.stage = k.stage;
    if (!on) return;
    if (this.molted) {
      this.molted = false;
      this.molt();
    }
    const def = kaijuKindDef(k.kind);
    const rage = clamp01(k.rage / COMBAT_RULES.rageMax);
    const fill = Math.round(rage * 100) / 100;
    if (fill !== this.lastFill) {
      this.lastFill = fill;
      const fills = gashFills(fill);
      this.heat.forEach((p, i) => p.setAttribute('d', gashPath(i, fills[i])));
      this.root.style.setProperty('--heat', heatColor(fill));
      this.root.classList.toggle('low', fill < 0.05);
      this.root.classList.toggle('hot', fill >= 0.85);
    }
    // The special is ready: the beam picked, its rage there, its cooldown over.
    const ready = k.moves.includes('beam') && k.rage >= def.actions.special.rageCost && k.cooldowns.special <= 0;
    if (ready !== this.lastReady) {
      this.lastReady = ready;
      this.root.classList.toggle('ready', ready);
    }
    this.root.classList.toggle('surging', k.surge > 0);
    // Something in the hand: the throw's arc is shown (render/throwPreview.ts); the gashes step back.
    this.root.classList.toggle('holding', k.held !== null);
  }

  /** The monster's blow landed: claw slashes flash over the crosshair and the gashes flare. */
  hit(now: number): void {
    if (this.root.classList.contains('hidden') || now - this.lastHit < HIT_GAP) return;
    this.lastHit = now;
    replay(this.slashes, 'on');
    replay(this.gashes, 'flare');
  }

  /** A new body came out of the cocoon: a hot ring bursts from the crosshair. */
  molt(): void {
    replay(this.burst, 'on');
  }
}
