/**
 * How the bots play (DESIGN.md section 5, "Bots"). The behavior itself is in sim/bots/; these
 * are its numbers, kept here with the rest of the tunable data so the balance harness can be
 * steered without touching logic. Bots are deliberately beatable: they react late, they do not
 * plan ahead, and a person who coordinates will outplay them.
 *
 * Distances given "in radii" are multiples of the kaiju's body radius at its current stage;
 * distances "of range" are fractions of the squad's weapon range.
 */

import { DEG } from '../math/angle';
import type { PerStage } from './ids';

export const BOT_RULES = {
  /** Handicap: a bot decides every this many seconds whether to hesitate (stand idle) until the next roll. */
  hesitateWindow: 2,

  squad: {
    /** Seconds between two looks at the situation (each squad is offset so they do not all think on one tick). */
    think: 0.4,
    /** The firing position: this far from the kaiju, of range. The squad parks anywhere inside the band. */
    standoff: 0.7,
    standoffMin: 0.5,
    standoffMax: 0.9,
    /** With the kaiju staggered or cocooned the squad closes in to this band instead. */
    closeInStandoff: 0.45,
    closeInMin: 0.25,
    /** It backs off when the kaiju comes closer than this, of range, or than this many radii plus a margin. */
    retreatAt: 0.3,
    retreatRadii: 5,
    retreatMargin: 12,
    /** ...and feels safe again beyond this, of range. */
    safeAt: 0.45,
    /** Squads keep at least this bearing apart around the kaiju, so their fire crosses. */
    bearingSpread: 70 * DEG,
    /** A parked squad has a line of fire when its leader and this share of its planted sub-units have one. */
    clearLines: 0.6,
    /** A parked squad waits this long with no line of fire before it moves on. */
    losPatience: 4,
    /** A parked squad stays put until the kaiju is beyond this, of range. */
    leaveAt: 0.97,
    /** It fires the volley at this charge; with the kaiju helpless it fires as soon as it can. */
    volleyCharge: 1,
    /** A ready squad waits up to this long for another squad that is nearly charged, so volleys land together. */
    syncWait: 2.5,
    syncCharge: 0.55,
    /** It plants the squad afresh when this share of its planted sub-units no longer cover the kaiju. */
    replantUncovered: 0.5,
    /** Seconds between two wheel commands (a person's fingers are not faster). */
    commandGap: 0.35,
    /** The kaiju counts as standing still (aim straight at it) below this fraction of its top speed. */
    stillSpeed: 0.25,
    /** Stage 1, kaiju not on the map: the squad searches; it has reached a search point within this many meters. */
    searchReach: 25,
    /** Artillery: called when ready and the kaiju is within this, of range (it reaches the whole city); the marker leads it by this many seconds. */
    callInRange: 4,
    callInLead: 3.5,
    /** Candidate firing positions examined for a line of fire per look. */
    spotCandidates: 8,
    /**
     * Marking (sim/abilities.ts): the leader marks the kaiju when it has it in sight and nobody
     * has marked it, and its squad is charged at least this much or the kaiju is off the map
     * (the mark keeps it there).
     */
    markCharge: 0.5,
    /**
     * Smoke: thrown between the squad and the kaiju when the kaiju comes within this, of range
     * (it covers the retreat), or when the squad is planted and the kaiju is dashing at it
     * within this, of range, with at least this share of the squad's guns charging.
     */
    smokeRetreatAt: 0.35,
    smokeRushAt: 0.55,
    smokeCharging: 0.5,
  },

  kaiju: {
    /** Seconds between two looks for something better to wreck. */
    think: 0.5,
    /** A new target must be this much better than the current one to be worth turning for. */
    switchGain: 1.35,
    /** Structures that would take longer than this to bring down are left alone (seconds, per stage). */
    maxKillTime: [8, 14, 16] as PerStage<number>,
    /** Something in the way is smashed rather than walked around when it takes no longer than this, seconds. */
    smashInWay: 5,
    /** Seconds of travel added to every target's cost, so that near things win over slightly richer far ones. */
    travelBias: 0.4,
    /** It stomps instead of swiping when a stomp is worth this much more per second. */
    stompBias: 1.15,
    /** A unit caught in a swipe or stomp counts like this many bar points. */
    unitWorth: 25,

    /** Units within this many radii (plus margin, meters) are fought before anything else. */
    meleeRadii: 5,
    meleeMargin: 8,
    /** After a stagger it goes for the nearest squad within this many radii for this long. */
    revengeRadii: 16,
    revengeTime: 10,
    /**
     * With at least this many lasers on it, it dashes at the nearest charging gun within this
     * many meters (per stage), for at most this long, and then goes back to work for this long.
     */
    rushLasers: 3,
    rushRange: [110, 280, 450] as PerStage<number>,
    rushMax: 7,
    rushRest: 7,
    /** A unit in smoke is hidden from it; it still finds one it bumps into, within this many radii. */
    smokeFeelRadii: 1.5,
    /** It roars when at least this many units stand inside the roar radius and are charging or it is hurt. */
    roarUnits: 2,
    /** It braces when at least this many lasers are on it with this much charge, for at most this long. */
    braceLasers: 4,
    braceCharge: 0.8,
    braceMax: 2.5,
    /** ...and then does not brace again for this long (so a patient squad cannot pin it forever). */
    braceRest: 6,
    /** It looks for food below this fraction of its health, within this many radii. */
    eatBelow: 0.7,
    foodRadii: 14,
    /** The beam: used on units inside this fraction of its range, else on a structure worth at least this many points. */
    beamUnitRange: 0.9,
    beamStructureValue: [12, 90, 300] as PerStage<number>,
    /** Throwing: at a unit within this fraction of the longest throw, at most once every so many seconds. */
    throwRange: 0.8,
    throwEvery: 7,

    /**
     * Swimming away (sim/swim.ts, at the stages it can swim): in trouble (its nerve this full,
     * or its health below this while guns can see it) with deep water within this many radii,
     * it slips into the water and swims away from the squads for at most this long, then not
     * again for this long (no stalling in the water: it earns nothing there). Under, it picks a
     * new stretch of water every so often, this many radii ahead at most. Tuned with the balance
     * harness: water any farther away costs it more, running to it with its back to the guns,
     * than the swim gives back.
     */
    swimNerve: 0.7,
    swimBelow: 0.4,
    swimSearchRadii: [10, 8, 0] as PerStage<number>,
    swimMax: 8,
    swimRest: 30,
    swimLegRadii: [20, 10, 0] as PerStage<number>,

    /** The molt: it looks for a place out of sight for at most this long, then cocoons where it stands. */
    hideTime: 16,
    /** Hiding places considered are within this many radii. */
    hideRadii: 40,
    /** Not making this many meters in this many seconds counts as stuck... */
    stuckDist: 1,
    stuckTime: 1.5,
    /** ...and so does walking this long without getting any closer to where it is going. */
    stallTime: 5,
    /** A structure it could not get at is left alone for this long. */
    avoidTime: 12,
  },
} as const;
