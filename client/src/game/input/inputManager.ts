/**
 * Reads the keyboard, the mouse and the first connected gamepad once per frame and turns them
 * into an ActionState through the bindings. Remembers which device was used last.
 */

import { BUTTON_ACTIONS, createActionState, defaultBindings, mergeBindings, type ActionState, type Bindings, type ButtonAction } from './actions';

const MOUSE_SENSITIVITY = 0.0023;
const STICK_LOOK_RATE = 2.7;
const STICK_DEADZONE = 0.18;
const TRIGGER_THRESHOLD = 0.35;
const BINDINGS_KEY = 'mb.bindings';

function stick(v: number): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  const t = (a - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return Math.sign(v) * t;
}

export class InputManager {
  readonly state: ActionState = createActionState();
  bindings: Bindings;
  /** Called after the devices are read, to let the autopilot press the buttons instead. */
  autopilot: ((state: ActionState, dt: number) => void) | null = null;
  /** Mouse position in page pixels (for the map and menus). */
  mouseX = 0;
  mouseY = 0;

  private readonly keys = new Set<string>();
  /** Keys that went down since the last poll: a tap shorter than a frame still counts once. */
  private readonly tapped = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private readonly previous: Record<ButtonAction, boolean>;
  private readonly element: HTMLElement;
  private attached = false;
  /** Whether mouse movement turns the view (pointer lock, or a button held on the canvas). */
  private capture = false;

  constructor(element: HTMLElement) {
    this.element = element;
    this.bindings = defaultBindings();
    try {
      const stored = window.localStorage.getItem(BINDINGS_KEY);
      if (stored) this.bindings = mergeBindings(JSON.parse(stored));
    } catch {
      // Unreadable or blocked storage: the defaults stand.
    }
    this.previous = { ...this.state.down };
  }

  saveBindings(): void {
    try {
      window.localStorage.setItem(BINDINGS_KEY, JSON.stringify(this.bindings));
    } catch {
      // Not stored: the change lasts until the page is closed.
    }
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  /** Asks the browser to hide the pointer and give raw mouse movement (needs a click to succeed). */
  lockPointer(): void {
    if (document.pointerLockElement === this.element) return;
    try {
      const pending = this.element.requestPointerLock() as unknown;
      // Newer browsers return a promise that rejects when the player declines: nothing to do.
      if (pending instanceof Promise) pending.catch(() => undefined);
    } catch {
      // No pointer lock here: the mouse still turns the view while a button is held.
    }
  }

  unlockPointer(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  private typing(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.typing(e)) return;
    this.keys.add(e.code);
    this.tapped.add(e.code);
    this.state.device = 'keyboard';
    // Keys the game uses must not scroll the page or move focus.
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (this.pointerLocked || this.capture) {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.target !== this.element) return;
    this.keys.add(`Mouse${e.button}`);
    this.tapped.add(`Mouse${e.button}`);
    this.state.device = 'keyboard';
    this.capture = true;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.keys.delete(`Mouse${e.button}`);
    if (!this.keys.has('Mouse0') && !this.keys.has('Mouse1') && !this.keys.has('Mouse2')) this.capture = false;
  };

  private readonly onContextMenu = (e: Event): void => {
    if (e.target === this.element) e.preventDefault();
  };

  private readonly onLockChange = (): void => {
    if (!this.pointerLocked) {
      this.keys.delete('Mouse0');
      this.keys.delete('Mouse1');
      this.keys.delete('Mouse2');
    }
  };

  private gamepad(): Gamepad | null {
    if (typeof navigator.getGamepads !== 'function') return null;
    let pads: ReadonlyArray<Gamepad | null>;
    try {
      pads = navigator.getGamepads();
    } catch {
      return null;
    }
    for (const pad of pads) if (pad && pad.connected && pad.mapping === 'standard') return pad;
    for (const pad of pads) if (pad && pad.connected) return pad;
    return null;
  }

  /** Reads the devices. Call once per frame, before anything looks at `state`. */
  poll(dt: number): ActionState {
    const s = this.state;
    const pad = this.gamepad();
    const padDown = (index: number): boolean => {
      const b = pad?.buttons[index];
      return b !== undefined && (b.pressed || b.value > TRIGGER_THRESHOLD);
    };

    let padUsed = false;
    for (const action of BUTTON_ACTIONS) {
      let down = false;
      for (const key of this.bindings.keyboard[action]) if (this.keys.has(key) || this.tapped.has(key)) down = true;
      if (pad) {
        for (const button of this.bindings.gamepad[action]) {
          if (padDown(button)) {
            down = true;
            padUsed = true;
          }
        }
      }
      s.down[action] = down;
    }

    this.tapped.clear();

    let moveX = (s.down.moveRight ? 1 : 0) - (s.down.moveLeft ? 1 : 0);
    let moveZ = (s.down.moveForward ? 1 : 0) - (s.down.moveBack ? 1 : 0);
    let lookX = this.mouseDX * MOUSE_SENSITIVITY;
    let lookY = -this.mouseDY * MOUSE_SENSITIVITY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (pad) {
      const lx = stick(pad.axes[0] ?? 0);
      const ly = stick(pad.axes[1] ?? 0);
      const rx = stick(pad.axes[2] ?? 0);
      const ry = stick(pad.axes[3] ?? 0);
      if (lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0) padUsed = true;
      moveX += lx;
      moveZ -= ly;
      // Squared response: fine aim near the center, fast turns at the rim.
      lookX += rx * Math.abs(rx) * STICK_LOOK_RATE * dt;
      lookY -= ry * Math.abs(ry) * STICK_LOOK_RATE * dt * 0.7;
    }
    if (padUsed) s.device = 'gamepad';
    const len = Math.hypot(moveX, moveZ);
    if (len > 1) {
      moveX /= len;
      moveZ /= len;
    }
    s.moveX = moveX;
    s.moveZ = moveZ;
    s.lookX = lookX;
    s.lookY = lookY;
    s.aimOverride = null;

    this.autopilot?.(s, dt);

    for (const action of BUTTON_ACTIONS) {
      s.pressed[action] = s.down[action] && !this.previous[action];
      s.released[action] = !s.down[action] && this.previous[action];
      this.previous[action] = s.down[action];
    }
    return s;
  }
}
