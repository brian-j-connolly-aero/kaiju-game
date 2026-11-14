/**
 * The molt card picker (docs/ROADMAP.md phase 1; DESIGN.md section 4, "Molt cards"). When the
 * cocoon starts, the monster is offered three moves: three big cards come up in the middle of
 * the screen, each the move's picture moving the way the move does (CSS), over the button that
 * picks it (1, 2, 3, or the d-pad's left, up and right). Above them, the move button the pick
 * will go on. No text. A bar under the cards runs down to the end of the intermission, when the
 * server picks one at random.
 *
 * The mouse picks too. While the cards wait the match screen lets the pointer go (`waiting`), so
 * a plain click on a card picks it (and takes the pointer back: the click is the gesture a
 * browser wants). Nothing here depends on mouse movement under pointer lock.
 *
 * The picked card flies to its move slot on the HUD (`slotRect`, ui/kaijuKit.ts) and lands there
 * (`onLand`). The server has the last word (`picked`, from its `moltPick` event): a card it drew
 * at random, or a pick of ours that was lost on the way, is the one shown landing.
 */

import { type KaijuMove, type KaijuMoveId, type MatchTuning, type MoltPickEvent, type SnapKaiju, type SnapMatch } from '@mb/shared';
import { glyphFor, keyLayoutVersion, type ActionState, type Bindings, type InputDevice } from '../game/input/actions';
import { el, glyph, icon, setGlyph } from './icons';
import { MOVE_ICON, slotAction } from './kaijuKit';

/** The buttons of the first, second and third card. */
const CARD_KEYS = ['card1', 'card2', 'card3'] as const;
/** Seconds the picked card stays in the middle before it flies, and the flight. */
const HOLD = 0.32;
const FLIGHT = 0.55;

type State = 'closed' | 'open' | 'flying';

export class MoltCardPicker {
  readonly root = el('div', 'molt-cards hidden');
  /** A card was picked here (1 to 3), by a key or a click. */
  onPick: ((card: number, byClick: boolean) => void) | null = null;
  /** A picked card starts its flight to its slot (0 or 1), and has landed there with its move. */
  onFlight: ((slot: number) => void) | null = null;
  onLand: ((slot: number, move: KaijuMoveId) => void) | null = null;
  /** Where a move slot is on screen (the HUD's kit), or null when it is not shown. */
  slotRect: ((slot: number) => DOMRect | null) | null = null;

  private state: State = 'closed';
  private readonly row = el('div', 'molt-cards-row');
  private readonly target = el('div', 'molt-cards-slot', [el('div', 'molt-cards-slot-box', [icon('k_molt')])]);
  private readonly targetGlyph = glyph(null, 'molt-cards-slot-glyph');
  private readonly timerFill = el('div', 'molt-cards-timer-fill');
  private cards: HTMLElement[] = [];
  private glyphs: HTMLElement[] = [];
  private moves: KaijuMoveId[] = [];
  /** The offer being shown or last handled: `stage:slot`. */
  private key = '';
  private handled = '';
  private slot = 0;
  /** The card flying (index), the move it carries, and when it was picked (local time). */
  private flyIndex = -1;
  private flyMove: KaijuMoveId = 'none';
  private flyAt = 0;
  private launched = false;
  /** The move this page picked for the offer it handled (to compare with the server's). */
  private mine: KaijuMoveId = 'none';
  private glyphKey = '';
  private lastFill = -1;
  private now = 0;

  constructor() {
    this.target.prepend(this.targetGlyph);
    this.root.append(this.target, this.row, el('div', 'molt-cards-timer', [this.timerFill]));
  }

  /** The cards are up and nothing has been picked: the match screen frees the pointer meanwhile. */
  get waiting(): boolean {
    return this.state === 'open';
  }

  /** On screen at all (waiting, or a card on its way to its slot). */
  get active(): boolean {
    return this.state !== 'closed';
  }

  /** The moves on the cards now showing (tests and the automation hook). */
  get shownMoves(): readonly KaijuMoveId[] {
    return this.state === 'closed' ? [] : this.moves;
  }

  /**
   * Call every frame with the local kaiju (as drawn). Opens on a new offer, reads the card
   * buttons while the cards wait, runs the bar down and flies a picked card to its slot.
   */
  update(k: SnapKaiju | null, match: SnapMatch, tuning: MatchTuning, input: ActionState, bindings: Bindings, device: InputDevice, now: number): void {
    this.now = now;
    const gk = `${device}:${keyLayoutVersion()}`;
    if (gk !== this.glyphKey) {
      this.glyphKey = gk;
      this.glyphs.forEach((g, i) => setGlyph(g, glyphFor(bindings, CARD_KEYS[i], device)));
      setGlyph(this.targetGlyph, glyphFor(bindings, slotAction(this.slot), device));
    }
    if (!k || !k.alive || match.phase === 'ended') {
      if (this.state !== 'closed') this.close();
      return;
    }
    // A new offer: the cocoon has started (also after the city gave way around a lone kaiju).
    if (k.offer.length > 0) {
      const key = `${k.stage}:${k.moves[0] === 'none' ? 0 : 1}`;
      if (this.state === 'closed' && key !== this.handled) this.open(k.offer, key, k.moves[0] === 'none' ? 0 : 1, bindings, device);
    } else if (this.state === 'open' && this.flyIndex < 0) {
      // The offer is gone and no word of the pick came (a missed event): nothing to show.
      this.close();
      return;
    }
    if (this.state === 'open') {
      for (let i = 0; i < this.moves.length; i++) {
        if (input.pressed[CARD_KEYS[i]]) {
          this.choose(i, false);
          break;
        }
      }
      // The bar: what is left of the cocoon and of the intermission after it.
      const total = Math.max(0.1, tuning.cocoon + tuning.intermission);
      const left = k.phase === 'cocoon' ? Math.max(0, k.phaseDuration - k.phaseTime) + tuning.intermission : match.phase === 'intermission' ? match.phaseTime : 0;
      const fill = Math.round(Math.min(1, left / total) * 200) / 200;
      if (fill !== this.lastFill) {
        this.lastFill = fill;
        this.timerFill.style.width = `${(fill * 100).toFixed(1)}%`;
      }
    }
    if (this.state === 'flying') this.fly();
  }

  /** The server's pick (its `moltPick` event for this player's kaiju). */
  picked(e: MoltPickEvent): void {
    if (e.move === this.flyMove && this.state === 'flying') return;
    if (e.move === this.mine && this.state === 'closed') return;
    const index = this.moves.indexOf(e.move);
    if (this.state === 'open' && index >= 0) {
      // Drawn at random at the end of the intermission (or picked where this page did not see it).
      this.startFlight(index);
      return;
    }
    // Not what was shown flying here (our pick was lost on the way): show the server's landing.
    this.showOnly(e.move, e.slot);
  }

  close(): void {
    if (this.key) this.handled = this.key;
    this.state = 'closed';
    this.flyIndex = -1;
    this.flyMove = 'none';
    this.root.classList.add('hidden');
    this.root.classList.remove('picked');
  }

  private open(offer: readonly KaijuMoveId[], key: string, slot: number, bindings: Bindings, device: InputDevice): void {
    this.key = key;
    this.slot = slot;
    this.mine = 'none';
    this.build(offer, bindings, device);
    this.state = 'open';
    this.lastFill = -1;
    this.root.classList.remove('hidden', 'picked');
    // Restart the cards' entrance.
    void this.root.offsetWidth;
  }

  private build(offer: readonly KaijuMoveId[], bindings: Bindings, device: InputDevice): void {
    this.moves = offer.slice();
    this.glyphs = [];
    this.cards = this.moves.map((move, i) => {
      const g = glyph(glyphFor(bindings, CARD_KEYS[i], device), 'molt-card-glyph');
      this.glyphs.push(g);
      const pic = el('div', 'molt-card-pic', [icon(move === 'none' ? 'k_molt' : MOVE_ICON[move as KaijuMove])]);
      const card = el('div', 'molt-card', [pic, g]);
      card.dataset.move = move;
      card.dataset.card = String(i + 1);
      card.style.setProperty('--i', String(i));
      card.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || this.state !== 'open') return;
        e.preventDefault();
        e.stopPropagation();
        this.choose(i, true);
      });
      return card;
    });
    this.row.replaceChildren(...this.cards);
    setGlyph(this.targetGlyph, glyphFor(bindings, slotAction(this.slot), device));
    this.target.dataset.slot = String(this.slot);
  }

  /** This page picked card `i`: tell the server, and fly it. */
  private choose(i: number, byClick: boolean): void {
    if (this.state !== 'open' || i < 0 || i >= this.moves.length) return;
    this.mine = this.moves[i];
    this.startFlight(i);
    this.onPick?.(i + 1, byClick);
  }

  private startFlight(i: number): void {
    this.state = 'flying';
    this.flyIndex = i;
    this.flyMove = this.moves[i];
    this.flyAt = this.now;
    this.launched = false;
    this.root.classList.add('picked');
    this.onFlight?.(this.slot);
    this.cards.forEach((c, j) => {
      c.classList.toggle('chosen', j === i);
      c.classList.toggle('gone', j !== i);
    });
  }

  /** Only the server's move, landing in its slot (our own pick never reached it). */
  private showOnly(move: KaijuMoveId, slot: number): void {
    this.slot = slot;
    this.moves = [move];
    const pic = el('div', 'molt-card-pic', [icon(move === 'none' ? 'k_molt' : MOVE_ICON[move as KaijuMove])]);
    const card = el('div', 'molt-card', [pic]);
    card.dataset.move = move;
    this.cards = [card];
    this.glyphs = [];
    this.row.replaceChildren(card);
    this.root.classList.remove('hidden');
    this.startFlight(0);
  }

  /** The flight: a moment in the middle, then into the slot, then it lands. */
  private fly(): void {
    const t = this.now - this.flyAt;
    const card = this.cards[this.flyIndex];
    if (!card) {
      this.close();
      return;
    }
    if (!this.launched && t >= HOLD) {
      this.launched = true;
      const to = this.slotRect?.(this.slot) ?? null;
      const from = card.getBoundingClientRect();
      if (to && from.width > 0) {
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const s = Math.max(0.12, to.width / from.width);
        card.style.transition = `transform ${FLIGHT}s cubic-bezier(0.55, 0, 0.8, 0.4), opacity ${FLIGHT}s ease-in`;
        card.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)})`;
        card.classList.add('flying');
      } else {
        card.classList.add('fading');
      }
    }
    if (t >= HOLD + FLIGHT) {
      const slot = this.slot;
      const move = this.flyMove;
      this.close();
      this.onLand?.(slot, move);
    }
  }
}
