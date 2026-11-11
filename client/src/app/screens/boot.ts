/** Boot: a progress bar while the manifest, models, textures and sprites load. */

import { el, icon } from '../../ui/icons';
import type { AppContext, Screen } from '../context';

export class BootScreen implements Screen {
  readonly id = 'boot' as const;
  private root: HTMLElement | null = null;
  private fill: HTMLElement | null = null;

  enter(ctx: AppContext): void {
    this.fill = el('div', 'boot-fill');
    this.root = el('div', 'screen boot', [el('div', 'title', ['MONSTER BATTLE 9001']), icon('lb_kaiju', 'boot-icon'), el('div', 'boot-track', [this.fill])]);
    ctx.ui.append(this.root);
  }

  /** 0..1. */
  setProgress(value: number): void {
    if (this.fill) this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }
}
