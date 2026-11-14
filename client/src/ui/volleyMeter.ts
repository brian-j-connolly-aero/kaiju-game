/**
 * The squad's volley meter (docs/ROADMAP.md phase 1, "The army"): big, yellow, a diamond round
 * the crosshair (diamonds mark volleys: DESIGN.md section 8). No words.
 *
 * - While the volley button is held the diamond fills from its bottom point up, as the three
 *   squad-mates charge (`volleyMeter` over the newest snapshot, carried forward between
 *   snapshots at the charge's own pace). A white notch across it marks 60%
 *   (`COMBAT_RULES.volleyMinCharge`): below it the fill is a dull amber (let go now and the shot
 *   is ragged), from it the diamond is bright and pulses (the volley counts), and full it pulses
 *   fast with a white edge.
 * - Letting go fires: a charged volley flashes the diamond white and blows it outward; a ragged
 *   one fizzles grey.
 * - Under it, one small picture per squad-mate: a yellow diamond while it charges, a cyan
 *   circle while it follows, red while it is stunned or shaken (it cannot charge), a dim ring
 *   once it is gone. So the player sees how many guns the volley will have.
 * - Two squads' charged volleys landing within 5 seconds of each other break the monster's nerve
 *   (DESIGN.md section 3). When another squad's charged volley lands, a ring round the meter
 *   counts those 5 seconds down (it blinks in the last ones): fire now. When this squad's own
 *   charged volley lands inside that window the ring bursts.
 */

import { COMBAT_RULES, MATCH_RULES, volleyMeter, type SimEvent, type SnapUnit } from '@mb/shared';
import { el } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The diamond's outer and inner half-diagonals, in the meter's own units (its box is 250 wide). */
const OUTER = 96;
const INNER = 64;
/** The countdown ring's radius and length. */
const RING = 111;
const RING_LENGTH = 2 * Math.PI * RING;
/** How long the release's flash and the pairing's burst show, seconds. */
const FIRED_TIME = 0.6;
const FIZZLE_TIME = 0.45;
const PAIRED_TIME = 0.8;
/** The ring blinks for the last this many seconds. */
const HURRY_TIME = 1.5;
/** A snapshot older than this is not carried forward any further (a stall). */
const MAX_CARRY = 0.5;

/** What one squad-mate's picture shows. */
export type MateLook = 'charging' | 'ready' | 'out' | 'dead';

/**
 * The squad-mates of a squad (every unit of it but the one its player drives), in id order, as
 * the meter's pictures show them.
 */
export function mateLooks(units: readonly SnapUnit[], squad: number, out: MateLook[] = []): MateLook[] {
  out.length = 0;
  for (const u of units) {
    if (u.squad !== squad || u.driven) continue;
    if (!u.alive) out.push('dead');
    else if (u.stun > 0 || u.shaken > 0) out.push('out');
    else if (u.rooted && u.laser) out.push('charging');
    else out.push('ready');
  }
  return out;
}

/**
 * The charge the meter shows while the volley button is held: the squad's charge in the newest
 * snapshot (the mean of its planted squad-mates), carried forward by the time since that
 * snapshot came at the rate charge grows, so the meter fills smoothly and does not wait for the
 * next snapshot. 0 while the button is up or nobody is planted.
 */
export function shownCharge(units: readonly SnapUnit[], squad: number, held: boolean, sinceSnapshot: number): number {
  if (!held) return 0;
  const base = volleyMeter(units, squad);
  if (base <= 0) return 0;
  const carry = Math.min(MAX_CARRY, Math.max(0, sinceSnapshot));
  return Math.min(1, base + carry / COMBAT_RULES.chargeTime);
}

/**
 * Keeps track of charged volleys landing on the kaiju (DESIGN.md section 3: two squads' within
 * `COMBAT_RULES.volleyBreakWindow` seconds break its nerve). Fed every simulation event as it is
 * shown, with the local time.
 */
export class VolleyPartner {
  /** Projectile id -> the squad whose charged volley it belongs to, and when it left. */
  private readonly shots = new Map<number, { squad: number; at: number }>();
  /** When another squad's charged volley last hit the kaiju (local seconds). */
  landedAt = Number.NEGATIVE_INFINITY;
  /** That squad. */
  partner = -1;
  /** When this squad's own charged volley hit inside the window (the pair is made). */
  pairedAt = Number.NEGATIVE_INFINITY;
  private readonly ownSquad: number;

  constructor(ownSquad: number) {
    this.ownSquad = ownSquad;
  }

  onEvent(e: SimEvent, now: number): void {
    if (e.type === 'projectileSpawn') {
      if (!e.volley || e.owner !== 'unit') return;
      // A unit's id is its squad's slot block: squad * unitsPerSquad + slot.
      this.shots.set(e.id, { squad: Math.floor(e.ownerId / MATCH_RULES.unitsPerSquad), at: now });
      if (this.shots.size > 64) this.prune(now);
    } else if (e.type === 'projectileHit') {
      const shot = this.shots.get(e.id);
      if (!shot) return;
      this.shots.delete(e.id);
      if (e.target !== 'kaiju') return;
      if (shot.squad !== this.ownSquad) {
        this.landedAt = now;
        this.partner = shot.squad;
      } else if (this.remaining(now) > 0) {
        this.pairedAt = now;
        this.landedAt = Number.NEGATIVE_INFINITY;
      }
    } else if (e.type === 'stageChange') {
      this.shots.clear();
      this.landedAt = Number.NEGATIVE_INFINITY;
    }
  }

  /** Seconds left to land this squad's own charged volley after the other squad's, 0 when none is waiting. */
  remaining(now: number): number {
    return Math.max(0, COMBAT_RULES.volleyBreakWindow - (now - this.landedAt));
  }

  private prune(now: number): void {
    for (const [id, shot] of this.shots) if (now - shot.at > 15) this.shots.delete(id);
  }
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, children: SVGElement[] = []): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const child of children) node.append(child);
  return node;
}

function diamond(r: number): string {
  return `M0 ${-r} L${r} 0 L0 ${r} L${-r} 0 Z`;
}

let clipIds = 0;

/** What the match screen hands the meter every frame. */
export interface VolleyMeterFrame {
  /** Units of the newest snapshot. */
  units: readonly SnapUnit[];
  /** Seconds since that snapshot arrived. */
  sinceSnapshot: number;
  /** The volley button is down right now (and the map is closed). */
  held: boolean;
  /** The meter may show at all: this player drives a squad's unit and the view is the player's own. */
  visible: boolean;
  now: number;
}

export class VolleyMeter {
  readonly root = el('div', 'volley-meter hidden');
  readonly partner: VolleyPartner;
  private readonly ownSquad: number;
  private readonly level: SVGRectElement;
  private readonly ringTime: SVGCircleElement;
  private readonly mates: SVGGElement[] = [];
  private readonly looks: MateLook[] = [];
  private wasHeld = false;
  /** The charge shown on the previous frame (what a release fires with). */
  private lastCharge = 0;
  private flash: 'fired' | 'fizzle' | 'paired' | '' = '';
  private flashUntil = 0;
  /** The level held on screen while a release flashes. */
  private frozen = 0;
  private lastFired = Number.NEGATIVE_INFINITY;
  private shownLevel = -1;
  private shownRing = -1;
  private shownKey = '';

  /** `ownSquad`: the squad this player leads. */
  constructor(ownSquad: number) {
    this.ownSquad = ownSquad;
    this.partner = new VolleyPartner(ownSquad);
    const clipId = `vm-level-${++clipIds}`;
    this.level = svg('rect', { x: -OUTER - 6, y: OUTER, width: (OUTER + 6) * 2, height: 0 });
    this.ringTime = svg('circle', { class: 'vm-ring-time', r: RING, transform: 'rotate(-90)', 'stroke-dasharray': `${RING_LENGTH.toFixed(2)} ${RING_LENGTH.toFixed(2)}`, 'stroke-dashoffset': 0 });
    const band = `${diamond(OUTER)} ${diamond(INNER)}`;
    // The notch at 60%: across the band where the fill's level stands at that charge.
    const notchY = OUTER - COMBAT_RULES.volleyMinCharge * OUTER * 2;
    const notchIn = INNER - Math.abs(notchY) - 6;
    const notchOut = OUTER - Math.abs(notchY) + 8;
    for (let i = 0; i < MATCH_RULES.unitsPerSquad - 1; i++) {
      const x = (i - (MATCH_RULES.unitsPerSquad - 2) / 2) * 30;
      this.mates.push(
        svg('g', { class: 'vm-mate', transform: `translate(${x} 142)` }, [svg('circle', { class: 'vm-mate-circle', r: 7.5 }), svg('path', { class: 'vm-mate-diamond', d: diamond(11) })]),
      );
    }
    const picture = svg('svg', { viewBox: '-125 -125 250 290', 'aria-hidden': 'true' }, [
      svg('defs', {}, [svg('clipPath', { id: clipId }, [this.level])]),
      svg('g', { class: 'vm-ring' }, [svg('circle', { class: 'vm-ring-track', r: RING }), this.ringTime, svg('path', { class: 'vm-ring-mark', d: `M0 ${-RING - 12} L10 ${-RING} L0 ${-RING + 12} L-10 ${-RING} Z` })]),
      svg('g', { class: 'vm-diamond' }, [
        svg('path', { class: 'vm-band', d: band, 'fill-rule': 'evenodd' }),
        svg('path', { class: 'vm-fill', d: band, 'fill-rule': 'evenodd', 'clip-path': `url(#${clipId})` }),
        svg('path', { class: 'vm-edge', d: diamond(OUTER) }),
        svg('path', { class: 'vm-edge vm-edge-inner', d: diamond(INNER) }),
        svg('path', { class: 'vm-notch', d: `M${-notchOut} ${notchY} L${-notchIn} ${notchY} M${notchIn} ${notchY} L${notchOut} ${notchY}` }),
      ]),
      svg('g', { class: 'vm-mates' }, this.mates),
    ]);
    this.root.append(picture);
  }

  /**
   * Every simulation event, as it is shown. `past`: an event from a backlog (a hidden tab), which
   * only updates the bookkeeping and flashes nothing.
   */
  onEvent(e: SimEvent, now: number, past = false): void {
    const paired = this.partner.pairedAt;
    this.partner.onEvent(e, now);
    if (past) return;
    // This squad's charged volley landed inside the other squad's window: the pair is made.
    if (this.partner.pairedAt !== paired) this.startFlash('paired', now, 0);
    // The server says this squad fired a charged volley: flash, unless the release already did.
    else if (e.type === 'volley' && e.squad === this.ownSquad && now - this.lastFired > 1) this.startFlash('fired', now, Math.max(this.lastCharge, e.charge));
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private startFlash(kind: 'fired' | 'fizzle' | 'paired', now: number, level: number): void {
    this.flash = kind;
    this.flashUntil = now + (kind === 'fired' ? FIRED_TIME : kind === 'fizzle' ? FIZZLE_TIME : PAIRED_TIME);
    if (kind !== 'paired') this.frozen = level;
    if (kind === 'fired') this.lastFired = now;
    // Start the animation over even if the same one is still running.
    this.root.classList.remove('fired', 'fizzle', 'paired');
    void this.root.offsetWidth;
    this.root.classList.add(kind);
  }

  update(f: VolleyMeterFrame): void {
    const { now, held } = f;
    const ownSquad = this.ownSquad;
    if (!f.visible) {
      this.wasHeld = held;
      this.lastCharge = 0;
      this.hide();
      return;
    }
    const charge = shownCharge(f.units, ownSquad, held, f.sinceSnapshot);
    // Let go: the squad fires with what it had.
    if (this.wasHeld && !held && this.lastCharge > 0) {
      this.startFlash(this.lastCharge >= COMBAT_RULES.volleyMinCharge ? 'fired' : 'fizzle', now, this.lastCharge);
    }
    this.wasHeld = held;
    this.lastCharge = charge;
    if (this.flash && now >= this.flashUntil) {
      this.root.classList.remove(this.flash);
      this.flash = '';
    }
    const flashing = this.flash === 'fired' || this.flash === 'fizzle';
    const remaining = this.partner.remaining(now);
    const show = held || this.flash !== '' || remaining > 0;
    this.root.classList.toggle('hidden', !show);
    if (!show) return;

    const level = flashing ? this.frozen : charge;
    const shown = Math.round(level * 400) / 400;
    if (shown !== this.shownLevel) {
      this.shownLevel = shown;
      const h = shown * OUTER * 2;
      this.level.setAttribute('y', (OUTER - h).toFixed(2));
      this.level.setAttribute('height', (h + (shown > 0 ? 0.5 : 0)).toFixed(2));
    }
    const ring = Math.round((remaining / COMBAT_RULES.volleyBreakWindow) * 500) / 500;
    if (ring !== this.shownRing) {
      this.shownRing = ring;
      this.ringTime.setAttribute('stroke-dashoffset', (RING_LENGTH * (1 - ring)).toFixed(2));
    }
    const charged = held && level >= COMBAT_RULES.volleyMinCharge;
    mateLooks(f.units, ownSquad, this.looks);
    const key = `${held ? 1 : 0}${flashing ? 1 : 0}${charged ? 1 : 0}${held && level >= 0.995 ? 1 : 0}${remaining > 0 ? 1 : 0}${remaining > 0 && remaining < HURRY_TIME ? 1 : 0}:${this.looks.join(',')}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    const c = this.root.classList;
    c.toggle('held', held);
    c.toggle('idle', !held && !flashing);
    c.toggle('charged', charged);
    c.toggle('full', held && level >= 0.995);
    c.toggle('countdown', remaining > 0);
    c.toggle('hurry', remaining > 0 && remaining < HURRY_TIME);
    this.mates.forEach((m, i) => {
      const look = this.looks[i];
      m.setAttribute('class', look ? `vm-mate ${look}` : 'vm-mate none');
    });
  }
}
