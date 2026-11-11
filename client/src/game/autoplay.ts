/**
 * The autopilot behind `?autoplay=1`: it presses the same buttons a person would, through the
 * same ActionState, so an automated playtest exercises the real input, prediction and network
 * path on either side. It plays sensibly, not well:
 *
 *   kaiju   walks to the nearest standing building, swipes and stomps it down, roars when
 *           soldiers are near, breathes its beam at them when rage is full, grabs and throws a
 *           car now and then, eats when hurt, braces against a charged volley, molts when it can.
 *   human   drives along the streets to a firing position at its own bearing around the kaiju,
 *           parks the sub-units on hold-and-charge, fires when it has range and a clear line,
 *           backs off when the kaiju closes, calls artillery when it has some, and now and then
 *           opens the map and toggles the camera.
 *   drone   circles the kaiju.
 */

import {
  boundsContains,
  clamp,
  distToStructure,
  findRoadPath,
  kaijuKindDef,
  kaijuStageDef,
  lineOfSight,
  PROP_KINDS,
  propsInCircle,
  roadAdjacency,
  unitTypeDef,
  weaponDef,
  type Bounds,
  type SnapKaiju,
  type SnapUnit,
} from '@mb/shared';
import type { FrameState, MatchSession } from '../net/matchSession';
import type { ActionState } from './input/actions';

interface Target {
  x: number;
  z: number;
}

const from = { x: 0, y: 0, z: 0 };
const to = { x: 0, y: 0, z: 0 };
const propIds: number[] = [];

export class Autopilot {
  private session: MatchSession | null = null;
  private frame: FrameState | null = null;
  private time = 0;
  private seed = 20260001;

  // kaiju
  private targetId = -1;
  private retarget = 0;
  private strikeHold = 0;
  private strikeRest = 0;
  private stompNext = false;
  private roarHold = 0;
  private specialHold = 0;
  private grabHold = 0;
  private grabRest = 6;
  private braceHold = 0;
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
  private commandRest = 2;
  private parked = false;
  private mapRest = 14;
  private mapHold = 0;
  private cameraRest = 9;
  private callInRest = 3;

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
    if (frame.match.phase !== 'playing') {
      this.strikeHold = 0;
      return;
    }
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

  private driveKaiju(state: ActionState, dt: number, session: MatchSession, frame: FrameState, k: SnapKaiju): void {
    const def = kaijuKindDef(k.kind);
    const st = kaijuStageDef(k.kind, k.stage);
    const d = state.down;
    if (!k.alive || k.phase === 'cocoon' || k.phase === 'stagger' || k.phase === 'dead') return;

    // Molt as soon as it is offered: hold the button until the cocoon closes.
    if (k.moltAvailable) {
      d.molt = true;
      state.aimOverride = { yaw: k.yaw, pitch: 0 };
      return;
    }

    const threat = this.nearestUnit(frame, k.x, k.z);
    let aimX = k.x + Math.sin(k.yaw) * 50;
    let aimZ = k.z + Math.cos(k.yaw) * 50;
    let aimPitch = 0;
    let move = 0;

    // Brace when several lasers are nearly charged and pointed this way.
    let charged = 0;
    for (const u of frame.units) if (u.alive && u.laser && u.charge > 0.75) charged++;
    if (this.braceHold > 0) this.braceHold -= dt;
    else if (charged >= 3 && this.rand() < dt * 0.6) this.braceHold = 1.6;
    if (this.braceHold > 0 && threat) {
      d.block = true;
      state.aimOverride = { yaw: Math.atan2(threat.unit.x - k.x, threat.unit.z - k.z), pitch: 0 };
      return;
    }

    // Roar when soldiers are in reach of it.
    const roarRadius = def.actions.roar.radius[k.stage - 1];
    if (this.roarHold > 0) {
      this.roarHold -= dt;
      d.roar = true;
    } else if (k.cooldowns.roar <= 0 && threat && threat.dist < roarRadius * 0.75 && k.phase === 'idle') {
      this.roarHold = 0.15;
    }

    // Beam: rage is full and something is in range.
    const special = def.actions.special;
    const beamRange = special.range[k.stage - 1];
    const beamReady = k.rage >= special.rageCost;
    const beaming = k.action === 'special';
    if (this.specialHold > 0) {
      this.specialHold -= dt;
      d.special = true;
    }
    if ((beamReady || beaming) && threat && threat.dist < beamRange * 0.9) {
      aimX = threat.unit.x;
      aimZ = threat.unit.z;
      aimPitch = Math.atan2(1.5 - st.mouthHeight, Math.max(1, threat.dist));
      if (beamReady && !beaming && k.phase === 'idle' && this.specialHold <= 0) this.specialHold = 0.15;
      state.aimOverride = { yaw: Math.atan2(aimX - k.x, aimZ - k.z), pitch: aimPitch };
      return;
    }

    // Grab a car now and then; throw it at the nearest unit, or eat it when hurt.
    this.grabRest -= dt;
    if (this.grabHold > 0) {
      this.grabHold -= dt;
      d.grab = true;
    } else if (k.held && k.phase === 'idle') {
      const hurt = k.hp < k.maxHp * 0.75 && k.cooldowns.eat <= 0;
      this.grabHold = hurt ? 0.7 : 0.12;
      this.grabRest = 8 + this.rand() * 6;
    } else if (!k.held && this.grabRest <= 0 && k.phase === 'idle') {
      const reach = def.actions.grab.reach * st.bodyRadius;
      propsInCircle(session.mirror.query, k.x, k.z, reach, propIds);
      const car = propIds.find((id) => PROP_KINDS[session.mirror.city.props[id].kind].grabbable);
      if (car !== undefined) {
        const p = session.mirror.city.props[car];
        aimX = p.x;
        aimZ = p.z;
        this.grabHold = k.hp < k.maxHp * 0.75 && k.cooldowns.eat <= 0 ? 0.7 : 0.12;
        this.grabRest = 1.5;
      } else {
        this.grabRest = 1;
      }
    }
    if (k.held && threat) {
      aimX = threat.unit.x;
      aimZ = threat.unit.z;
    }

    // Wreck the nearest building.
    this.retarget -= dt;
    const hp = session.mirror.query.structureHp;
    if (this.targetId < 0 || hp[this.targetId] <= 0 || this.retarget <= 0) {
      this.targetId = this.pickStructure(session, k, frame.bounds, -1);
      this.retarget = 4;
    }
    const target = this.targetId >= 0 ? session.mirror.city.structures[this.targetId] : null;
    if (target && this.grabHold <= 0 && !k.held) {
      aimX = target.x;
      aimZ = target.z;
    }
    if (target) {
      const gap = distToStructure(session.mirror.index, target.id, k.x, k.z);
      const reach = def.actions.swipe.reach * st.bodyRadius;
      const tramples = target.height <= st.trampleHeight || st.wadesTall;
      if (gap > reach * 0.7 || tramples) move = 1;
      const inReach = gap < reach * 0.85;
      if (this.strikeHold > 0) {
        this.strikeHold -= dt;
        d.strike = true;
      } else if (this.strikeRest > 0) {
        this.strikeRest -= dt;
      } else if (inReach && k.phase === 'idle' && !k.held && (!tramples || k.stage === 3)) {
        this.strikeHold = this.stompNext ? 0.5 : 0.1;
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
    if (move > 0.5 && k.phase === 'idle') {
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
    const inPosition = known && toGoal < 18 && !tooClose;

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
    // World direction to stick deflection relative to the view.
    const s = Math.sin(aimYaw);
    const c = Math.cos(aimYaw);
    state.moveZ = wantX * s + wantZ * c;
    state.moveX = -wantX * c + wantZ * s;
    state.aimOverride = { yaw: aimYaw, pitch: aimPitch };

    // Shoot when in range with a clear line; the shot also triggers the charged volley.
    if (known && clear && dist < range * 0.97) d.fire = true;

    // Orders: follow on the move, hold and charge once in position.
    this.commandRest -= dt;
    if (this.commandRest <= 0) {
      if (inPosition && !this.parked) {
        d.cmdHoldCharge = true;
        this.parked = true;
        this.commandRest = 4;
      } else if (!inPosition && this.parked && (tooClose || toGoal > 60)) {
        d.cmdFollow = true;
        this.parked = false;
        this.commandRest = 4;
      } else if (squad.fireMode !== 'charge' && this.parked) {
        d.cmdHoldCharge = true;
        this.commandRest = 5;
      } else {
        this.commandRest = 1;
      }
    }

    // Artillery, when the squad has it and it is ready.
    this.callInRest -= dt;
    if (known && squad.level >= 3 && squad.callInCooldowns[0] <= 0 && this.callInRest <= 0) {
      session.sendCommand({ type: 'callIn', callIn: 'artillery', x: k.x, z: k.z });
      this.callInRest = 6;
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
