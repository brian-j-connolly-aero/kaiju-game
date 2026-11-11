/**
 * The action map: every thing a player can do, and which keys, mouse buttons and gamepad
 * buttons do it. Keyboard and mouse and gamepad feed the same actions, the bindings are plain
 * data (so a settings screen can change them), and the HUD asks this module which glyph to
 * show for an action on the device that was used last.
 */

export const BUTTON_ACTIONS = [
  // movement (keys; sticks feed the axes directly)
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  // kaiju verbs
  'strike',
  'grab',
  'block',
  'roar',
  'special',
  'molt',
  // human squad
  'fire',
  'callIn',
  'wheel',
  'cmdFollow',
  'cmdMoveTo',
  'cmdFireAtWill',
  'cmdHoldCharge',
  // view
  'map',
  'camera',
  // drone and menus
  'rise',
  'sink',
  'confirm',
  'back',
] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

export type InputDevice = 'keyboard' | 'gamepad';

/**
 * A key is a KeyboardEvent.code ("KeyW", "Space"); mouse buttons are "Mouse0" (left), "Mouse1"
 * (middle), "Mouse2" (right). Gamepad buttons are indexes of the standard mapping.
 */
export interface Bindings {
  keyboard: Record<ButtonAction, string[]>;
  gamepad: Record<ButtonAction, number[]>;
}

/** Standard gamepad mapping, by name. */
export const PAD = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  ls: 10,
  rs: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

export function defaultBindings(): Bindings {
  return {
    keyboard: {
      moveForward: ['KeyW', 'ArrowUp'],
      moveBack: ['KeyS', 'ArrowDown'],
      moveLeft: ['KeyA', 'ArrowLeft'],
      moveRight: ['KeyD', 'ArrowRight'],
      strike: ['Mouse0'],
      grab: ['Mouse2'],
      block: ['Space', 'ShiftLeft'],
      roar: ['KeyQ'],
      special: ['KeyE'],
      molt: ['KeyF'],
      fire: ['Mouse0'],
      callIn: ['KeyE'],
      wheel: ['Mouse2', 'KeyQ'],
      cmdFollow: ['Digit1'],
      cmdMoveTo: ['Digit2'],
      cmdFireAtWill: ['Digit3'],
      cmdHoldCharge: ['Digit4'],
      map: ['KeyM', 'Tab'],
      camera: ['KeyV'],
      rise: ['Space'],
      sink: ['ControlLeft', 'KeyC'],
      confirm: ['Enter'],
      back: ['Escape'],
    },
    gamepad: {
      moveForward: [],
      moveBack: [],
      moveLeft: [],
      moveRight: [],
      strike: [PAD.rt],
      grab: [PAD.lt],
      block: [PAD.lb],
      roar: [PAD.y],
      special: [PAD.rb],
      molt: [PAD.b],
      fire: [PAD.rt],
      callIn: [PAD.x],
      wheel: [PAD.lb],
      cmdFollow: [PAD.up],
      cmdMoveTo: [PAD.right],
      // The d-pad mirrors the wheel: follow up, move-to right, fire-at-will down, hold-and-charge left.
      cmdFireAtWill: [PAD.down],
      cmdHoldCharge: [PAD.left],
      map: [PAD.back],
      camera: [PAD.rs],
      rise: [PAD.a],
      sink: [PAD.b],
      confirm: [PAD.a],
      back: [PAD.b],
    },
  };
}

/** Merges stored bindings over the defaults, ignoring anything malformed. */
export function mergeBindings(stored: unknown): Bindings {
  const out = defaultBindings();
  if (typeof stored !== 'object' || stored === null) return out;
  const s = stored as Partial<Record<InputDevice, Record<string, unknown>>>;
  for (const action of BUTTON_ACTIONS) {
    const keys = s.keyboard?.[action];
    if (Array.isArray(keys) && keys.every((k) => typeof k === 'string')) out.keyboard[action] = keys as string[];
    const buttons = s.gamepad?.[action];
    if (Array.isArray(buttons) && buttons.every((b) => typeof b === 'number')) out.gamepad[action] = buttons as number[];
  }
  return out;
}

/** What the input devices say this frame. Controllers and the autopilot read and write this. */
export interface ActionState {
  /** Buttons that are down. */
  down: Record<ButtonAction, boolean>;
  /** Buttons that went down since the previous frame. */
  pressed: Record<ButtonAction, boolean>;
  /** Buttons that went up since the previous frame. */
  released: Record<ButtonAction, boolean>;
  /** Movement relative to the view, each -1..1 (moveZ forward, moveX right). */
  moveX: number;
  moveZ: number;
  /** View rotation asked for this frame, radians (positive lookX turns right, positive lookY looks up). */
  lookX: number;
  lookY: number;
  /** The device used most recently (button glyphs follow it). */
  device: InputDevice;
  /**
   * Set by the autopilot: look in exactly this direction instead of applying lookX / lookY.
   * Null for a person.
   */
  aimOverride: { yaw: number; pitch: number } | null;
}

function record(value: boolean): Record<ButtonAction, boolean> {
  const out = {} as Record<ButtonAction, boolean>;
  for (const action of BUTTON_ACTIONS) out[action] = value;
  return out;
}

export function createActionState(): ActionState {
  return { down: record(false), pressed: record(false), released: record(false), moveX: 0, moveZ: 0, lookX: 0, lookY: 0, device: 'keyboard', aimOverride: null };
}

// --- glyphs ------------------------------------------------------------------------------------

/** A button picture: an icon id from docs/ASSETS.md section 5, plus the letter for a keycap. */
export interface Glyph {
  icon: string;
  /** Short key label drawn on the blank keycap (`kb_key`); empty for pictured buttons. */
  label: string;
}

const PAD_ICONS: Record<number, string> = {
  [PAD.a]: 'gp_a',
  [PAD.b]: 'gp_b',
  [PAD.x]: 'gp_x',
  [PAD.y]: 'gp_y',
  [PAD.lb]: 'gp_lb',
  [PAD.rb]: 'gp_rb',
  [PAD.lt]: 'gp_lt',
  [PAD.rt]: 'gp_rt',
  [PAD.back]: 'gp_back',
  [PAD.start]: 'gp_start',
  [PAD.ls]: 'gp_ls',
  [PAD.rs]: 'gp_rs',
  [PAD.up]: 'gp_dpad',
  [PAD.down]: 'gp_dpad',
  [PAD.left]: 'gp_dpad',
  [PAD.right]: 'gp_dpad',
};

const KEY_LABELS: Record<string, string> = {
  Space: '␣',
  ShiftLeft: '⇧',
  ShiftRight: '⇧',
  ControlLeft: '⌃',
  Enter: '⏎',
  Escape: '⎋',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

export function keyGlyph(code: string): Glyph {
  if (code === 'Mouse0') return { icon: 'ms_left', label: '' };
  if (code === 'Mouse1') return { icon: 'ms_middle', label: '' };
  if (code === 'Mouse2') return { icon: 'ms_right', label: '' };
  const label = KEY_LABELS[code] ?? (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code.slice(0, 3));
  return { icon: 'kb_key', label };
}

/** The glyph to show for an action on a device (its first binding), or null when unbound. */
export function glyphFor(bindings: Bindings, action: ButtonAction, device: InputDevice): Glyph | null {
  if (device === 'gamepad') {
    const button = bindings.gamepad[action][0];
    return button === undefined ? null : { icon: PAD_ICONS[button] ?? 'gp_a', label: '' };
  }
  const key = bindings.keyboard[action][0];
  return key === undefined ? null : keyGlyph(key);
}
