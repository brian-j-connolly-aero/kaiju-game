/**
 * Reads the keyboard, the mouse and the first connected gamepad once per frame and turns them
 * into an ActionState through the bindings. Remembers which device was used last.
 *
 * The mouse and pointer lock. During play the game wants the mouse captured (`wantCapture`):
 * the pointer is hidden and its movement turns the view. The rules that keep that honest:
 *
 * - While the pointer is free, a click on the view only asks the browser for the pointer and
 *   is never a game action: the click that captures the mouse must not also strike or fire.
 *   Mouse buttons count as game buttons only while the pointer is captured.
 * - The browser can take the pointer back at any time (Escape, switching windows). Every mouse
 *   button is let go at that moment, and `onLockLost` tells the match screen.
 * - A browser with no pointer lock at all (or one that keeps refusing it) gets the old way:
 *   the buttons act at once and the view turns while a button is held on the view.
 */

import { BUTTON_ACTIONS, createActionState, defaultBindings, mergeBindings, noteKeyLabel, type ActionState, type Bindings, type ButtonAction } from './actions';

/** Radians of view rotation per pixel of mouse movement at sensitivity 1. */
export const MOUSE_SENSITIVITY = 0.0023;
const STICK_LOOK_RATE = 2.7;
const STICK_DEADZONE = 0.18;
const TRIGGER_THRESHOLD = 0.35;
const BINDINGS_KEY = 'mb.bindings';
/** Mouse movement reported right after the pointer is captured is thrown away for this long (some browsers report a jump). */
const LOCK_SETTLE_MS = 100;
/** Refusals in a row, with the lock never once granted, after which the browser is treated as having no pointer lock. */
const LOCK_GIVE_UP = 3;

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
  /** Mouse look speed, as a multiple of the default (a player setting). */
  sensitivity = 1;
  /** Inverted look: pushing the mouse or the stick forward looks down (a player setting). */
  invertY = false;
  /**
   * The game wants the mouse captured right now (a match is being played and no map or panel
   * is open). Set by the match screen. Only while this is true does a click on the view ask
   * for the pointer.
   */
  wantCapture = false;
  /** The browser took the captured pointer away (Escape, another window) without the game asking. */
  onLockLost: (() => void) | null = null;
  /**
   * A match is on screen: Tab and Space are game keys and must not move the focus or press a
   * page button. In the menus they are left to the browser, so the buttons work from the keyboard.
   */
  gameKeys = false;

  private readonly keys = new Set<string>();
  /** Keys that went down since the last poll: a tap shorter than a frame still counts once. */
  private readonly tapped = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private readonly previous: Record<ButtonAction, boolean>;
  /** Buttons reported down this frame only because of a tap that is already over. */
  private readonly tapOnly: Record<ButtonAction, boolean>;
  private readonly element: HTMLElement;
  private attached = false;
  /** Without pointer lock: mouse movement turns the view while a button is held on the view. */
  private capture = false;
  private wasLocked = false;
  /** The game itself is letting the pointer go (so the change is not reported as lost). */
  private releasing = false;
  private lockPending = false;
  private lockRefusals = 0;
  private everLocked = false;
  private lockGivenUp = false;
  private settleUntil = 0;

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
    this.tapOnly = { ...this.state.down };
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
    document.addEventListener('pointerlockerror', this.onLockError);
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
    document.removeEventListener('pointerlockerror', this.onLockError);
  }

  /** Whether this browser can capture the pointer at all (and has not refused every time so far). */
  get lockAvailable(): boolean {
    return !this.lockGivenUp && typeof this.element.requestPointerLock === 'function';
  }

  /**
   * Asks the browser to hide the pointer and give raw mouse movement. Browsers grant it only
   * in answer to a click or a key press, and may refuse (for about a second after the player
   * pressed Escape, for one): a refusal leaves the pointer free and the next click asks again.
   */
  lockPointer(): void {
    if (!this.lockAvailable || this.pointerLocked) return;
    this.lockPending = true;
    try {
      const pending = this.element.requestPointerLock() as unknown;
      // Newer browsers return a promise that rejects when the request is refused.
      if (pending instanceof Promise) pending.catch(() => this.lockRefused());
    } catch {
      this.lockRefused();
    }
  }

  unlockPointer(): void {
    if (!this.pointerLocked) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  /**
   * True when the game wants the mouse and does not have it: the HUD shows a "click" picture,
   * and the next click on the view captures the pointer instead of acting.
   */
  get pointerFree(): boolean {
    return this.wantCapture && this.lockAvailable && !this.pointerLocked;
  }

  /**
   * Call after each 30 Hz input sample has been built: the latch of buttons seen since the
   * previous sample starts again from what is still down now. (A tap that began and ended
   * before this frame was in the sample just taken and is over: when a slow frame sends
   * several samples, the next ones carry its release.)
   */
  sampleTaken(): void {
    const s = this.state;
    for (const action of BUTTON_ACTIONS) s.held[action] = s.down[action] && !this.tapOnly[action];
  }

  private lockRefused(): void {
    if (!this.lockPending) return;
    this.lockPending = false;
    this.lockRefusals++;
    // Never granted and refused again and again: this browser will not do it (an embedded
    // page without the permission, for one). Fall back to turning the view with a button held.
    if (!this.everLocked && this.lockRefusals >= LOCK_GIVE_UP) this.lockGivenUp = true;
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
    if (typeof e.key === 'string') noteKeyLabel(e.code, e.key);
    // Keys the game uses must not scroll the page or move focus.
    if (this.gameKeys && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.capture = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (this.pointerLocked) {
      if (performance.now() < this.settleUntil) return;
    } else if (!this.capture) {
      return;
    }
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.target !== this.element) return;
    // The side buttons of a mouse mean "back" and "forward" to a browser: not during a match.
    if (e.button > 2 && (this.wantCapture || this.pointerLocked)) e.preventDefault();
    this.state.device = 'keyboard';
    if (this.lockAvailable) {
      if (!this.pointerLocked) {
        // The pointer is free: this click captures it and is nothing else. No button is
        // recorded, so nothing strikes or fires, now or when the lock is granted.
        if (this.wantCapture) this.lockPointer();
        return;
      }
    } else {
      this.capture = true;
    }
    this.keys.add(`Mouse${e.button}`);
    this.tapped.add(`Mouse${e.button}`);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button > 2 && (this.wantCapture || this.pointerLocked)) e.preventDefault();
    this.keys.delete(`Mouse${e.button}`);
    if (!this.keys.has('Mouse0') && !this.keys.has('Mouse1') && !this.keys.has('Mouse2')) this.capture = false;
  };

  private readonly onContextMenu = (e: Event): void => {
    if (e.target === this.element) e.preventDefault();
  };

  private readonly onLockChange = (): void => {
    const locked = this.pointerLocked;
    if (locked) {
      this.lockPending = false;
      this.lockRefusals = 0;
      this.everLocked = true;
      this.capture = false;
      // Whatever the mouse did while the lock was being granted is not a turn of the view.
      this.mouseDX = 0;
      this.mouseDY = 0;
      this.settleUntil = performance.now() + LOCK_SETTLE_MS;
    } else {
      // Buttons held when the pointer went away would otherwise stay down for good: their
      // release goes to whatever the pointer is over now.
      for (const key of Array.from(this.keys)) if (key.startsWith('Mouse')) this.keys.delete(key);
      for (const key of Array.from(this.tapped)) if (key.startsWith('Mouse')) this.tapped.delete(key);
      this.mouseDX = 0;
      this.mouseDY = 0;
      const asked = this.releasing;
      this.releasing = false;
      if (this.wasLocked && !asked) this.onLockLost?.();
    }
    this.wasLocked = locked;
  };

  private readonly onLockError = (): void => {
    this.lockRefused();
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
      let tapped = false;
      for (const key of this.bindings.keyboard[action]) {
        if (this.keys.has(key)) down = true;
        else if (this.tapped.has(key)) tapped = true;
      }
      if (pad) {
        for (const button of this.bindings.gamepad[action]) {
          if (padDown(button)) {
            down = true;
            padUsed = true;
          }
        }
      }
      s.down[action] = down || tapped;
      this.tapOnly[action] = tapped && !down;
    }

    this.tapped.clear();

    let moveX = (s.down.moveRight ? 1 : 0) - (s.down.moveLeft ? 1 : 0);
    let moveZ = (s.down.moveForward ? 1 : 0) - (s.down.moveBack ? 1 : 0);
    const perPixel = MOUSE_SENSITIVITY * this.sensitivity;
    let lookX = this.mouseDX * perPixel;
    let lookY = 0 - this.mouseDY * perPixel;
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
    s.lookY = this.invertY ? -lookY : lookY;
    s.pointerY = lookY;
    s.aimOverride = null;

    this.autopilot?.(s, dt);

    for (const action of BUTTON_ACTIONS) {
      // (What the autopilot holds down is held, not tapped.)
      if (this.autopilot) this.tapOnly[action] = false;
      s.pressed[action] = s.down[action] && !this.previous[action];
      s.released[action] = !s.down[action] && this.previous[action];
      this.previous[action] = s.down[action];
      if (s.down[action]) s.held[action] = true;
    }
    return s;
  }
}
