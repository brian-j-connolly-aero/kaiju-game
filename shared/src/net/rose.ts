/**
 * The communication rose (docs/ROADMAP.md, round 4): a player holds one key, picks a wedge, and
 * their character says something. Nothing here changes the game: it is talk.
 *
 * The client sends `rose { cat }`: the wedge picked, an index into its own side's list below
 * (the monster's list for the kaiju player, the army's for a squad leader). The server checks
 * it, keeps each player to one message every `ROSE_GAP_SECONDS` (less `ROSE_SLACK_SECONDS`, so
 * that two picks made exactly that far apart are not refused for the network's jitter), and
 * sends `rose { player, cat, pick }` to everyone in the room: `pick` is a random number every
 * screen turns into the same line or sound (`rosePick`). Bots never use it.
 *
 * The categories' words live with the client (client/src/audio/roseLines.json, for the army's
 * lines) and the sound files (the monster's): this module only fixes the order, which is the
 * wire encoding. Add new categories at the end.
 */

/** The army's wedges: what a squad leader shouts on the radio. */
export const ROSE_ARMY = ['panic', 'bravado', 'orders', 'science', 'home', 'food', 'retreat', 'admire'] as const;
export type RoseArmyId = (typeof ROSE_ARMY)[number];

/** The monster's wedges: no words, only its noises. */
export const ROSE_KAIJU = ['roar', 'roarShort', 'snuffle', 'growl', 'chomp', 'rumble', 'mating'] as const;
export type RoseKaijuId = (typeof ROSE_KAIJU)[number];

/** Which list a player picks from. */
export type RoseSide = 'army' | 'kaiju';

/** The wedges of one side, in wire order. */
export function roseCategories(side: RoseSide): readonly string[] {
  return side === 'kaiju' ? ROSE_KAIJU : ROSE_ARMY;
}

/** Seconds a player waits between two picks (the rose shows it, and does not send sooner). */
export const ROSE_GAP_SECONDS = 2;
/** The server lets a pick through this much early, for the network's jitter. */
export const ROSE_SLACK_SECONDS = 0.3;

/** The largest `pick` the server sends (exclusive): any number below it is a fair pick. */
export const ROSE_PICK_RANGE = 0x10000;

/** The client's message: the wedge picked, an index into the sender's own side's list. */
export interface RoseRequest {
  cat: number;
}

/** What everyone in the room is sent when a player picks a wedge. */
export interface RoseMessage {
  /** The match slot of the player who picked it. */
  player: number;
  /** The wedge, an index into that player's side's list (`roseCategories`). */
  cat: number;
  /** A random number, 0 to ROSE_PICK_RANGE - 1: every screen picks the same line with it. */
  pick: number;
}

/** The wedge index if `cat` is a valid one for this side, else -1. */
export function cleanRoseCategory(side: RoseSide, cat: unknown): number {
  if (typeof cat !== 'number' || !Number.isInteger(cat)) return -1;
  return cat >= 0 && cat < roseCategories(side).length ? cat : -1;
}

/** Which of `count` lines (or sounds) a `pick` stands for: the same on every screen. */
export function rosePick(pick: number, count: number): number {
  if (count <= 0) return -1;
  const p = Number.isFinite(pick) ? Math.floor(Math.abs(pick)) : 0;
  return p % count;
}
