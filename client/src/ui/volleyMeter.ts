/**
 * The squad's volley meter (docs/ROADMAP.md phase 1, "The army"; round 5: "not sure when could
 * charge", "the weird yellow circle constantly refreshing", "players were confused by just
 * pictures"). Yellow, with the diamond that marks volleys (DESIGN.md section 8), and since round 5
 * a word of one or two beside the pictures, so that at every moment the squad's screen says
 * whether it can charge (and if not, why), how far the charge has come, when to let go, and what
 * happened.
 *
 * - **The chip**, always there while the player drives a unit, under the crosshair: the three
 *   squad-mates' pictures and a word (`volleyStatus`). Button up it says whether a volley can be
 *   charged now: "Ready", or why not ("No squad", "Landing", "Stunned", "Shaken", "Reload",
 *   "Too far", "No line"). Each squad-mate's picture says the same of it: a cyan dot (ready), a
 *   yellow diamond (charging), a ring filling as it reloads, a red cross (shaken or stunned), a
 *   parachute (coming down), a red bar (no line: a building or a heap between it and where the
 *   volley goes), a dashed ring (too far), a grey ring (gone).
 * - **Held**, the big diamond round the crosshair fills from its bottom point up as the
 *   squad-mates charge (`shownCharge`; before the server has said they planted, the charge is
 *   carried from the press itself, `predictedCharge`, so a slow line does not show an empty
 *   meter). A white notch marks 60% (`COMBAT_RULES.volleyMinCharge`): below it the fill is a dull
 *   amber and the word "Charging"; from it bright and pulsing, "Ready"; full, a white edge and
 *   "Fire!". A squad-mate still reloading charges only to just under the notch (sim/systems/
 *   unitOrders.ts `chargeCap`): its picture is the reload ring, and when it is the one holding the
 *   volley back the word is "Reload". With nobody able to charge the word says why, in red.
 * - **Let go**: the meter holds its level until the server answers. This squad's `volley` event
 *   flashes it white and blows it outward with "Volley!" ("Immune" when the monster cannot be
 *   shaken just then). Let go short of the notch it fizzles grey, "Weak"; when no squad-mate's
 *   shot leaves at all within 0.4 s and the round trip, "No shot".
 * - **Team up.** Two squads' charged volleys landing within 5 seconds of each other break the
 *   monster's nerve (DESIGN.md section 3; the server counts from each squad's latest hit, and so
 *   does `VolleyPartner`). Round 4 drew that window as a big pale-yellow ring round the crosshair
 *   whenever another squad's volley landed, button pressed or not (up a fifth of the time, with
 *   no word): the "weird yellow circle". Now it shows only when it matters (`teamUpShown`: this
 *   squad can still fire, and the monster's nerve is high enough that the pair can break it) and
 *   never round the crosshair while the button is up: the HUD puts a yellow strip counting down
 *   over the monster's nerve bar with the word "Team up" (ui/hud.ts). Held, a thin ring round the
 *   big diamond counts the same seconds, "Team up" under the word, blinking in the last ones; a
 *   pair made bursts it.
 */

import {
  castSegment,
  COMBAT_RULES,
  DT,
  isWeaponPickup,
  kaijuKindDef,
  kaijuShownRadius,
  MATCH_RULES,
  PICKUP_WEAPONS,
  pickupWeaponDef,
  RELOAD_CHARGE_GAP,
  SQUAD_RULES,
  unitTypeDef,
  volleyMeter,
  weaponDef,
  type CityQuery,
  type PickupId,
  type SimEvent,
  type SnapKaiju,
  type SnapUnit,
  type Vec3,
} from '@mb/shared';
import { el } from './icons';
import { LABELS, type VolleyWord } from './labels';

export type { VolleyWord };

/** The chip's words (ui/labels.ts, the one table of labels). */
const W = LABELS.volley;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The diamond's outer and inner half-diagonals, in the big meter's own units (its box is 250 wide). */
const OUTER = 96;
const INNER = 64;
/** The team-up ring's radius and length. */
const RING = 108;
const RING_LENGTH = 2 * Math.PI * RING;
/** How long the release's flash and the pairing's burst show, seconds. */
const FIRED_TIME = 0.6;
const FIZZLE_TIME = 0.45;
const PAIRED_TIME = 0.8;
/** The release's word stays this long. */
const RESULT_TIME = 1.4;
/** After the release, how long (on top of the round trip) to wait for a squad-mate's shot before saying "No shot". */
const NO_SHOT_WAIT = 0.4;
/** The team-up ring blinks for the last this many seconds. */
const HURRY_TIME = 1.5;
/** A snapshot older than this is not carried forward any further (a stall). */
const MAX_CARRY = 0.5;
/** The squad-mates' lines are looked at this often (seconds). */
const LINE_EVERY = 0.1;
/**
 * Team up shows while the monster's nerve is at least this share of what breaks it: a full
 * charged volley from the front adds about half of it (DESIGN.md section 5), so from here the
 * pair can break it.
 */
export const TEAM_UP_NERVE = 0.5;
/** The charge a squad-mate still reloading stops at (just under the notch). */
const NOTCH_CAP = COMBAT_RULES.volleyMinCharge - RELOAD_CHARGE_GAP;

/** What one squad-mate's picture shows, worst first after 'dead'. */
export type MateLook = 'dead' | 'landing' | 'stunned' | 'shaken' | 'reload' | 'blocked' | 'far' | 'charging' | 'ready';

/** Whether a squad-mate's shot can reach where the volley goes: 'clear', 'blocked' (a building or a heap in between) or 'far' (it gives out first). */
export type LineState = 'clear' | 'blocked' | 'far';

/** How the word is drawn: 'go' (yellow: fire now, it fired), 'ready' (cyan: can charge, charging), 'wait' (grey), 'cannot' (red). */
export type WordTone = 'go' | 'ready' | 'wait' | 'cannot';

export const WORD_TONE: Readonly<Record<VolleyWord, WordTone>> = {
  [W.noSquad]: 'cannot',
  [W.landing]: 'wait',
  [W.stunned]: 'cannot',
  [W.shaken]: 'cannot',
  [W.reload]: 'wait',
  [W.tooFar]: 'cannot',
  [W.noLine]: 'cannot',
  [W.ready]: 'ready',
  [W.charging]: 'ready',
  [W.fire]: 'go',
  [W.fired]: 'go',
  [W.immune]: 'wait',
  [W.weak]: 'wait',
  [W.noShot]: 'cannot',
};

/** The reload a squad-mate's weapon has after a volley: the squad's weapon pick-up's (as many pulls as a volley fires) or its own. */
export function volleyReload(type: SnapUnit['type'], pickup: PickupId): number {
  const own = weaponDef(unitTypeDef(type).weapon);
  if (!isWeaponPickup(pickup)) return own.cooldown;
  return pickupWeaponDef(own, pickup).cooldown * Math.max(1, PICKUP_WEAPONS[pickup].volleyPulls);
}

/**
 * True when a squad-mate's reload holds its charge back: with this charge, its weapon will still
 * be reloading when the charge reaches the notch (it stops just under it until loaded). A reload
 * shorter than that changes nothing a player would notice, so it is not shown (squad-mates
 * firing at will reload every few seconds).
 */
export function reloadHolds(cooldown: number, charge: number): boolean {
  return cooldown > DT + 1e-6 && cooldown > (NOTCH_CAP - charge) * COMBAT_RULES.chargeTime;
}

/**
 * The squad-mates of a squad (every unit of it but the one its player drives), in id order, as
 * the chip's pictures show them. `lines` (indexed by unit id) says whose shot cannot reach where
 * the volley goes; leave it out when the volley is not at the monster.
 */
export function mateLooks(units: readonly SnapUnit[], squad: number, lines: readonly (LineState | undefined)[] | null = null, out: MateLook[] = []): MateLook[] {
  out.length = 0;
  for (const u of units) {
    if (u.squad !== squad || u.driven) continue;
    const line = lines ? lines[u.id] : undefined;
    if (!u.alive) out.push('dead');
    else if (u.y > 0.05) out.push('landing');
    else if (u.stun > 0) out.push('stunned');
    else if (u.shaken > 0) out.push('shaken');
    else if (reloadHolds(u.cooldown, u.rooted ? u.charge : 0)) out.push('reload');
    else if (line === 'blocked') out.push('blocked');
    else if (line === 'far') out.push('far');
    else if (u.rooted && u.laser) out.push('charging');
    else out.push('ready');
  }
  return out;
}

/**
 * The chip's word for a squad's volley, from its squad-mates' pictures (`mateLooks`), whether
 * the button is held and the charge shown. First that fits wins: nobody left; everybody still
 * coming down; everybody stunned; everybody shaken or stunned; everybody able held back by a
 * reload; nobody able has a line (or the reach); and then, held, how far the charge has come.
 */
export function volleyWord(looks: readonly MateLook[], held: boolean, charge: number): VolleyWord {
  let alive = 0;
  let landing = 0;
  let stunned = 0;
  let out = 0;
  let steady = 0;
  let reload = 0;
  let blocked = 0;
  let far = 0;
  for (const l of looks) {
    if (l === 'dead') continue;
    alive++;
    if (l === 'landing') landing++;
    else if (l === 'stunned') {
      stunned++;
      out++;
    } else if (l === 'shaken') out++;
    else {
      steady++;
      if (l === 'reload') reload++;
      else if (l === 'blocked') blocked++;
      else if (l === 'far') far++;
    }
  }
  if (alive === 0) return W.noSquad;
  if (landing === alive) return W.landing;
  const able = alive - landing;
  if (stunned === able) return W.stunned;
  if (out === able) return W.shaken;
  if (reload === steady) return W.reload;
  if (far === steady - reload) return W.tooFar;
  if (blocked + far === steady - reload) return W.noLine;
  if (!held) return W.ready;
  if (charge >= 0.995) return W.fire;
  return charge >= COMBAT_RULES.volleyMinCharge ? W.ready : W.charging;
}

/**
 * Whether each of a squad's squad-mates can put its volley shot on `target` (the squad-mates'
 * aim point, `volleyPoint` in sim/squads.ts): its muzzle's line to it is clear of buildings and
 * heaps (as a squad-mate looks for a line of fire to shoot at will: bridge decks do not count,
 * heaps do), and it is within the reach of what it fires (its weapon's range times the slack,
 * after which a shot gives out; `near`: how much nearer than the point a shot already hits, the
 * monster's body radius when the point is its middle). Written into `out` by unit id.
 */
export function mateLines(query: CityQuery, units: readonly SnapUnit[], squad: number, target: Vec3, out: (LineState | undefined)[] = [], near = 0): (LineState | undefined)[] {
  out.length = 0;
  const muzzle = { x: 0, y: 0, z: 0 };
  for (const u of units) {
    if (u.squad !== squad || u.driven || !u.alive) continue;
    const def = unitTypeDef(u.type);
    muzzle.x = u.x;
    muzzle.y = u.y + def.muzzleHeight;
    muzzle.z = u.z;
    const reach = weaponDef(def.weapon).range * SQUAD_RULES.rangeSlack;
    if (Math.hypot(target.x - muzzle.x, target.y - muzzle.y, target.z - muzzle.z) - near > reach) out[u.id] = 'far';
    else out[u.id] = castSegment(query, muzzle, target, undefined, -1, true, true) ? 'blocked' : 'clear';
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
  let n = 0;
  let sum = 0;
  const carry = Math.min(MAX_CARRY, Math.max(0, sinceSnapshot)) / COMBAT_RULES.chargeTime;
  for (const u of units) {
    if (u.squad !== squad || !u.alive || !u.rooted) continue;
    // A squad-mate held back by its reload stays under the notch.
    const cap = u.cooldown - Math.max(0, sinceSnapshot) > DT ? NOTCH_CAP : 1;
    sum += Math.min(cap, Math.max(u.charge, Math.min(1, u.charge + carry)));
    n++;
  }
  return n > 0 ? Math.min(1, sum / n) : 0;
}

/**
 * Before the server has said the squad-mates planted (the press is on its way there and the
 * answer on its way back): the charge they will have by now, from how long ago the button went
 * down less the round trip, for those of them able to charge (each held under the notch while
 * its reload lasts). 0 when none can.
 */
export function predictedCharge(units: readonly SnapUnit[], squad: number, heldFor: number, roundTrip: number): number {
  const t = Math.max(0, heldFor - roundTrip);
  let n = 0;
  let sum = 0;
  for (const u of units) {
    if (u.squad !== squad || u.driven || !u.alive || u.y > 0.05 || u.stun > 0 || u.shaken > 0) continue;
    const loadedAt = Math.max(0, u.cooldown - heldFor);
    const grown = Math.min(1, t / COMBAT_RULES.chargeTime);
    sum += loadedAt > 0 ? Math.min(NOTCH_CAP, grown) : grown;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** What the monster's nerve looks like, for the team-up rule. Snapshot kaiju satisfy it. */
export type TeamUpBoss = Pick<SnapKaiju, 'kind' | 'nerve' | 'nerveImmune' | 'phase' | 'alive'>;

/**
 * Whether to show the team-up window: another squad's charged volley has landed within the last
 * five seconds (`remaining` of them left), this squad can still fire (`able`: a squad-mate on its
 * feet, steady and not stunned), and the monster's nerve can still be broken by the pair: neither
 * staggered nor cocooned nor in its spell of immunity after a break, and at least TEAM_UP_NERVE
 * of the way there.
 */
export function teamUpShown(remaining: number, boss: TeamUpBoss | undefined, able: boolean): boolean {
  if (!(remaining > 0) || !able || !boss || !boss.alive) return false;
  if (boss.phase === 'stagger' || boss.phase === 'cocoon' || boss.nerveImmune > 0) return false;
  return boss.nerve >= kaijuKindDef(boss.kind).nerveCapacity * TEAM_UP_NERVE;
}

/**
 * Keeps track of charged volleys landing on the kaiju (DESIGN.md section 3: two squads' within
 * `COMBAT_RULES.volleyBreakWindow` seconds break its nerve). Fed every simulation event as it is
 * shown, with the local time. Like the server (systems/damage.ts `noteVolleyHit`) it counts the
 * window from the other squad's latest hit.
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

/** An arc of a circle of radius r from the top, clockwise, over `share` of the way round. */
function arc(r: number, share: number): string {
  const s = Math.max(0, Math.min(0.999, share));
  if (s <= 0) return '';
  const a = s * 2 * Math.PI;
  return `M0 ${-r} A${r} ${r} 0 ${s > 0.5 ? 1 : 0} 1 ${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
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
  /** The squad's weapon pick-up. */
  pickup: PickupId;
  /** The monster (the newest snapshot's), for the team-up rule and the release's word. */
  boss: SnapKaiju | undefined;
  /** Where the squad-mates would aim if the volley went now (`volleyPoint`), and whether that is at the monster. */
  target: Vec3 | null;
  atKaiju: boolean;
  /** The mirrored city, for the squad-mates' lines. */
  query: CityQuery | null;
  /** The connection's round trip, seconds. */
  roundTrip: number;
}

interface MatePicture {
  root: SVGGElement;
  sweep: SVGPathElement;
  shown: string;
  swept: number;
}

export class VolleyMeter {
  readonly root = el('div', 'volley-meter hidden');
  readonly partner: VolleyPartner;
  private readonly ownSquad: number;
  private readonly level: SVGRectElement;
  private readonly ringTime: SVGCircleElement;
  private readonly chip: HTMLElement;
  private readonly word: HTMLElement;
  private readonly team: HTMLElement;
  private readonly mates: MatePicture[] = [];
  private readonly looks: MateLook[] = [];
  private lines: (LineState | undefined)[] = [];
  private linesAt = Number.NEGATIVE_INFINITY;
  private wasHeld = false;
  private heldSince = 0;
  /** The charge shown on the previous frame (what a release fires with). */
  private lastCharge = 0;
  private flash: 'fired' | 'fizzle' | 'paired' | '' = '';
  private flashUntil = 0;
  /** The level held on screen while a release waits for the server and while it flashes. */
  private frozen = 0;
  /** The release: when it was, and the word it got (empty while waiting for the server). */
  private releasedAt = Number.NEGATIVE_INFINITY;
  private result: VolleyWord | '' = '';
  private resultUntil = 0;
  /** A squad-mate's shot left since the release. */
  private shotSince = false;
  private lastFired = Number.NEGATIVE_INFINITY;
  private boss: SnapKaiju | undefined;
  /** The unit the player drives (its own shots are not the squad-mates'). */
  private drivenId = -1;
  /** The word on the previous frame (kept while a release waits for the server). */
  private lastWord: VolleyWord = W.ready;
  /** The team-up window's share left (0..1) while it is shown, for the HUD's nerve bar. */
  teamUp = 0;
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
    const big = svg('svg', { class: 'vm-big', viewBox: '-125 -125 250 250', 'aria-hidden': 'true' }, [
      svg('defs', {}, [svg('clipPath', { id: clipId }, [this.level])]),
      svg('g', { class: 'vm-ring' }, [svg('circle', { class: 'vm-ring-track', r: RING }), this.ringTime]),
      svg('g', { class: 'vm-diamond' }, [
        svg('path', { class: 'vm-band', d: band, 'fill-rule': 'evenodd' }),
        svg('path', { class: 'vm-fill', d: band, 'fill-rule': 'evenodd', 'clip-path': `url(#${clipId})` }),
        svg('path', { class: 'vm-edge', d: diamond(OUTER) }),
        svg('path', { class: 'vm-edge vm-edge-inner', d: diamond(INNER) }),
        svg('path', { class: 'vm-notch', d: `M${-notchOut} ${notchY} L${-notchIn} ${notchY} M${notchIn} ${notchY} L${notchOut} ${notchY}` }),
      ]),
    ]);
    // The chip: a small diamond, one picture per squad-mate, the word.
    const pics: SVGElement[] = [svg('g', { class: 'vm-chip-badge', transform: 'translate(-46 0)' }, [svg('path', { class: 'vm-badge-edge', d: diamond(11) }), svg('path', { class: 'vm-badge-core', d: diamond(4.5) }), svg('path', { class: 'vm-badge-slash', d: 'M-9 9 L9 -9' })])];
    for (let i = 0; i < MATCH_RULES.unitsPerSquad - 1; i++) {
      const sweep = svg('path', { class: 'vm-m-sweep', d: '' });
      const root = svg('g', { class: 'vm-mate none', transform: `translate(${-16 + i * 22} 0)` }, [
        svg('circle', { class: 'vm-m-dot', r: 6.5 }),
        svg('path', { class: 'vm-m-diamond', d: diamond(9) }),
        svg('circle', { class: 'vm-m-ring', r: 6.5 }),
        sweep,
        svg('path', { class: 'vm-m-cross', d: 'M-6 -6 L6 6 M6 -6 L-6 6' }),
        svg('path', { class: 'vm-m-chute', d: 'M-8 -2 A8 7 0 0 1 8 -2 Z M-7 -2 L0 7 M7 -2 L0 7' }),
        svg('path', { class: 'vm-m-wall', d: 'M-8 8 L8 -8' }),
      ]);
      this.mates.push({ root, sweep, shown: '', swept: -1 });
      pics.push(root);
    }
    this.word = el('div', 'vm-word lbl');
    this.team = el('div', 'vm-team lbl', [LABELS.nerve.teamUp]);
    this.chip = el('div', 'vm-chip', [svg('svg', { class: 'vm-chip-pics', viewBox: '-60 -12 120 24', 'aria-hidden': 'true' }, pics), this.word, this.team]);
    this.root.append(big, this.chip);
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
    if (e.type === 'projectileSpawn' && e.owner === 'unit' && e.ownerId !== this.drivenId && Math.floor(e.ownerId / MATCH_RULES.unitsPerSquad) === this.ownSquad && now >= this.releasedAt) {
      this.shotSince = true;
    }
    // The server says this squad fired a charged volley: that is what the release flash waits for.
    if (e.type === 'volley' && e.squad === this.ownSquad && now - this.lastFired > 1) {
      const immune = !!this.boss && this.boss.nerveImmune > 0 && this.boss.phase !== 'stagger';
      this.startFlash('fired', now, Math.max(this.frozen, e.charge));
      this.setResult(immune ? W.immune : W.fired, now);
    }
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.teamUp = 0;
  }

  private setResult(word: VolleyWord, now: number): void {
    this.result = word;
    this.resultUntil = now + RESULT_TIME;
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
    this.boss = f.boss;
    if (!f.visible) {
      this.wasHeld = held;
      this.lastCharge = 0;
      this.hide();
      return;
    }
    if (held && !this.wasHeld) {
      this.heldSince = now;
      this.result = '';
    }
    this.drivenId = -1;
    for (const u of f.units) if (u.squad === ownSquad && u.driven) this.drivenId = u.id;
    // The squad-mates' lines to where the volley would go, a few times a second.
    if (!f.atKaiju || !f.target || !f.query) {
      this.lines.length = 0;
      this.linesAt = Number.NEGATIVE_INFINITY;
    } else if (now - this.linesAt >= LINE_EVERY) {
      this.linesAt = now;
      this.lines = mateLines(f.query, f.units, ownSquad, f.target, this.lines, f.boss ? kaijuShownRadius(f.boss) : 0);
    }
    mateLooks(f.units, ownSquad, f.atKaiju ? this.lines : null, this.looks);

    let charge = shownCharge(f.units, ownSquad, held, f.sinceSnapshot);
    // Not planted yet as far as this screen knows: carried from the press itself.
    if (held && charge <= 0) charge = predictedCharge(f.units, ownSquad, now - this.heldSince, f.roundTrip);

    // Let go: the meter holds its level and waits for the server's answer.
    if (this.wasHeld && !held && this.lastCharge > 0) {
      this.releasedAt = now;
      this.shotSince = false;
      this.frozen = this.lastCharge;
      if (this.lastCharge < COMBAT_RULES.volleyMinCharge) {
        this.startFlash('fizzle', now, this.lastCharge);
        this.setResult(W.weak, now);
      } else this.result = '';
    }
    // No `volley` from the server in time: the squad-mates' shots went ragged ("Weak"), or none
    // left at all ("No shot").
    const wait = NO_SHOT_WAIT + f.roundTrip;
    if (!held && !this.result && now - this.releasedAt > wait && now - this.releasedAt < wait + 0.5) {
      this.startFlash('fizzle', now, this.frozen);
      this.setResult(this.shotSince ? W.weak : W.noShot, now);
    }
    this.wasHeld = held;
    this.lastCharge = charge;
    if (this.flash && now >= this.flashUntil) {
      this.root.classList.remove(this.flash);
      this.flash = '';
    }
    if (this.result && now >= this.resultUntil) this.result = '';
    const waiting = !held && !this.result && now - this.releasedAt <= wait;
    const flashing = this.flash === 'fired' || this.flash === 'fizzle' || waiting;

    let able = false;
    for (const l of this.looks) if (l !== 'dead' && l !== 'landing' && l !== 'stunned' && l !== 'shaken') able = true;
    const remaining = this.partner.remaining(now);
    const team = teamUpShown(remaining, f.boss, able);
    this.teamUp = team ? remaining / COMBAT_RULES.volleyBreakWindow : 0;
    this.root.classList.remove('hidden');

    const level = flashing ? this.frozen : charge;
    const shown = Math.round(level * 400) / 400;
    if (shown !== this.shownLevel) {
      this.shownLevel = shown;
      const h = shown * OUTER * 2;
      this.level.setAttribute('y', (OUTER - h).toFixed(2));
      this.level.setAttribute('height', (h + (shown > 0 ? 0.5 : 0)).toFixed(2));
    }
    const ring = Math.round(this.teamUp * 500) / 500;
    if (ring !== this.shownRing) {
      this.shownRing = ring;
      this.ringTime.setAttribute('stroke-dashoffset', (RING_LENGTH * (1 - ring)).toFixed(2));
    }

    // The squad-mates' pictures (the reload ring fills as the weapon reloads).
    let m = 0;
    for (const u of f.units) {
      if (u.squad !== ownSquad || u.driven) continue;
      const pic = this.mates[m];
      const look = this.looks[m++];
      if (!pic) break;
      if (look !== pic.shown) {
        pic.shown = look;
        pic.root.setAttribute('class', `vm-mate ${look}`);
      }
      const swept = look === 'reload' ? Math.round((1 - u.cooldown / Math.max(0.01, volleyReload(u.type, f.pickup))) * 40) / 40 : -1;
      if (swept !== pic.swept) {
        pic.swept = swept;
        pic.sweep.setAttribute('d', swept > 0 ? arc(6.5, swept) : '');
      }
    }
    for (; m < this.mates.length; m++) {
      if (this.mates[m].shown !== 'none') {
        this.mates[m].shown = 'none';
        this.mates[m].root.setAttribute('class', 'vm-mate none');
      }
    }

    const word: VolleyWord = this.result || (waiting ? this.lastWord : volleyWord(this.looks, held, level));
    this.lastWord = word;
    const showBig = held || this.flash !== '' || waiting;
    const charged = showBig && level >= COMBAT_RULES.volleyMinCharge;
    const full = showBig && level >= 0.995;
    const key = `${word}|${held ? 1 : 0}${showBig ? 1 : 0}${flashing ? 1 : 0}${charged ? 1 : 0}${full ? 1 : 0}${team ? 1 : 0}${team && remaining < HURRY_TIME ? 1 : 0}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    if (this.word.textContent !== word) this.word.textContent = word;
    this.word.className = `vm-word lbl ${WORD_TONE[word]}`;
    const c = this.root.classList;
    c.toggle('held', held);
    c.toggle('big', showBig);
    c.toggle('waiting', waiting && !this.flash);
    c.toggle('charged', charged);
    c.toggle('full', full);
    c.toggle('countdown', team);
    c.toggle('hurry', team && remaining < HURRY_TIME);
    c.toggle('cannot', WORD_TONE[word] === 'cannot');
    c.toggle('no-line', word === W.noLine);
  }
}
