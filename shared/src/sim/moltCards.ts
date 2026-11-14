/**
 * Molt cards (DESIGN.md section 4, "Molt cards"; docs/ROADMAP.md, phase 1): at each molt the
 * kaiju picks one new move from three pictures, and it goes on the next empty move button.
 *
 * - The offer is made when the cocoon starts (`offerCards`, called by the kaiju action system):
 *   at the first molt the kind's `cards.first` (the Lizard: beam, roar, charge); at the second
 *   the two of those it did not take, and one of `cards.second` (brace or tail sweep), drawn
 *   with the match's random numbers when the offer is made.
 * - A pick (`PlayerInput.card`, 1 to 3) counts from the start of the cocoon to the end of the
 *   intermission after it (`pickCard`). Nobody picked by then: the match flow system draws one
 *   from the offer at random (`pickCardAtRandom`), so every molt ends with a new move.
 * - The pick lands at once in the first empty slot (`Kaiju.moves`: the first molt fills the
 *   first move button, the second molt the second), and stays for the rest of the match.
 *
 * `moltOffer` and `moltPick` tell the clients; the snapshot carries `moves` and `offer` too.
 */

import { kaijuKindDef } from '../defs/kaiju/index';
import type { KaijuMove, KaijuMoveId } from '../defs/ids';
import { rngInt } from '../math/rng';
import type { Kaiju, World } from './types';
import { emit } from './worldOps';

/** How many cards an offer shows at most. */
export const CARDS_PER_OFFER = 3;

/** The slot (0 or 1) the next pick goes in, or -1 when both are taken. */
export function nextMoveSlot(k: Pick<Kaiju, 'moves'>): 0 | 1 | -1 {
  if (k.moves[0] === 'none') return 0;
  if (k.moves[1] === 'none') return 1;
  return -1;
}

/** The moves a kaiju is offered at its next molt, in card order (empty when both slots are taken). */
export function cardsFor(world: World, k: Kaiju): KaijuMove[] {
  const slot = nextMoveSlot(k);
  if (slot < 0) return [];
  const cards = kaijuKindDef(k.kind).cards;
  const owned = (m: KaijuMoveId): boolean => k.moves[0] === m || k.moves[1] === m;
  const offer = cards.first.filter((m) => !owned(m));
  if (slot > 0) {
    // The second molt: what it did not take the first time, and one more, drawn now.
    const extra = cards.second.filter((m) => !owned(m) && !offer.includes(m));
    if (extra.length > 0) offer.push(extra[rngInt(world.rng, extra.length)]);
  }
  return offer.slice(0, CARDS_PER_OFFER);
}

/** The cocoon has started: the cards are offered (the `moltOffer` event). */
export function offerCards(world: World, k: Kaiju): void {
  const slot = nextMoveSlot(k);
  const offer = cardsFor(world, k);
  k.offer = offer;
  if (slot === -1 || offer.length === 0) return;
  emit(world, { type: 'moltOffer', kaiju: k.id, offer: offer.slice(), slot });
}

/**
 * Takes card `index` (0-based) of the offer standing: the move goes in the next empty slot and
 * the offer is gone. Does nothing without an offer or with an index outside it.
 */
export function pickCard(world: World, k: Kaiju, index: number, random = false): boolean {
  const slot = nextMoveSlot(k);
  if (slot === -1 || index < 0 || index >= k.offer.length) return false;
  const move = k.offer[index];
  k.moves[slot] = move;
  k.offer = [];
  emit(world, { type: 'moltPick', kaiju: k.id, move, slot, card: index + 1, random });
  return true;
}

/** The intermission is over and no card was picked: one is drawn from the offer. */
export function pickCardAtRandom(world: World, k: Kaiju): void {
  if (k.offer.length === 0) return;
  pickCard(world, k, rngInt(world.rng, k.offer.length), true);
}
