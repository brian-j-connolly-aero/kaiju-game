/**
 * System 2 of 11: kaiju actions. The action state machine of every kaiju (DESIGN.md section 4).
 *
 * Every verb runs through the same three timed phases taken from its definition: wind-up (the
 * tell), the effect (instant, or an active phase that lasts), recovery. A `kaijuAction` event
 * goes out at every phase change, the first one at the START of the wind-up so clients can show
 * the tell. Nothing can be cancelled once it has begun: only a stagger (the damage system) or
 * death cuts an action short.
 *
 *   idle -> windup -> [effect] -> active phase ('active' | 'eat' | 'roar' | 'special') -> recover -> idle
 *   idle -> brace (while Block is down) -> idle
 *   idle -> cocoon (Molt held, when a molt is available); the match flow system ends the cocoon
 *
 * Reading the buttons (the full contract is the header of net/input.ts):
 * - Strike: the press starts a Swipe wind-up. If the button is still down `stomp.holdTime`
 *   after the action began, the Swipe becomes a Stomp and keeps the time already spent. With
 *   something in the hand, Strike throws it.
 * - Grab, empty hand: the press starts a Grab. Grab, something in the hand: letting go before
 *   `eat.holdTime` throws it. Either way, a hold of `eat.holdTime` goes on to Eat (what is in the
 *   hand, else an edible in reach) once the kaiju is free; each hold is judged once.
 * - Block: Brace for as long as it is down. Bracing is exclusive: release it to act.
 * - Roar, Special: on the press, when off cooldown and (Special) rage covers the cost.
 * - Molt: held for `molt.holdTime` while `moltAvailable`.
 * - A press made while another action runs is remembered for INPUT_BUFFER_TICKS, and for as
 *   long as the button stays down.
 * - Swimming (sim/swim.ts): nothing starts while the kaiju is in the water going down, under or
 *   coming up. A press made then brings it up and is acted on as soon as it is up.
 * When several are wanted on the same tick the order is: molt, brace, special, roar, strike,
 * throw, grab, eat.
 *
 * Effects (who gets hit) live in sim/kaijuEffects.ts. Timings: a phase of d seconds ends on the
 * first tick at which d has fully passed (0.45 s is 14 ticks at 30 Hz).
 *
 * Stagger, cocoon and dead are phases too, entered from outside (damage, this system's molt,
 * death). This system only counts their timers and never starts an action during them: the
 * damage system ends a stagger; the match flow system takes a cocoon whose `phaseTime` has
 * reached `phaseDuration` on to the blast wave and the next stage.
 */

import type { KaijuButton, KaijuKindDef } from '../../defs/schema';
import type { KaijuPhase, KaijuVerb } from '../../defs/ids';
import { KAIJU_ACTION_IDS } from '../../defs/ids';
import { kaijuKindDef } from '../../defs/kaiju/index';
import { DT } from '../../defs/rules';
import { LAST_STAGE } from '../../defs/stages';
import { modMult } from '../../defs/upgrades';
import { Btn, BtnIndex, INPUT_BUFFER_TICKS } from '../../net/input';
import {
  beamTick,
  canEat,
  dropHeld,
  eatFinish,
  eatStart,
  grabEffect,
  roarEffect,
  stompEffect,
  swipeEffect,
  throwEffect,
} from '../kaijuEffects';
import { updateSwim } from '../swim';
import type { InputState, Kaiju, World } from '../types';
import { emit } from '../worldOps';

/** Slack for comparing accumulated tick time against a duration. */
const TIME_EPS = 1e-6;

const VERBS: readonly KaijuVerb[] = KAIJU_ACTION_IDS.filter((id): id is KaijuVerb => id !== 'none');

/** Seconds a button has been down since its press (0 on the press tick and while it is up). */
function heldSeconds(input: InputState, button: KaijuButton): number {
  const ticks = input.heldTicks[BtnIndex[button]];
  return ticks > 0 ? (ticks - 1) * DT : 0;
}

function isDown(input: InputState, button: KaijuButton): boolean {
  return (input.buttons & Btn[button]) !== 0;
}

/**
 * A press of this button is waiting to be used: not yet spent, and either made within the
 * buffer or still held down (holding a button through another action means "as soon as I can").
 */
function freshPress(k: Kaiju, input: InputState, button: KaijuButton): boolean {
  if ((k.act.usedPress & Btn[button]) !== 0) return false;
  if ((k.act.swimPress & Btn[button]) !== 0) return true;
  return input.sincePressTicks[BtnIndex[button]] <= INPUT_BUFFER_TICKS || isDown(input, button);
}

function announce(world: World, k: Kaiju, action: KaijuVerb, phase: KaijuPhase, duration: number, elapsed = 0): void {
  emit(world, {
    type: 'kaijuAction',
    kaiju: k.id,
    action,
    phase,
    duration,
    ...(elapsed > 0 ? { elapsed } : {}),
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
  k.act.holdLive = false;
  announce(world, k, ended, 'idle', 0);
}

function enterRecover(world: World, k: Kaiju, def: KaijuKindDef, verb: KaijuVerb): void {
  const recover = def.actions[verb].timing.recover;
  if (recover > 0) {
    setPhase(k, 'recover', recover);
    announce(world, k, verb, 'recover', recover);
  } else {
    enterIdle(world, k, verb);
  }
}

/** The wind-up is over: the effect goes off, and the active phase begins if the verb has one. */
function enterActive(world: World, k: Kaiju, def: KaijuKindDef, verb: KaijuVerb): void {
  const action = def.actions[verb];
  // The effect is aimed where the head points at this moment.
  k.actionYaw = k.aimYaw;
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
    default:
      // brace and molt never come through here; a special's effect runs every tick of its active phase.
      break;
  }
  if (!(action.timing.active > 0)) enterRecover(world, k, def, verb);
}

/** The active phase has run its time: effects that land at the end, then recovery. */
function leaveActive(world: World, k: Kaiju, def: KaijuKindDef, verb: KaijuVerb): void {
  if (verb === 'eat') {
    if (k.act.meal) eatFinish(k, def);
    k.act.meal = false;
  } else if (verb === 'special') {
    k.act.beamLength = 0;
    k.act.beamBlocker = -1;
  }
  enterRecover(world, k, def, verb);
}

/** Starts a verb: cooldown, rage cost, the tell. `button` is the button whose press started it. */
function startAction(world: World, k: Kaiju, def: KaijuKindDef, input: InputState, verb: KaijuVerb, button: KaijuButton): void {
  const action = def.actions[verb];
  k.action = verb;
  k.actionTime = 0;
  k.actionYaw = k.aimYaw;
  k.cooldowns[verb] = action.cooldown * modMult(k.mods, 'actionCooldown');
  if (action.rageCost > 0) k.rage = Math.max(0, k.rage - action.rageCost);
  k.act.usedPress |= Btn[button];
  k.act.swimPress = 0;
  k.act.holdLive = isDown(input, button);
  k.act.throwBuffer = 0;
  if (action.timing.windup > 0) {
    setPhase(k, 'windup', action.timing.windup);
    announce(world, k, verb, 'windup', action.timing.windup);
  } else {
    enterActive(world, k, def, verb);
  }
}

function startBrace(world: World, k: Kaiju): void {
  k.action = 'brace';
  k.actionTime = 0;
  k.actionYaw = k.aimYaw;
  k.act.holdLive = false;
  setPhase(k, 'brace', 0);
  announce(world, k, 'brace', 'brace', 0);
}

/** The molt: the kaiju seals itself in. From here on it is helpless until the match flow system lets it out. */
function startCocoon(world: World, k: Kaiju): void {
  dropHeld(world, k);
  const duration = world.config.tuning.cocoon;
  k.moltAvailable = false;
  k.action = 'molt';
  k.actionTime = 0;
  k.actionYaw = k.yaw;
  k.vx = 0;
  k.vz = 0;
  k.act.holdLive = false;
  k.act.throwBuffer = 0;
  setPhase(k, 'cocoon', duration);
  announce(world, k, 'molt', 'cocoon', duration);
  emit(world, { type: 'cocoon', kaiju: k.id, x: k.x, z: k.z, duration });
}

/** Advances the action that is running. */
function advance(world: World, k: Kaiju, def: KaijuKindDef, input: InputState): void {
  const verb = k.action;
  if (verb === 'none') {
    // Cannot happen (a phase without a verb); recover rather than freeze the kaiju.
    setPhase(k, 'idle', 0);
    return;
  }
  const action = def.actions[verb];
  if (k.act.holdLive && !isDown(input, action.button)) k.act.holdLive = false;
  const done = k.phaseTime >= k.phaseDuration - TIME_EPS;

  switch (k.phase) {
    case 'windup': {
      const stomp = def.actions.stomp;
      if (verb === 'swipe' && k.act.holdLive && k.actionTime >= stomp.holdTime - TIME_EPS) {
        // Still holding Strike: the swipe becomes a stomp and keeps the time already spent.
        k.action = 'stomp';
        k.phaseDuration = stomp.timing.windup;
        k.cooldowns.stomp = stomp.cooldown * modMult(k.mods, 'actionCooldown');
        k.act.holdLive = false;
        announce(world, k, 'stomp', 'windup', stomp.timing.windup, k.phaseTime);
        if (k.phaseTime >= k.phaseDuration - TIME_EPS) enterActive(world, k, def, 'stomp');
      } else if (done) {
        enterActive(world, k, def, verb);
      }
      break;
    }
    case 'brace':
      if (!isDown(input, action.button)) enterIdle(world, k, verb);
      break;
    case 'recover':
      if (done) enterIdle(world, k, verb);
      break;
    default:
      // An active phase. The beam burns on every tick of it.
      if (verb === 'special' && def.actions.special.special === 'beam') beamTick(world, k, def.actions.special);
      if (done) leaveActive(world, k, def, verb);
      break;
  }
}

/** Reads the buttons of an idle kaiju and starts at most one action. */
function startFromInput(world: World, k: Kaiju, def: KaijuKindDef, input: InputState): void {
  const a = def.actions;
  const mem = k.act;

  if (k.moltAvailable && world.match.stage < LAST_STAGE && heldSeconds(input, a.molt.button) >= a.molt.holdTime - TIME_EPS) {
    startCocoon(world, k);
    return;
  }
  if (isDown(input, a.brace.button)) {
    startBrace(world, k);
    return;
  }
  if (freshPress(k, input, a.special.button) && k.cooldowns.special <= 0 && k.rage >= a.special.rageCost - TIME_EPS) {
    startAction(world, k, def, input, 'special', a.special.button);
    return;
  }
  if (freshPress(k, input, a.roar.button) && k.cooldowns.roar <= 0) {
    startAction(world, k, def, input, 'roar', a.roar.button);
    return;
  }
  if (freshPress(k, input, a.swipe.button)) {
    // With something in the hand, Strike throws it.
    startAction(world, k, def, input, k.held ? 'throw' : 'swipe', a.swipe.button);
    return;
  }
  if (mem.throwBuffer > 0 && k.held) {
    startAction(world, k, def, input, 'throw', a.throw.button);
    return;
  }
  // Empty hands reach first; the hold that follows a grab is judged once the grab is over.
  if (!k.held && freshPress(k, input, a.grab.button)) {
    startAction(world, k, def, input, 'grab', a.grab.button);
    return;
  }
  const grabBit = Btn[a.eat.button];
  if ((mem.usedHold & grabBit) === 0 && heldSeconds(input, a.eat.button) >= a.eat.holdTime - TIME_EPS) {
    // A hold is judged once. Whatever comes of it, letting go afterwards does not throw.
    mem.usedHold |= grabBit;
    mem.usedPress |= grabBit;
    if (k.cooldowns.eat <= 0 && canEat(world, k, def)) startAction(world, k, def, input, 'eat', a.eat.button);
  }
}

function updateKaiju(world: World, k: Kaiju): void {
  const def = kaijuKindDef(k.kind);
  const input = world.players[k.player].input;
  const mem = k.act;

  if (mem.throwBuffer > 0) mem.throwBuffer--;

  for (const verb of VERBS) {
    if (k.cooldowns[verb] > 0) {
      // Snap to 0 so that rounding never costs an extra tick of waiting.
      const left = k.cooldowns[verb] - DT;
      k.cooldowns[verb] = left > TIME_EPS ? left : 0;
    }
  }
  k.phaseTime += DT;
  if (k.phase !== 'idle') k.actionTime += DT;

  // Going under or coming up (it comes up for anything but standing idle in deep water).
  updateSwim(world.cityQuery, k, input);

  if (k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead') return;

  // A Grab tap with something in the hand (a press that did not start a grab, let go before the
  // eat hold) is a throw; remember it briefly if the kaiju is busy.
  const throwBit = Btn[def.actions.throw.button];
  if ((input.released & throwBit) !== 0 && k.held && (mem.usedPress & throwBit) === 0) {
    const held = Math.max(0, input.lastHeldTicks[BtnIndex[def.actions.throw.button]] - 1) * DT;
    if (held < def.actions.eat.holdTime - TIME_EPS) {
      mem.throwBuffer = INPUT_BUFFER_TICKS;
      mem.usedPress |= throwBit;
    }
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
  for (const k of world.kaijus) {
    // A new press of a button makes it count again. Tracked in every phase, so a press made
    // during an intermission is not mistaken for one that was already used.
    const pressed = world.players[k.player].input.pressed;
    k.act.usedPress &= ~pressed;
    k.act.usedHold &= ~pressed;
    if (playing && k.alive) updateKaiju(world, k);
  }
}
