/** Small helpers every system uses: emitting events, looking entities up, queueing commands. */

import { TALLY_CLASSES, type TallyClass } from '../defs/ids';
import { VOICE_RULES } from '../defs/voice';
import { BUTTON_COUNT, neutralInput } from '../net/input';
import { createBotState } from './bots/types';
import type { SquadCommand } from './commands';
import type { PlayerId, PlayerSlot } from './config';
import type { PlayerTally, SimEvent, SimEventInput } from './events';
import type { InputState, Kaiju, PlayerState, Squad, Unit, VoiceState, World } from './types';

/** "Never pressed" value for InputState.sincePressTicks. */
export const NEVER_PRESSED_TICKS = 1e9;

/** Records an event for this tick. The world stamps the tick. */
export function emit(world: World, event: SimEventInput): void {
  // The spread keeps the discriminated payload intact; only `tick` is added.
  world.events.push({ ...event, tick: world.tick } as SimEvent);
}

export function createInputState(): InputState {
  return {
    seq: 0,
    moveX: 0,
    moveZ: 0,
    aimYaw: 0,
    aimPitch: 0,
    buttons: 0,
    pressed: 0,
    released: 0,
    heldTicks: new Array<number>(BUTTON_COUNT).fill(0),
    lastHeldTicks: new Array<number>(BUTTON_COUNT).fill(0),
    sincePressTicks: new Array<number>(BUTTON_COUNT).fill(NEVER_PRESSED_TICKS),
  };
}

export function createTally(): PlayerTally {
  const wrecked = {} as Record<TallyClass, number>;
  for (const cls of TALLY_CLASSES) wrecked[cls] = 0;
  return { wrecked, barPoints: 0, damageDealt: 0, breaks: 0, kills: 0, unitsLost: 0, volleys: 0 };
}

export function createPlayerState(slot: PlayerSlot): PlayerState {
  return {
    id: slot.id,
    name: slot.name,
    callsign: slot.callsign,
    role: slot.role,
    bot: slot.bot,
    kaijuId: -1,
    squadId: -1,
    input: createInputState(),
    commands: [],
    queuedCommands: [],
    botInput: neutralInput(),
    botState: createBotState(),
    handBack: false,
    tally: createTally(),
  };
}

export function createVoiceState(): VoiceState {
  return {
    cooldowns: {},
    clockCalled: { min3: false, min1: false, sec10: false },
    tokens: VOICE_RULES.chatterTokens,
    lastLine: {},
    lowHpStage: 0,
    barNearCalled: 0,
  };
}

/** The kaiju a player controls, or null. */
export function playerKaiju(world: World, player: PlayerId): Kaiju | null {
  const p = world.players[player];
  return p && p.kaijuId >= 0 ? world.kaijus[p.kaijuId] : null;
}

/** The squad a player leads, or null. */
export function playerSquad(world: World, player: PlayerId): Squad | null {
  const p = world.players[player];
  return p && p.squadId >= 0 ? world.squads[p.squadId] : null;
}

/** The unit a squad's player is driving, or null when the squad is eliminated. */
export function drivenUnit(world: World, squad: Squad): Unit | null {
  return squad.driven >= 0 ? world.units[squad.driven] : null;
}

/** True for the unit its squad's player drives directly (not a sub-unit). */
export function isDriven(world: World, unit: Unit): boolean {
  return world.squads[unit.squad].driven === unit.id;
}

/**
 * Hands a command to the simulation between ticks (the server calls this for `command`
 * messages). It takes effect on the next step, exactly like a wheel pick sent in an input.
 */
export function queueCommand(world: World, player: PlayerId, command: SquadCommand): void {
  const p = world.players[player];
  if (!p || p.role !== 'human') return;
  // A flood of commands is a broken or hostile client; the newest few are all that matter.
  if (p.queuedCommands.length >= 8) p.queuedCommands.shift();
  p.queuedCommands.push(command);
}

/**
 * The server's hook for people coming and going. `bot: true` gives a slot to a bot (its player
 * dropped, or never came): the bot starts from the slot's current state with a fresh mind and
 * plays by the same rules. `bot: false` hands the slot back to a person (they rejoined, or a
 * late joiner takes over a bot squad): the bot lets go of the controls at once, and the person
 * carries on from wherever the bot left their kaiju or squad. Nothing else changes; calling it
 * with the state the slot is already in does nothing.
 */
export function setPlayerBot(world: World, player: PlayerId, bot: boolean): void {
  const p = world.players[player];
  if (!p || p.bot === bot) return;
  p.bot = bot;
  if (bot) {
    // The bot keeps looking where the player looked; everything else it works out afresh.
    p.botInput = neutralInput(p.input.seq);
    p.botInput.aimYaw = p.input.aimYaw;
    p.botInput.aimPitch = p.input.aimPitch;
    p.botState = createBotState();
    p.handBack = false;
  } else {
    p.handBack = true;
  }
}

/** The first living kaiju, or null. Tier 1 has exactly one kaiju. */
export function firstLivingKaiju(world: World): Kaiju | null {
  for (const k of world.kaijus) if (k.alive) return k;
  return null;
}
