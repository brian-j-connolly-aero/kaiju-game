/**
 * The communication rose (docs/ROADMAP.md, round 4): hold the rose key (Z, or down on the
 * gamepad's d-pad) and a ring of wedges opens around the crosshair; moving the mouse (or the
 * right stick) picks a wedge, letting go sends it, letting go in the middle sends nothing.
 * Pictures only (the no-reading rule): each wedge is a kind of thing to say, and sending it
 * makes the player's character say a random line of that kind (shared/src/net/rose.ts).
 *
 * The army's wedges: panic, bravado, orders, science, home, food, retreat, admiring the monster.
 * The monster's: the big roar, the short roar, snuffles, a growl, a chomp, a contented rumble,
 * the mating call. While the rose is open the view holds still (the mouse moves the pick, not
 * the camera); the body keeps moving and the buttons keep working. After a pick the rose waits
 * ROSE_GAP_SECONDS before the next one (the server holds everyone to that too): meanwhile it
 * opens greyed, with the wait running round its middle, and sends nothing.
 */

import { ROSE_ARMY, ROSE_GAP_SECONDS, ROSE_KAIJU, type RoseSide } from '@mb/shared';
import { el, icon } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The picture of each wedge, in wire order. */
export const ROSE_ICONS: Record<RoseSide, readonly string[]> = {
  army: ROSE_ARMY.map((id) => `ro_${id.toLowerCase()}`),
  kaiju: ROSE_KAIJU.map((id) => `ro_${id.toLowerCase()}`),
};

/** How far the pick moves before a wedge is chosen (pixels of mouse movement), and how far it can go. */
export const ROSE_DEADZONE = 28;
export const ROSE_REACH = 120;

/**
 * The wedge a pick at (x, y) points at (screen pixels from the middle, y down), or -1 in the
 * middle. Wedge 0 is at the top; the others follow clockwise.
 */
export function roseWedgeAt(x: number, y: number, count: number): number {
  if (Math.hypot(x, y) < ROSE_DEADZONE || count <= 0) return -1;
  const step = (Math.PI * 2) / count;
  const turn = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(turn / step) % count;
}

function wedgePath(i: number, count: number, inner: number, outer: number): string {
  const step = (Math.PI * 2) / count;
  const gap = 0.035;
  const a0 = i * step - step / 2 + gap;
  const a1 = i * step + step / 2 - gap;
  const at = (r: number, a: number): string => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  return `M${at(inner, a0)} L${at(outer, a0)} A${outer} ${outer} 0 0 1 ${at(outer, a1)} L${at(inner, a1)} A${inner} ${inner} 0 0 0 ${at(inner, a0)} Z`;
}

export interface RoseInput {
  /** The rose key is down. */
  held: boolean;
  /** Mouse (or stick) movement this frame, in screen pixels, y down. */
  dx: number;
  dy: number;
  /** The player may talk now (a match being played, the map and the menu shut). */
  allowed: boolean;
  /** Local seconds. */
  now: number;
}

/**
 * The rose's workings, without the pictures: opens while the key is held, follows the mouse to a
 * wedge, and on letting go says which wedge to send (or nothing: in the middle, or still waiting).
 */
export class RosePicker {
  readonly count: number;
  open = false;
  /** The wedge picked right now, or -1. */
  selected = -1;
  /** Where the pick is, screen pixels from the middle (y down), at most ROSE_REACH out. */
  x = 0;
  y = 0;
  private readyAt = Number.NEGATIVE_INFINITY;

  constructor(count: number) {
    this.count = count;
  }

  /** Seconds until the next pick can go out (0 when it can). */
  waitLeft(now: number): number {
    return Math.max(0, this.readyAt - now);
  }

  /** One frame. `sent` is the wedge to send now, or -1. */
  step(input: RoseInput): { open: boolean; sent: number } {
    if (!input.allowed) {
      this.close();
      return { open: false, sent: -1 };
    }
    if (input.held && !this.open) {
      this.open = true;
      this.x = 0;
      this.y = 0;
      this.selected = -1;
    }
    if (!this.open) return { open: false, sent: -1 };
    if (input.held) {
      this.x += input.dx;
      this.y += input.dy;
      const r = Math.hypot(this.x, this.y);
      if (r > ROSE_REACH) {
        this.x *= ROSE_REACH / r;
        this.y *= ROSE_REACH / r;
      }
      this.selected = roseWedgeAt(this.x, this.y, this.count);
      return { open: true, sent: -1 };
    }
    // Let go: send the pick, if there is one and the wait is over.
    const pick = this.selected;
    this.close();
    if (pick < 0 || input.now < this.readyAt) return { open: false, sent: -1 };
    this.readyAt = input.now + ROSE_GAP_SECONDS;
    return { open: false, sent: pick };
  }

  close(): void {
    this.open = false;
    this.selected = -1;
  }
}

export class CommRose {
  readonly root: HTMLElement;
  readonly side: RoseSide;
  readonly picker: RosePicker;
  /** Called with the wedge (an index into the side's list) when a pick is sent. */
  onSend: ((cat: number) => void) | null = null;

  private readonly wedges: SVGPathElement[] = [];
  private readonly icons: HTMLElement[] = [];
  private readonly dot: HTMLElement;
  private readonly wait: SVGCircleElement;

  constructor(side: RoseSide) {
    this.side = side;
    const ids = ROSE_ICONS[side];
    this.picker = new RosePicker(ids.length);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-100 -100 200 200');
    svg.setAttribute('aria-hidden', 'true');
    ids.forEach((_id, i) => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', wedgePath(i, ids.length, 34, 97));
      p.setAttribute('class', 'rose-wedge');
      svg.append(p);
      this.wedges.push(p);
    });
    const hub = document.createElementNS(SVG_NS, 'circle');
    hub.setAttribute('r', '26');
    hub.setAttribute('class', 'rose-hub');
    this.wait = document.createElementNS(SVG_NS, 'circle');
    this.wait.setAttribute('r', '20');
    this.wait.setAttribute('class', 'rose-wait');
    this.wait.setAttribute('pathLength', '100');
    this.wait.setAttribute('transform', 'rotate(-90)');
    svg.append(hub, this.wait);
    this.dot = el('div', 'rose-dot');
    this.root = el('div', `rose rose-${side} hidden`, [svg, this.dot]);
    ids.forEach((id, i) => {
      const a = (i * Math.PI * 2) / ids.length;
      const pic = icon(id, 'rose-icon');
      // The pictures sit on the ring's middle radius (65 of 100), as a share of the rose's size.
      pic.style.left = `${50 + Math.sin(a) * 32.5}%`;
      pic.style.top = `${50 - Math.cos(a) * 32.5}%`;
      this.root.append(pic);
      this.icons.push(pic);
    });
  }

  /** True while the ring is up (the view holds still meanwhile). */
  get open(): boolean {
    return this.picker.open;
  }

  /**
   * One frame. Returns true while the rose is open, when the caller must keep the mouse's
   * movement away from the camera.
   */
  update(input: RoseInput): boolean {
    const { open, sent } = this.picker.step(input);
    this.root.classList.toggle('hidden', !open);
    if (open) this.draw(input.now);
    if (sent >= 0) this.onSend?.(sent);
    return open;
  }

  private draw(now: number): void {
    const p = this.picker;
    const left = p.waitLeft(now);
    this.root.classList.toggle('waiting', left > 0);
    this.wait.style.strokeDashoffset = String(100 - (100 * left) / ROSE_GAP_SECONDS);
    this.wedges.forEach((w, i) => w.classList.toggle('on', i === p.selected));
    this.icons.forEach((pic, i) => pic.classList.toggle('on', i === p.selected));
    // The pick's own little dot, so the player sees where the mouse has taken it (the ring is ROSE_REACH out).
    this.dot.style.left = `${50 + (p.x / ROSE_REACH) * 32.5}%`;
    this.dot.style.top = `${50 + (p.y / ROSE_REACH) * 32.5}%`;
  }
}
