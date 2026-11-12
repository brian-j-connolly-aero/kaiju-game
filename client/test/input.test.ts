import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Btn, DT } from '@mb/shared';
import { cleanSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, SENSITIVITY_MAX, SENSITIVITY_MIN, sensitivityFromSlider, SETTINGS_KEY, sliderFromSensitivity } from '../src/app/settings';
import { KaijuController } from '../src/game/controllers/kaijuController';
import type { ControlContext } from '../src/game/controllers/types';
import {
  browserShortcutRisk,
  BUTTON_ACTIONS,
  defaultBindings,
  glyphFor,
  keyGlyph,
  keyLayoutVersion,
  loadKeyboardLayout,
  noteKeyLabel,
  resetKeyLabels,
} from '../src/game/input/actions';
import { InputManager, MOUSE_SENSITIVITY } from '../src/game/input/inputManager';
import { InputTicker, MAX_TICKS_PER_FRAME } from '../src/game/input/inputTicker';
import { memoryStore } from '../src/net/session';
import { FakeBrowser } from './fakeBrowser';

const FRAME = 1 / 60;

describe('the captured mouse', () => {
  let browser: FakeBrowser;
  let input: InputManager;
  let uninstall: () => void;

  function start(options: { pointerLock?: boolean } = {}): void {
    browser = new FakeBrowser(options);
    uninstall = browser.install();
    input = new InputManager(browser.canvas as unknown as HTMLElement);
    input.attach();
    input.wantCapture = true;
  }

  /** Clicks the view, lets the browser grant the pointer, lets go, and lets the settle time pass. */
  async function capture(): Promise<void> {
    browser.mouseDown(0);
    await browser.settle();
    browser.mouseUp(0);
    browser.advance(200);
    input.poll(FRAME);
    input.sampleTaken();
    expect(browser.locked).toBe(true);
  }

  beforeEach(() => start());
  afterEach(() => {
    input.detach();
    uninstall();
  });

  it('takes the click that captures the pointer as that and nothing else', async () => {
    // The pointer is free: the first click of a match.
    browser.mouseDown(0);
    expect(browser.requests).toBe(1);
    let s = input.poll(FRAME);
    expect(s.down.strike).toBe(false);
    expect(s.down.fire).toBe(false);
    expect(s.held.strike).toBe(false);
    expect(s.pressed.fire).toBe(false);

    // The browser grants the pointer while the button is still down: still nothing.
    await browser.settle();
    expect(input.pointerLocked).toBe(true);
    s = input.poll(FRAME);
    expect(s.down.strike).toBe(false);
    expect(s.held.fire).toBe(false);
    browser.mouseUp(0);
    s = input.poll(FRAME);
    expect(s.down.strike).toBe(false);
    expect(s.released.strike).toBe(false);

    // From here on a click is a strike (kaiju) and a shot (human).
    browser.mouseDown(0);
    s = input.poll(FRAME);
    expect(s.down.strike).toBe(true);
    expect(s.pressed.fire).toBe(true);
    browser.mouseUp(0);
    s = input.poll(FRAME);
    expect(s.down.strike).toBe(false);
    expect(browser.requests).toBe(1);
  });

  it('does not ask for the pointer, or act, while the game does not want the mouse (the map is open)', () => {
    input.wantCapture = false;
    browser.mouseDown(0);
    const s = input.poll(FRAME);
    expect(browser.requests).toBe(0);
    expect(s.down.fire).toBe(false);
    expect(input.pointerFree).toBe(false);
    // A click that lands on the map or a button is none of the view's business either way.
    input.wantCapture = true;
    browser.mouseDown(0, browser.other);
    expect(browser.requests).toBe(0);
    expect(input.poll(FRAME).down.fire).toBe(false);
  });

  it('gives the pointer back to the browser on request without calling it lost, and takes it again', async () => {
    let lost = 0;
    input.onLockLost = () => lost++;
    await capture();
    expect(input.pointerFree).toBe(false);

    // The map opens: the game lets go.
    input.wantCapture = false;
    input.unlockPointer();
    await browser.settle();
    expect(input.pointerLocked).toBe(false);
    expect(lost).toBe(0);

    // The map closes (a key press): the game asks again, and gets it.
    input.wantCapture = true;
    expect(input.pointerFree).toBe(true);
    input.lockPointer();
    await browser.settle();
    expect(input.pointerLocked).toBe(true);
    expect(input.pointerFree).toBe(false);
    expect(lost).toBe(0);
  });

  it('reports Escape (the browser frees the pointer, no key arrives) and lets go of every mouse button', async () => {
    let lost = 0;
    input.onLockLost = () => lost++;
    await capture();
    browser.mouseDown(0);
    expect(input.poll(FRAME).down.fire).toBe(true);

    browser.pressEscape();
    expect(lost).toBe(1);
    expect(input.pointerFree).toBe(true);
    // The button was down when the pointer went; its release will never reach the view.
    let s = input.poll(FRAME);
    expect(s.down.fire).toBe(false);
    expect(s.down.menu).toBe(false);
    input.sampleTaken();
    s = input.poll(FRAME);
    expect(s.held.fire).toBe(false);

    // The next click is again only a capture.
    browser.mouseUp(0, browser.other);
    browser.mouseDown(0);
    expect(input.poll(FRAME).down.fire).toBe(false);
    await browser.settle();
    browser.mouseUp(0);
    expect(input.pointerLocked).toBe(true);
    expect(lost).toBe(1);
  });

  it('frees every key and button when the player switches to another window', async () => {
    let lost = 0;
    input.onLockLost = () => lost++;
    await capture();
    browser.keyDown('KeyW', 'w');
    browser.mouseDown(0);
    let s = input.poll(FRAME);
    expect(s.down.moveForward && s.down.fire).toBe(true);
    browser.switchAway();
    expect(lost).toBe(1);
    expect(browser.document.hasFocus()).toBe(false);
    s = input.poll(FRAME);
    expect(s.down.moveForward).toBe(false);
    expect(s.down.fire).toBe(false);
    expect(s.moveZ).toBe(0);
  });

  it('leaves the pointer free after a refusal and asks again on the next click', async () => {
    browser.answer = 'refuse';
    browser.mouseDown(0);
    await browser.settle();
    browser.mouseUp(0);
    expect(input.pointerLocked).toBe(false);
    expect(input.pointerFree).toBe(true);
    expect(input.poll(FRAME).down.fire).toBe(false);

    browser.answer = 'grant';
    browser.mouseDown(0);
    await browser.settle();
    browser.mouseUp(0);
    expect(browser.requests).toBe(2);
    expect(input.pointerLocked).toBe(true);
    expect(input.poll(FRAME).down.fire).toBe(false);
  });

  it('turns the view only with the pointer captured, and not with what the mouse did while it was being captured', async () => {
    // Free pointer: the mouse moves over the page and turns nothing.
    browser.mouseMove(40, 10);
    expect(input.poll(FRAME).lookX).toBe(0);
    browser.mouseDown(0);
    browser.mouseMove(300, 300);
    await browser.settle();
    // Some browsers report a jump on the first events after the lock.
    browser.mouseMove(900, -700);
    browser.mouseUp(0);
    let s = input.poll(FRAME);
    expect(s.lookX).toBe(0);
    expect(s.lookY).toBe(0);

    browser.advance(150);
    browser.mouseMove(10, 0);
    browser.mouseMove(10, -5);
    s = input.poll(FRAME);
    expect(s.lookX).toBeCloseTo(20 * MOUSE_SENSITIVITY, 9);
    expect(s.lookY).toBeCloseTo(5 * MOUSE_SENSITIVITY, 9);
    expect(input.poll(FRAME).lookX).toBe(0);
  });

  it('works without pointer lock: buttons act at once and the view turns while a button is held', () => {
    input.detach();
    uninstall();
    start({ pointerLock: false });
    expect(input.lockAvailable).toBe(false);
    expect(input.pointerFree).toBe(false);
    browser.mouseMove(50, 0);
    expect(input.poll(FRAME).lookX).toBe(0);
    browser.mouseDown(0);
    let s = input.poll(FRAME);
    expect(s.down.fire).toBe(true);
    browser.mouseMove(50, 0);
    s = input.poll(FRAME);
    expect(s.lookX).toBeCloseTo(50 * MOUSE_SENSITIVITY, 9);
    browser.mouseUp(0);
    browser.mouseMove(50, 0);
    s = input.poll(FRAME);
    expect(s.down.fire).toBe(false);
    expect(s.lookX).toBe(0);
  });

  it('falls back to that when the browser has pointer lock but never grants it', async () => {
    browser.answer = 'refuse';
    for (let i = 0; i < 3; i++) {
      expect(input.lockAvailable).toBe(true);
      browser.mouseDown(0);
      await browser.settle();
      browser.mouseUp(0);
      expect(input.poll(FRAME).down.fire).toBe(false);
    }
    expect(input.lockAvailable).toBe(false);
    browser.mouseDown(0);
    expect(input.poll(FRAME).down.fire).toBe(true);
    browser.mouseUp(0);
  });

  it('keeps asking when a browser that granted the pointer before refuses for a moment (after Escape)', async () => {
    await capture();
    browser.pressEscape();
    browser.answer = 'refuse';
    for (let i = 0; i < 5; i++) {
      browser.mouseDown(0);
      await browser.settle();
      browser.mouseUp(0);
    }
    expect(input.lockAvailable).toBe(true);
    browser.answer = 'grant';
    browser.mouseDown(0);
    await browser.settle();
    expect(input.pointerLocked).toBe(true);
  });

  it('applies the sensitivity and inverted look settings, and leaves the wheel pointer upright', async () => {
    await capture();
    input.sensitivity = 2;
    browser.mouseMove(100, 50);
    let s = input.poll(FRAME);
    expect(s.lookX).toBeCloseTo(100 * MOUSE_SENSITIVITY * 2, 9);
    expect(s.lookY).toBeCloseTo(-50 * MOUSE_SENSITIVITY * 2, 9);
    input.invertY = true;
    browser.mouseMove(100, 50);
    s = input.poll(FRAME);
    expect(s.lookX).toBeCloseTo(100 * MOUSE_SENSITIVITY * 2, 9);
    expect(s.lookY).toBeCloseTo(50 * MOUSE_SENSITIVITY * 2, 9);
    expect(s.pointerY).toBeCloseTo(-50 * MOUSE_SENSITIVITY * 2, 9);
  });

  it('leaves Tab and Space to the browser in the menus and keeps them for the game in a match', () => {
    expect(browser.keyDown('Tab', 'Tab').defaultPrevented).toBe(false);
    expect(browser.keyDown('Space', ' ').defaultPrevented).toBe(false);
    input.gameKeys = true;
    expect(browser.keyDown('Tab', 'Tab').defaultPrevented).toBe(true);
    expect(browser.keyDown('Space', ' ').defaultPrevented).toBe(true);
    expect(browser.keyDown('KeyW', 'w').defaultPrevented).toBe(false);
  });

  it('removes every listener on detach', () => {
    input.detach();
    expect(browser.window.listenerCount()).toBe(0);
    expect(browser.document.listenerCount()).toBe(0);
    input.attach();
  });
});

describe('30 Hz input samples', () => {
  let browser: FakeBrowser;
  let input: InputManager;
  let uninstall: () => void;

  beforeEach(async () => {
    browser = new FakeBrowser();
    uninstall = browser.install();
    input = new InputManager(browser.canvas as unknown as HTMLElement);
    input.attach();
    input.wantCapture = true;
    browser.mouseDown(0);
    await browser.settle();
    browser.mouseUp(0);
    input.poll(FRAME);
    input.sampleTaken();
  });
  afterEach(() => {
    input.detach();
    uninstall();
  });

  /**
   * Plays `seconds` of frames at `fps` the way MatchRuntime.update does (poll, then the input
   * ticks that are due, each built by the controller from the latch), with the left button
   * pressed at `pressAt` and released `clickMs` later. Returns the strike bit of every sample.
   */
  function run(fps: number, pressAt: number, clickMs: number, phase: number, seconds = 0.6): boolean[] {
    const controller = new KaijuController();
    const ticker = new InputTicker();
    ticker.advance(phase * DT);
    const sent: boolean[] = [];
    const frame = 1 / fps;
    const releaseAt = pressAt + clickMs / 1000;
    let pressed = false;
    let released = false;
    for (let now = frame * 0.37; now < seconds; now += frame) {
      // Everything the mouse did since the previous frame arrives before this frame's poll.
      if (!pressed && pressAt <= now) {
        pressed = true;
        browser.mouseDown(0);
      }
      if (pressed && !released && releaseAt <= now) {
        released = true;
        browser.mouseUp(0);
      }
      const actions = input.poll(frame);
      const ctx = { input: actions, mapOpen: false } as ControlContext;
      const ticks = ticker.advance(frame);
      for (let i = 0; i < ticks; i++) {
        const sample = controller.sample(ctx);
        input.sampleTaken();
        sent.push((sample.buttons & Btn.strike) !== 0);
      }
    }
    if (!released) browser.mouseUp(0);
    input.poll(frame);
    input.sampleTaken();
    return sent;
  }

  for (const fps of [30, 60, 144, 240]) {
    it(`carries a click of any length in exactly one run of samples at ${fps} frames a second`, () => {
      for (const clickMs of [1, 5, 15, 25, 40]) {
        for (let trial = 0; trial < 40; trial++) {
          const pressAt = 0.2 + (trial / 40) * DT * 3.1;
          const phase = (trial * 0.377) % 1;
          const sent = run(fps, pressAt, clickMs, phase);
          const withBit = sent.filter(Boolean).length;
          expect(withBit, `${clickMs} ms click at ${fps} fps, trial ${trial}`).toBeGreaterThanOrEqual(1);
          // A click this short is one tap to the simulation: the samples that carry it are
          // next to each other and few.
          const first = sent.indexOf(true);
          const last = sent.lastIndexOf(true);
          expect(last - first + 1, `${clickMs} ms click at ${fps} fps, trial ${trial}`).toBe(withBit);
          expect(withBit).toBeLessThanOrEqual(Math.ceil(clickMs / 1000 / DT) + 2);
        }
      }
    });
  }

  it('sends a press and then its release when several ticks share one slow frame', () => {
    const controller = new KaijuController();
    const ticker = new InputTicker();
    browser.mouseDown(0);
    browser.mouseUp(0);
    const actions = input.poll(0.2);
    const ctx = { input: actions, mapOpen: false } as ControlContext;
    const ticks = ticker.advance(0.2);
    expect(ticks).toBe(6);
    const bits: number[] = [];
    for (let i = 0; i < ticks; i++) {
      bits.push(controller.sample(ctx).buttons & Btn.strike);
      input.sampleTaken();
    }
    expect(bits).toEqual([Btn.strike, 0, 0, 0, 0, 0]);
  });

  it('keeps a held button down in every sample and never sends buttons while the map is open', () => {
    const controller = new KaijuController();
    browser.keyDown('Space', ' ');
    for (let i = 0; i < 5; i++) {
      const ctx = { input: input.poll(FRAME), mapOpen: false } as ControlContext;
      expect(controller.sample(ctx).buttons & Btn.block).toBe(Btn.block);
      input.sampleTaken();
    }
    const ctx = { input: input.poll(FRAME), mapOpen: true } as ControlContext;
    expect(controller.sample(ctx).buttons).toBe(0);
    browser.keyUp('Space', ' ');
  });

  it('limits the ticks of one frame and reports how far the present is past the newest tick', () => {
    const ticker = new InputTicker();
    expect(ticker.advance(DT * 0.25)).toBe(0);
    expect(ticker.alpha).toBeCloseTo(0.25, 6);
    expect(ticker.advance(DT)).toBe(1);
    expect(ticker.alpha).toBeCloseTo(0.25, 6);
    expect(ticker.advance(5)).toBe(MAX_TICKS_PER_FRAME);
    expect(ticker.alpha).toBeGreaterThanOrEqual(0);
    expect(ticker.alpha).toBeLessThan(1);
  });
});

describe('the default keys and the browser', () => {
  it('binds no key that turns another game key into a browser shortcut', () => {
    const keyboard = defaultBindings().keyboard;
    for (const action of BUTTON_ACTIONS) {
      for (const code of keyboard[action]) expect(browserShortcutRisk(code), `${action}: ${code}`).toBe(false);
    }
    // The examples that matter: Ctrl+W closes the tab, Alt+Left goes back, Shift+Escape opens the task manager.
    for (const code of ['ControlLeft', 'ControlRight', 'AltLeft', 'MetaLeft', 'ShiftLeft', 'F5', 'F11', 'Backspace']) expect(browserShortcutRisk(code), code).toBe(true);
    for (const code of ['KeyW', 'KeyC', 'Space', 'Tab', 'Escape', 'Mouse0', 'Digit1']) expect(browserShortcutRisk(code), code).toBe(false);
  });

  it('lets the drone go down with a key of its own, and shows it', () => {
    const b = defaultBindings();
    expect(b.keyboard.sink).toEqual(['KeyC']);
    expect(b.keyboard.rise).toEqual(['Space']);
    expect(glyphFor(b, 'sink', 'keyboard')).toEqual({ icon: 'kb_key', label: 'C' });
    // No other action of the drone or of movement shares the key.
    for (const action of ['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'rise', 'map', 'menu'] as const) {
      expect(b.keyboard[action]).not.toContain('KeyC');
    }
  });
});

describe('keycap letters', () => {
  beforeEach(() => resetKeyLabels());
  afterEach(() => resetKeyLabels());

  it('shows the US letter of a key position until the keyboard says otherwise', () => {
    expect(keyGlyph('KeyQ').label).toBe('Q');
    expect(keyGlyph('Digit3').label).toBe('3');
    expect(keyGlyph('Space').label).toBe('␣');
  });

  it('learns the letter printed on a key from the first press (a French keyboard)', () => {
    const browser = new FakeBrowser();
    const uninstall = browser.install();
    const input = new InputManager(browser.canvas as unknown as HTMLElement);
    input.attach();
    const before = keyLayoutVersion();
    // On an AZERTY keyboard the key in the Q position types "a" and the one in the M position ",".
    browser.keyDown('KeyQ', 'a');
    browser.keyDown('KeyM', ',');
    browser.keyDown('KeyW', 'z');
    expect(glyphFor(input.bindings, 'roar', 'keyboard')).toEqual({ icon: 'kb_key', label: 'A' });
    expect(glyphFor(input.bindings, 'map', 'keyboard')).toEqual({ icon: 'kb_key', label: ',' });
    expect(glyphFor(input.bindings, 'moveForward', 'keyboard')).toEqual({ icon: 'kb_key', label: 'Z' });
    expect(keyLayoutVersion()).toBeGreaterThan(before);
    // The position still does the same thing: bindings are by position.
    expect(input.poll(FRAME).down.roar).toBe(true);
    // Named keys keep their symbol; a key that types nothing printable teaches nothing; the
    // digit row keeps its digits (on this keyboard the "1" key types "&" without Shift).
    browser.keyDown('Space', ' ');
    browser.keyDown('KeyE', 'Dead');
    browser.keyDown('Digit1', '&');
    expect(keyGlyph('Space').label).toBe('␣');
    expect(keyGlyph('KeyE').label).toBe('E');
    expect(glyphFor(input.bindings, 'cmdFollow', 'keyboard')).toEqual({ icon: 'kb_key', label: '1' });
    // A character typed with AltGr or Ctrl held is not what the keycap shows.
    browser.window.dispatch('keydown', { code: 'KeyE', key: '€', target: browser.other, ...({ ctrlKey: true, altKey: true } as object) });
    expect(keyGlyph('KeyE').label).toBe('E');
    input.detach();
    uninstall();
  });

  it('takes the whole layout from the browser when it can tell', async () => {
    const german = new Map([
      ['KeyY', 'z'],
      ['KeyZ', 'y'],
      ['KeyQ', 'q'],
    ]);
    await loadKeyboardLayout({ keyboard: { getLayoutMap: () => Promise.resolve(german) } });
    expect(keyGlyph('KeyY').label).toBe('Z');
    expect(keyGlyph('KeyZ').label).toBe('Y');
    // A browser without the feature, or one that refuses, changes nothing and does not throw.
    await loadKeyboardLayout({});
    await loadKeyboardLayout({ keyboard: { getLayoutMap: () => Promise.reject(new Error('denied')) } });
    expect(keyGlyph('KeyQ').label).toBe('Q');
    noteKeyLabel('KeyQ', 'ß');
    expect(keyGlyph('KeyQ').label).toBe('Q');
  });
});

describe('settings', () => {
  it('survives anything that may be in the browser storage', () => {
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings('loud')).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ volume: 7, sensitivity: -3, invertY: 'yes' })).toEqual({ volume: 1, sensitivity: SENSITIVITY_MIN, invertY: false });
    expect(cleanSettings({ volume: Number.NaN, sensitivity: 99 })).toEqual({ volume: DEFAULT_SETTINGS.volume, sensitivity: SENSITIVITY_MAX, invertY: false });
    const store = memoryStore();
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('remembers what the player chose', () => {
    const store = memoryStore();
    saveSettings(store, { volume: 0.25, sensitivity: 1.7, invertY: true });
    expect(loadSettings(store)).toEqual({ volume: 0.25, sensitivity: 1.7, invertY: true });
  });

  it('puts the default mouse speed in the middle of its slider', () => {
    expect(sensitivityFromSlider(0.5)).toBeCloseTo(1, 9);
    expect(sensitivityFromSlider(0)).toBeCloseTo(SENSITIVITY_MIN, 9);
    expect(sensitivityFromSlider(1)).toBeCloseTo(SENSITIVITY_MAX, 9);
    for (const s of [0.25, 0.6, 1, 2.3, 4]) expect(sensitivityFromSlider(sliderFromSensitivity(s))).toBeCloseTo(s, 9);
    expect(sliderFromSensitivity(DEFAULT_SETTINGS.sensitivity)).toBeCloseTo(0.5, 9);
  });
});
