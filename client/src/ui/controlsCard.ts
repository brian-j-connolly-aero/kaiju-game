/**
 * The controls card: every control of the player's role, as pictures (DESIGN.md section 8: no
 * words but names). Each tile is the button (in the glyph of the device in use: keycaps and
 * mouse buttons, or the controller's buttons) followed by a picture of what it does. A ring
 * around a glyph means "hold it"; a small arrow between pictures means "then".
 *
 * The kaiju's tiles (docs/ROADMAP.md phase 1: one move per button): the starting kit (swipe or
 * throw, grab or eat, stomp), the molt with its three cards, the two move buttons as empty slots
 * that the molts fill, then every move a card can give, on whichever move button it lands on
 * (the brace held), and swimming. Stages a control is limited to show as the HUD's three growing
 * triangles. The squad's tiles (docs/ROADMAP.md phase 1: two buttons): moving, aiming, Fire,
 * Volley (held: the squad-mates charge and the meter fills past its notch; let go: they all
 * fire; let go before the notch: a weak shot), the tank's driving at stages 2 and 3 (W and S
 * drive, A and D turn the hull, the turret follows the mouse), the camera, the map and the news
 * drone for after the squad is gone. `ACTION_USERS` in
 * game/input/actions.ts says who presses what, and client/test/controlsCard.test.ts fails when a
 * pressable action is missing from a card.
 *
 * Where it shows: a button in the lobby and on the briefing screen; open by itself for the whole
 * briefing; in a match the `controls` action (H, or a click of the left stick) opens and closes
 * it. In a match it takes no mouse input at all (the pointer stays captured and the game keeps
 * running behind it); in the menus a click on it closes it.
 */

import { kaijuKindDef, kaijuMoveVerb, type KaijuActionSet, type KaijuKindId, type KaijuMove, type StageId } from '@mb/shared';
import { glyphFor, keyGlyph, keyLayoutVersion, type Bindings, type ButtonAction, type Glyph, type InputDevice } from '../game/input/actions';
import { el, glyph, icon } from './icons';
import { MOVE_ICON } from './kaijuKit';

export type CardRole = 'kaiju' | 'squad';

/** One piece of a tile, left to right. */
export type CardPart =
  /** The movement keys (a cross of four keycaps) or the left stick. */
  | { kind: 'move' }
  /** The mouse moving, or the right stick. */
  | { kind: 'look' }
  /**
   * A button. `hold`: held down (a ring around the glyph). `mouse`: on keyboard and mouse,
   * show this key or mouse button instead of the action's own binding (the map is clicked).
   */
  | { kind: 'button'; action: ButtonAction; hold?: boolean; mouse?: string }
  /** A picture of what happens. `tone` colors it (kaiju, human, volley). */
  | { kind: 'picture'; icon: string; tone?: 'kaiju' | 'human' | 'volley' | 'dim' }
  /** "Then": a small arrow. */
  | { kind: 'then' }
  /**
   * Squad: one axis of the movement keys or the left stick: W over S (or the stick tilted up
   * and down) for a tank's throttle, A beside D (or the stick tilted sideways) for its turn.
   */
  | { kind: 'axis'; axis: 'throttle' | 'turn' }
  /** The stages what stands just before is limited to (the HUD's three growing triangles). */
  | { kind: 'stages'; stages: StageId[] }
  /**
   * Kaiju: "on its move button", for a move a molt card gives: both move buttons' glyphs in the
   * HUD's slot frame (it lands on the first empty one). `hold`: held down (the brace).
   */
  | { kind: 'moves'; hold?: boolean }
  /** Kaiju: one move button over its empty slot (a faint egg), and the stages from which it is filled. */
  | { kind: 'slot'; action: 'move1' | 'move2'; stages: StageId[] }
  /** Kaiju: three molt cards with these moves, each over the button that picks it (or a click). */
  | { kind: 'cards'; moves: readonly KaijuMove[] };

export interface CardTile {
  /** Stable name for tests and styling. */
  id: string;
  group: 'move' | 'verbs' | 'squad' | 'view';
  parts: CardPart[];
  /** The stages this applies at, when not all three. */
  stages?: StageId[];
  /** The kaiju verb this tile shows. */
  verb?: keyof KaijuActionSet;
  /** Takes two columns. */
  wide?: boolean;
}

/**
 * The control a kaiju verb is on (net/input.ts, one move per button) and whether it is held:
 * the starting kit's own buttons, or `slot` for a move a molt card gives (it lands on the first
 * empty move button, so the card shows both). Only the brace is held.
 */
export function cardButton(verb: keyof KaijuActionSet): { action: ButtonAction; hold: boolean; slot: boolean } {
  switch (verb) {
    case 'swipe':
    case 'throw':
      return { action: 'strike', hold: false, slot: false };
    case 'grab':
    case 'eat':
      return { action: 'grab', hold: false, slot: false };
    case 'stomp':
      return { action: 'stomp', hold: false, slot: false };
    case 'molt':
      return { action: 'molt', hold: false, slot: false };
    default:
      return { action: 'move1', hold: verb === 'brace', slot: true };
  }
}

const ALL_STAGES: StageId[] = [1, 2, 3];

/** The buttons that pick the first, second and third molt card. */
export const CARD_ACTIONS = ['card1', 'card2', 'card3'] as const satisfies readonly ButtonAction[];

const button = (action: ButtonAction, hold = false): CardPart => ({ kind: 'button', action, hold });
const picture = (id: string, tone?: 'kaiju' | 'human' | 'volley' | 'dim'): CardPart => ({ kind: 'picture', icon: id, tone });
const then: CardPart = { kind: 'then' };

/** The view and menu tiles every role has. */
function viewTiles(): CardTile[] {
  return [
    { id: 'camera', group: 'view', parts: [button('camera'), picture('st_camera')] },
    { id: 'settings', group: 'view', parts: [button('menu'), picture('ui_settings')] },
    { id: 'controls', group: 'view', parts: [button('controls'), picture('ui_controls')] },
  ];
}

/** The kaiju's card, from its kind's action table. */
export function kaijuTiles(kind: KaijuKindId): CardTile[] {
  const def = kaijuKindDef(kind);
  const stageCount = def.stages.length as number;
  const actions = def.actions;
  const stagesFrom = (from: number): StageId[] => ALL_STAGES.filter((s) => s >= from && s <= stageCount);
  // A molt is there to take before every stage but the last; the first fills the first move
  // button for the stages after it, the second the second.
  const molts = ALL_STAGES.filter((s) => s < stageCount);
  const tiles: CardTile[] = [
    { id: 'move', group: 'move', parts: [{ kind: 'move' }, picture('lb_kaiju', 'kaiju')] },
    { id: 'look', group: 'move', parts: [{ kind: 'look' }, picture('st_spotted')] },
    // The starting kit: one move per button.
    { id: 'swipe', group: 'verbs', verb: 'swipe', parts: [button('strike'), picture('k_swipe', 'kaiju')] },
    { id: 'stomp', group: 'verbs', verb: 'stomp', parts: [button('stomp'), picture('k_stomp', 'kaiju')] },
    // A car at every stage; from the stage the definition names, tanks and pieces of buildings too.
    { id: 'grab', group: 'verbs', verb: 'grab', parts: [button('grab'), picture('k_grab', 'kaiju'), picture('tl_car')] },
  ];
  const from = Math.min(actions.grab.vehicleFromStage, actions.grab.chunkFromStage);
  if (from <= stageCount) {
    tiles.push({ id: 'grab-big', group: 'verbs', verb: 'grab', parts: [button('grab'), picture('k_grab', 'kaiju'), picture('fac_army'), picture('tl_office')], stages: stagesFrom(from) });
  }
  tiles.push(
    // With something in the hand the same two buttons throw it, or eat it (it heals).
    { id: 'throw', group: 'verbs', verb: 'throw', parts: [picture('k_grab', 'dim'), then, button('strike'), picture('k_throw', 'kaiju')] },
    { id: 'eat', group: 'verbs', verb: 'eat', parts: [picture('k_grab', 'dim'), then, button('grab'), picture('k_eat', 'kaiju'), picture('st_health')] },
    // Nothing to pick up, but a kiosk in reach: the grab button eats that.
    { id: 'eat-kiosk', group: 'verbs', verb: 'eat', parts: [picture('tl_kiosk', 'dim'), then, button('grab'), picture('k_eat', 'kaiju')] },
  );
  // Swimming (sim/swim.ts) has no button: walk into deep water and stand, and it goes under.
  if (def.swim) {
    const swim = def.swim;
    const stages = ALL_STAGES.filter((s) => s <= stageCount && swim.stages[s - 1]);
    if (stages.length > 0) tiles.push({ id: 'swim', group: 'verbs', parts: [{ kind: 'move' }, then, picture('k_swim', 'kaiju')], stages });
  }
  tiles.push(
    // The molt: one press when the bar offers it; in the cocoon, one of three cards.
    { id: 'molt', group: 'verbs', verb: 'molt', wide: true, parts: [button('molt'), picture('k_molt', 'kaiju'), then, { kind: 'cards', moves: def.cards.first }], stages: molts },
    // The two move buttons, empty until the molts fill them.
    { id: 'slots', group: 'verbs', wide: true, parts: [{ kind: 'slot', action: 'move1', stages: stagesFrom(2) }, { kind: 'slot', action: 'move2', stages: stagesFrom(3) }] },
  );
  // What the cards can give, each on the move button it lands on: the beam once the rage is
  // full, the roar dazes, the brace is held. Offered first at the molt its stage pips show.
  for (const move of [...def.cards.first, ...def.cards.second]) {
    const verb = kaijuMoveVerb(move);
    if (verb === 'none' || tiles.some((t) => t.id === move)) continue;
    const action = actions[verb];
    const parts: CardPart[] = action.rageCost > 0 ? [picture('st_rage', 'kaiju'), then] : [];
    parts.push({ kind: 'moves', hold: action.whileHeld }, picture(MOVE_ICON[move], 'kaiju'));
    if (verb === 'roar') parts.push(then, picture('st_nerve', 'volley'));
    tiles.push({ id: move, group: 'verbs', verb, parts, stages: stagesFrom(def.cards.first.includes(move) ? 2 : 3) });
  }
  tiles.push({ id: 'map', group: 'view', parts: [button('map'), picture('st_map')] }, ...viewTiles());
  return tiles;
}

/** The squad leader's card (and the drone's, for after the squad is gone). */
export function squadTiles(): CardTile[] {
  const [camera, settings, controls] = viewTiles();
  // Five columns: moving, aiming and the two buttons; the weak volley and the tank's driving;
  // the view, the drone and the menus.
  return [
    // On foot (stage 1) the keys move relative to the view.
    { id: 'move', group: 'move', parts: [{ kind: 'move' }, picture('sq_foot', 'human')], stages: [1] },
    { id: 'look', group: 'move', parts: [{ kind: 'look' }, picture('st_spotted')] },
    { id: 'fire', group: 'verbs', parts: [button('fire'), picture('st_reload', 'human')] },
    // The volley: hold, and the three squad-mates plant and charge while the meter fills past
    // its notch; let go and they all fire at the crosshair.
    {
      id: 'volley',
      group: 'squad',
      wide: true,
      parts: [button('volley', true), picture('sq_charge', 'volley'), then, picture('sq_meter', 'volley'), then, picture('sq_burst', 'volley')],
    },
    // Let go before the notch: a weak, ragged shot.
    { id: 'volleyEarly', group: 'squad', parts: [picture('sq_meter_low', 'dim'), then, picture('sq_burst', 'dim')] },
    // At stages 2 and 3 the unit is a tank: W and S drive it, A and D turn the hull, and the
    // turret swings toward where the mouse looks at its own pace.
    { id: 'drive', group: 'move', parts: [{ kind: 'axis', axis: 'throttle' }, picture('sq_drive', 'human')], stages: [2, 3] },
    { id: 'turn', group: 'move', parts: [{ kind: 'axis', axis: 'turn' }, picture('sq_turn', 'human')], stages: [2, 3] },
    { id: 'turret', group: 'move', parts: [{ kind: 'look' }, picture('sq_turret', 'human')], stages: [2, 3] },
    { id: 'map', group: 'view', parts: [button('map'), picture('st_map')] },
    camera,
    // Squad gone: the news drone flies until the next molt.
    { id: 'drone', group: 'view', wide: true, parts: [picture('ui_skull', 'dim'), then, button('rise'), picture('ui_rise'), button('sink'), picture('ui_sink')] },
    settings,
    controls,
  ];
}

export function cardTiles(role: CardRole, kind: KaijuKindId): CardTile[] {
  return role === 'kaiju' ? kaijuTiles(kind) : squadTiles();
}

/** Every action a card shows a button for (the movement keys count as the four move actions). */
export function cardActions(tiles: CardTile[]): Set<ButtonAction> {
  const out = new Set<ButtonAction>();
  for (const tile of tiles) {
    for (const part of tile.parts) {
      if (part.kind === 'button') out.add(part.action);
      else if (part.kind === 'move') for (const a of ['moveForward', 'moveBack', 'moveLeft', 'moveRight'] as const) out.add(a);
      else if (part.kind === 'axis') for (const a of part.axis === 'throttle' ? (['moveForward', 'moveBack'] as const) : (['moveLeft', 'moveRight'] as const)) out.add(a);
      else if (part.kind === 'moves') for (const a of ['move1', 'move2'] as const) out.add(a);
      else if (part.kind === 'slot') out.add(part.action);
      else if (part.kind === 'cards') part.moves.forEach((_, i) => out.add(CARD_ACTIONS[i]));
    }
  }
  return out;
}

/** The glyph a button part shows on a device, or null when it is unbound there. */
export function partGlyph(part: Extract<CardPart, { kind: 'button' }>, bindings: Bindings, device: InputDevice): Glyph | null {
  if (device === 'keyboard' && part.mouse) return keyGlyph(part.mouse);
  return glyphFor(bindings, part.action, device);
}

function stagePips(stages: StageId[]): HTMLElement {
  return el(
    'div',
    'card-stages',
    ALL_STAGES.map((s) => el('div', `card-stage card-stage-${s}${stages.includes(s) ? ' on' : ''}`, [icon('lb_kaiju')])),
  );
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

  /** Which card to show: the role, the kaiju's kind, and the name in its header (the kaiju's or the faction's). */
  setRole(role: CardRole, kind: KaijuKindId, name: string): void {
    if (this.role === role && this.kind === kind && this.name === name) return;
    this.role = role;
    this.kind = kind;
    this.name = name;
    this.shown = '';
    this.render();
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

  private render(): void {
    const role = this.role;
    const kind = this.kind;
    const bindings = this.bindings;
    if (!role || !kind || !bindings) return;
    // (The window's size too: the card is fitted to it.)
    const key = `${role}:${kind}:${this.name}:${this.device}:${keyLayoutVersion()}:${window.innerWidth}x${window.innerHeight}`;
    if (key === this.shown) return;
    this.shown = key;
    const device = this.device;
    const tone = role === 'kaiju' ? 'kaiju' : 'human';

    const head = el('div', 'card-head', [
      icon(role === 'kaiju' ? 'lb_kaiju' : 'fac_army', `card-role ${tone}`),
      el('div', `card-name ${tone}`, [this.name]),
      el('div', 'card-device', device === 'gamepad' ? [icon('gp_dpad'), icon('gp_a')] : [icon('kb_key'), icon('ms_move')]),
      el('div', 'card-close', [glyph(glyphFor(bindings, 'controls', device), 'card-glyph'), icon('ui_controls')]),
    ]);

    const tiles = cardTiles(role, kind).map((tile) => {
      const parts = tile.parts.map((part) => this.part(part, bindings, device));
      if (tile.stages && tile.stages.length < 3) parts.push(stagePips(tile.stages));
      const node = el('div', `card-tile card-${tile.group}${tile.wide ? ' wide' : ''}`, [el('div', 'card-parts', parts)]);
      node.dataset.tile = tile.id;
      return node;
    });
    this.card.className = `controls-card role-${role}`;
    this.card.dataset.device = device;
    this.card.replaceChildren(head, el('div', 'card-grid', tiles));
    if (this.open) this.fit();
  }

  /**
   * Shrinks the card's unit (`--u`, styles.css) until the whole card fits its sheet: the
   * monster's card has six rows of tiles, more than a small window holds at full size, and the
   * sheet would cut the last row off.
   */
  private fit(): void {
    const card = this.card;
    card.style.removeProperty('--u');
    for (let i = 0; i < 3; i++) {
      const room = card.clientHeight;
      const need = card.scrollHeight;
      if (room <= 0 || need <= room + 1) return;
      const parts = card.querySelector('.card-parts');
      const u = parts ? parseFloat(getComputedStyle(parts).fontSize) : NaN;
      if (!(u > 0)) return;
      card.style.setProperty('--u', `${Math.max(12, Math.floor(u * (room / need) * 0.98))}px`);
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
      case 'then':
        return el('div', 'card-then');
      case 'axis': {
        // A stick tilted one way only (two small arrows), or the two keys of that axis as they sit.
        const throttle = part.axis === 'throttle';
        if (device === 'gamepad') return el('div', `card-tilt ${throttle ? 'card-tilt-v' : 'card-tilt-h'}`, [glyph({ icon: 'gp_ls', label: '' }, 'card-glyph card-stick')]);
        const key = (a: ButtonAction): HTMLElement => glyph(glyphFor(bindings, a, 'keyboard'), 'card-key');
        return throttle
          ? el('div', 'card-move', [el('div', 'card-move-row', [key('moveForward')]), el('div', 'card-move-row', [key('moveBack')])])
          : el('div', 'card-move', [el('div', 'card-move-row', [key('moveLeft'), key('moveRight')])]);
      }
      case 'stages':
        return stagePips(part.stages);
      case 'moves': {
        // Both move buttons in the HUD's slot frame: "on whichever button it landed on".
        const frame = el('div', 'card-moves', [glyph(glyphFor(bindings, 'move1', device), 'card-glyph'), glyph(glyphFor(bindings, 'move2', device), 'card-glyph')]);
        return part.hold ? el('div', 'card-hold', [frame]) : frame;
      }
      case 'slot':
        // A move button over its empty slot (the HUD's faint egg), and the stages it is filled at.
        return el('div', 'card-slot', [glyph(glyphFor(bindings, part.action, device), 'card-glyph'), el('div', 'card-slot-box', [icon('k_molt', 'card-slot-egg')]), stagePips(part.stages)]);
      case 'cards': {
        // The cards as the picker shows them, each over the button that picks it; or a click.
        const cards: HTMLElement[] = part.moves.map((move, i) => el('div', 'card-card', [icon(MOVE_ICON[move], 'card-card-pic'), glyph(glyphFor(bindings, CARD_ACTIONS[i], device), 'card-card-glyph')]));
        if (device === 'keyboard') cards.push(glyph(keyGlyph('Mouse0'), 'card-glyph card-card-click'));
        return el('div', 'card-cards', cards);
      }
    }
  }
}
