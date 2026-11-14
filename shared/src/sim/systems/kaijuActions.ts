/**
 * System 2 of 12: kaiju actions. The action state machine of every kaiju (DESIGN.md section 4).
 *
 * Every verb runs through the same three timed phases taken from its definition: wind-up (the
 * tell), the effect (instant, or an active phase that lasts), recovery. A `kaijuAction` event
 * goes out at every phase change, the first one at the START of the wind-up so clients can show
 * the tell. Nothing can be cancelled once it has begun: only a stagger (the damage system),
 * the city giving way (never alone) or death cuts an action short, and a second press of the
 * charge's button ends its run early (into its stumble).
 *
 *   idle -> windup -> [effect] -> active phase ('active' | 'eat' | 'roar' | 'special' | 'charge') -> recover ('recover' | 'stumble') -> idle
 *   idle -> brace (while the brace's move button is down) -> idle
 *   idle -> cocoon (Molt pressed when a molt is available); the match flow system ends the cocoon
 *
 * Reading the buttons, one move per button (the full contract is the header of net/input.ts):
 * - Strike: Swipe; with something in the hand, Throw; with a fast-food sign in the hand, the
 *   Club (a big swing; sim/cityWeapons.ts `strikeVerb`).
 * - Grab: with something edible in the hand, Eat it; with a city weapon in the hand (never
 *   edible), drop it there and then (it lies loose on the ground); else Grab when something can
 *   be picked up in reach, else Eat when something edible is in reach (and the meal is off
 *   cooldown), else a Grab that closes on nothing.
 * - Stomp: Stomp.
 * - Move 1 and Move 2: the moves picked at the molts (`kaiju.moves`): the beam (the special:
 *   rage must cover its cost), roar, charge, tail sweep (each off cooldown), brace (for as long
 *   as the button is down; bracing is exclusive). An empty slot does nothing.
 * - Molt: one press while `moltAvailable` starts the cocoon, and the molt cards are offered
 *   (sim/moltCards.ts). A card pick (`input.card`) is taken in every phase, the intermission
 *   included, while an offer stands.
 * - A press made while another action runs is remembered for INPUT_BUFFER_TICKS, and for as
 *   long as the button stays down.
 * - Swimming (sim/swim.ts): nothing starts while the kaiju is in the water going down, under or
 *   coming up. A press made then brings it up and is acted on as soon as it is up.
 * When several are wanted on the same tick the order is: molt, brace, move 1, move 2, stomp,
 * strike, grab.
 *
 * The charge: the wind-up roots it (it can still turn), the run ('charge') drives it straight
 * ahead (the movement system, `kaijuMoveInput`) for up to `timing.active`, and it ends in a
 * stumble ('stumble', the recovery) when the time is up, when a wall it cannot smash or the
 * bounds stop it (the movement system sets `act.chargeBlocked`), or when its button is pressed
 * again. Its cooldown counts from the end of the stumble.
 *
 * Never alone (DESIGN.md section 2): once the city has given way (`kaiju.forceMolt`, set by the
 * match flow system), the cocoon starts by itself as soon as the kaiju is up out of the water
 * and not staggered, cutting short whatever it was doing.
 *
 * Phase 2: a power surge (`kaiju.surge`, sim/systems/specials.ts) makes every cooldown recover
 * `rewards.surge.cooldownRate` times as fast while it lasts, and this system counts it down. A
 * propane tank going off in the hand makes the kaiju flinch (phase 'flinch', action 'none',
 * sim/cityWeapons.ts): rooted, nothing starts, back to idle when its time is up. Loose city
 * weapons are looked after here too (`updateLoose`: a fallen mast's top coming to rest, feet and
 * tracks crushing them at the later stages).
 *
 * Effects (who gets hit) live in sim/kaijuEffects.ts. Timings: a phase of d seconds ends on the
 * first tick at which d has fully passed (0.45 s is 14 ticks at 30 Hz).
 *
 * Stagger, cocoon and dead are phases too, entered from outside (damage, this system's molt,
 * death). This system only counts their timers and never starts an action during them: the
 * damage system ends a stagger; the match flow system takes a cocoon whose `phaseTime` has
 * reached `phaseDuration` on to the blast wave and the next stage.
 */

import type { KaijuKindDef } from '../../defs/schema';
import type { KaijuPhase, KaijuVerb } from '../../defs/ids';
import { KAIJU_ACTION_IDS } from '../../defs/ids';
import { kaijuKindDef, kaijuMoveVerb } from '../../defs/kaiju/index';
import { DT } from '../../defs/rules';
import { LAST_STAGE } from '../../defs/stages';
import { modMult } from '../../defs/upgrades';
import { PI, wrapAngle } from '../../math/angle';
import { Btn, BtnIndex, INPUT_BUFFER_TICKS, type ButtonName } from '../../net/input';
import { dropToGround, heldCityWeapon, heldEdible, strikeVerb, updateLoose } from '../cityWeapons';
import {
  beamTick,
  chargeTick,
  clubEffect,
  dropHeld,
  eatFinish,
  eatStart,
  findEdible,
  findGrabTarget,
  grabEffect,
  roarEffect,
  stompEffect,
  swipeEffect,
  tailSweepEffect,
  throwEffect,
} from '../kaijuEffects';
import { offerCards, pickCard } from '../moltCards';
import { updateSwim } from '../swim';
import type { InputState, Kaiju, World } from '../types';
import { emit } from '../worldOps';

/** Slack for comparing accumulated tick time against a duration. */
const TIME_EPS = 1e-6;

const VERBS: readonly KaijuVerb[] = KAIJU_ACTION_IDS.filter((id): id is KaijuVerb => id !== 'none');

/** The two move buttons, by slot. */
const MOVE_BUTTONS: readonly ['move1', 'move2'] = ['move1', 'move2'];

function isDown(input: InputState, button: ButtonName): boolean {
  return (input.buttons & Btn[button]) !== 0;
}

/**
 * A press of this button is waiting to be used: not yet spent, and either made within the
 * buffer or still held down (holding a button through another action means "as soon as I can").
 */
function freshPress(k: Kaiju, input: InputState, button: ButtonName): boolean {
  const bit = Btn[button];
  if ((k.act.usedPress & bit) !== 0) return false;
  if ((k.act.swimPress & bit) !== 0) return true;
  return input.sincePressTicks[BtnIndex[button]] <= INPUT_BUFFER_TICKS || isDown(input, button);
}

function announce(world: World, k: Kaiju, action: KaijuVerb, phase: KaijuPhase, duration: number): void {
  emit(world, {
    type: 'kaijuAction',
    kaiju: k.id,
    action,
    phase,
    duration,
    x: k.x,
    z: k.z,
    yaw: k.actionYaw,
  });
}

function setPhase(k: Kaiju, phase: KaijuPhase, duration: number): void {
  k.phase = phase;
  k.phaseTime = 0;
  k.phaseDuration = duration;
}

function enterIdle(world: World, k: Kaiju, ended: KaijuVerb): void {
  setPhase(k, 'idle', 0);
  k.action = 'none';
  k.actionTime = 0;
  k.act.actionButton = 0;
  announce(world, k, ended, 'idle', 0);
}

function enterRecover(world: World, k: Kaiju, def: KaijuKindDef, verb: KaijuVerb): void {
  const action = def.actions[verb];
  const recover = action.timing.recover;
  if (recover > 0) {
    const phase = action.recoverPhase ?? 'recover';
    setPhase(k, phase, recover);
    announce(world, k, verb, phase, recover);
  } else {
    endAction(world, k, def, verb);
  }
}

/** The action is over: back to idle. The charge's cooldown counts from here. */
function endAction(world: World, k: Kaiju, def: KaijuKindDef, verb: KaijuVerb): void {
  if (verb === 'charge') k.cooldowns.charge = def.actions.charge.cooldown * modMult(k.mods, 'actionCooldown');
  enterIdle(world, k, verb);
}

/** The wind-up is over: the effect goes off, and the active phase begins if the verb has one. */
function enterActive(world: World, k: Kaiju, def: KaijuKindDef, verb: KaijuVerb): void {
  const action = def.actions[verb];
  // The effect is aimed where the head points at this moment; the tail sweeps behind the body.
  k.actionYaw = verb === 'tailSweep' ? wrapAngle(k.yaw + PI) : k.aimYaw;
  setPhase(k, action.activePhase, action.timing.active);
  announce(world, k, verb, action.activePhase, action.timing.active);

  switch (verb) {
    case 'swipe':
      swipeEffect(world, k, def);
      break;
    case 'stomp':
      stompEffect(world, k, def);
      break;
    case 'grab':
      grabEffect(world, k, def);
      break;
    case 'throw':
      throwEffect(world, k, def);
      break;
    case 'eat':
      k.act.meal = eatStart(world, k, def);
      break;
    case 'roar':
      roarEffect(world, k, def);
      break;
    case 'tailSweep':
      tailSweepEffect(world, k, def);
      break;
    case 'club':
      clubEffect(world, k, def);
      break;
    case 'charge':
      // The run begins: nobody has been run into yet.
      k.act.chargeHits.length = 0;
      k.act.chargeBlocked = false;
      break;
    default:
      // brace and molt never come through here; a special's effect runs every tick of its active phase.
      break;
  }
  if (!(action.timing.active > 0)) enterRecover(world, k, def, verb);
}

/** The active phase has run its time (or the charge was stopped): effects that land at the end, then recovery. */
function leaveActive(world: World, k: Kaiju, def: KaijuKindDef, verb: KaijuVerb): void {
  if (verb === 'eat') {
    if (k.act.meal) eatFinish(k, def);
    k.act.meal = false;
  } else if (verb === 'special') {
    k.act.beamLength = 0;
    k.act.beamBlocker = -1;
  } else if (verb === 'charge') {
    k.act.chargeBlocked = false;
  }
  enterRecover(world, k, def, verb);
}

/** Starts a verb: cooldown, rage cost, the tell. `button` is the button whose press started it. */
function startAction(world: World, k: Kaiju, def: KaijuKindDef, verb: KaijuVerb, button: ButtonName): void {
  const action = def.actions[verb];
  k.action = verb;
  k.actionTime = 0;
  k.actionYaw = k.aimYaw;
  // The charge's cooldown counts from the end of its stumble: until then it reads as all of it.
  const t = action.timing;
  const busy = verb === 'charge' ? t.windup + t.active + t.recover : 0;
  k.cooldowns[verb] = (busy + action.cooldown) * modMult(k.mods, 'actionCooldown');
  if (action.rageCost > 0) k.rage = Math.max(0, k.rage - action.rageCost);
  k.act.usedPress |= Btn[button];
  k.act.swimPress = 0;
  k.act.actionButton = Btn[button];
  if (action.timing.windup > 0) {
    setPhase(k, 'windup', action.timing.windup);
    announce(world, k, verb, 'windup', action.timing.windup);
  } else {
    enterActive(world, k, def, verb);
  }
}

function startBrace(world: World, k: Kaiju, button: ButtonName): void {
  k.action = 'brace';
  k.actionTime = 0;
  k.actionYaw = k.aimYaw;
  k.act.actionButton = Btn[button];
  k.act.usedPress |= Btn[button];
  setPhase(k, 'brace', 0);
  announce(world, k, 'brace', 'brace', 0);
}

/** Whatever the kaiju was doing is cut short, the way a stagger does it (no closing `kaijuAction`). */
function cutAction(k: Kaiju): void {
  k.act.meal = false;
  k.act.beamLength = 0;
  k.act.beamBlocker = -1;
  k.act.chargeBlocked = false;
  k.act.actionButton = 0;
}

/**
 * The molt: the kaiju seals itself in and the molt cards are offered. From here on it is
 * helpless until the match flow system lets it out.
 */
function startCocoon(world: World, k: Kaiju): void {
  cutAction(k);
  dropHeld(world, k);
  const duration = world.config.tuning.cocoon;
  k.moltAvailable = false;
  k.forceMolt = false;
  k.action = 'molt';
  k.actionTime = 0;
  k.actionYaw = k.yaw;
  k.vx = 0;
  k.vz = 0;
  k.act.usedPress |= Btn.molt;
  // Presses kept from the water (never alone brings it up with one) are spent.
  k.act.swimPress = 0;
  setPhase(k, 'cocoon', duration);
  announce(world, k, 'molt', 'cocoon', duration);
  emit(world, { type: 'cocoon', kaiju: k.id, x: k.x, z: k.z, duration });
  offerCards(world, k);
}

/** Advances the action that is running. */
function advance(world: World, k: Kaiju, def: KaijuKindDef, input: InputState): void {
  const verb = k.action;
  if (verb === 'none') {
    // Cannot happen (a phase without a verb); recover rather than freeze the kaiju.
    setPhase(k, 'idle', 0);
    return;
  }
  const done = k.phaseTime >= k.phaseDuration - TIME_EPS;

  switch (k.phase) {
    case 'windup':
      if (done) enterActive(world, k, def, verb);
      break;
    case 'brace':
      if ((input.buttons & k.act.actionButton) === 0) enterIdle(world, k, verb);
      break;
    case 'recover':
    case 'stumble':
      if (done) endAction(world, k, def, verb);
      break;
    case 'charge': {
      // A second press of its button ends the run early; so does a wall, or the time.
      const again = (input.pressed & k.act.actionButton) !== 0;
      if (again) k.act.usedPress |= k.act.actionButton;
      if (done || again || k.act.chargeBlocked) leaveActive(world, k, def, verb);
      else chargeTick(world, k, def.actions.charge);
      break;
    }
    default:
      // An active phase. The beam burns on every tick of it.
      if (verb === 'special' && def.actions.special.special === 'beam') beamTick(world, k, def.actions.special);
      if (done) leaveActive(world, k, def, verb);
      break;
  }
}

/** Whether a move picked at a molt can start now: off cooldown, and (the special) rage enough for it. */
function moveReady(k: Kaiju, def: KaijuKindDef, verb: KaijuVerb): boolean {
  if (k.cooldowns[verb] > 0) return false;
  const cost = def.actions[verb].rageCost;
  return !(cost > 0) || k.rage >= cost - TIME_EPS;
}

/** Reads the buttons of an idle kaiju and starts at most one action. */
function startFromInput(world: World, k: Kaiju, def: KaijuKindDef, input: InputState): void {
  if (k.moltAvailable && world.match.stage < LAST_STAGE && freshPress(k, input, 'molt')) {
    startCocoon(world, k);
    return;
  }
  // The moves in the slots. The brace lasts while its button is down and is exclusive.
  for (let slot = 0; slot < MOVE_BUTTONS.length; slot++) {
    if (kaijuMoveVerb(k.moves[slot]) === 'brace' && isDown(input, MOVE_BUTTONS[slot])) {
      startBrace(world, k, MOVE_BUTTONS[slot]);
      return;
    }
  }
  for (let slot = 0; slot < MOVE_BUTTONS.length; slot++) {
    const verb = kaijuMoveVerb(k.moves[slot]);
    if (verb === 'none' || verb === 'brace') continue;
    if (freshPress(k, input, MOVE_BUTTONS[slot]) && moveReady(k, def, verb)) {
      startAction(world, k, def, verb, MOVE_BUTTONS[slot]);
      return;
    }
  }
  if (freshPress(k, input, 'stomp')) {
    startAction(world, k, def, 'stomp', 'stomp');
    return;
  }
  if (freshPress(k, input, 'strike')) {
    // With something in the hand, Strike throws it; a fast-food sign is swung as a club.
    startAction(world, k, def, strikeVerb(k.held), 'strike');
    return;
  }
  if (freshPress(k, input, 'grab')) {
    if (k.held && heldCityWeapon(k.held) !== null && !heldEdible(k.held)) {
      // A city weapon is never eaten: Grab lets go of it, and it lies on the ground.
      k.act.usedPress |= Btn.grab;
      dropToGround(world, k);
      return;
    }
    if (k.held) {
      // With something in the hand, Grab eats it (when the last meal is far enough behind).
      if (k.cooldowns.eat <= 0) startAction(world, k, def, 'eat', 'grab');
      return;
    }
    // Something to pick up wins; with nothing, something to eat off the ground; with neither the hand closes on nothing.
    const eatInstead = !findGrabTarget(world, k, def) && k.cooldowns.eat <= 0 && findEdible(world, k, def) !== null;
    startAction(world, k, def, eatInstead ? 'eat' : 'grab', 'grab');
  }
}

function updateKaiju(world: World, k: Kaiju): void {
  const def = kaijuKindDef(k.kind);
  const input = world.players[k.player].input;
  const mem = k.act;

  // A power surge: cooldowns recover faster while it lasts.
  const recover = k.surge > 0 ? DT * def.rewards.surge.cooldownRate : DT;
  if (k.surge > 0) k.surge = k.surge - DT > TIME_EPS ? k.surge - DT : 0;
  for (const verb of VERBS) {
    if (k.cooldowns[verb] > 0) {
      // Snap to 0 so that rounding never costs an extra tick of waiting.
      const left = k.cooldowns[verb] - recover;
      k.cooldowns[verb] = left > TIME_EPS ? left : 0;
    }
  }
  k.phaseTime += DT;
  if (k.phase !== 'idle') k.actionTime += DT;

  // Never alone: it comes up out of the water first (a kept press of Molt brings it up).
  if (k.forceMolt && k.submerge > 0) mem.swimPress |= Btn.molt;
  // Going under or coming up (it comes up for anything but standing idle in deep water).
  updateSwim(world.cityQuery, k, input);

  if (k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead') return;

  // Never alone: the city has given way and the cocoon starts by itself, whatever it was doing.
  if (k.forceMolt && k.submerge <= 0 && world.match.stage < LAST_STAGE) {
    startCocoon(world, k);
    return;
  }

  // A flinch (a propane tank went off in the hand): rooted until its time is up, then idle.
  if (k.phase === 'flinch') {
    if (k.phaseTime < k.phaseDuration - TIME_EPS) return;
    setPhase(k, 'idle', 0);
    k.action = 'none';
    k.actionTime = 0;
  }

  if (k.phase !== 'idle') advance(world, k, def, input);
  // In the water nothing starts until it is all the way up; then the presses it kept get one go.
  if (k.phase === 'idle' && k.submerge <= 0) {
    startFromInput(world, k, def, input);
    k.act.swimPress = 0;
  }
}

export function kaijuActionSystem(world: World): void {
  const playing = world.match.phase === 'playing';
  if (playing) updateLoose(world);
  for (const k of world.kaijus) {
    const input = world.players[k.player].input;
    // A new press of a button makes it count again. Tracked in every phase, so a press made
    // during an intermission is not mistaken for one that was already used.
    k.act.usedPress &= ~input.pressed;
    // A molt card counts from the start of the cocoon to the end of the intermission.
    if (input.card > 0 && k.offer.length > 0 && k.alive) pickCard(world, k, input.card - 1);
    if (playing && k.alive) updateKaiju(world, k);
  }
}
