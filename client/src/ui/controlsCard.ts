/**
 * The controls card (H): what the player can do right now, as five big pictures at most, each
 * over the button that does it (docs/ROADMAP.md round 4: "five things at most per side, big
 * pictures"; DESIGN.md section 8: no words but names). The buttons are drawn in the glyphs of
 * the device in use (keycaps and mouse buttons, or the controller's). A ring around a glyph
 * means "hold it". In the header, small, the communication rose's key.
 *
 * Only what can be done now is shown, so the card changes as the match does (`CardState`, fed
 * by the match screen every frame):
 *
 *   the monster   walk and look; Strike (a swipe, or with something in the hand its throw, the
 *                 sign's swing, the antenna's javelin); Grab (a grab, or with something in the
 *                 hand eating it, or dropping a city weapon); Stomp; the moves its molts have
 *                 picked, each on its own button (only once picked); the molt, while the bar
 *                 offers one. With all of these, walking is left out (it is the one every player
 *                 finds alone).
 *   a squad       on foot (stage 1) moving and looking; in a tank (stages 2 and 3) driving and
 *                 the turret; Fire (the crate's weapon while the squad has one); Volley (held;
 *                 with a crate's weapon its picture, with the artillery radio the radio); the map.
 *   the drone     (the squad is gone) flying, looking, up, down, the map.
 *
 * Where it shows: a button in the lobby and on the briefing screen (the starting state); open by
 * itself for the whole briefing; in a match the `controls` action (H, or a click of the left
 * stick) opens and closes it. In a match it takes no mouse input at all (the pointer stays
 * captured and the game keeps running behind it); in the menus a click on it closes it.
 */

import { kaijuKindDef, kaijuMoveVerb, LAST_STAGE, type HeldObject, type KaijuKindId, type KaijuMoveId, type PickupId, type SnapKaiju, type SnapSquad, type StageId } from '@mb/shared';
import { pickupIcon } from '../assets/iconRaster';
import { glyphFor, keyLayoutVersion, type Bindings, type ButtonAction, type Glyph, type InputDevice } from '../game/input/actions';
import { el, glyph, icon } from './icons';
import { grabIcon, MOVE_ICON, strikeIcon } from './kaijuKit';

export type CardRole = 'kaiju' | 'squad';

/** How a picture is colored: the monster's orange, the army's cyan, the volley's yellow, or dimmed. */
export type CardTone = 'kaiju' | 'human' | 'volley' | 'dim';

/** One glyph or picture. */
export type CardPart =
  /** The movement keys (a cross of four keycaps) or the left stick. */
  | { kind: 'move' }
  /** The mouse moving, or the right stick. */
  | { kind: 'look' }
  /** A button; `hold`: held down (a ring around the glyph). */
  | { kind: 'button'; action: ButtonAction; hold?: boolean }
  /** A picture of what happens. */
  | { kind: 'picture'; icon: string; tone?: CardTone };

/** Big pictures over the buttons that do them. */
export interface CardPair {
  pics: CardPart[];
  keys: CardPart[];
}

export interface CardTile {
  /** Stable name for tests and styling. */
  id: string;
  /** Side by side (the monster's two move buttons are two pairs in one tile). */
  pairs: CardPair[];
  /** Lit and pulsing: do this now (the molt on offer). */
  glow?: boolean;
}

/** What the player has right now: the card shows only what can be done with it. */
export interface CardState {
  stage: StageId;
  /** The monster: the moves its molts have put on its two move buttons. */
  moves: readonly [KaijuMoveId, KaijuMoveId];
  /** The monster: what is in its hand. */
  held: HeldObject | null;
  /** The monster: the bar offers a molt. */
  moltOffered: boolean;
  /** A squad: the crate weapon it fires ('none': its own). */
  pickup: PickupId;
  /** A squad: the artillery radio's barrages left (0: no radio). */
  barrages: number;
  /** The squad is gone: the player flies the news drone. */
  drone: boolean;
}

/** The start of a match (the lobby and the briefing show this). */
export const START_STATE: CardState = { stage: 1, moves: ['none', 'none'], held: null, moltOffered: false, pickup: 'none', barrages: 0, drone: false };

/** The most big pictures a card shows (round 4). */
export const MAX_TILES = 5;

/** The card's state from the frame: the local kaiju's, or the player's squad's. */
export function cardState(stage: StageId, kaiju: SnapKaiju | null, squad: SnapSquad | undefined, drone: boolean): CardState {
  return {
    stage,
    moves: kaiju ? kaiju.moves : START_STATE.moves,
    held: kaiju ? kaiju.held : null,
    moltOffered: !!kaiju && kaiju.moltAvailable && kaiju.stage < LAST_STAGE,
    pickup: squad ? squad.pickup : 'none',
    barrages: squad ? squad.barrages : 0,
    drone,
  };
}

/** A short key that changes whenever the card would show something else. */
export function stateKey(s: CardState): string {
  const held = s.held ? `${s.held.kind}:${s.held.kind === 'prop' ? s.held.prop : ''}` : '';
  return `${s.stage}|${s.moves[0]}|${s.moves[1]}|${held}|${s.moltOffered ? 1 : 0}|${s.pickup}|${s.barrages > 0 ? 1 : 0}|${s.drone ? 1 : 0}`;
}

const button = (action: ButtonAction, hold = false): CardPart => ({ kind: 'button', action, hold });
const picture = (id: string, tone?: CardTone): CardPart => ({ kind: 'picture', icon: id, tone });
const pair = (keys: CardPart[], pics: CardPart[]): CardPair => ({ keys, pics });

/** The communication rose: held, pick a wedge, let go to say it (small, in the card's header). */
export function roseTile(): CardTile {
  return { id: 'rose', pairs: [pair([button('rose', true)], [picture('ui_rose')])] };
}

/** The monster's card for what it has now. */
export function kaijuTiles(kind: KaijuKindId, state: CardState = START_STATE): CardTile[] {
  const def = kaijuKindDef(kind);
  const held = state.held;
  // Grab with an empty hand: the car shows what the hand can close on (they glow in the street).
  const grabPics = held ? [picture(grabIcon(held), 'kaiju')] : [picture('k_grab', 'kaiju'), picture('tl_car')];
  // Something edible in the hand heals.
  if (grabIcon(held) === 'k_eat') grabPics.push(picture('st_health'));
  const tiles: CardTile[] = [
    { id: 'walk', pairs: [pair([{ kind: 'move' }, { kind: 'look' }], [picture('lb_kaiju', 'kaiju')])] },
    { id: 'strike', pairs: [pair([button('strike')], [picture(strikeIcon(held), 'kaiju')])] },
    { id: 'grab', pairs: [pair([button('grab')], grabPics)] },
    { id: 'stomp', pairs: [pair([button('stomp')], [picture('k_stomp', 'kaiju')])] },
  ];
  // The moves the molts picked, each on its own button (the brace is held).
  const moves: CardPair[] = [];
  state.moves.forEach((move, i) => {
    if (move === 'none') return;
    const verb = kaijuMoveVerb(move);
    const hold = verb !== 'none' && def.actions[verb].whileHeld;
    moves.push(pair([button(i === 0 ? 'move1' : 'move2', hold)], [picture(MOVE_ICON[move], 'kaiju')]));
  });
  if (moves.length > 0) tiles.push({ id: 'moves', pairs: moves });
  if (state.moltOffered) tiles.push({ id: 'molt', glow: true, pairs: [pair([button('molt')], [picture('k_molt', 'kaiju')])] });
  // Five at most: walking goes first.
  return tiles.length > MAX_TILES ? tiles.filter((t) => t.id !== 'walk') : tiles;
}

/** A squad leader's card for what it has now (or the news drone's, once the squad is gone). */
export function squadTiles(state: CardState = START_STATE): CardTile[] {
  const map: CardTile = { id: 'map', pairs: [pair([button('map')], [picture('st_map')])] };
  if (state.drone) {
    return [
      { id: 'fly', pairs: [pair([{ kind: 'move' }, { kind: 'look' }], [picture('st_camera', 'human')])] },
      { id: 'rise', pairs: [pair([button('rise')], [picture('ui_rise', 'human')])] },
      { id: 'sink', pairs: [pair([button('sink')], [picture('ui_sink', 'human')])] },
      map,
    ];
  }
  const weapon = state.pickup !== 'none' && state.pickup !== 'artilleryRadio' && state.pickup !== 'reinforcements' ? pickupIcon(state.pickup) : null;
  const tiles: CardTile[] = [];
  if (state.stage === 1) {
    // On foot the keys move relative to the view.
    tiles.push({ id: 'walk', pairs: [pair([{ kind: 'move' }, { kind: 'look' }], [picture('sq_foot', 'human')])] });
  } else {
    // A tank: W and S drive, A and D turn the hull; the turret follows the mouse at its own pace.
    tiles.push(
      { id: 'drive', pairs: [pair([{ kind: 'move' }], [picture('sq_drive', 'human'), picture('sq_turn', 'human')])] },
      { id: 'turret', pairs: [pair([{ kind: 'look' }], [picture('sq_turret', 'human')])] },
    );
  }
  // Fire: the unit's own shot, or the crate's weapon while the squad has one.
  tiles.push({ id: 'fire', pairs: [pair([button('fire')], [picture(weapon ?? 'st_reload', weapon ? 'volley' : 'human')])] });
  // Volley, held: the squad-mates plant and charge, let go and they all fire (the crate's weapon
  // too; with the artillery radio the volley calls a barrage).
  const volley = [picture('sq_charge', 'volley'), picture(state.barrages > 0 ? 'pk_artilleryradio' : (weapon ?? 'sq_burst'), 'volley')];
  tiles.push({ id: 'volley', pairs: [pair([button('volley', true)], volley)] });
  tiles.push(map);
  return tiles;
}

export function cardTiles(role: CardRole, kind: KaijuKindId, state: CardState = START_STATE): CardTile[] {
  return role === 'kaiju' ? kaijuTiles(kind, state) : squadTiles(state);
}

/** Every action a card shows a button for (the movement keys count as the four move actions). */
export function cardActions(tiles: CardTile[]): Set<ButtonAction> {
  const out = new Set<ButtonAction>();
  for (const tile of tiles) {
    for (const p of tile.pairs) {
      for (const part of p.keys) {
        if (part.kind === 'button') out.add(part.action);
        else if (part.kind === 'move') for (const a of ['moveForward', 'moveBack', 'moveLeft', 'moveRight'] as const) out.add(a);
      }
    }
  }
  return out;
}

/** The glyph a button part shows on a device, or null when it is unbound there. */
export function partGlyph(part: Extract<CardPart, { kind: 'button' }>, bindings: Bindings, device: InputDevice): Glyph | null {
  return glyphFor(bindings, part.action, device);
}

export class ControlsCard {
  /** A sheet over the page; the card sits in it. */
  readonly root = el('div', 'controls hidden');
  open = false;
  /** Called when the player closes the card with a click (menus only). */
  onClose: (() => void) | null = null;

  private readonly card = el('div', 'controls-card');
  private role: CardRole | null = null;
  private kind: KaijuKindId | null = null;
  private name = '';
  private state: CardState = START_STATE;
  private shown = '';
  private bindings: Bindings | null = null;
  private device: InputDevice = 'keyboard';

  constructor() {
    this.root.append(this.card);
    this.root.addEventListener('mousedown', () => {
      if (!this.root.classList.contains('passive')) this.setOpen(false, true);
    });
  }

  /**
   * In a match the card ignores the mouse (`passive`): clicks go to the game and the pointer
   * stays captured. In the menus a click anywhere closes it.
   */
  setPassive(passive: boolean): void {
    this.root.classList.toggle('passive', passive);
  }

  /**
   * Which card to show: the role, the kaiju's kind, and the name in its header (the kaiju's or
   * the faction's). The card goes back to the start of a match (the match screen then feeds it).
   */
  setRole(role: CardRole, kind: KaijuKindId, name: string): void {
    this.state = START_STATE;
    if (this.role === role && this.kind === kind && this.name === name) {
      if (this.open) this.render();
      return;
    }
    this.role = role;
    this.kind = kind;
    this.name = name;
    this.shown = '';
    this.render();
  }

  /** What the player has right now (the match screen, every frame): the card follows it. */
  setState(state: CardState): void {
    this.state = state;
    if (this.open) this.render();
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(open: boolean, byPlayer = false): void {
    if (this.open === open) return;
    this.open = open;
    this.root.classList.toggle('hidden', !open);
    if (open) {
      this.render();
      this.fit();
    }
    if (!open && byPlayer) this.onClose?.();
  }

  /** Call every frame: the glyphs follow the device in use and the keyboard's layout. */
  update(bindings: Bindings, device: InputDevice): void {
    this.bindings = bindings;
    this.device = device;
    if (this.open) this.render();
  }

  get currentRole(): CardRole | null {
    return this.role;
  }

  get currentDevice(): InputDevice {
    return this.device;
  }

  /** The tiles shown now (for the debug hooks and playtests). */
  get tiles(): CardTile[] {
    return this.role && this.kind ? cardTiles(this.role, this.kind, this.state) : [];
  }

  private render(): void {
    const role = this.role;
    const kind = this.kind;
    const bindings = this.bindings;
    if (!role || !kind || !bindings) return;
    // (The window's size too: the card is fitted to it.)
    const key = `${role}:${kind}:${this.name}:${this.device}:${keyLayoutVersion()}:${stateKey(this.state)}:${window.innerWidth}x${window.innerHeight}`;
    if (key === this.shown) return;
    this.shown = key;
    const device = this.device;
    const tone = role === 'kaiju' ? 'kaiju' : 'human';

    const tile = (t: CardTile, extra = ''): HTMLElement => {
      const pairs = t.pairs.map((p) =>
        el('div', 'card-pair', [el('div', 'card-pics', p.pics.map((part) => this.part(part, bindings, device))), el('div', 'card-keys', p.keys.map((part) => this.part(part, bindings, device)))]),
      );
      const node = el('div', `card-tile${t.glow ? ' glow' : ''}${extra}`, pairs);
      node.dataset.tile = t.id;
      return node;
    };
    // The header: who, then the communication rose's key (small), then the card's own key.
    const head = el('div', 'card-head', [
      icon(role === 'kaiju' ? 'lb_kaiju' : 'fac_army', `card-role ${tone}`),
      el('div', `card-name ${tone}`, [this.name]),
      tile(roseTile(), ' card-small'),
      el('div', 'card-close', [glyph(glyphFor(bindings, 'controls', device), 'card-glyph'), icon('ui_controls')]),
    ]);
    const tiles = cardTiles(role, kind, this.state).map((t) => tile(t));
    this.card.className = `controls-card role-${role}`;
    this.card.dataset.device = device;
    this.card.replaceChildren(head, el('div', 'card-grid', tiles));
    if (this.open) this.fit();
  }

  /**
   * Shrinks the card's unit (`--u`, styles.css) until the whole card fits its sheet (a small
   * window would cut its bottom off).
   */
  private fit(): void {
    const card = this.card;
    card.style.removeProperty('--u');
    for (let i = 0; i < 3; i++) {
      const room = card.clientHeight;
      const need = card.scrollHeight;
      const wide = card.scrollWidth > card.clientWidth + 1;
      if (room <= 0 || (need <= room + 1 && !wide)) return;
      // (The keys' row is one unit high: styles.css.)
      const keys = card.querySelector('.card-keys');
      const u = keys ? parseFloat(getComputedStyle(keys).fontSize) : NaN;
      if (!(u > 0)) return;
      const share = Math.min(room / need, wide ? card.clientWidth / card.scrollWidth : 1);
      card.style.setProperty('--u', `${Math.max(12, Math.floor(u * share * 0.98))}px`);
    }
  }

  private part(part: CardPart, bindings: Bindings, device: InputDevice): HTMLElement {
    switch (part.kind) {
      case 'move': {
        if (device === 'gamepad') return el('div', 'card-tilt', [glyph({ icon: 'gp_ls', label: '' }, 'card-glyph card-stick')]);
        const key = (a: ButtonAction): HTMLElement => glyph(glyphFor(bindings, a, 'keyboard'), 'card-key');
        return el('div', 'card-move', [el('div', 'card-move-row', [key('moveForward')]), el('div', 'card-move-row', [key('moveLeft'), key('moveBack'), key('moveRight')])]);
      }
      case 'look':
        // A stick is tilted (four small arrows around it), not clicked.
        if (device === 'gamepad') return el('div', 'card-tilt', [glyph({ icon: 'gp_rs', label: '' }, 'card-glyph card-stick')]);
        return glyph({ icon: 'ms_move', label: '' }, 'card-glyph');
      case 'button': {
        const g = glyph(partGlyph(part, bindings, device), 'card-glyph');
        return part.hold ? el('div', 'card-hold', [g]) : g;
      }
      case 'picture':
        return icon(part.icon, `card-pic${part.tone ? ` ${part.tone}` : ''}`);
    }
  }
}
