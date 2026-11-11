/**
 * Creating and placing entities: the kaiju at the start, and fresh squads at the bounds edge at
 * the start of every stage (DESIGN.md section 2, the molt, step 4 and 5).
 */

import { circleHitsStructure, inWater, type CityQuery } from '../city/spatialIndex';
import { factionLevelDef } from '../defs/factions';
import type { KaijuVerb, StageId } from '../defs/ids';
import { KAIJU_ACTION_IDS } from '../defs/ids';
import { kaijuKindDef, kaijuStageDef } from '../defs/kaiju/index';
import { MATCH_RULES } from '../defs/rules';
import { stageDef } from '../defs/stages';
import { unitTypeDef } from '../defs/units';
import { emptyMods, modMult } from '../defs/upgrades';
import { yawFromTo } from '../math/angle';
import type { Bounds } from '../math/geom';
import type { Vec2 } from '../math/vec';
import type { PlayerSlot } from './config';
import type { Kaiju, KaijuActionMemory, Squad, Unit, World } from './types';

/** How far inside the bounds line squads deploy. */
const DEPLOY_INSET = 20;
const DEPLOY_STEP = 20;

interface Disc {
  x: number;
  z: number;
  radius: number;
}

/**
 * Finds open ground for a circle of `radius` at or near (x, z): inside the bounds, clear of
 * standing structures and of the given discs, and dry when possible. Searches outward in rings.
 * Returns false (and leaves `out` at the requested point) when nothing within about 16 rings fits.
 */
export function findClearSpot(
  city: CityQuery,
  x: number,
  z: number,
  radius: number,
  bounds: Bounds,
  avoid: readonly Disc[],
  out: Vec2,
): boolean {
  const step = Math.max(2, radius);
  const margin = radius + 1;
  for (let pass = 0; pass < 2; pass++) {
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
        if (!free) continue;
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
  squad.callInCooldowns = levelDef.callIns.map(() => 0);
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
    u.inWater = false;
    u.wreck = false;
    u.control.moveX = 0;
    u.control.moveZ = 0;
    u.control.fire = false;
  }
}

const spot: Vec2 = { x: 0, z: 0 };

/**
 * Refills every squad for the current stage and spreads them around the inside of the bounds
 * line, as far from the kaiju as the rules ask (MATCH_RULES.redeployMinKaijuDist, or as far as
 * the bounds allow when they are smaller than that). Units face the kaiju.
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
  const eligible = pts.filter((p) => Math.hypot(p.x - tx, p.z - tz) >= need);

  // Spread the squads: repeatedly take the eligible point farthest from those already chosen.
  const chosen: Vec2[] = [];
  for (let n = 0; n < world.squads.length && eligible.length > 0; n++) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < eligible.length; i++) {
      const p = eligible[i];
      let score = Math.hypot(p.x - tx, p.z - tz);
      if (chosen.length > 0) {
        score = Infinity;
        for (const c of chosen) score = Math.min(score, Math.hypot(p.x - c.x, p.z - c.z));
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    chosen.push(eligible[best]);
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
      findClearSpot(world.cityQuery, wantX, wantZ, u.radius, b, placed, spot);
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
