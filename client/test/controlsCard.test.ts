/**
 * The controls card shows every control a player can press. The list of who presses what is
 * `ACTION_USERS` next to the bindings; the kaiju's verbs come from its kind's action table.
 */

import { describe, expect, it } from 'vitest';
import { kaijuKindDef, PLAYABLE_KAIJU_KINDS } from '@mb/shared';
import { ACTION_USERS, BUTTON_ACTIONS, browserShortcutRisk, defaultBindings, type ButtonAction } from '../src/game/input/actions';
import { cardActions, cardTiles, kaijuTiles, partGlyph, squadTiles, type CardTile } from '../src/ui/controlsCard';

function buttonParts(tiles: CardTile[]) {
  return tiles.flatMap((t) => t.parts.filter((p): p is Extract<typeof p, { kind: 'button' }> => p.kind === 'button'));
}

describe('the controls card', () => {
  it('shows every action a player can press to everyone who can press it', () => {
    for (const kind of PLAYABLE_KAIJU_KINDS) {
      const kaiju = cardActions(cardTiles('kaiju', kind));
      const squad = cardActions(cardTiles('squad', kind));
      for (const action of BUTTON_ACTIONS) {
        const users = ACTION_USERS[action];
        if (users.includes('kaiju')) expect(kaiju.has(action), `kaiju card misses ${action}`).toBe(true);
        // An eliminated squad leader flies the drone: its controls are on the squad's card.
        if (users.includes('squad') || users.includes('drone')) expect(squad.has(action), `squad card misses ${action}`).toBe(true);
      }
    }
  });

  it('does not show a button to a role that cannot press it', () => {
    const kind = PLAYABLE_KAIJU_KINDS[0];
    for (const action of cardActions(cardTiles('kaiju', kind))) expect(ACTION_USERS[action], action).toContain('kaiju');
    for (const action of cardActions(cardTiles('squad', kind))) {
      const users = ACTION_USERS[action];
      expect(users.includes('squad') || users.includes('drone'), action).toBe(true);
    }
  });

  it('has a tile for every verb in the kaiju action table, on the button and with the gesture it uses', () => {
    for (const kind of PLAYABLE_KAIJU_KINDS) {
      const def = kaijuKindDef(kind);
      const tiles = kaijuTiles(kind);
      for (const [verb, action] of Object.entries(def.actions)) {
        const tile = tiles.find((t) => t.verb === verb);
        expect(tile, `${kind} ${verb}`).toBeDefined();
        const press = buttonParts([tile as CardTile]).find((p) => p.action === action.button);
        expect(press, `${kind} ${verb} shows ${action.button}`).toBeDefined();
        expect(press?.hold === true, `${kind} ${verb} hold ring`).toBe(action.gesture === 'hold' || action.gesture === 'level');
      }
      // Grabbing tanks and pieces of buildings, and the molt, are limited to their stages.
      expect(tiles.find((t) => t.id === 'grab-big')?.stages).toEqual([2, 3]);
      expect(tiles.find((t) => t.id === 'molt')?.stages).toEqual([1, 2]);
    }
  });

  it('shows the squad commands, the volley with the player own shot as its trigger, and the call-in', () => {
    const tiles = squadTiles();
    for (const id of ['follow', 'moveTo', 'fireAtWill', 'holdCharge', 'wheel', 'volley', 'callIn', 'map', 'camera', 'settings', 'controls', 'drone']) {
      expect(tiles.some((t) => t.id === id), id).toBe(true);
    }
    const volley = tiles.find((t) => t.id === 'volley') as CardTile;
    expect(buttonParts([volley]).map((p) => p.action)).toEqual(['fire']);
    expect(buttonParts(tiles.filter((t) => t.id === 'wheel'))[0]).toMatchObject({ action: 'wheel', hold: true });
  });

  it('has a glyph for every button on both devices', () => {
    const b = defaultBindings();
    for (const role of ['kaiju', 'squad'] as const) {
      for (const part of buttonParts(cardTiles(role, PLAYABLE_KAIJU_KINDS[0]))) {
        expect(partGlyph(part, b, 'keyboard'), `${role} ${part.action} keyboard`).not.toBeNull();
        expect(partGlyph(part, b, 'gamepad'), `${role} ${part.action} gamepad`).not.toBeNull();
      }
    }
  });

  it('opens with a key and a controller button that nothing else in a match uses', () => {
    const b = defaultBindings();
    const others = BUTTON_ACTIONS.filter((a): a is ButtonAction => a !== 'controls');
    for (const key of b.keyboard.controls) {
      expect(browserShortcutRisk(key)).toBe(false);
      for (const a of others) expect(b.keyboard[a], `${key} is also ${a}`).not.toContain(key);
    }
    expect(b.gamepad.controls.length).toBeGreaterThan(0);
    for (const button of b.gamepad.controls) for (const a of others) expect(b.gamepad[a], `${button} is also ${a}`).not.toContain(button);
  });
});

describe('the loading bar', () => {
  it('moves while a big file downloads, with or without a known size, and never claims a file is done early', async () => {
    const { downloadShare } = await import('../src/assets/assetStore');
    expect(downloadShare(0, 1000, true)).toBe(0);
    expect(downloadShare(500, 1000, true)).toBeCloseTo(0.5);
    expect(downloadShare(1000, 1000, true)).toBeLessThan(1);
    // A compressed transfer has no size: the share still grows with every byte, and stays short of the end.
    const a = downloadShare(50_000, 0, false);
    const b = downloadShare(400_000, 0, false);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });
});
