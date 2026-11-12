/**
 * Creating and placing entities: the kaiju at the start, and fresh squads at the bounds edge at
 * the start of every stage (DESIGN.md section 2, the molt, step 4 and 5).
 */

import { circleHitsStructure, inWater, structuresInCircle, type CityQuery } from '../city/spatialIndex';
import { factionLevelDef } from '../defs/factions';
import type { KaijuVerb, StageId } from '../defs/ids';
import { KAIJU_ACTION_IDS } from '../defs/ids';
import { kaijuKindDef, kaijuStageDef } from '../defs/kaiju/index';
import { MATCH_RULES, SQUAD_RULES } from '../defs/rules';
import { stageDef } from '../defs/stages';
import { unitTypeDef } from '../defs/units';
import { emptyMods, modMult } from '../defs/upgrades';
import { yawFromTo } from '../math/angle';
import type { Bounds } from '../math/geom';
import type { Vec2 } from '../math/vec';
import type { PlayerSlot } from './config';
import { createUnitNav, resetNav, standsByRoad } from './nav';
import type { Kaiju, KaijuActionMemory, Squad, Unit, World } from './types';

/** How far inside the bounds line squads deploy. */
const DEPLOY_INSET = 20;
const DEPLOY_STEP = 20;
/** Two squads deploy at least this far apart. */
const DEPLOY_SEPARATION = 120;
/** Ways the sectors are turned when looking for the shortest drives, and what an empty sector costs (meters). */
const DEPLOY_TURNS = 8;
const DEPLOY_EMPTY_COST = 5000;
/** A deploy point counts only when dry ground for the squad lies within this many meters of it. */
const DEPLOY_DRY_REACH = 40;
const NO_DISCS: readonly Disc[] = [];

interface Disc {
  x: number;
  z: number;
  radius: number;
}

/**
 * Finds open ground for a circle of `radius` at or near (x, z): inside the bounds, clear of
 * standing structures and of the given discs, and dry when possible (only dry with `dryOnly`),
 * and passing `accept` when that is given. Searches outward in rings. Returns false (and leaves `out` at the requested point) when nothing
 * within about 16 rings fits.
 */
export function findClearSpot(
  city: CityQuery,
  x: number,
  z: number,
  radius: number,
  bounds: Bounds,
  avoid: readonly Disc[],
  out: Vec2,
  dryOnly = false,
  accept?: (x: number, z: number) => boolean,
): boolean {
  const step = Math.max(2, radius);
  const margin = radius + 1;
  for (let pass = 0; pass < (dryOnly ? 1 : 2); pass++) {
    // First pass insists on dry ground; the second accepts water.
    for (let ring = 0; ring <= 16; ring++) {
      const count = ring === 0 ? 1 : 6 + ring * 2;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const cx = x + Math.sin(a) * ring * step;
        const cz = z + Math.cos(a) * ring * step;
        if (cx < bounds.minX + margin || cx > bounds.maxX - margin) continue;
        if (cz < bounds.minZ + margin || cz > bounds.maxZ - margin) continue;
        if (circleHitsStructure(city, cx, cz, radius + 0.75)) continue;
        if (pass === 0 && inWater(city, cx, cz)) continue;
        let free = true;
        for (const d of avoid) {
          const dx = d.x - cx;
          const dz = d.z - cz;
          const rr = d.radius + radius + 0.5;
          if (dx * dx + dz * dz < rr * rr) {
            free = false;
            break;
          }
        }
        if (!free || (accept && !accept(cx, cz))) continue;
        out.x = cx;
        out.z = cz;
        return true;
      }
    }
  }
  out.x = x;
  out.z = z;
  return false;
}

/** Rings searched for standing room, half a body radius apart: about 24 radii out. */
const ROOM_RINGS = 48;
/** Room a body is given beyond its radius. */
const ROOM_MARGIN = 0.5;
const roomIds: number[] = [];

/**
 * Finds the ground nearest (x, z) where a body of `radius` has room to stand: inside the
 * bounds and clear of every standing structure it cannot walk through (taller than
 * `trampleHeight`; bridge decks never count). The spot itself is tried first, so a body that
 * already has room stays exactly where it is; then rings outward. For a kaiju that has just
 * outgrown the gap its cocoon was in: left between two walls, collision would throw it from
 * one to the other on every tick. Returns false (and leaves `out` at the spot asked for) when
 * nothing within reach fits.
 */
export function findStandingRoom(
  city: CityQuery,
  x: number,
  z: number,
  radius: number,
  trampleHeight: number,
  bounds: Bounds,
  out: Vec2,
): boolean {
  const index = city.index;
  const step = Math.max(1, radius / 2);
  for (let ring = 0; ring <= ROOM_RINGS; ring++) {
    const count = ring === 0 ? 1 : Math.ceil(2 * Math.PI * ring);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const cx = ring === 0 ? x : x + Math.sin(a) * ring * step;
      const cz = ring === 0 ? z : z + Math.cos(a) * ring * step;
      if (cx < bounds.minX + radius - 1e-9 || cx > bounds.maxX - radius + 1e-9) continue;
      if (cz < bounds.minZ + radius - 1e-9 || cz > bounds.maxZ - radius + 1e-9) continue;
      structuresInCircle(city, cx, cz, radius + ROOM_MARGIN, roomIds);
      let free = true;
      for (let j = 0; j < roomIds.length; j++) {
        const id = roomIds[j];
        if (index.spassable[id] === 0 && index.sheight[id] > trampleHeight) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      out.x = cx;
      out.z = cz;
      return true;
    }
  }
  out.x = x;
  out.z = z;
  return false;
}

function zeroCooldowns(): Record<KaijuVerb, number> {
  const c = {} as Record<KaijuVerb, number>;
  for (const id of KAIJU_ACTION_IDS) if (id !== 'none') c[id] = 0;
  return c;
}

export function createActionMemory(): KaijuActionMemory {
  return {
    usedPress: 0,
    usedHold: 0,
    holdLive: false,
    throwBuffer: 0,
    meal: false,
    beamLength: 0,
    beamBlocker: -1,
    crossfireTick: -1e9,
  };
}

/** Sets a kaiju's size for a stage. Does not touch hp, nerve or position. */
export function setKaijuStage(k: Kaiju, stage: StageId): void {
  const st = kaijuStageDef(k.kind, stage);
  k.stage = stage;
  k.radius = st.bodyRadius;
  k.height = st.height;
}

export function createKaiju(id: number, slot: PlayerSlot, x: number, z: number, yaw: number): Kaiju {
  const def = kaijuKindDef(slot.kaijuKind);
  const mods = emptyMods();
  const k: Kaiju = {
    entity: 'kaiju',
    id,
    player: slot.id,
    kind: slot.kaijuKind,
    stage: 1,
    alive: true,
    x,
    z,
    yaw,
    vx: 0,
    vz: 0,
    radius: 0,
    height: 0,
    aimYaw: yaw,
    aimPitch: 0,
    hp: def.hp * modMult(mods, 'maxHp'),
    maxHp: def.hp * modMult(mods, 'maxHp'),
    nerve: 0,
    nerveImmune: 0,
    rage: 0,
    phase: 'idle',
    action: 'none',
    phaseTime: 0,
    phaseDuration: 0,
    actionTime: 0,
    actionYaw: yaw,
    act: createActionMemory(),
    held: null,
    cooldowns: zeroCooldowns(),
    moltAvailable: false,
    mods,
    upgrades: [],
    wading: false,
    inWater: false,
    known: false,
    knownTimer: 0,
    spotted: false,
    recentHits: [],
    volleyHits: [],
  };
  setKaijuStage(k, 1);
  return k;
}

function createUnit(id: number, squad: number, slot: number): Unit {
  return {
    entity: 'unit',
    id,
    squad,
    slot,
    type: 'army_rocket_infantry',
    alive: false,
    x: 0,
    z: 0,
    y: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    radius: 1,
    aimYaw: 0,
    aimPitch: 0,
    hp: 0,
    maxHp: 1,
    members: 0,
    nerve: 0,
    shaken: 0,
    charge: 0,
    cooldown: 0,
    veteran: false,
    state: 'dead',
    rooted: false,
    arcYaw: 0,
    nav: createUnitNav(),
    inWater: false,
    wreck: false,
    control: { moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, fire: false },
  };
}

/** Creates a squad and its four (not yet deployed) unit slots, and appends them to the world. */
export function createSquad(world: World, slot: PlayerSlot): Squad {
  const id = world.squads.length;
  const per = MATCH_RULES.unitsPerSquad;
  const units: number[] = [];
  for (let s = 0; s < per; s++) {
    const unitId = id * per + s;
    world.units[unitId] = createUnit(unitId, id, s);
    units.push(unitId);
  }
  const squad: Squad = {
    id,
    player: slot.id,
    faction: slot.faction,
    level: 1,
    callsign: slot.callsign,
    units,
    driven: units[0],
    moveOrder: 'follow',
    moveTarget: { x: 0, z: 0 },
    fireMode: 'atWill',
    callInCooldowns: [],
    upgrades: [],
    mods: emptyMods(),
    eliminated: false,
    veteranSlots: new Array<boolean>(per).fill(false),
    trail: [],
    formed: false,
    volleyReady: false,
    orderBudget: SQUAD_RULES.orderBurst,
    pendingOrders: [],
  };
  world.squads.push(squad);
  return squad;
}

/**
 * Brings a squad back fresh at the level of the given stage: four full-strength units of the
 * faction's unit type, default orders, call-ins ready. Positions are left to deploySquads.
 * Veteran marks come from `squad.veteranSlots`.
 */
export function refillSquad(world: World, squad: Squad, stage: StageId): void {
  const levelDef = factionLevelDef(squad.faction, stage);
  const def = unitTypeDef(levelDef.unitType);
  const hp = def.hp * modMult(squad.mods, 'maxHp');
  squad.level = stageDef(stage).humanLevel;
  squad.driven = squad.units[0];
  squad.eliminated = false;
  squad.moveOrder = 'follow';
  squad.fireMode = 'atWill';
  // Orders that were still waiting were for the squad that is gone.
  squad.orderBudget = SQUAD_RULES.orderBurst;
  squad.pendingOrders.length = 0;
  squad.callInCooldowns = levelDef.callIns.map(() => 0);
  squad.trail.length = 0;
  squad.formed = false;
  squad.volleyReady = false;
  for (let s = 0; s < squad.units.length; s++) {
    const u = world.units[squad.units[s]];
    u.type = def.id;
    u.alive = true;
    u.radius = def.radius;
    u.y = 0;
    u.vx = 0;
    u.vz = 0;
    u.hp = hp;
    u.maxHp = hp;
    u.members = def.members;
    u.nerve = 0;
    u.shaken = 0;
    u.charge = 0;
    u.cooldown = 0;
    u.veteran = squad.veteranSlots[s];
    u.state = 'idle';
    u.rooted = false;
    u.arcYaw = 0;
    resetNav(u.nav);
    u.inWater = false;
    u.wreck = false;
    u.control.moveX = 0;
    u.control.moveZ = 0;
    u.control.fire = false;
  }
}

const spot: Vec2 = { x: 0, z: 0 };

/** Body radius of the units the squads field at a stage (the first squad's faction stands for all). */
function squadRadius(world: World, stage: StageId): number {
  const squad = world.squads[0];
  return squad ? unitTypeDef(factionLevelDef(squad.faction, stage).unitType).radius : 1;
}

/**
 * Refills every squad for the current stage and spreads them around the inside of the bounds
 * line: on every side of the kaiju, each as near to it as the rules allow (at least
 * MATCH_RULES.redeployMinKaijuDist away, or as far as the bounds allow when they are smaller
 * than that). Units face the kaiju.
 */
export function deploySquads(world: World): void {
  const b = world.match.bounds;
  const stage = world.match.stage;
  const threat = world.kaijus.find((k) => k.alive) ?? world.kaijus[0];
  const tx = threat ? threat.x : (b.minX + b.maxX) / 2;
  const tz = threat ? threat.z : (b.minZ + b.maxZ) / 2;

  // Candidate points along the perimeter, a little inside the line.
  const pts: Vec2[] = [];
  const x0 = b.minX + DEPLOY_INSET;
  const x1 = b.maxX - DEPLOY_INSET;
  const z0 = b.minZ + DEPLOY_INSET;
  const z1 = b.maxZ - DEPLOY_INSET;
  for (let x = x0; x < x1; x += DEPLOY_STEP) pts.push({ x, z: z0 });
  for (let z = z0; z < z1; z += DEPLOY_STEP) pts.push({ x: x1, z });
  for (let x = x1; x > x0; x -= DEPLOY_STEP) pts.push({ x, z: z1 });
  for (let z = z1; z > z0; z -= DEPLOY_STEP) pts.push({ x: x0, z });

  let farthest = 0;
  for (const p of pts) farthest = Math.max(farthest, Math.hypot(p.x - tx, p.z - tz));
  const need = Math.min(MATCH_RULES.redeployMinKaijuDist, farthest * 0.92);
  const far = pts.filter((p) => Math.hypot(p.x - tx, p.z - tz) >= need);
  // A point of the line out at sea is no place to arrive: the search for dry ground from there
  // would walk inland to a mole or a pier far inside the line. Such points are left out, so the
  // sector takes its next point on the shore (unless the whole line is wet, which no city has).
  // Nor is a pocket between houses whose only way out is across the quarantine line: the squad
  // must be able to drive straight out onto a street inside the bounds.
  const r = squadRadius(world, stage);
  const usable = (p: Vec2): boolean => {
    // The plain search first (cheap); the one that also asks for a street only when that fails,
    // and only as far out as a spot could still count.
    if (!findClearSpot(world.cityQuery, p.x, p.z, r, b, NO_DISCS, spot, true)) return false;
    if (Math.hypot(spot.x - p.x, spot.z - p.z) > DEPLOY_DRY_REACH) return false;
    if (standsByRoad(world, spot.x, spot.z, r)) return true;
    const near = (x: number, z: number): boolean => Math.hypot(x - p.x, z - p.z) <= DEPLOY_DRY_REACH && standsByRoad(world, x, z, r);
    return findClearSpot(world.cityQuery, p.x, p.z, r, b, NO_DISCS, spot, true, near);
  };
  const dry = far.filter(usable);
  const eligible = dry.length > 0 ? dry : far;

  // One squad per sector of bearings around the kaiju, so that they come at it from every
  // side, each at the eligible point of its sector nearest to the kaiju: "at the new edge" should
  // not mean the far corner of the city. The sectors are turned to whichever way round gives the
  // shortest drives. A sector with no eligible ground takes the point farthest from the others.
  const squads = world.squads.length;
  const sector = (Math.PI * 2) / Math.max(1, squads);
  const bearing = eligible.map((p) => Math.atan2(p.x - tx, p.z - tz) + Math.PI);
  const range = eligible.map((p) => Math.hypot(p.x - tx, p.z - tz));
  const farEnough = (p: Vec2, picked: Array<Vec2 | null>): boolean => {
    for (const c of picked) if (c && Math.hypot(p.x - c.x, p.z - c.z) < DEPLOY_SEPARATION) return false;
    return true;
  };
  let chosen: Array<Vec2 | null> = [];
  let bestTotal = Infinity;
  for (let turn = 0; turn < DEPLOY_TURNS && squads > 0; turn++) {
    const offset = (turn / DEPLOY_TURNS) * sector;
    const picked: Array<Vec2 | null> = new Array<Vec2 | null>(squads).fill(null);
    let total = 0;
    for (let n = 0; n < squads; n++) {
      let best = -1;
      for (let i = 0; i < eligible.length; i++) {
        const slot = Math.floor(((bearing[i] - offset + Math.PI * 4) % (Math.PI * 2)) / sector) % squads;
        if (slot !== n || (best >= 0 && range[i] >= range[best]) || !farEnough(eligible[i], picked)) continue;
        best = i;
      }
      if (best >= 0) {
        picked[n] = eligible[best];
        total += range[best];
      } else {
        total += DEPLOY_EMPTY_COST;
      }
    }
    if (total < bestTotal) {
      bestTotal = total;
      chosen = picked;
    }
  }
  for (let n = 0; n < squads && eligible.length > 0; n++) {
    if (chosen[n]) continue;
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < eligible.length; i++) {
      let score = Infinity;
      for (const c of chosen) if (c) score = Math.min(score, Math.hypot(eligible[i].x - c.x, eligible[i].z - c.z));
      if (score === Infinity) score = range[i];
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    chosen[n] = eligible[best];
  }

  const placed: Disc[] = world.kaijus.filter((k) => k.alive).map((k) => ({ x: k.x, z: k.z, radius: k.radius }));
  const rowOffsets = [0, -1, 1, -2];
  for (const squad of world.squads) {
    refillSquad(world, squad, stage);
    const base = chosen[squad.id % Math.max(1, chosen.length)] ?? { x: tx, z: tz };
    // Line the units up along the bounds edge: perpendicular to the direction of the kaiju.
    const dx = tx - base.x;
    const dz = tz - base.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    for (let s = 0; s < squad.units.length; s++) {
      const u = world.units[squad.units[s]];
      const spacing = u.radius * 2 + 3;
      const wantX = base.x + px * spacing * rowOffsets[s % rowOffsets.length];
      const wantZ = base.z + pz * spacing * rowOffsets[s % rowOffsets.length];
      const ur = u.radius;
      // Room by a street, and no nearer the kaiju than the deploy point had to be (the search
      // for room must not walk a unit back inside the redeploy distance).
      // Dry ground comes first, then that distance, then any open ground at all.
      const byStreet = (x: number, z: number): boolean => standsByRoad(world, x, z, ur);
      const fits = (x: number, z: number): boolean => Math.hypot(x - tx, z - tz) >= need && byStreet(x, z);
      const q = world.cityQuery;
      if (!findClearSpot(q, wantX, wantZ, ur, b, placed, spot, true, fits) && !findClearSpot(q, wantX, wantZ, ur, b, placed, spot, true, byStreet)) {
        findClearSpot(q, wantX, wantZ, ur, b, placed, spot);
      }
      u.x = spot.x;
      u.z = spot.z;
      u.yaw = yawFromTo(u.x, u.z, tx, tz);
      u.aimYaw = u.yaw;
      u.aimPitch = 0;
      u.control.aimYaw = u.yaw;
      u.control.aimPitch = 0;
      u.inWater = inWater(world.cityQuery, u.x, u.z);
      placed.push({ x: u.x, z: u.z, radius: u.radius });
    }
    squad.moveTarget.x = world.units[squad.units[0]].x;
    squad.moveTarget.z = world.units[squad.units[0]].z;
  }
}
