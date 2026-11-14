/**
 * Per-player bot memory. It lives in PlayerState.botState for every slot (a human slot can be
 * handed to a bot when its player drops), so a bot can pick up mid-match: `createBotState()` is
 * a blank mind, and the first thing a bot does with one is look at the world as it is.
 *
 * Plain data. Nothing outside sim/bots/ and systems/bots.ts reads it.
 */

import { BUTTON_COUNT } from '../../net/input';

export type SquadBotMode = 'approach' | 'hold' | 'retreat' | 'search';
export type KaijuBotGoal = 'none' | 'structure' | 'prop' | 'hide' | 'point';

export interface BotState {
  /** The stage this memory was made in; 0 for a blank mind. A new stage starts it over. */
  stage: number;
  /** Seconds until the bot reconsiders its plan. */
  thinkTimer: number;
  /** Handicap: seconds until the next roll, and whether the bot is idling until then. */
  hesitateTimer: number;
  hesitating: boolean;
  /** Per button (BtnIndex): ticks the bot will keep it down, and ticks before it may press it again. */
  hold: number[];
  rest: number[];
  /** Ground point the bot is heading for. */
  goalX: number;
  goalZ: number;
  /** Progress watch: where it was when it last got somewhere, and for how long it has not since. */
  markX: number;
  markZ: number;
  stuck: number;
  /** The closest it has been to its goal, and for how long it has not come closer (walking in circles is not progress). */
  goalBest: number;
  goalStall: number;

  // --- Squad bot ---------------------------------------------------------------------------
  mode: SquadBotMode;
  /** Bearing around the kaiju this squad likes to hold (radians), so squads spread out and their fire crosses. */
  bearing: number;
  /** Where the kaiju was when the humans last knew, and whether that has been looked at since. */
  lastX: number;
  lastZ: number;
  lastChecked: boolean;
  /** The squad is parked on hold-and-charge. */
  parked: boolean;
  /** Seconds the parked squad has had no line of fire. */
  blind: number;
  /** Seconds the squad has been ready and waiting for the others. */
  waited: number;
  /** Wheel commands waiting to be given, in order, and seconds until the next may go. */
  wheel: Array<'follow' | 'moveTo' | 'fireAtWill' | 'holdCharge'>;
  wheelTimer: number;
  /** The leader has a line of fire to the kaiju (as of the last look), and to which height on its body (a fraction; -1: none). */
  los: boolean;
  aimHeight: number;
  /** Seconds until the artillery button may be tried again. */
  callInTimer: number;

  // --- Kaiju bot ---------------------------------------------------------------------------
  goal: KaijuBotGoal;
  /** Structure id, prop id or unit id of the goal, or -1. */
  goalId: number;
  /** Score of the goal when it was chosen (for hysteresis). */
  goalScore: number;
  /** Lasers on it as of the last look: how many, their highest charge, and the heading they come from on average. */
  lasers: number;
  laserCharge: number;
  laserYaw: number;
  /** A gun in range can see it (as of the last look). */
  exposed: boolean;
  /** Which way round an obstacle it is going (1, -1, or 0 when the way is open), and for how long it remembers. */
  side: number;
  sideTime: number;
  /** A structure it gave up on (it could not get at it), and for how long it stays away. */
  avoidId: number;
  avoidTime: number;
  /** Seconds it has been looking for a place to molt. */
  hideFor: number;
  /** Seconds of going after squads left (after a stagger). */
  revenge: number;
  /** Seconds it has been dashing at charging guns, and seconds until it will let itself be drawn again. */
  rushTime: number;
  rushRest: number;
  /** Whether it was staggered on the last tick (to notice the end of one). */
  wasStaggered: boolean;
  /** Seconds it has been bracing, and seconds until it will brace again. */
  bracing: number;
  braceRest: number;
  /** Seconds until it throws again. */
  throwTimer: number;
  /** Where the beam is being walked to. */
  beamX: number;
  beamY: number;
  beamZ: number;
  /** Swimming away (sim/swim.ts): seconds left of it, seconds until it may again, and where in the water it is heading. */
  swimFor: number;
  swimRest: number;
  swimX: number;
  swimZ: number;
}

export function createBotState(): BotState {
  return {
    stage: 0,
    thinkTimer: 0,
    hesitateTimer: 0,
    hesitating: false,
    hold: new Array<number>(BUTTON_COUNT).fill(0),
    rest: new Array<number>(BUTTON_COUNT).fill(0),
    goalX: 0,
    goalZ: 0,
    markX: 0,
    markZ: 0,
    stuck: 0,
    goalBest: Infinity,
    goalStall: 0,

    mode: 'approach',
    bearing: 0,
    lastX: 0,
    lastZ: 0,
    lastChecked: false,
    parked: false,
    blind: 0,
    waited: 0,
    wheel: [],
    wheelTimer: 0,
    los: false,
    aimHeight: -1,
    callInTimer: 0,

    goal: 'none',
    goalId: -1,
    goalScore: 0,
    lasers: 0,
    laserCharge: 0,
    laserYaw: 0,
    exposed: false,
    side: 0,
    sideTime: 0,
    avoidId: -1,
    avoidTime: 0,
    hideFor: 0,
    revenge: 0,
    rushTime: 0,
    rushRest: 0,
    wasStaggered: false,
    bracing: 0,
    braceRest: 0,
    throwTimer: 0,
    beamX: 0,
    beamY: 0,
    beamZ: 0,
    swimFor: 0,
    swimRest: 0,
    swimX: 0,
    swimZ: 0,
  };
}
