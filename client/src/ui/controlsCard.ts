/**
 * The controls card: every control of the player's role, as pictures (DESIGN.md section 8: no
 * words but names). Each tile is the button (in the glyph of the device in use: keycaps and
 * mouse buttons, or the controller's buttons) followed by a picture of what it does. A ring
 * around a glyph means "hold it"; a small arrow between pictures means "then".
 *
 * The kaiju's tiles come from its kind's action table (one per verb, with the stages a verb is
 * limited to as the HUD's three growing triangles); the squad's from the commands and the
 * squad's verbs. `ACTION_USERS` in game/input/actions.ts says who presses what, and
 * client/test/controlsCard.test.ts fails when a pressable action is missing from a card.
 *
 * Where it shows: a button in the lobby and on the briefing screen; open by itself for the whole
 * briefing; in a match the `controls` action (H, or a click of the left stick) opens and closes
 * it. In a match it takes no mouse input at all (the pointer stays captured and the game keeps
 * running behind it); in the menus a click on it closes it.
 */

import { kaijuKindDef, type KaijuActionSet, type KaijuKindId, type StageId } from '@mb/shared';
import { glyphFor, keyGlyph, keyLayoutVersion, type Bindings, type ButtonAction, type Glyph, type InputDevice } from '../game/input/actions';
import { el, glyph, icon } from './icons';

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
  /** The command wheel in miniature: its four pictograms where the wheel has them. */
  | { kind: 'wheel' }
  /** The stages what stands just before is limited to (the HUD's three growing triangles). */
  | { kind: 'stages'; stages: StageId[] };

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

const VERB_ICONS: Record<keyof KaijuActionSet, string> = {
  swipe: 'k_swipe',
  stomp: 'k_stomp',
  grab: 'k_grab',
  throw: 'k_throw',
  eat: 'k_eat',
  brace: 'k_brace',
  roar: 'k_roar',
  special: 'k_special',
  molt: 'k_molt',
};

const ALL_STAGES: StageId[] = [1, 2, 3];

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
  const tiles: CardTile[] = [
    { id: 'move', group: 'move', parts: [{ kind: 'move' }, picture('lb_kaiju', 'kaiju')] },
    { id: 'look', group: 'move', parts: [{ kind: 'look' }, picture('st_spotted')] },
  ];
  const actions = def.actions;
  for (const verb of Object.keys(actions) as Array<keyof KaijuActionSet>) {
    const a = actions[verb];
    const hold = a.gesture === 'hold' || a.gesture === 'level';
    const press = button(a.button, hold);
    const icon = picture(VERB_ICONS[verb], 'kaiju');
    if (verb === 'grab') {
      // A car at every stage; from the stage the definition names, tanks and pieces of buildings too.
      tiles.push({ id: 'grab', group: 'verbs', verb, parts: [press, icon, picture('tl_car')] });
      const from = Math.min(actions.grab.vehicleFromStage, actions.grab.chunkFromStage);
      if (from <= stageCount) {
        tiles.push({
          id: 'grab-big',
          group: 'verbs',
          verb,
          parts: [press, icon, picture('fac_army'), picture('tl_office')],
          stages: ALL_STAGES.filter((s) => s >= from && s <= stageCount),
        });
      }
    } else if (verb === 'throw') {
      // With something in the hand, the same button again.
      tiles.push({ id: 'throw', group: 'verbs', verb, parts: [picture('k_grab', 'dim'), then, press, icon] });
    } else if (verb === 'eat') {
      tiles.push({ id: 'eat', group: 'verbs', verb, parts: [press, icon, picture('st_health')] });
    } else if (verb === 'special') {
      tiles.push({ id: 'special', group: 'verbs', verb, parts: [picture('st_rage', 'kaiju'), then, press, icon] });
    } else if (verb === 'molt') {
      // A molt is there to take before every stage but the last.
      tiles.push({ id: 'molt', group: 'verbs', verb, parts: [press, icon], stages: ALL_STAGES.filter((s) => s < stageCount) });
    } else {
      tiles.push({ id: verb, group: 'verbs', verb, parts: [press, icon] });
    }
  }
  // Swimming (sim/swim.ts) has no button: walk into deep water and stand, and it goes under.
  if (def.swim) {
    const swim = def.swim;
    const stages = ALL_STAGES.filter((s) => s <= stageCount && swim.stages[s - 1]);
    if (stages.length > 0) tiles.push({ id: 'swim', group: 'verbs', parts: [{ kind: 'move' }, then, picture('k_swim', 'kaiju')], stages });
  }
  tiles.push({ id: 'map', group: 'view', parts: [button('map'), picture('st_map')] }, ...viewTiles());
  return tiles;
}

/** The squad leader's card (and the drone's, for after the squad is gone). */
export function squadTiles(): CardTile[] {
  const [camera, settings, controls] = viewTiles();
  // Five columns: what the leader does, the wheel and the commands, the volley, the map, the rest.
  return [
    { id: 'move', group: 'move', parts: [{ kind: 'move' }, picture('fac_army', 'human')] },
    { id: 'look', group: 'move', parts: [{ kind: 'look' }, picture('st_spotted')] },
    { id: 'fire', group: 'verbs', parts: [button('fire'), picture('st_reload', 'human')] },
    { id: 'callIn', group: 'verbs', parts: [button('callIn'), picture('st_callin', 'human')], stages: [3] },
    // Smoke where the crosshair is; mark the kaiju in the crosshair for the whole army.
    { id: 'smoke', group: 'verbs', parts: [button('smoke'), picture('st_smoke', 'human')] },
    { id: 'mark', group: 'verbs', parts: [button('mark'), picture('st_mark', 'kaiju')] },
    camera,
    // Hold the wheel, point at a command, let go.
    { id: 'wheel', group: 'squad', wide: true, parts: [button('wheel', true), { kind: 'look' }, { kind: 'then' }, { kind: 'wheel' }] },
    // Or tap it, point, and click (the click picks; it does not fire).
    { id: 'wheelClick', group: 'squad', wide: true, parts: [button('wheel'), { kind: 'look' }, then, { kind: 'button', action: 'fire', mouse: 'Mouse0' }, { kind: 'wheel' }] },
    { id: 'follow', group: 'squad', parts: [button('cmdFollow'), picture('cmd_follow', 'human')] },
    { id: 'moveTo', group: 'squad', parts: [button('cmdMoveTo'), picture('cmd_moveto', 'human')] },
    { id: 'fireAtWill', group: 'squad', parts: [button('cmdFireAtWill'), picture('cmd_fireatwill', 'human')] },
    { id: 'holdCharge', group: 'squad', parts: [button('cmdHoldCharge'), picture('cmd_holdcharge', 'volley')] },
    // The volley: hold and charge, wait for the full charge, then the leader's own shot fires them all.
    {
      id: 'volley',
      group: 'squad',
      wide: true,
      parts: [picture('cmd_holdcharge', 'volley'), then, picture('st_charge', 'volley'), then, button('fire'), picture('st_reload', 'volley'), picture('st_reload', 'volley'), picture('st_reload', 'volley')],
    },
    // The map; on it a left click (or the confirm button) sends the squad there.
    {
      id: 'map',
      group: 'view',
      wide: true,
      parts: [button('map'), picture('st_map'), then, { kind: 'button', action: 'confirm', mouse: 'Mouse0' }, picture('cmd_moveto', 'human')],
    },
    // At stage 3: pick the guns on the map's side (or press the call-in button), then a left click calls them there.
    {
      id: 'mapCallIn',
      group: 'view',
      wide: true,
      parts: [picture('st_map', 'dim'), button('callIn'), then, { kind: 'button', action: 'confirm', mouse: 'Mouse0' }, picture('st_callin', 'human')],
      stages: [3],
    },
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
    }
  }
  return out;
}

/** The glyph a button part shows on a device, or null when it is unbound there. */
export function partGlyph(part: Extract<CardPart, { kind: 'button' }>, bindings: Bindings, device: InputDevice): Glyph | null {
  if (device === 'keyboard' && part.mouse) return keyGlyph(part.mouse);
  return glyphFor(bindings, part.action, device);
}

const WHEEL_ICONS = [
  ['up', 'cmd_follow'],
  ['right', 'cmd_moveto'],
  ['down', 'cmd_fireatwill'],
  ['left', 'cmd_holdcharge'],
] as const;

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
    if (open) this.render();
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
    const key = `${role}:${kind}:${this.name}:${this.device}:${keyLayoutVersion()}`;
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
      case 'stages':
        return stagePips(part.stages);
      case 'wheel':
        return el(
          'div',
          'card-wheel',
          WHEEL_ICONS.map(([place, id]) => icon(id, `card-wheel-${place}`)),
        );
    }
  }
}
