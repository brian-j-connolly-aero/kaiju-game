/**
 * Boot: a progress bar while the manifest, models, textures and sprites load. The bar follows
 * the bytes of the big files as they arrive, and a band of light runs along it and the kaiju
 * breathes the whole time (both are compositor animations, so they keep moving through the
 * moments the page is busy building the city): a slow first load never looks frozen.
 */

import { el, icon } from '../../ui/icons';
import type { AppContext, Screen } from '../context';

export class BootScreen implements Screen {
  readonly id = 'boot' as const;
  private root: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private track: HTMLElement | null = null;
  private failed = false;

  enter(ctx: AppContext): void {
    if (this.root) return;
    // The page's own stand-in (shown while this code downloaded) gives way to this screen.
    document.getElementById('preboot')?.remove();
    this.fill = el('div', 'boot-fill');
    this.track = el('div', 'boot-track', [this.fill]);
    this.root = el('div', 'screen boot', [el('div', 'title', ['MONSTER BATTLE 9001']), icon('lb_kaiju', 'boot-icon'), this.track]);
    ctx.ui.append(this.root);
    if (this.failed) this.fail();
  }

  /** The game cannot start here: the loading bar gives way to the warning picture, for good. */
  fail(): void {
    this.failed = true;
    if (!this.root || !this.track || this.root.classList.contains('failed')) return;
    this.root.classList.add('failed');
    this.track.replaceWith(icon('ui_warning', 'boot-failed'));
  }

  private shown = 0;

  /** 0..1. Never goes backwards. */
  setProgress(value: number): void {
    const v = Math.max(this.shown, Math.min(1, Math.max(0, value)));
    this.shown = v;
    if (this.fill) this.fill.style.width = `${(v * 100).toFixed(1)}%`;
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    this.track = null;
    this.fill = null;
  }
}
