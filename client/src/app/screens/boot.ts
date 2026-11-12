/** Boot: a progress bar while the manifest, models, textures and sprites load. */

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

  /** 0..1. */
  setProgress(value: number): void {
    if (this.fill) this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    this.track = null;
    this.fill = null;
  }
}
