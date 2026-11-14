/**
 * The tank's second reticle (docs/ROADMAP.md phase 1, "The army"). At stages 2 and 3 the turret
 * swings toward where the player looks at its own pace, and the shells leave along the turret,
 * not along the view. So a tank shows two reticles: the crosshair in the middle of the screen
 * (where the player looks, where a volley goes) and this one, a cyan sight on the point the gun
 * itself points at now (where Fire would land). It slides toward the crosshair as the turret
 * catches up and sits round it once the turret is on.
 *
 * Its ring fills as the gun reloads (full: ready to fire); its ticks turn orange when the gun is
 * on the monster; it fades when the gun's point is out of the weapon's range; a point off the
 * screen (the turret faces away from the view) is pinned to the screen's edge in its direction.
 *
 * It is placed after the camera has been placed for the frame being drawn
 * (`MatchRuntime.onCamera`), so it moves with the picture and not a frame behind it.
 */

import { el } from './icons';
import { screenSpot, type ScreenSpot, type ThreatCamera } from './threats';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING = 19;
const RING_LENGTH = 2 * Math.PI * RING;

/** What the reticle shows: where the gun points, and how the gun is. */
export interface GunSight {
  /** The world point the gun's aim ray lands on. */
  x: number;
  y: number;
  z: number;
  /** The gun is on the monster. */
  onKaiju: boolean;
  /** The point is within the weapon's range. */
  inRange: boolean;
  /** How far the gun has reloaded, 0..1 (1: ready to fire). */
  ready: number;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export class GunReticle {
  readonly root = el('div', 'gun-reticle hidden');
  private readonly reload: SVGCircleElement;
  private readonly spot: ScreenSpot = { x: 0, y: 0, onScreen: false, angle: 0 };
  private shownKey = '';
  private shownReady = -1;

  constructor() {
    this.reload = svg('circle', { class: 'gr-reload', r: RING, transform: 'rotate(-90)', 'stroke-dasharray': `${RING_LENGTH.toFixed(2)} ${RING_LENGTH.toFixed(2)}`, 'stroke-dashoffset': 0 });
    const picture = svg('svg', { viewBox: '-32 -32 64 64', 'aria-hidden': 'true' });
    picture.append(
      svg('circle', { class: 'gr-track', r: RING }),
      this.reload,
      svg('path', { class: 'gr-ticks', d: 'M0 -23 L0 -31 M23 0 L31 0 M0 23 L0 31 M-23 0 L-31 0' }),
      svg('circle', { class: 'gr-dot', r: 2.4 }),
    );
    this.root.append(picture);
  }

  hide(): void {
    if (this.shownKey === 'hidden') return;
    this.shownKey = 'hidden';
    this.root.classList.add('hidden');
  }

  /** Puts the reticle where `sight` is on the screen seen through `camera` (its matrices current). */
  place(camera: ThreatCamera, sight: GunSight): void {
    const m = camera.matrixWorldInverse.elements;
    // Into the camera's own space (three.js matrices are column-major).
    const cx = m[0] * sight.x + m[4] * sight.y + m[8] * sight.z + m[12];
    const cy = m[1] * sight.x + m[5] * sight.y + m[9] * sight.z + m[13];
    const cz = m[2] * sight.x + m[6] * sight.y + m[10] * sight.z + m[14];
    const spot = screenSpot(cx, cy, cz, (camera.fov * Math.PI) / 180, camera.aspect, 0.05, this.spot);
    const ready = Math.round(Math.min(1, Math.max(0, sight.ready)) * 100) / 100;
    if (ready !== this.shownReady) {
      this.shownReady = ready;
      this.reload.setAttribute('stroke-dashoffset', (RING_LENGTH * (1 - ready)).toFixed(2));
    }
    const key = `${spot.x.toFixed(4)}:${spot.y.toFixed(4)}:${spot.onScreen ? 1 : 0}:${sight.onKaiju ? 1 : 0}:${sight.inRange ? 1 : 0}:${ready >= 1 ? 1 : 0}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    const r = this.root;
    r.classList.remove('hidden');
    r.classList.toggle('edge', !spot.onScreen);
    r.classList.toggle('on-kaiju', sight.onKaiju);
    r.classList.toggle('out-of-range', !sight.inRange);
    r.classList.toggle('ready', ready >= 1);
    r.style.left = `${(spot.x * 100).toFixed(3)}%`;
    r.style.top = `${(spot.y * 100).toFixed(3)}%`;
  }
}
