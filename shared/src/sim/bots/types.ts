/**
 * Per-player bot memory. It lives in PlayerState.botState for every slot (a human slot can be
 * handed to a bot when its player drops), so a bot can pick up mid-match.
 *
 * STUB(sim): the bots worker shapes this. Keep it plain data and add fields freely; nothing
 * outside sim/bots/ and systems/bots.ts reads it.
 */
export interface BotState {
  /** Seconds until the bot reconsiders its plan. */
  thinkTimer: number;
  /** Bearing around the kaiju this human bot likes to hold (radians), so squads spread out. */
  bearing: number;
  /** Ground point the bot is heading for. */
  goalX: number;
  goalZ: number;
}

export function createBotState(): BotState {
  return { thinkTimer: 0, bearing: 0, goalX: 0, goalZ: 0 };
}
