/** The communication rose on screen (ui/rose.ts): picking a wedge, cancelling, the wait between picks. */

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROSE_ARMY, ROSE_GAP_SECONDS, ROSE_KAIJU } from '@mb/shared';
import { defaultBindings } from '../src/game/input/actions';
import { ROSE_DEADZONE, ROSE_ICONS, ROSE_REACH, RosePicker, roseWedgeAt, type RoseInput } from '../src/ui/rose';

const input = (over: Partial<RoseInput>): RoseInput => ({ held: false, dx: 0, dy: 0, allowed: true, now: 10, ...over });

describe('the communication rose', () => {
  it('points at wedge 0 straight up and goes round clockwise; the middle is no wedge', () => {
    expect(roseWedgeAt(0, -100, 8)).toBe(0);
    expect(roseWedgeAt(100, 0, 8)).toBe(2);
    expect(roseWedgeAt(0, 100, 8)).toBe(4);
    expect(roseWedgeAt(-100, 0, 8)).toBe(6);
    expect(roseWedgeAt(70, -70, 8)).toBe(1);
    expect(roseWedgeAt(-70, -70, 8)).toBe(7);
    expect(roseWedgeAt(ROSE_DEADZONE - 1, 0, 8)).toBe(-1);
    expect(roseWedgeAt(0, -100, 7)).toBe(0);
    expect(roseWedgeAt(-5, -100, 7)).toBe(0);
  });

  it('opens while held, follows the mouse, and sends the wedge it is let go on', () => {
    const p = new RosePicker(ROSE_ARMY.length);
    expect(p.step(input({ held: true }))).toEqual({ open: true, sent: -1 });
    p.step(input({ held: true, dx: 30, dy: 0 }));
    p.step(input({ held: true, dx: 30, dy: 0 }));
    expect(p.selected).toBe(2);
    // It never goes further out than the ring.
    p.step(input({ held: true, dx: 1000 }));
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(ROSE_REACH, 6);
    expect(p.step(input({ held: false }))).toEqual({ open: false, sent: 2 });
    expect(p.open).toBe(false);
  });

  it('sends nothing when let go in the middle, or while it waits after a pick', () => {
    const p = new RosePicker(ROSE_KAIJU.length);
    p.step(input({ held: true }));
    p.step(input({ held: true, dx: 5, dy: -5 }));
    expect(p.step(input({ held: false })).sent).toBe(-1);

    const pick = (now: number): number => {
      p.step(input({ held: true, now }));
      p.step(input({ held: true, dy: -80, now }));
      return p.step(input({ held: false, now })).sent;
    };
    expect(pick(10)).toBe(0);
    expect(p.waitLeft(10.5)).toBeCloseTo(ROSE_GAP_SECONDS - 0.5, 6);
    expect(pick(10 + ROSE_GAP_SECONDS - 0.1)).toBe(-1);
    expect(pick(10 + ROSE_GAP_SECONDS)).toBe(0);
  });

  it('shuts without sending when the moment passes (the map, the menu, the match ending)', () => {
    const p = new RosePicker(ROSE_ARMY.length);
    p.step(input({ held: true }));
    p.step(input({ held: true, dy: -80 }));
    expect(p.step(input({ held: true, allowed: false }))).toEqual({ open: false, sent: -1 });
    expect(p.step(input({ held: false }))).toEqual({ open: false, sent: -1 });
  });

  it('has a picture for every wedge, and a key and a pad button of its own', () => {
    for (const ids of Object.values(ROSE_ICONS)) {
      for (const id of ids) expect(existsSync(new URL(`../public/assets/ui/${id}.svg`, import.meta.url)), id).toBe(true);
    }
    expect(ROSE_ICONS.army.length).toBe(ROSE_ARMY.length);
    expect(ROSE_ICONS.kaiju.length).toBe(ROSE_KAIJU.length);
    const b = defaultBindings();
    expect(b.keyboard.rose).toEqual(['KeyZ']);
    // Free on both sides: no other action shares the key or the button.
    for (const [action, keys] of Object.entries(b.keyboard)) if (action !== 'rose') expect(keys, action).not.toContain('KeyZ');
    for (const [action, buttons] of Object.entries(b.gamepad)) if (action !== 'rose') expect(buttons, action).not.toContain(b.gamepad.rose[0]);
  });
});
