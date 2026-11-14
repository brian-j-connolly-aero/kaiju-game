/**
 * The autopilot behind `?autoplay=1`: it presses the same buttons a person would, through the
 * same ActionState, so an automated playtest exercises the real input, prediction and network
 * path on either side. It plays sensibly, not well:
 *
 *   kaiju   walks to the nearest standing building and swipes and stomps it down (one button
 *           each), grabs a car now and then and throws it at a unit, or eats it when hurt, molts
 *           with one press and picks one of the three cards at random. With the moves the cards
 *           gave it: roars when soldiers are near, beams them when the rage is full, charges a
 *           unit straight ahead, sweeps its tail at one behind, braces against charged volleys.
 *   human   drives along the streets to a firing position at its own bearing around the kaiju
 *           (a tank by throttle and hull turn, as a person drives it at stages 2 and 3), stops
 *           there and, with range and a clear line, holds Volley: the squad-mates plant and
 *           charge, and it lets go at full charge, waiting a moment for another squad that is
 *           nearly charged so the volleys land together (as the squad bots do: `volleyPlan`).
 *           Whenever it is not charging it fires its own gun; it shoots freely at a helpless
 *           kaiju or when it has nobody to charge with, lets go and backs off when the kaiju
 *           closes, and now and then opens the map and toggles the camera.
 *   drone   circles the kaiju.
 */

import {
  angleDiff,
  BOT_RULES,
  boundsContains,
  clamp,
  distToStructure,
  findRoadPath,
  kaijuKindDef,
  kaijuMoveSlot,
  kaijuStageDef,
  LAST_STAGE,
  lineOfSight,
  PROP_KINDS,
  propsInCircle,
  roadAdjacency,
  setTankMove,
  unitTypeDef,
  volleyMeter,
  weaponDef,
  type Bounds,
  type MoveInput,
  type KaijuVerb,
  type SnapKaiju,
  type SnapUnit,
} from '@mb/shared';
import type { FrameState, MatchSession } from '../net/matchSession';
import type { ActionState, ButtonAction } from './input/actions';

interface Target {
  x: number;
  z: number;
}

/**
 * What the autopilot's squad does with its two buttons while it has range and a clear line, by
 * the squad bot's rules (shared/src/sim/bots/squadBot.ts):
 *
 *   fire      no volley to charge (the kaiju is helpless, nobody is left to charge with, or the
 *             squad is on the move): the leader shoots as its gun loads
 *   charge    hold Volley: the squad-mates plant and charge
 *   wait      hold Volley at full charge while another planted squad is nearly charged, for at
 *             most `syncWait` seconds (counted by the caller in `waited`), so the volleys land
 *             together
 *   release   let go of Volley: the charged volley fires
 */
export function volleyPlan(units: readonly SnapUnit[], squad: number, parked: boolean, helpless: boolean, waited: number): 'fire' | 'charge' | 'wait' | 'release' {
  const S = BOT_RULES.squad;
  let mates = 0;
  for (const u of units) if (u.squad === squad && u.alive && !u.driven) mates++;
  if (mates === 0 || helpless || !parked) return 'fire';
  // Charges travel in 1/255 steps.
  if (volleyMeter(units, squad) < S.volleyCharge - 0.5 / 255) return 'charge';
  if (waited >= S.syncWait) return 'release';
  const others = new Set<number>();
  for (const u of units) if (u.squad !== squad && u.alive && u.rooted && !u.driven) others.add(u.squad);
  for (const other of others) {
    const c = volleyMeter(units, other);
    if (c >= S.syncCharge && c < S.volleyCharge - 0.5 / 255) return 'wait';
  }
  return 'release';
}

/** How long the autopilot keeps Volley up after letting go (long enough for an input to carry it). */
const VOLLEY_LET_GO = 0.4;

const from = { x: 0, y: 0, z: 0 };
const to = { x: 0, y: 0, z: 0 };
const propIds: number[] = [];
/** The buttons of the first, second and third molt card. */
const CARD_KEYS = ['card1', 'card2', 'card3'] as const;

export class Autopilot {
  private session: MatchSession | null = null;
  private frame: FrameState | null = null;
  private time = 0;
  private seed = 20260001;

  // kaiju
  private targetId = -1;
  private retarget = 0;
  /** Buttons held down by the autopilot, and for how much longer (seconds). */
  private readonly taps = new Map<ButtonAction, number>();
  private strikeRest = 0;
  private stompNext = false;
  private grabRest = 6;
  private braceHold = 0;
  /** The unit a charge was aimed at (the head stays on it through the run). */
  private chargeTarget = -1;
  /** When the molt cards now on offer were first seen (-1: none), and whether one was picked. */
  private offerSeen = -1;
  private cardPicked = false;
  private stuck = 0;
  private lastX = 0;
  private lastZ = 0;
  private sidestep = 0;
  private sideSign = 1;

  // human
  private adjacency: number[][] | null = null;
  private path: number[] = [];
  private pathGoal: Target | null = null;
  private pathAge = 0;
  private parked = false;
  /** Seconds Volley stays up after the autopilot let go of it. */
  private volleyRest = 0;
  private readonly tankStick: MoveInput = { moveX: 0, moveZ: 0, aimYaw: 0 };
  private mapRest = 14;
  private mapHold = 0;
  private cameraRest = 9;
  /** Seconds the parked squad has had no line of fire. */
  private noLine = 0;
  /** Seconds the charged squad has waited for a neighbor's volley. */
  private volleyWait = 0;

  /** Give the autopilot this frame's view of the match (null between matches). */
  setContext(session: MatchSession | null, frame: FrameState | null): void {
    if (session !== this.session) {
      this.targetId = -1;
      this.path = [];
      this.pathGoal = null;
      this.adjacency = null;
      this.parked = false;
    }
    this.session = session;
    this.frame = frame;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Called by the input manager each frame, after the real devices were read. */
  drive(state: ActionState, dt: number): void {
    this.time += dt;
    const session = this.session;
    const frame = this.frame;
    if (!session || !frame) return;
    // The autopilot owns the controls: whatever the idle devices said is replaced.
    state.moveX = 0;
    state.moveZ = 0;
    this.pressTaps(state, dt);
    // The molt cards stand through the cocoon and the intermission.
    if (frame.localKaiju) this.pickCard(frame.localKaiju);
    if (frame.match.phase !== 'playing') return;
    if (frame.localKaiju) this.driveKaiju(state, dt, session, frame, frame.localKaiju);
    else if (frame.localUnit && frame.localUnit.alive) this.driveHuman(state, dt, session, frame, frame.localUnit);
    else this.driveDrone(state, frame);
  }

  // --- kaiju -----------------------------------------------------------------------------------

  private pickStructure(session: MatchSession, k: SnapKaiju, bounds: Bounds, skip: number): number {
    const city = session.mirror.city;
    const hp = session.mirror.query.structureHp;
    let best = -1;
    let bestScore = Infinity;
    for (const s of city.structures) {
      if (hp[s.id] <= 0 || s.id === skip || s.value <= 0) continue;
      if (!boundsContains(bounds, s.x, s.z, -Math.max(s.hx, s.hz))) continue;
      const d = Math.hypot(s.x - k.x, s.z - k.z);
      // Nearest first, with a small pull toward the valuable ones.
      const score = d - Math.min(60, s.value * 0.15);
      if (score < bestScore) {
        bestScore = score;
        best = s.id;
      }
    }
    return best;
  }

  private nearestUnit(frame: FrameState, x: number, z: number): { unit: SnapUnit; dist: number } | null {
    let best: SnapUnit | null = null;
    let bestD = Infinity;
    for (const u of frame.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best ? { unit: best, dist: bestD } : null;
  }

  /** Holds a button down for `seconds` (a tap by default): the server sees one press. */
  private tap(action: ButtonAction, seconds = 0.12): void {
    this.taps.set(action, Math.max(this.taps.get(action) ?? 0, seconds));
  }

  /** Holds down what the taps hold this frame. */
  private pressTaps(state: ActionState, dt: number): void {
    for (const [action, left] of this.taps) {
      if (left <= 0) {
        this.taps.delete(action);
        continue;
      }
      state.down[action] = true;
      this.taps.set(action, left - dt);
    }
  }

  /** At a molt: looks at the cards for a moment, then presses the button of one, at random. */
  private pickCard(k: SnapKaiju): void {
    if (k.offer.length === 0) {
      this.offerSeen = -1;
      return;
    }
    if (this.offerSeen < 0) {
      this.offerSeen = this.time;
      this.cardPicked = false;
    }
    if (this.cardPicked || this.time - this.offerSeen < 0.8) return;
    this.cardPicked = true;
    const n = Math.min(k.offer.length, 1 + Math.floor(this.rand() * k.offer.length));
    this.tap(CARD_KEYS[n - 1]);
  }

  private driveKaiju(state: ActionState, dt: number, session: MatchSession, frame: FrameState, k: SnapKaiju): void {
    const def = kaijuKindDef(k.kind);
    const st = kaijuStageDef(k.kind, k.stage);
    if (!k.alive || k.phase === 'cocoon' || k.phase === 'stagger' || k.phase === 'dead') return;
    const idle = k.phase === 'idle';
    // The move button a verb picked at a molt is on, or null when it was not picked.
    const moveButton = (verb: KaijuVerb): ButtonAction | null => {
      const slot = kaijuMoveSlot(k.moves, verb);
      return slot === 0 ? 'move1' : slot === 1 ? 'move2' : null;
    };

    // Molt as soon as it is offered: one press.
    if (k.moltAvailable && k.stage < LAST_STAGE) {
      if (idle && !this.taps.has('molt')) this.tap('molt');
      state.aimOverride = { yaw: k.yaw, pitch: 0 };
      return;
    }

    const threat = this.nearestUnit(frame, k.x, k.z);
    const bearing = threat ? Math.atan2(threat.unit.x - k.x, threat.unit.z - k.z) : k.yaw;

    // A charge's run: the head stays on the unit it was aimed at (the body turns slowly after it).
    if (k.action === 'charge' && !idle) {
      const u = frame.units[this.chargeTarget];
      state.aimOverride = { yaw: u && u.alive ? Math.atan2(u.x - k.x, u.z - k.z) : k.yaw, pitch: 0 };
      return;
    }

    let aimX = k.x + Math.sin(k.yaw) * 50;
    let aimZ = k.z + Math.cos(k.yaw) * 50;
    let aimPitch = 0;
    let move = 0;

    // Brace (once it has it) while several lasers are nearly charged and pointed this way.
    const brace = moveButton('brace');
    if (brace) {
      let charged = 0;
      for (const u of frame.units) if (u.alive && u.laser && u.charge > 0.75) charged++;
      if (this.braceHold > 0) this.braceHold -= dt;
      else if (charged >= 3 && this.rand() < dt * 0.6) this.braceHold = 1.6;
      if (this.braceHold > 0 && threat) {
        state.down[brace] = true;
        state.aimOverride = { yaw: bearing, pitch: 0 };
        return;
      }
    }

    // Roar when soldiers are in its reach.
    const roar = moveButton('roar');
    if (roar && idle && k.cooldowns.roar <= 0 && threat && threat.dist < def.actions.roar.radius[k.stage - 1] * 0.75) this.tap(roar);

    // The beam: rage is full and something is in range.
    const beam = moveButton('special');
    if (beam) {
      const special = def.actions.special;
      const ready = k.rage >= special.rageCost;
      const beaming = k.action === 'special';
      if ((ready || beaming) && threat && threat.dist < special.range[k.stage - 1] * 0.9) {
        aimPitch = Math.atan2(1.5 - st.mouthHeight, Math.max(1, threat.dist));
        if (ready && !beaming && idle) this.tap(beam);
        state.aimOverride = { yaw: bearing, pitch: aimPitch };
        return;
      }
    }

    // Charge at a unit straight ahead, out of a swipe's reach and inside a run's.
    const charge = moveButton('charge');
    if (charge && idle && k.cooldowns.charge <= 0 && threat) {
      const c = def.actions.charge;
      const run = st.topSpeed * c.speedMult * c.timing.active * 0.6;
      if (threat.dist > st.bodyRadius * 3 && threat.dist < run && Math.abs(angleDiff(bearing, k.yaw)) < 0.5) {
        this.chargeTarget = threat.unit.id;
        this.tap(charge);
        state.aimOverride = { yaw: bearing, pitch: 0 };
        return;
      }
    }

    // Sweep the tail at a unit behind, within its reach.
    const sweep = moveButton('tailSweep');
    if (sweep && idle && k.cooldowns.tailSweep <= 0 && threat && threat.dist < def.actions.tailSweep.reach * st.bodyRadius) {
      if (Math.abs(angleDiff(bearing, k.yaw + Math.PI)) < Math.PI / 2) this.tap(sweep);
    }

    // Grab a car now and then; throw it at the nearest unit, or eat it when hurt.
    this.grabRest -= dt;
    const busyHands = this.taps.has('grab') || this.taps.has('strike');
    if (k.held && idle && !busyHands && this.grabRest <= 0) {
      const hurt = k.hp < k.maxHp * 0.75 && k.cooldowns.eat <= 0;
      if (hurt) this.tap('grab');
      else if (threat) this.tap('strike');
      this.grabRest = hurt || threat ? 8 + this.rand() * 6 : 1;
    } else if (!k.held && this.grabRest <= 0 && idle && !busyHands) {
      const reach = def.actions.grab.reach * st.bodyRadius;
      propsInCircle(session.mirror.query, k.x, k.z, reach, propIds);
      const car = propIds.find((id) => PROP_KINDS[session.mirror.city.props[id].kind].grabbable);
      if (car !== undefined) {
        const p = session.mirror.city.props[car];
        aimX = p.x;
        aimZ = p.z;
        this.tap('grab');
        this.grabRest = 1.5;
      } else {
        this.grabRest = 1;
      }
    }
    if (k.held && threat) {
      aimX = threat.unit.x;
      aimZ = threat.unit.z;
    }

    // Wreck the nearest building: swipe, then stomp, each on its own button.
    this.retarget -= dt;
    const hp = session.mirror.query.structureHp;
    if (this.targetId < 0 || hp[this.targetId] <= 0 || this.retarget <= 0) {
      this.targetId = this.pickStructure(session, k, frame.bounds, -1);
      this.retarget = 4;
    }
    const target = this.targetId >= 0 ? session.mirror.city.structures[this.targetId] : null;
    if (target && !this.taps.has('grab') && !k.held) {
      aimX = target.x;
      aimZ = target.z;
    }
    if (target) {
      const gap = distToStructure(session.mirror.index, target.id, k.x, k.z);
      const reach = def.actions.swipe.reach * st.bodyRadius;
      const tramples = target.height <= st.trampleHeight || st.wadesTall;
      if (gap > reach * 0.7 || tramples) move = 1;
      const inReach = gap < reach * 0.85;
      if (this.strikeRest > 0) {
        this.strikeRest -= dt;
      } else if (inReach && idle && !k.held && (!tramples || k.stage === 3)) {
        this.tap(this.stompNext ? 'stomp' : 'strike');
        this.strikeRest = 0.25;
        this.stompNext = !this.stompNext;
      }
    } else {
      // Nothing left standing in bounds: stroll.
      move = 0.5;
      aimX = (frame.bounds.minX + frame.bounds.maxX) / 2;
      aimZ = (frame.bounds.minZ + frame.bounds.maxZ) / 2;
    }

    // Walking into something that is not the target (a wall, the quarantine line): try another.
    const progress = Math.hypot(k.x - this.lastX, k.z - this.lastZ);
    if (move > 0.5 && idle) {
      this.stuck = progress < 0.02 ? this.stuck + dt : Math.max(0, this.stuck - dt);
      if (this.stuck > 1.5) {
        this.targetId = this.pickStructure(session, k, frame.bounds, this.targetId);
        this.retarget = 6;
        this.stuck = 0;
        this.sidestep = 0.8;
        this.sideSign = this.rand() < 0.5 ? 1 : -1;
      }
    }
    this.lastX = k.x;
    this.lastZ = k.z;

    state.moveZ = move;
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      state.moveX = this.sideSign;
      state.moveZ = -0.3;
    }
    state.aimOverride = { yaw: Math.atan2(aimX - k.x, aimZ - k.z), pitch: aimPitch };
  }

  // --- human -----------------------------------------------------------------------------------

  /** The road node nearest to a point among those inside the quarantine bounds, or -1. */
  private nodeNear(session: MatchSession, bounds: Bounds, x: number, z: number): number {
    let best = -1;
    let bestD = Infinity;
    for (const n of session.mirror.city.roads.nodes) {
      if (!boundsContains(bounds, n.x, n.z, 4)) continue;
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /** Where to head next on the way to `goal`: along the streets when it is far, straight when close. */
  private waypoint(session: MatchSession, u: SnapUnit, goal: Target, bounds: Bounds, dt: number): Target {
    const direct = Math.hypot(goal.x - u.x, goal.z - u.z);
    if (direct < 45) return goal;
    const graph = session.mirror.city.roads;
    if (!this.adjacency) this.adjacency = roadAdjacency(graph);
    this.pathAge += dt;
    const moved = this.pathGoal ? Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z) : Infinity;
    if (this.path.length === 0 || moved > 60 || this.pathAge > 6) {
      const a = this.nodeNear(session, bounds, u.x, u.z);
      const b = this.nodeNear(session, bounds, goal.x, goal.z);
      const hp = session.mirror.query.structureHp;
      // Streets that leave the quarantine zone, and bridges that have fallen, are closed.
      this.path = findRoadPath(graph, this.adjacency, a, b, (edge) => {
        const e = graph.edges[edge];
        const na = graph.nodes[e.a];
        const nb = graph.nodes[e.b];
        if (!boundsContains(bounds, na.x, na.z, 4) || !boundsContains(bounds, nb.x, nb.z, 4)) return false;
        return e.bridge < 0 || hp[e.bridge] > 0;
      });
      // Already past the first corner: do not walk back to it.
      if (this.path.length >= 2) {
        const n0 = graph.nodes[this.path[0]];
        const n1 = graph.nodes[this.path[1]];
        if (Math.hypot(n1.x - u.x, n1.z - u.z) < Math.hypot(n1.x - n0.x, n1.z - n0.z)) this.path.shift();
      }
      this.pathGoal = { x: goal.x, z: goal.z };
      this.pathAge = 0;
    }
    while (this.path.length > 0) {
      const node = graph.nodes[this.path[0]];
      if (Math.hypot(node.x - u.x, node.z - u.z) < 14) this.path.shift();
      else return node;
    }
    return goal;
  }

  private driveHuman(state: ActionState, dt: number, session: MatchSession, frame: FrameState, u: SnapUnit): void {
    const d = state.down;
    const def = unitTypeDef(u.type);
    const weapon = weaponDef(def.weapon);
    const squad = frame.squads[session.role.squadId];
    const k = frame.kaijus.find((kk) => kk.alive) ?? frame.kaijus[0];
    const b = frame.bounds;
    if (!k || !squad) return;
    const st = kaijuStageDef(k.kind, k.stage);
    const dx = k.x - u.x;
    const dz = k.z - u.z;
    const dist = Math.hypot(dx, dz);
    const known = k.known || dist < 200;

    // Firing position: this squad's own bearing around the kaiju, at about two thirds of range.
    const range = weapon.range;
    const bearing = session.role.squadId * (Math.PI / 2) + Math.PI / 4 + Math.sin(this.time * 0.05 + session.role.squadId) * 0.4;
    const standOff = Math.max(st.bodyRadius * 4 + 20, range * 0.62);
    let goal: Target;
    if (known) {
      goal = { x: clamp(k.x + Math.sin(bearing) * standOff, b.minX + 6, b.maxX - 6), z: clamp(k.z + Math.cos(bearing) * standOff, b.minZ + 6, b.maxZ - 6) };
    } else {
      // Not found yet: sweep toward the middle of the quarantine zone.
      goal = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    }
    const tooClose = known && dist < Math.max(st.bodyRadius * 3 + 12, range * 0.25);
    const toGoal = Math.hypot(goal.x - u.x, goal.z - u.z);

    // Look at the kaiju's chest (or along the way when it has not been found).
    const eyeY = u.y + def.eyeHeight;
    let aimYaw = Math.atan2(goal.x - u.x, goal.z - u.z);
    let aimPitch = 0;
    let clear = false;
    if (known) {
      aimYaw = Math.atan2(dx, dz);
      aimPitch = Math.atan2(st.height * 0.5 - eyeY, Math.max(1, dist));
      from.x = u.x;
      from.y = eyeY;
      from.z = u.z;
      to.x = k.x;
      to.y = st.height * 0.6;
      to.z = k.z;
      clear = lineOfSight(session.mirror.query, from, to);
    }
    // In position: at the goal, or anywhere in the firing band with a line of fire. Once parked
    // the squad stays (its charge builds only while it holds still) until the kaiju walks out of
    // range or too close, or the line of fire stays blocked, as the squad bots do.
    this.noLine = clear ? 0 : this.noLine + dt;
    const inBand = known && clear && dist >= range * 0.45 && dist <= range * 0.9;
    const inPosition = known && !tooClose && (this.parked ? dist <= range * 0.97 && this.noLine < BOT_RULES.squad.losPatience : toGoal < 18 || inBand);

    // Drive.
    let wantX = 0;
    let wantZ = 0;
    if (tooClose) {
      wantX = -dx / Math.max(1, dist);
      wantZ = -dz / Math.max(1, dist);
    } else if (!inPosition) {
      const next = this.waypoint(session, u, goal, b, dt);
      const len = Math.hypot(next.x - u.x, next.z - u.z) || 1;
      wantX = (next.x - u.x) / len;
      wantZ = (next.z - u.z) / len;
    } else if (!clear) {
      // In range but looking at a wall: slide sideways around the kaiju.
      wantX = dz / Math.max(1, dist);
      wantZ = -dx / Math.max(1, dist);
    }
    // Stuck against something: sidestep for a moment.
    const progress = Math.hypot(u.x - this.lastX, u.z - this.lastZ);
    const trying = Math.hypot(wantX, wantZ) > 0.1 && !u.rooted;
    this.stuck = trying && progress < 0.01 ? this.stuck + dt : Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.2) {
      this.stuck = 0;
      this.sidestep = 1.0;
      this.sideSign = this.rand() < 0.5 ? 1 : -1;
      this.path = [];
    }
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      const sx = wantZ * this.sideSign;
      const sz = -wantX * this.sideSign;
      wantX = sx;
      wantZ = sz;
    }
    this.lastX = u.x;
    this.lastZ = u.z;
    if (u.driven && def.drive) {
      // A tank: throttle and hull turn toward where it wants to go (stages 2 and 3).
      setTankMove(this.tankStick, u.yaw, wantX, wantZ, Math.hypot(wantX, wantZ) > 0.1 ? 1 : 0);
      state.moveX = this.tankStick.moveX;
      state.moveZ = this.tankStick.moveZ;
    } else {
      // World direction to stick deflection relative to the view.
      const s = Math.sin(aimYaw);
      const c = Math.cos(aimYaw);
      state.moveZ = wantX * s + wantZ * c;
      state.moveX = -wantX * c + wantZ * s;
    }
    state.aimOverride = { yaw: aimYaw, pitch: aimPitch };

    // Parked: the squad stops to charge. On the move it fires at will.
    this.parked = inPosition;
    // With range and a clear line: hold Volley until the charge is full (and a moment for a
    // neighbor that is nearly there), let go, and hold it again. Not charging: fire the gun.
    this.volleyRest = Math.max(0, this.volleyRest - dt);
    if (known && clear && dist < range * 0.97 && !tooClose) {
      const helpless = k.phase === 'stagger' || k.phase === 'cocoon';
      const plan = volleyPlan(frame.units, squad.id, this.parked, helpless, this.volleyWait);
      if (plan === 'fire') {
        d.fire = true;
        this.volleyWait = 0;
      } else if (plan === 'release') {
        this.volleyRest = VOLLEY_LET_GO;
        this.volleyWait = 0;
      } else if (this.volleyRest <= 0) {
        d.volley = true;
        if (plan === 'wait') this.volleyWait += dt;
        else this.volleyWait = 0;
      }
    } else {
      // Too close, out of range or no line: whatever is charging goes now (and off it drives).
      this.volleyWait = 0;
    }

    // Glance at the map and flip the camera now and then, as a player would.
    this.mapRest -= dt;
    if (this.mapHold > 0) {
      this.mapHold -= dt;
      if (this.mapHold <= 0) d.map = true;
    } else if (this.mapRest <= 0) {
      d.map = true;
      this.mapHold = 1.2;
      this.mapRest = 30 + this.rand() * 20;
    }
    this.cameraRest -= dt;
    if (this.cameraRest <= 0) {
      d.camera = true;
      this.cameraRest = 16 + this.rand() * 14;
    }
  }

  // --- drone -----------------------------------------------------------------------------------

  private driveDrone(state: ActionState, frame: FrameState): void {
    const k = frame.kaijus[0];
    if (!k) return;
    const st = kaijuStageDef(k.kind, k.stage);
    const a = this.time * 0.12;
    const r = st.height * 3 + 40;
    // Looking at the kaiju from a slowly turning bearing; the drone drifts sideways to keep it.
    state.moveX = 0.35;
    state.aimOverride = { yaw: a + Math.PI, pitch: -Math.atan2(st.height * 1.2, r) };
  }
}
