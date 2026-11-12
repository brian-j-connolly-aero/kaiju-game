/**
 * A stand-in for the parts of a browser the input manager talks to, for tests in plain Node:
 * `window` and `document` as event targets, a canvas that can be asked for the pointer, and the
 * browser's side of pointer lock. It behaves the way browsers do where that matters:
 *
 * - A request for the pointer is answered LATER (after the event handler that asked has
 *   returned), by a `pointerlockchange` or a `pointerlockerror` event: call `settle()`.
 * - While the pointer is captured, every mouse event goes to the canvas.
 * - Escape with the pointer captured frees the pointer and is not delivered to the page.
 * - Switching to another window blurs the page and frees the pointer.
 *
 * `install()` puts the fakes on `globalThis`; call the function it returns when the test is done.
 */

export interface FakeEvent {
  type: string;
  target: unknown;
  code?: string;
  key?: string;
  repeat?: boolean;
  button?: number;
  clientX?: number;
  clientY?: number;
  movementX?: number;
  movementY?: number;
  defaultPrevented: boolean;
  preventDefault(): void;
}

type Listener = (e: FakeEvent) => void;

class FakeTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...init,
    };
    for (const fn of Array.from(this.listeners.get(type) ?? [])) fn(event);
    return event;
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

export type LockAnswer = 'grant' | 'refuse';

export class FakeBrowser {
  readonly window = new FakeTarget() as FakeTarget & { localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void } };
  readonly document = new FakeTarget() as FakeTarget & { pointerLockElement: unknown; exitPointerLock(): void; hasFocus(): boolean };
  /** The view. `requestPointerLock` is missing when the browser has no pointer lock. */
  readonly canvas: { tagName: string; requestPointerLock?: () => Promise<void> };
  /** Some other element of the page (a button, the map). */
  readonly other = { tagName: 'DIV' };
  /** How the browser answers the next requests for the pointer. */
  answer: LockAnswer = 'grant';
  /** Requests for the pointer made so far. */
  requests = 0;
  /** Milliseconds, as `performance.now()` reports them. */
  now = 1000;
  focused = true;

  private readonly store = new Map<string, string>();
  private pending: Array<() => void> = [];
  private realNow: (() => number) | null = null;
  private saved: Record<string, unknown> = {};

  constructor(options: { pointerLock?: boolean } = {}) {
    this.window.localStorage = {
      getItem: (k) => this.store.get(k) ?? null,
      setItem: (k, v) => {
        this.store.set(k, v);
      },
    };
    this.document.pointerLockElement = null;
    this.document.hasFocus = () => this.focused;
    this.document.exitPointerLock = () => {
      this.pending.push(() => this.release());
    };
    this.canvas = { tagName: 'CANVAS' };
    if (options.pointerLock !== false) {
      this.canvas.requestPointerLock = () => {
        this.requests++;
        const answer = this.answer;
        return new Promise<void>((resolve, reject) => {
          this.pending.push(() => {
            if (answer === 'grant') {
              this.document.pointerLockElement = this.canvas;
              this.document.dispatch('pointerlockchange');
              resolve();
            } else {
              this.document.dispatch('pointerlockerror');
              reject(new Error('NotAllowedError'));
            }
          });
        });
      };
    }
  }

  install(): () => void {
    const g = globalThis as Record<string, unknown>;
    this.saved = { window: g.window, document: g.document };
    g.window = this.window;
    g.document = this.document;
    this.realNow = performance.now.bind(performance);
    performance.now = () => this.now;
    return () => {
      g.window = this.saved.window;
      g.document = this.saved.document;
      if (this.realNow) performance.now = this.realNow;
    };
  }

  get locked(): boolean {
    return this.document.pointerLockElement === this.canvas;
  }

  private release(): void {
    if (this.document.pointerLockElement === null) return;
    this.document.pointerLockElement = null;
    this.document.dispatch('pointerlockchange');
  }

  /** Lets the browser answer everything it was asked (pointer requests, releases) and promises run. */
  async settle(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      for (const fn of batch) fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.resolve();
  }

  /** Time passes. */
  advance(ms: number): void {
    this.now += ms;
  }

  // --- the player's hands ------------------------------------------------------------------------

  keyDown(code: string, key = '', target: unknown = this.other): FakeEvent {
    return this.window.dispatch('keydown', { code, key, target });
  }

  keyUp(code: string, key = '', target: unknown = this.other): FakeEvent {
    return this.window.dispatch('keyup', { code, key, target });
  }

  /** A mouse button goes down. With the pointer captured it always lands on the view. */
  mouseDown(button = 0, target: unknown = this.canvas): FakeEvent {
    return this.window.dispatch('mousedown', { button, target: this.locked ? this.canvas : target });
  }

  mouseUp(button = 0, target: unknown = this.canvas): FakeEvent {
    return this.window.dispatch('mouseup', { button, target: this.locked ? this.canvas : target });
  }

  mouseMove(dx: number, dy: number): FakeEvent {
    return this.window.dispatch('mousemove', { movementX: dx, movementY: dy, clientX: 100, clientY: 100, target: this.canvas });
  }

  /**
   * The Escape key as a browser handles it: with the pointer captured it frees the pointer and
   * the page gets no key event; otherwise it is an ordinary key press.
   */
  pressEscape(): void {
    if (this.locked) {
      this.release();
      return;
    }
    this.keyDown('Escape', 'Escape');
    this.keyUp('Escape', 'Escape');
  }

  /** The player switches to another window: the page loses the focus and the pointer. */
  switchAway(): void {
    this.focused = false;
    this.window.dispatch('blur', { target: this.window });
    this.release();
  }

  switchBack(): void {
    this.focused = true;
    this.window.dispatch('focus', { target: this.window });
  }
}
