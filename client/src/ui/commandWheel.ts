/**
 * The command wheel: four pictograms around a hub (DESIGN.md section 5). Follow me is up,
 * move to is right, fire at will is down, hold fire and charge is left; each also shows the
 * glyph of its direct button.
 */

import type { CommandId } from '@mb/shared';
import { glyphFor, type Bindings, type ButtonAction, type InputDevice } from '../game/input/actions';
import type { WheelState } from '../game/controllers/humanController';
import { el, glyph, icon, setGlyph } from './icons';

const ENTRIES: Array<{ id: CommandId; icon: string; action: ButtonAction; place: string }> = [
  { id: 'follow', icon: 'cmd_follow', action: 'cmdFollow', place: 'up' },
  { id: 'moveTo', icon: 'cmd_moveto', action: 'cmdMoveTo', place: 'right' },
  { id: 'fireAtWill', icon: 'cmd_fireatwill', action: 'cmdFireAtWill', place: 'down' },
  { id: 'holdCharge', icon: 'cmd_holdcharge', action: 'cmdHoldCharge', place: 'left' },
];

export class CommandWheel {
  readonly root = el('div', 'wheel hidden');
  private readonly slices = new Map<CommandId, { root: HTMLElement; glyph: HTMLElement; action: ButtonAction }>();
  private readonly pointer = el('div', 'wheel-pointer');
  private lastDevice = '';

  constructor() {
    for (const entry of ENTRIES) {
      const g = glyph(null, 'wheel-glyph');
      const slice = el('div', `wheel-slice wheel-${entry.place}`, [icon(entry.icon), g]);
      this.slices.set(entry.id, { root: slice, glyph: g, action: entry.action });
      this.root.append(slice);
    }
    this.root.append(el('div', 'wheel-hub'), this.pointer);
  }

  update(state: WheelState, bindings: Bindings, device: InputDevice): void {
    this.root.classList.toggle('hidden', !state.open);
    if (!state.open) return;
    if (device !== this.lastDevice) {
      this.lastDevice = device;
      for (const slice of this.slices.values()) setGlyph(slice.glyph, glyphFor(bindings, slice.action, device));
    }
    for (const [id, slice] of this.slices) slice.root.classList.toggle('on', state.highlight === id);
    this.pointer.style.transform = `translate(${(state.x * 70).toFixed(1)}px, ${(-state.y * 70).toFixed(1)}px)`;
  }
}
