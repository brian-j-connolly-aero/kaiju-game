/**
 * Labels of one or two words beside the pictures (docs/ROADMAP.md round 5: "1-2 word descriptions
 * needed, players were confused by just pictures"). Every button in the controls card, on the HUD
 * (the monster's kit, the squad's and the drone's buttons, the menu and the controls card's) and
 * in the communication rose has one, and every label in the one table (client/src/ui/labels.ts) is
 * at most two plain words and about fourteen characters.
 */

import { describe, expect, it } from 'vitest';
import { PICKUP_IDS, PLAYABLE_KAIJU_KINDS, ROSE_ARMY, ROSE_KAIJU, type HeldObject, type KaijuMoveId, type PickupId, type StageId } from '@mb/shared';
import { cardTiles, roseTile, START_STATE, type CardState, type CardTile } from '../src/ui/controlsCard';
import { fireWord, HUD_BUTTONS } from '../src/ui/hud';
import { KIT_ACTIONS, kitLabels } from '../src/ui/kaijuKit';
import { everyLabel, fireLabel, LABEL_MAX_CHARS, LABEL_MAX_WORDS, labelProblem, LABELS, roseLabels } from '../src/ui/labels';

const MOVES: KaijuMoveId[] = ['none', 'beam', 'roar', 'charge', 'tailSweep', 'brace'];
const HELD: Array<HeldObject | null> = [
  null,
  { kind: 'wreck', wreck: 'car' },
  { kind: 'prop', prop: 'foodsign' },
  { kind: 'prop', prop: 'antenna' },
  { kind: 'prop', prop: 'garagedoor' },
  { kind: 'prop', prop: 'propane' },
];

/** Every state the controls card can be asked to show, for both sides. */
function everyState(): CardState[] {
  const out: CardState[] = [];
  for (const stage of [1, 2, 3] as StageId[]) {
    for (const a of MOVES) {
      for (const b of MOVES) for (const held of HELD) for (const moltOffered of [false, true]) out.push({ ...START_STATE, stage, moves: [a, b], held, moltOffered });
    }
    for (const pickup of PICKUP_IDS as readonly PickupId[]) {
      for (const drone of [false, true]) out.push({ ...START_STATE, stage, pickup, barrages: pickup === 'artilleryRadio' ? 2 : 0, drone });
    }
  }
  return out;
}

function expectLabel(text: string | undefined, where: string): void {
  expect(text, where).toBeTypeOf('string');
  expect(labelProblem(text as string), `${where}: "${text}"`).toBeNull();
}

describe('labels of one or two words beside the pictures', () => {
  it('every word in the table is one or two plain words, about fourteen characters at most', () => {
    const all = everyLabel();
    expect(all.length).toBeGreaterThan(100);
    for (const word of all) expectLabel(word, 'table');
    // The rule itself.
    expect(LABEL_MAX_WORDS).toBe(2);
    expect(LABEL_MAX_CHARS).toBe(14);
    expect(labelProblem('Fire')).toBeNull();
    expect(labelProblem('Machine gun')).toBeNull();
    expect(labelProblem('Hold to charge')).not.toBeNull();
    expect(labelProblem('Somewhat lengthy')).not.toBeNull();
    expect(labelProblem('Go.')).not.toBeNull();
    expect(labelProblem('')).not.toBeNull();
  });

  it('every picture and button on the controls card (H) has one, on both sides, whatever the player has', () => {
    const check = (tiles: CardTile[], where: string): void => {
      for (const t of tiles) for (const p of t.pairs) expectLabel(p.label, `${where} ${t.id}`);
    };
    for (const kind of PLAYABLE_KAIJU_KINDS) {
      for (const s of everyState()) {
        check(cardTiles('kaiju', kind, s), `kaiju ${JSON.stringify(s)}`);
        check(cardTiles('squad', kind, s), `squad ${JSON.stringify(s)}`);
      }
    }
    check([roseTile()], 'header');
  });

  it("every button on the HUD has one: the monster's kit in every hand and with every move, the squad's, the drone's, the menu's and the controls card's", () => {
    for (const held of HELD) {
      for (const a of MOVES) {
        for (const b of MOVES) {
          const labels = kitLabels(held, [a, b]);
          for (const action of KIT_ACTIONS) expectLabel(labels[action], `kit ${action} ${JSON.stringify(held)} ${a} ${b}`);
        }
      }
    }
    for (const group of [HUD_BUTTONS.human, HUD_BUTTONS.drone]) for (const [id, b] of Object.entries(group)) expectLabel(b.label, `hud ${id}`);
    expectLabel(HUD_BUTTONS.menu.label, 'hud menu');
    expectLabel(HUD_BUTTONS.controls.label, 'hud controls');
    // Fire says the weapon a crate gave.
    for (const pickup of PICKUP_IDS) expectLabel(fireLabel(pickup), `fire with ${pickup}`);
    expect(fireLabel('machineGun')).toBe(LABELS.pickups.machineGun);
    expect(fireWord).toBe(fireLabel);
  });

  it('every wedge of the communication rose has one, on both sides, in the order of the wedges', () => {
    expect(roseLabels('army')).toHaveLength(ROSE_ARMY.length);
    expect(roseLabels('kaiju')).toHaveLength(ROSE_KAIJU.length);
    ROSE_ARMY.forEach((id, i) => expect(roseLabels('army')[i], id).toBe(LABELS.roseArmy[id]));
    ROSE_KAIJU.forEach((id, i) => expect(roseLabels('kaiju')[i], id).toBe(LABELS.roseKaiju[id]));
    for (const side of ['army', 'kaiju'] as const) for (const w of roseLabels(side)) expectLabel(w, `rose ${side}`);
  });

  it('says what a button does now, and the same on the HUD as on the controls card', () => {
    const kind = PLAYABLE_KAIJU_KINDS[0];
    // Strike and Grab follow the hand.
    expect(kitLabels(null, ['none', 'none']).strike).toBe(LABELS.kaiju.strike);
    expect(kitLabels({ kind: 'wreck', wreck: 'car' }, ['none', 'none']).strike).toBe(LABELS.kaiju.throw);
    expect(kitLabels({ kind: 'prop', prop: 'foodsign' }, ['none', 'none']).strike).toBe(LABELS.kaiju.swing);
    expect(kitLabels({ kind: 'wreck', wreck: 'car' }, ['none', 'none']).grab).toBe(LABELS.kaiju.eat);
    expect(kitLabels({ kind: 'prop', prop: 'garagedoor' }, ['none', 'none']).grab).toBe(LABELS.kaiju.drop);
    expect(kitLabels(null, ['none', 'beam']).move1).toBe(LABELS.kaiju.locked);
    expect(kitLabels(null, ['none', 'tailSweep']).move2).toBe(LABELS.moves.tailSweep);
    for (const held of HELD) {
      for (const moves of [['roar', 'brace'], ['beam', 'charge']] as Array<[KaijuMoveId, KaijuMoveId]>) {
        const kit = kitLabels(held, moves);
        const tiles = cardTiles('kaiju', kind, { ...START_STATE, held, moves });
        const label = (id: string): string[] => tiles.find((t) => t.id === id)?.pairs.map((p) => p.label) ?? [];
        expect(label('strike')).toEqual([kit.strike]);
        expect(label('grab')).toEqual([kit.grab]);
        expect(label('moves')).toEqual([kit.move1, kit.move2]);
      }
    }
    // The squad's Fire on the card is its button's label on the HUD.
    for (const pickup of ['none', 'machineGun', 'bigCannon', 'missilePod'] as PickupId[]) {
      const fire = cardTiles('squad', kind, { ...START_STATE, pickup }).find((t) => t.id === 'fire');
      expect(fire?.pairs[0].label, pickup).toBe(fireLabel(pickup));
    }
  });
});
