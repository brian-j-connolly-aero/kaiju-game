/**
 * The monster's buttons on the HUD, bottom right (DESIGN.md section 8; docs/ROADMAP.md phase 1:
 * one move per button). Pictures only, each over the glyph of its button on the device in use:
 *
 *   the starting kit   Strike (a swipe; with something in the hand, the throw), Grab (a grab;
 *                      with something in the hand, eating it) and Stomp. With a city weapon in
 *                      the hand (phase 2) Strike shows what it does with it (a javelin thrown
 *                      point first, the fast-food sign swung, with a pip for each swing left,
 *                      anything else thrown; a propane tank pulses red, it can go off in the
 *                      hand) and Grab shows the drop (a city weapon is never eaten)
 *   the shield         a garage door in the hand: the door, the front it covers and its strength
 *                      left
 *   the surge          a power surge (a substation wrecked): a big lightning badge beside the
 *                      crosshair (`badge`, which the HUD places) in a ring that runs down over
 *                      its 8 seconds; as it starts every button snaps full with a crackle (the
 *                      surge clears every cooldown), and the move slots flash while it lasts
 *   two move slots     what the molts put on the two move buttons. Empty: a faint locked egg.
 *                      Filled: the move's picture inside a ring that fills as the move comes
 *                      ready (its cooldown; for the beam, the rage it needs), bright when ready
 *   molt               only while the bar offers a molt, pulsing
 *   camera             the view toggle
 *
 * `slotRect` tells the molt card picker (ui/moltCards.ts) where a picked card lands, and `land`
 * makes the slot flash when it does.
 */

import { heldCityWeapon, heldEdible, kaijuKindDef, kaijuMoveVerb, LAST_STAGE, strikeVerb, type HeldObject, type KaijuMove, type KaijuMoveId, type SnapKaiju } from '@mb/shared';
import { glyphFor, type Bindings, type ButtonAction, type InputDevice } from '../game/input/actions';
import { el, glyph, icon, setGlyph, setIcon } from './icons';

/** The picture of each move a molt can give (docs/ASSETS.md section 5). */
export const MOVE_ICON: Readonly<Record<KaijuMove, string>> = {
  beam: 'k_special',
  roar: 'k_roar',
  charge: 'k_charge',
  tailSweep: 'k_tailsweep',
  brace: 'k_brace',
};

/** The picture of a slot's move, or the empty slot's egg. */
export function moveIcon(move: KaijuMoveId): string {
  return move === 'none' ? 'k_molt' : MOVE_ICON[move];
}

/**
 * What the Strike button's picture is with this in the hand: the swipe with nothing, the club
 * with a fast-food sign, a javelin with an antenna or a radio mast's top, a throw with anything
 * else (docs/ROADMAP.md phase 2).
 */
export function strikeIcon(held: HeldObject | null): string {
  const verb = strikeVerb(held);
  if (verb === 'swipe') return 'k_swipe';
  if (verb === 'club') return 'k_club';
  const weapon = heldCityWeapon(held);
  return weapon === 'antenna' || weapon === 'mast' ? 'k_javelin' : 'k_throw';
}

/** ...and the Grab button's: the grab with nothing, the meal with something it can eat, the drop with a city weapon. */
export function grabIcon(held: HeldObject | null): string {
  if (!held) return 'k_grab';
  return heldEdible(held) ? 'k_eat' : 'k_drop';
}

interface Tile {
  root: HTMLElement;
  box: HTMLElement;
  pic: HTMLElement;
  cover: HTMLElement;
  glyph: HTMLElement;
  action: ButtonAction;
}

function setClass(node: HTMLElement, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

function tile(iconId: string, action: ButtonAction, extra = ''): Tile {
  const pic = icon(iconId);
  const cover = el('div', 'hint-cover');
  const box = el('div', 'hint-icon', [pic, cover]);
  const g = glyph(null, 'hint-glyph');
  const root = el('div', `hint ${extra}`.trim(), [box, g]);
  return { root, box, pic, cover, glyph: g, action };
}

const SLOT_ACTIONS = ['move1', 'move2'] as const;

export class KaijuKit {
  readonly root: HTMLElement;
  private readonly strike = tile('k_swipe', 'strike', 'kit-strike');
  private readonly grab = tile('k_grab', 'grab', 'kit-grab');
  private readonly stomp = tile('k_stomp', 'stomp', 'kit-stomp');
  private readonly slots: [Tile, Tile] = [tile('k_molt', 'move1', 'kit-slot empty'), tile('k_molt', 'move2', 'kit-slot empty')];
  private readonly rings: [HTMLElement, HTMLElement];
  private readonly molt = tile('k_molt', 'molt', 'kit-molt hidden');
  private readonly camera = tile('st_camera', 'camera', 'kit-camera');
  /** The fast-food sign's swings left, under Strike. */
  private readonly pips: HTMLElement[] = [];
  /** A garage door in the hand: the door over the front it covers, and its strength left. */
  private readonly shield: HTMLElement;
  private readonly shieldBar: HTMLElement;
  /** The power surge: a big bolt in a ring that runs down as it does (the HUD puts it beside the crosshair). */
  readonly badge: HTMLElement;
  private readonly surgeRing: HTMLElement;
  private lastShield = -1;
  private lastSurge = -1;
  private lastPips = -1;
  /** What each slot shows, and the longest wait seen since it was last ready (the ring's full turn). */
  private readonly shown: [KaijuMoveId, KaijuMoveId] = ['none', 'none'];
  private readonly peak = [0, 0];
  private readonly fills = [-1, -1];
  private lastCover = -1;
  /**
   * While a picked card flies to a slot the slot still shows what it had (until `held`, local
   * seconds); once it has landed it shows the card's move until the snapshots carry it.
   */
  private readonly held = [0, 0];
  private readonly landing: [KaijuMoveId, KaijuMoveId] = ['none', 'none'];
  private now = 0;

  constructor() {
    this.rings = [el('div', 'slot-ring'), el('div', 'slot-ring')];
    this.slots.forEach((s, i) => {
      s.box.classList.add('slot-box');
      s.box.prepend(this.rings[i]);
      s.root.dataset.slot = String(i);
    });
    for (let i = 0; i < 3; i++) this.pips.push(el('div', 'kit-pip'));
    this.strike.box.append(el('div', 'kit-pips', this.pips));
    this.shieldBar = el('div', 'kit-shield-fill');
    this.shield = el('div', 'kit-shield hidden', [el('div', 'kit-shield-arc'), icon('k_shield'), el('div', 'kit-shield-bar', [this.shieldBar])]);
    this.surgeRing = el('div', 'kit-surge-ring');
    this.badge = el('div', 'kit-surge hidden', [this.surgeRing, el('div', 'kit-surge-bolt', [icon('k_surge')])]);
    this.root = el('div', 'hints kaiju-kit', [this.shield, this.strike.root, this.grab.root, this.stomp.root, this.slots[0].root, this.slots[1].root, this.molt.root, this.camera.root]);
  }

  /** Every tile's glyph for the device in use (call when the device or the keyboard's layout changes). */
  setGlyphs(bindings: Bindings, device: InputDevice): void {
    for (const t of [this.strike, this.grab, this.stomp, ...this.slots, this.molt, this.camera]) setGlyph(t.glyph, glyphFor(bindings, t.action, device));
  }

  /** Where slot 0 or 1 is on screen (a picked molt card flies there), or null when it is not shown. */
  slotRect(slot: number): DOMRect | null {
    const s = this.slots[slot];
    if (!s || s.box.offsetParent === null) return null;
    return s.box.getBoundingClientRect();
  }

  /** A picked card is on its way to this slot: keep showing what was there until it lands. */
  hold(slot: number, seconds = 1.5): void {
    if (slot === 0 || slot === 1) this.held[slot] = this.now + seconds;
  }

  /** A move has just landed in a slot: it shows there at once, and the slot flashes. */
  land(slot: number, move: KaijuMoveId): void {
    const s = this.slots[slot];
    if (!s) return;
    this.held[slot] = 0;
    this.landing[slot] = move;
    s.root.classList.remove('landed');
    void s.root.offsetWidth;
    s.root.classList.add('landed');
  }

  /** `now`: local seconds (for a card in flight). */
  update(k: SnapKaiju, now = 0): void {
    this.now = now;
    const def = kaijuKindDef(k.kind);
    // The starting kit: what Strike and Grab do depends on the hand.
    setIcon(this.strike.pic, strikeIcon(k.held));
    setIcon(this.grab.pic, grabIcon(k.held));
    this.updateWeapon(k);
    // With something edible in the hand and the last meal too recent, Grab does nothing.
    const eatWait = heldEdible(k.held) && k.cooldowns.eat > 0 ? k.cooldowns.eat / Math.max(0.01, def.actions.eat.cooldown) : 0;
    const cover = Math.round(Math.min(1, eatWait) * 20) / 20;
    if (cover !== this.lastCover) {
      this.lastCover = cover;
      this.grab.cover.style.height = `${(cover * 100).toFixed(0)}%`;
    }
    setClass(this.grab.root, 'unavailable', cover > 0);
    setClass(this.stomp.root, 'active', k.action === 'stomp' && k.phase !== 'idle');
    setClass(this.strike.root, 'active', (k.action === 'swipe' || k.action === 'throw' || k.action === 'club') && k.phase !== 'idle');

    // The two slots.
    for (let i = 0; i < 2; i++) this.updateSlot(i, k);

    // Molt, while the bar offers it.
    const offered = k.moltAvailable && k.stage < LAST_STAGE;
    setClass(this.molt.root, 'hidden', !offered);
    setClass(this.molt.root, 'glow', offered);
  }

  /** The sign's swings, the door's strength, the propane tank's warning and the surge. */
  private updateWeapon(k: SnapKaiju): void {
    const def = kaijuKindDef(k.kind);
    const weapon = heldCityWeapon(k.held);
    // A fast-food sign: one pip per swing left.
    const pips = weapon === 'foodsign' ? Math.max(0, Math.min(3, Math.round(k.clubSwings))) : -1;
    if (pips !== this.lastPips) {
      this.lastPips = pips;
      setClass(this.strike.root, 'swings', pips >= 0);
      this.pips.forEach((p, i) => setClass(p, 'on', i < pips));
    }
    // A propane tank: it can go off in the hand (a shot landing within 2 m of it).
    setClass(this.strike.root, 'volatile', weapon === 'propane');
    // A garage door: its strength left, as a bar under the door.
    const door = weapon === 'garagedoor' ? Math.round(Math.max(0, Math.min(1, k.shieldHp / def.cityWeapons.garagedoor.hp)) * 40) / 40 : -1;
    if (door !== this.lastShield) {
      this.lastShield = door;
      setClass(this.shield, 'hidden', door < 0);
      if (door >= 0) {
        this.shieldBar.style.width = `${(door * 100).toFixed(1)}%`;
        setClass(this.shield, 'low', door < 0.3);
      }
    }
    // The power surge: the ring runs down over its seconds; the move slots flash meanwhile.
    const surge = k.surge > 0 ? Math.round(Math.max(0, Math.min(1, k.surge / def.rewards.surge.duration)) * 60) / 60 : -1;
    if (surge !== this.lastSurge) {
      const started = this.lastSurge < 0 && surge >= 0;
      this.lastSurge = surge;
      setClass(this.badge, 'hidden', surge < 0);
      setClass(this.root, 'surging', surge >= 0);
      if (surge >= 0) this.surgeRing.style.setProperty('--fill', surge.toFixed(3));
      if (started) {
        // It pops in big, and every button snaps full with a crackle.
        for (const node of [this.badge, this.root]) {
          node.classList.remove('surge-in');
          void node.offsetWidth;
          node.classList.add('surge-in');
        }
      }
    }
  }

  private updateSlot(i: number, k: SnapKaiju): void {
    const s = this.slots[i];
    // The snapshots have the pick a moment before the card gets there, or a moment after.
    if (k.moves[i] !== 'none') this.landing[i] = 'none';
    const move = this.held[i] > this.now ? this.shown[i] : k.moves[i] !== 'none' ? k.moves[i] : this.landing[i];
    if (move !== this.shown[i]) {
      this.shown[i] = move;
      setIcon(s.pic, moveIcon(move));
      setClass(s.root, 'empty', move === 'none');
      s.root.dataset.move = move;
      this.peak[i] = 0;
      this.fills[i] = -1;
    }
    if (move === 'none') {
      setClass(s.root, 'ready', false);
      setClass(s.root, 'active', false);
      return;
    }
    const def = kaijuKindDef(k.kind);
    const verb = kaijuMoveVerb(move);
    let fill = 1;
    if (verb !== 'none') {
      const action = def.actions[verb];
      if (action.rageCost > 0) {
        // The beam: the ring is the rage it needs.
        fill = Math.min(1, k.rage / action.rageCost);
      } else {
        const wait = k.cooldowns[verb];
        // The longest wait seen is the ring's full turn (the charge reads its run and its
        // stumble too while it runs, then exactly its cooldown).
        this.peak[i] = wait > 0 ? Math.max(this.peak[i], wait, action.cooldown) : 0;
        fill = wait > 0 ? 1 - wait / Math.max(0.01, this.peak[i]) : 1;
      }
    }
    const f = Math.round(Math.max(0, Math.min(1, fill)) * 40) / 40;
    if (f !== this.fills[i]) {
      this.fills[i] = f;
      this.rings[i].style.setProperty('--fill', f.toFixed(3));
    }
    setClass(s.root, 'ready', f >= 1);
    setClass(s.root, 'active', verb !== 'none' && k.action === verb && k.phase !== 'idle');
  }
}

/** Which move button a slot is on (0: the first, 1: the second). */
export function slotAction(slot: number): ButtonAction {
  return SLOT_ACTIONS[slot === 1 ? 1 : 0];
}
