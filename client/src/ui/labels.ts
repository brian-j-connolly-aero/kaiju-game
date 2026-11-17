/**
 * Every label in the game, in one table (docs/ROADMAP.md round 5: "Labels of one or two words.
 * Players were confused by pictures alone"; DESIGN.md section 8, "Labels"). A label is one or two
 * plain words beside a picture: what the button does, what the bar measures, what the state is.
 * Never a sentence or an instruction; the picture stays, the label supports it.
 *
 * The words are written here in plain case and drawn in capitals, in the game's display font, by
 * one style (`.lbl` in styles.css, which also covers the volley chip's, the crosshair's, the
 * monster's nerve bar's and the monster's line-of-sight words). Red means "cannot" wherever a
 * label says so, on both sides, and the same word means the same thing on both sides ("Blocked",
 * "Too far").
 *
 * Every label is at most LABEL_MAX_WORDS words and LABEL_MAX_CHARS characters (a test walks the
 * whole table: client/test/labels.test.ts). Change a word here and it changes everywhere.
 */

import { heldEdible, strikeVerb, type HeldObject, type KaijuMove, type KaijuMoveId, type PickupId, type PickupKind, type RoseArmyId, type RoseKaijuId } from '@mb/shared';
import { el } from './icons';

/** At most this many words in a label. */
export const LABEL_MAX_WORDS = 2;
/** At most this many characters in a label ("Reinforcements" is the longest). */
export const LABEL_MAX_CHARS = 14;

/** The monster's buttons (ui/kaijuKit.ts), its controls card and the molt cards. */
const KAIJU = {
  walk: 'Move',
  strike: 'Strike',
  /** Strike with something in the hand. */
  throw: 'Throw',
  /** Strike with the fast-food sign in the hand. */
  swing: 'Swing',
  grab: 'Grab',
  /** Grab with something edible in the hand. */
  eat: 'Eat',
  /** Grab with a city weapon in the hand. */
  drop: 'Drop',
  stomp: 'Stomp',
  molt: 'Molt',
  /** A move slot no molt has filled yet. */
  locked: 'Locked',
  /** A garage door held as a shield. */
  shield: 'Shield',
  /** The power surge's badge beside the crosshair. */
  surge: 'Power surge',
} as const;

/** The moves a molt can give. */
const MOVES = {
  beam: 'Beam',
  roar: 'Roar',
  charge: 'Charge',
  tailSweep: 'Tail sweep',
  brace: 'Brace',
} as const satisfies Record<KaijuMove, string>;

/** A squad's buttons and controls card, and the news drone's. */
const SQUAD = {
  walk: 'Move',
  drive: 'Drive',
  turret: 'Turret',
  fire: 'Fire',
  volley: 'Volley',
  map: 'Map',
  fly: 'Fly',
  up: 'Up',
  down: 'Down',
  /** The tank's second reticle: where the gun points now. */
  gun: 'Gun',
} as const;

/** What a supply crate holds: on Fire, on the crate popping up, the artillery radio's button. */
const PICKUPS = {
  machineGun: 'Machine gun',
  bigCannon: 'Big cannon',
  missilePod: 'Missiles',
  artilleryRadio: 'Artillery',
  reinforcements: 'Reinforcements',
} as const satisfies Record<PickupKind, string>;

/** Buttons everyone has. */
const COMMON = {
  view: 'View',
  menu: 'Menu',
  controls: 'Controls',
  /** The communication rose's key. */
  talk: 'Talk',
  /** The controls card's own key, in its header. */
  close: 'Close',
  /** The mouse is free: a click on the view takes it. */
  click: 'Click',
} as const;

/** The meters bottom left (and the monster's, top middle, for the squads). */
const METERS = {
  health: 'Health',
  nerve: 'Nerve',
  rage: 'Rage',
  reload: 'Reload',
} as const;

/** Along the top: the clock, the destruction bar's marks, the stage, the squads. */
const TOP = {
  timeLeft: 'Time left',
  stage: 'Stage',
  squads: 'Squads',
  /** The destruction bar's first two marks. */
  molt: 'Molt',
  /** Its last mark. */
  monsterWins: 'Monster wins',
} as const;

/** The big status pictures over the middle (ui/hud.ts). */
const STATUS = {
  crossfire: 'Crossfire',
  spotted: 'Spotted',
  shaken: 'Shaken',
  underwater: 'Underwater',
  nerveBreak: 'Nerve broken',
  volley: 'Volley',
  incoming: 'Incoming',
  offline: 'Reconnecting',
  eliminated: 'Squad lost',
} as const;

/** Beside the monster's nerve bar, on the squads' screens: why a volley would add nothing, or the pair's window. */
const NERVE = {
  stagger: 'Stagger',
  immune: 'Immune',
  teamUp: 'Team up',
  hidden: 'Hidden',
} as const;

/**
 * The squad's volley chip under the crosshair and its release (ui/volleyMeter.ts): whether a
 * volley can be charged now and if not why, how far the charge has come, what happened.
 */
const VOLLEY = {
  noSquad: 'No squad',
  landing: 'Landing',
  stunned: 'Stunned',
  shaken: 'Shaken',
  reload: 'Reload',
  tooFar: 'Too far',
  noLine: 'No line',
  ready: 'Ready',
  charging: 'Charging',
  fire: 'Fire!',
  fired: 'Volley!',
  immune: 'Immune',
  weak: 'Weak',
  noShot: 'No shot',
} as const;

/** What cannot reach: the monster's throw, beam and charge (ui/kaijuSight.ts), the squad's crosshair (ui/hud.ts). */
const AIM = {
  blocked: 'Blocked',
  tooFar: 'Too far',
  tooClose: 'Too close',
  tooTall: 'Too tall',
} as const;

/** The communication rose's wedges (ui/rose.ts), in the army's and the monster's lists. */
const ROSE_ARMY_LABELS = {
  panic: 'Panic',
  bravado: 'Tough talk',
  orders: 'Orders',
  science: 'Science',
  home: 'Home',
  food: 'Food',
  retreat: 'Retreat',
  admire: 'Admire',
} as const satisfies Record<RoseArmyId, string>;

const ROSE_KAIJU_LABELS = {
  roar: 'Roar',
  roarShort: 'Short roar',
  snuffle: 'Snuffle',
  growl: 'Growl',
  chomp: 'Chomp',
  rumble: 'Rumble',
  mating: 'Mating call',
} as const satisfies Record<RoseKaijuId, string>;

/** The first screen: a callsign, then create a room or join one by its code; what went wrong. */
const HOME = {
  name: 'Name',
  code: 'Code',
  create: 'Create',
  join: 'Join',
  /** No such room (or it is gone). */
  noRoom: 'No room',
  roomFull: 'Room full',
  /** This page is older than the server's game. */
  oldVersion: 'Old version',
  /** No server, or the connection was lost. */
  offline: 'Offline',
  /** The same player opened the game in another tab, which took the seat. */
  otherTab: 'Other tab',
} as const;

/** The lobby: the sides, ready, start, the bots, the invite. */
const LOBBY = {
  monster: 'Monster',
  squad: 'Squad',
  ready: 'Ready',
  start: 'Start',
  /** The host's practice switch: a bot plays the monster. */
  botMonster: 'Bot monster',
  /** An empty seat: a bot leads that squad. */
  bot: 'Bot',
  leave: 'Leave',
  invite: 'Invite',
  copied: 'Copied',
  settings: 'Settings',
  /** A seat's flags: the room's host, ready, not ready for a while (the host may start without them), gone. */
  host: 'Host',
  asleep: 'Asleep',
  offline: 'Offline',
} as const;

/** The briefing's two sides. */
const BRIEFING = {
  monster: 'Monster',
  squads: 'Squads',
} as const;

/** The settings panel (Escape). */
const SETTINGS = {
  volume: 'Volume',
  mouse: 'Mouse speed',
  invert: 'Invert',
  fullscreen: 'Full screen',
  lowRes: 'Low detail',
  restart: 'Restart',
  /** The restart button after its first press. */
  confirm: 'Confirm',
  done: 'Done',
} as const;

/** The end screen: who won, how, and the host's way back. */
const END = {
  monsterWins: 'Monster wins',
  squadsWin: 'Squads win',
  /** How: the destruction bar filled, the monster fell, the clock ran out. */
  bar: 'City flattened',
  kill: 'Monster down',
  clock: 'Time up',
  lobby: 'Lobby',
} as const;

/** The table. */
export const LABELS = {
  kaiju: KAIJU,
  moves: MOVES,
  squad: SQUAD,
  pickups: PICKUPS,
  common: COMMON,
  meters: METERS,
  top: TOP,
  status: STATUS,
  nerve: NERVE,
  volley: VOLLEY,
  aim: AIM,
  roseArmy: ROSE_ARMY_LABELS,
  roseKaiju: ROSE_KAIJU_LABELS,
  home: HOME,
  lobby: LOBBY,
  briefing: BRIEFING,
  settings: SETTINGS,
  end: END,
} as const;

/** The volley chip's words (ui/volleyMeter.ts). */
export type VolleyWord = (typeof VOLLEY)[keyof typeof VOLLEY];
/** The words for what cannot reach (render/throwPreview.ts, ui/kaijuSight.ts, ui/hud.ts). */
export type AimWord = (typeof AIM)[keyof typeof AIM];

/** Strike's label with this in the hand: the swipe, the sign's swing, or a throw. */
export function strikeLabel(held: HeldObject | null): string {
  const verb = strikeVerb(held);
  return verb === 'swipe' ? KAIJU.strike : verb === 'club' ? KAIJU.swing : KAIJU.throw;
}

/** Grab's label with this in the hand: the grab, eating it, or dropping a city weapon. */
export function grabLabel(held: HeldObject | null): string {
  if (!held) return KAIJU.grab;
  return heldEdible(held) ? KAIJU.eat : KAIJU.drop;
}

/** A move slot's label: its move, or "Locked" while no molt has filled it. */
export function moveLabel(move: KaijuMoveId): string {
  return move === 'none' ? KAIJU.locked : MOVES[move];
}

/** Fire's label: the weapon a crate gave (machine gun, big cannon, missiles), or plain "Fire". */
export function fireLabel(pickup: PickupId): string {
  return pickup === 'machineGun' || pickup === 'bigCannon' || pickup === 'missilePod' ? PICKUPS[pickup] : SQUAD.fire;
}

/** Volley's label on the controls card: the artillery radio's barrage while it has one, else "Volley". */
export function volleyLabel(barrages: number): string {
  return barrages > 0 ? PICKUPS.artilleryRadio : SQUAD.volley;
}

/** The rose's wedge labels, in wire order. */
export function roseLabels(side: 'army' | 'kaiju'): readonly string[] {
  return Object.values(side === 'army' ? ROSE_ARMY_LABELS : ROSE_KAIJU_LABELS);
}

/** Every word in the table (for the test that keeps them short). */
export function everyLabel(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(LABELS);
  return out;
}

/**
 * Why a label breaks the rule (empty, more than two words, too long, a sentence), or null when
 * it is fine.
 */
export function labelProblem(text: string): string | null {
  const words = text.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return 'empty';
  if (words.length > LABEL_MAX_WORDS) return `${words.length} words`;
  if (text.length > LABEL_MAX_CHARS) return `${text.length} characters`;
  if (/[.,;:?]/.test(text)) return 'punctuation of a sentence';
  return null;
}

/**
 * A label element: the words in the labels' one style (capitals, the display font, a dark edge:
 * `.lbl` in styles.css). `className` adds where it sits and its tone.
 */
export function label(text: string, className = ''): HTMLElement {
  return el('div', `lbl ${className}`.trim(), [text]);
}

/** Changes what a label says (only when it changes). */
export function setLabel(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
