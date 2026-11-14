/**
 * The controls card shows every control a player can press. The list of who presses what is
 * `ACTION_USERS` next to the bindings; the kaiju's verbs come from its kind's action table.
 */

import { describe, expect, it } from 'vitest';
import { kaijuKindDef, PLAYABLE_KAIJU_KINDS } from '@mb/shared';
import { ACTION_USERS, BUTTON_ACTIONS, browserShortcutRisk, defaultBindings, type ButtonAction } from '../src/game/input/actions';
import { cardActions, cardButton, cardTiles, kaijuTiles, partGlyph, squadTiles, type CardTile } from '../src/ui/controlsCard';

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

  it('has a tile for every verb in the kaiju action table, on its button, held only for the brace', () => {
    for (const kind of PLAYABLE_KAIJU_KINDS) {
      const def = kaijuKindDef(kind);
      const tiles = kaijuTiles(kind);
      for (const [verb, action] of Object.entries(def.actions)) {
        const tile = tiles.find((t) => t.verb === verb);
        expect(tile, `${kind} ${verb}`).toBeDefined();
        const key = cardButton(verb as keyof typeof def.actions);
        // A move a molt card gives sits on whichever move button its slot is: the card shows both.
        expect(key.slot, `${kind} ${verb} is a move picked at a molt`).toBe(action.button === 'slot');
        if (key.slot) {
          const moves = (tile as CardTile).parts.find((p) => p.kind === 'moves');
          expect(moves, `${kind} ${verb} shows the move buttons`).toBeDefined();
          expect(moves?.kind === 'moves' && moves.hold === true, `${kind} ${verb} hold ring`).toBe(action.whileHeld);
        } else {
          const press = buttonParts([tile as CardTile]).find((p) => p.action === key.action);
          expect(press, `${kind} ${verb} shows ${key.action}`).toBeDefined();
          expect(press?.hold === true, `${kind} ${verb} hold ring`).toBe(action.whileHeld);
        }
      }
      // Grabbing tanks and pieces of buildings, and the molt, are limited to their stages.
      expect(tiles.find((t) => t.id === 'grab-big')?.stages).toEqual([2, 3]);
      expect(tiles.find((t) => t.id === 'molt')?.stages).toEqual([1, 2]);
    }
  });

  it('shows the starting kit, the two empty move slots and the molt with its three cards', () => {
    const tiles = kaijuTiles('lizard');
    const parts = (id: string) => (tiles.find((t) => t.id === id) as CardTile).parts;
    // One move per button: Strike swipes, Grab grabs, Stomp stomps; with something in the hand
    // the same two buttons throw it and eat it; with nothing to pick up a kiosk is eaten.
    expect(buttonParts([tiles.find((t) => t.id === 'swipe') as CardTile]).map((p) => p.action)).toEqual(['strike']);
    expect(buttonParts([tiles.find((t) => t.id === 'stomp') as CardTile]).map((p) => p.action)).toEqual(['stomp']);
    expect(buttonParts([tiles.find((t) => t.id === 'throw') as CardTile]).map((p) => p.action)).toEqual(['strike']);
    expect(buttonParts([tiles.find((t) => t.id === 'eat') as CardTile]).map((p) => p.action)).toEqual(['grab']);
    expect(parts('eat-kiosk').some((p) => p.kind === 'picture' && p.icon === 'tl_kiosk')).toBe(true);
    // Nothing is held any more, but the brace.
    expect(buttonParts(tiles).every((p) => !p.hold)).toBe(true);
    // The slots: the first move button filled from stage 2, the second from stage 3.
    expect(parts('slots')).toEqual([
      { kind: 'slot', action: 'move1', stages: [2, 3] },
      { kind: 'slot', action: 'move2', stages: [3] },
    ]);
    // The molt: one press, then the first molt's three cards.
    expect(buttonParts([tiles.find((t) => t.id === 'molt') as CardTile]).map((p) => p.action)).toEqual(['molt']);
    expect(parts('molt').find((p) => p.kind === 'cards')).toEqual({ kind: 'cards', moves: kaijuKindDef('lizard').cards.first });
    // Every move a card can give, from the stage it can first be had: the second molt's only at stage 3.
    for (const move of ['beam', 'roar', 'charge']) expect(tiles.find((t) => t.id === move)?.stages, move).toEqual([2, 3]);
    for (const move of ['brace', 'tailSweep']) expect(tiles.find((t) => t.id === move)?.stages, move).toEqual([3]);
  });

  it('pictures swimming (no button: walk into deep water) at the stages the kaiju can swim', () => {
    const tiles = kaijuTiles('lizard');
    const swim = tiles.find((t) => t.id === 'swim') as CardTile;
    expect(swim).toBeDefined();
    expect(buttonParts([swim])).toEqual([]);
    expect(swim.parts.some((p) => p.kind === 'move')).toBe(true);
    expect(swim.parts.some((p) => p.kind === 'picture' && p.icon === 'k_swim')).toBe(true);
    // The hatchling and the juvenile; the titan is too big.
    expect(swim.stages).toEqual([1, 2]);
  });

  it('shows the squad its two buttons (Volley held), and the tank’s driving at stages 2 and 3', () => {
    const tiles = squadTiles();
    for (const id of ['move', 'look', 'fire', 'volley', 'volleyEarly', 'drive', 'turn', 'turret', 'map', 'camera', 'settings', 'controls', 'drone']) {
      expect(tiles.some((t) => t.id === id), id).toBe(true);
    }
    const tile = (id: string): CardTile => tiles.find((t) => t.id === id) as CardTile;
    expect(buttonParts([tile('fire')])).toEqual([{ kind: 'button', action: 'fire', hold: false }]);
    expect(buttonParts([tile('volley')])).toEqual([{ kind: 'button', action: 'volley', hold: true }]);
    // On foot the keys move relative to the view; at stages 2 and 3 W and S drive and A and D turn.
    expect(tile('move').stages).toEqual([1]);
    for (const id of ['drive', 'turn', 'turret']) expect(tile(id).stages, id).toEqual([2, 3]);
    expect(cardActions([tile('drive')])).toEqual(new Set(['moveForward', 'moveBack']));
    expect(cardActions([tile('turn')])).toEqual(new Set(['moveLeft', 'moveRight']));
    // Nothing of the old controls is left: no wheel, no orders, no smoke, no mark, no artillery.
    for (const action of ['wheel', 'cmdFollow', 'cmdMoveTo', 'cmdFireAtWill', 'cmdHoldCharge', 'smoke', 'mark', 'callIn', 'confirm']) {
      expect((BUTTON_ACTIONS as readonly string[]).includes(action), action).toBe(false);
    }
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
