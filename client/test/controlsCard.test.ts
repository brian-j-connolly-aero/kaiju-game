/**
 * The controls card (H) shows what the player can do right now: five big pictures at most per
 * side (docs/ROADMAP.md round 4), each over its button, and the communication rose's key under
 * them. `ACTION_USERS` next to the bindings says who presses what.
 */

import { describe, expect, it } from 'vitest';
import { kaijuKindDef, PLAYABLE_KAIJU_KINDS, type HeldObject, type KaijuMoveId, type PickupId, type StageId } from '@mb/shared';
import { ACTION_USERS, BUTTON_ACTIONS, browserShortcutRisk, defaultBindings, type ButtonAction } from '../src/game/input/actions';
import { cardActions, cardTiles, kaijuTiles, MAX_TILES, partGlyph, roseTile, squadTiles, START_STATE, type CardState, type CardTile } from '../src/ui/controlsCard';

function buttonParts(tiles: CardTile[]) {
  return tiles.flatMap((t) => t.pairs.flatMap((p) => p.keys.filter((k): k is Extract<typeof k, { kind: 'button' }> => k.kind === 'button')));
}

function pictures(tile: CardTile | undefined): string[] {
  return tile ? tile.pairs.flatMap((p) => p.pics.flatMap((k) => (k.kind === 'picture' ? [k.icon] : []))) : [];
}

const state = (s: Partial<CardState>): CardState => ({ ...START_STATE, ...s });
const MOVES: Array<readonly [KaijuMoveId, KaijuMoveId]> = [['none', 'none'], ['beam', 'none'], ['roar', 'brace'], ['charge', 'tailSweep']];
const HELD: Array<HeldObject | null> = [null, { kind: 'wreck', wreck: 'car' }, { kind: 'prop', prop: 'foodsign' }, { kind: 'prop', prop: 'antenna' }, { kind: 'prop', prop: 'garagedoor' }];
const PICKUPS: PickupId[] = ['none', 'machineGun', 'bigCannon', 'missilePod', 'artilleryRadio'];

/** Every state the card can be asked to show, for both sides. */
function everyState(): CardState[] {
  const out: CardState[] = [];
  for (const stage of [1, 2, 3] as StageId[]) {
    for (const moves of MOVES) for (const held of HELD) for (const moltOffered of [false, true]) out.push(state({ stage, moves, held, moltOffered }));
    for (const pickup of PICKUPS) for (const drone of [false, true]) out.push(state({ stage, pickup, barrages: pickup === 'artilleryRadio' ? 2 : 0, drone }));
  }
  return out;
}

describe('the controls card', () => {
  it('shows five things at most, on either side, whatever the player has', () => {
    for (const kind of PLAYABLE_KAIJU_KINDS) {
      for (const s of everyState()) {
        expect(cardTiles('kaiju', kind, s).length).toBeLessThanOrEqual(MAX_TILES);
        expect(cardTiles('squad', kind, s).length).toBeLessThanOrEqual(MAX_TILES);
      }
    }
  });

  it('never shows a button to a role that cannot press it, and keeps the communication rose for everyone', () => {
    const kind = PLAYABLE_KAIJU_KINDS[0];
    for (const s of everyState()) {
      for (const action of cardActions(cardTiles('kaiju', kind, s))) expect(ACTION_USERS[action], action).toContain('kaiju');
      for (const action of cardActions(cardTiles('squad', kind, s))) {
        const users = ACTION_USERS[action];
        expect(users.includes(s.drone ? 'drone' : 'squad'), `${action} drone ${s.drone}`).toBe(true);
      }
    }
    expect(buttonParts([roseTile()])).toEqual([{ kind: 'button', action: 'rose', hold: true }]);
    for (const role of ['kaiju', 'squad', 'drone'] as const) expect(ACTION_USERS.rose).toContain(role);
  });

  it('shows the monster its starting kit, and the molt picks only once picked, each on its own button', () => {
    const ids = (s: CardState) => kaijuTiles('lizard', s).map((t) => t.id);
    expect(ids(START_STATE)).toEqual(['walk', 'strike', 'grab', 'stomp']);
    const buttons = (s: CardState, id: string) => buttonParts(kaijuTiles('lizard', s).filter((t) => t.id === id)).map((p) => p.action);
    expect(buttons(START_STATE, 'strike')).toEqual(['strike']);
    expect(buttons(START_STATE, 'grab')).toEqual(['grab']);
    expect(buttons(START_STATE, 'stomp')).toEqual(['stomp']);
    // The bar offers a molt: its button lights up.
    const offered = kaijuTiles('lizard', state({ moltOffered: true }));
    expect(offered.map((t) => t.id)).toEqual(['walk', 'strike', 'grab', 'stomp', 'molt']);
    expect(offered.find((t) => t.id === 'molt')?.glow).toBe(true);
    // Picked at the first molt: the beam on the first move button.
    const one = kaijuTiles('lizard', state({ stage: 2, moves: ['beam', 'none'] }));
    expect(buttons(state({ stage: 2, moves: ['beam', 'none'] }), 'moves')).toEqual(['move1']);
    expect(pictures(one.find((t) => t.id === 'moves'))).toEqual(['k_special']);
    // Both picked, the brace held; with the molt on offer too, walking makes room.
    const both = state({ stage: 2, moves: ['roar', 'brace'], moltOffered: true });
    expect(ids(both)).toEqual(['strike', 'grab', 'stomp', 'moves', 'molt']);
    const moves = buttonParts(kaijuTiles('lizard', both).filter((t) => t.id === 'moves'));
    expect(moves).toEqual([
      { kind: 'button', action: 'move1', hold: false },
      { kind: 'button', action: 'move2', hold: kaijuKindDef('lizard').actions.brace.whileHeld },
    ]);
  });

  it('changes Strike and Grab with what is in the hand', () => {
    const tile = (held: HeldObject | null, id: string) => pictures(kaijuTiles('lizard', state({ held })).find((t) => t.id === id));
    expect(tile(null, 'strike')).toEqual(['k_swipe']);
    expect(tile(null, 'grab')).toEqual(['k_grab', 'tl_car']);
    // A car wreck: thrown, or eaten (it heals).
    expect(tile({ kind: 'wreck', wreck: 'car' }, 'strike')).toEqual(['k_throw']);
    expect(tile({ kind: 'wreck', wreck: 'car' }, 'grab')).toEqual(['k_eat', 'st_health']);
    // City weapons: swung, thrown as a javelin, and dropped (never eaten).
    expect(tile({ kind: 'prop', prop: 'foodsign' }, 'strike')).toEqual(['k_club']);
    expect(tile({ kind: 'prop', prop: 'antenna' }, 'strike')).toEqual(['k_javelin']);
    expect(tile({ kind: 'prop', prop: 'garagedoor' }, 'grab')).toEqual(['k_drop']);
  });

  it('shows a squad on foot, then its tank, a crate weapon on both buttons, the radio on the volley, and the drone', () => {
    const ids = (s: CardState) => squadTiles(s).map((t) => t.id);
    expect(ids(START_STATE)).toEqual(['walk', 'fire', 'volley', 'map']);
    expect(ids(state({ stage: 2 }))).toEqual(['drive', 'turret', 'fire', 'volley', 'map']);
    expect(buttonParts(squadTiles(START_STATE).filter((t) => t.id === 'volley'))).toEqual([{ kind: 'button', action: 'volley', hold: true }]);
    const tile = (s: CardState, id: string) => pictures(squadTiles(s).find((t) => t.id === id));
    expect(tile(START_STATE, 'fire')).toEqual(['st_reload']);
    // A crate's weapon replaces Fire's picture and is what the volley fires too.
    expect(tile(state({ pickup: 'machineGun' }), 'fire')).toEqual(['pk_machinegun']);
    expect(tile(state({ pickup: 'machineGun' }), 'volley')).toEqual(['sq_charge', 'pk_machinegun']);
    expect(tile(state({ pickup: 'artilleryRadio', barrages: 2 }), 'volley')).toEqual(['sq_charge', 'pk_artilleryradio']);
    // The squad gone: flying the news drone.
    expect(ids(state({ drone: true }))).toEqual(['fly', 'rise', 'sink', 'map']);
    expect(cardActions(squadTiles(state({ drone: true })))).toEqual(new Set<ButtonAction>(['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'rise', 'sink', 'map']));
  });

  it('has a glyph for every button on both devices', () => {
    const b = defaultBindings();
    for (const role of ['kaiju', 'squad'] as const) {
      for (const s of everyState()) {
        for (const part of buttonParts([...cardTiles(role, PLAYABLE_KAIJU_KINDS[0], s), roseTile()])) {
          expect(partGlyph(part, b, 'keyboard'), `${role} ${part.action} keyboard`).not.toBeNull();
          expect(partGlyph(part, b, 'gamepad'), `${role} ${part.action} gamepad`).not.toBeNull();
        }
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
