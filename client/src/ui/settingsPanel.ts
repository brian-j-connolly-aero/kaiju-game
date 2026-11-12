/**
 * The settings panel: pictures only (DESIGN.md section 8). A speaker with a slider is the master
 * volume, a mouse with a slider is how fast the mouse turns the view, two opposed arrows switch
 * inverted look, four corners switch fullscreen, a grid of big pixels switches the 3D view to
 * half resolution (for weak graphics hardware), and the check mark closes the panel. Clicking
 * anywhere outside the panel closes it too.
 *
 * It is opened from the gear button on the home screen and in the lobby, and with Escape (or
 * Start on a gamepad) anywhere, a match included. The panel only shows and edits values: the
 * host applies and stores them.
 */

import { el, icon } from './icons';

export interface SettingsValues {
  /** Master volume, 0 to 1. */
  volume: number;
  /** Position of the mouse-speed slider, 0 to 1 (the middle is the default speed). */
  mouse: number;
  invertY: boolean;
  fullscreen: boolean;
  /** The 3D view is drawn at half resolution. */
  lowRes: boolean;
}

export interface SettingsHost {
  values(): SettingsValues;
  setVolume(volume: number): void;
  setMouse(position: number): void;
  setInvertY(on: boolean): void;
  setLowRes(on: boolean): void;
  /** Asks the browser to enter or leave fullscreen; always called from inside a click. */
  setFullscreen(on: boolean): void;
  /** A click sound, so a volume change can be heard. */
  click(): void;
}

const STEPS = 100;

function slider(label: string): HTMLInputElement {
  const input = el('input', 'settings-slider');
  input.type = 'range';
  input.min = '0';
  input.max = String(STEPS);
  input.step = '1';
  // For screen readers only; nothing here is drawn.
  input.setAttribute('aria-label', label);
  return input;
}

function setFill(input: HTMLInputElement): void {
  input.style.setProperty('--fill', `${(Number(input.value) / STEPS) * 100}%`);
}

export class SettingsPanel {
  /** A see-through sheet over the whole page: a click on it, outside the panel, closes the panel. */
  readonly root = el('div', 'settings hidden');
  open = false;
  /** The player closed the panel themselves (the check mark, a click outside, Escape on a slider). */
  onClose: (() => void) | null = null;

  private readonly host: SettingsHost;
  private readonly volume = slider('volume');
  private readonly mouse = slider('mouse speed');
  private readonly invert = el('button', 'btn settings-toggle settings-invert', [icon('ui_invert')]);
  private readonly fullscreen = el('button', 'btn settings-toggle settings-fullscreen', [icon('ui_fullscreen')]);
  private readonly lowRes = el('button', 'btn settings-toggle settings-lowres', [icon('ui_lowres')]);
  private readonly done = el('button', 'btn settings-done', [icon('lb_ready')]);

  constructor(host: SettingsHost) {
    this.host = host;
    const panel = el('div', 'settings-panel', [
      el('div', 'settings-row', [icon('ui_sound', 'settings-icon'), this.volume]),
      el('div', 'settings-row', [icon('ms_move', 'settings-icon'), this.mouse]),
      el('div', 'settings-row settings-buttons', [this.invert, this.fullscreen, this.lowRes, this.done]),
    ]);
    this.root.append(panel);

    this.volume.addEventListener('input', () => {
      setFill(this.volume);
      host.setVolume(Number(this.volume.value) / STEPS);
    });
    // The click is played when the slider is let go, at the new volume.
    this.volume.addEventListener('change', () => host.click());
    this.mouse.addEventListener('input', () => {
      setFill(this.mouse);
      host.setMouse(Number(this.mouse.value) / STEPS);
    });
    this.invert.addEventListener('click', () => {
      host.setInvertY(!host.values().invertY);
      host.click();
      this.sync();
    });
    this.lowRes.addEventListener('click', () => {
      host.setLowRes(!host.values().lowRes);
      host.click();
      this.sync();
    });
    this.fullscreen.addEventListener('click', () => {
      host.setFullscreen(!host.values().fullscreen);
      host.click();
    });
    this.done.addEventListener('click', () => this.closeByPlayer());
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.closeByPlayer();
    });
    // Keys pressed on a slider do not reach the game's own key handling: Escape must still close.
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target instanceof HTMLInputElement) this.closeByPlayer();
    });
  }

  private closeByPlayer(): void {
    if (!this.open) return;
    this.host.click();
    this.setOpen(false);
    this.onClose?.();
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.root.classList.toggle('hidden', !open);
    if (open) this.sync();
    else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  /** Shows the current values (also called when fullscreen changes behind the panel's back). */
  sync(): void {
    const v = this.host.values();
    this.volume.value = String(Math.round(v.volume * STEPS));
    this.mouse.value = String(Math.round(v.mouse * STEPS));
    setFill(this.volume);
    setFill(this.mouse);
    this.invert.classList.toggle('on', v.invertY);
    this.fullscreen.classList.toggle('on', v.fullscreen);
    this.lowRes.classList.toggle('on', v.lowRes);
  }
}
