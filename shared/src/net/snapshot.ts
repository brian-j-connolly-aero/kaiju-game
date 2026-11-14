/**
 * The binary snapshot: the `snap` message, sent to every client 15 times a second.
 *
 * It carries everything a client needs to draw and animate the match except what arrives as
 * events (projectiles, structure changes): match scalars, every kaiju, every squad, every unit.
 * The layout is fixed and little-endian; `encodeSnapshot` and `decodeSnapshot` are exact
 * inverses up to the quantization noted on each field.
 *
 *   header   u8 magic 'M', u8 version, u32 tick, u32 ackSeq
 *   match    u8 phase, u8 stage, u16 clock (0.1 s), u16 phaseTime (0.01 s), f32 barPoints,
 *            f32 x 3 marks, u8 marksReached, u8 winner, u8 endReason
 *   counts   u8 kaijus, u8 squads, u8 units
 *   kaiju    u8 id, u8 player, u8 kind, u8 stage, u8 flags, u8 action, u8 phase, u8 heldKind,
 *            u16 heldRef, f32 x, z, vx, vz, yaw, aimYaw, aimPitch, hp, maxHp, nerve, rage,
 *            phaseTime, phaseDuration, u16 nerveImmune (0.01 s), u16 x 9 cooldowns (0.01 s)
 *   squad    u8 id, u8 player, u8 faction, u8 level, u8 flags, u8 moveOrder, u8 fireMode,
 *            u8 driven (255 = none), i16 moveTargetX, i16 moveTargetZ (0.1 m),
 *            u16 x 2 call-in cooldowns (0.01 s)
 *   unit     u8 id, u8 squad, u8 type, u8 state, u8 flags, f32 x, z, vx, vz, u16 y (0.1 m),
 *            i16 yaw, i16 aimYaw, i16 aimPitch (pi / 32768), u16 hp, u16 maxHp (0.1),
 *            u8 members, u8 nerve (0.5), u8 shaken (0.05 s), u8 charge (1 / 255),
 *            u8 cooldown (0.05 s)
 *
 * Positions and velocities are full 32-bit floats so a client can replay its own inputs from a
 * snapshot without drift. `ackSeq` is the only per-client field; the server encodes once and
 * patches it for each client with `setSnapshotAck`.
 *
 * Changing this layout means bumping SNAPSHOT_VERSION. Appending ids to the arrays in
 * defs/ids.ts does not.
 */

import { ARCHETYPES } from '../city/archetypes';
import { PROP_KIND_IDS } from '../city/types';
import {
  END_REASONS,
  FACTION_IDS,
  FIRE_MODES,
  HELD_KINDS,
  idOf,
  KAIJU_ACTION_IDS,
  KAIJU_KIND_IDS,
  KAIJU_PHASES,
  MATCH_PHASES,
  MOVE_ORDERS,
  UNIT_STATES,
  UNIT_TYPE_IDS,
  WINNERS,
  WRECK_KINDS,
  type EndReason,
  type FactionId,
  type FireMode,
  type KaijuActionId,
  type KaijuKindId,
  type KaijuPhase,
  type KaijuVerb,
  type Level,
  type MatchPhase,
  type MoveOrder,
  type PerStage,
  type StageId,
  type UnitState,
  type UnitTypeId,
  type Winner,
} from '../defs/ids';
import { PI } from '../math/angle';
import type { HeldObject } from '../sim/events';
import {
  createReader,
  createWriter,
  finishWriter,
  quantize,
  quantizeI16,
  readF32,
  readI16,
  readU16,
  readU32,
  readU8,
  writeF32,
  writeI16,
  writeU16,
  writeU32,
  writeU8,
  type ByteReader,
  type ByteWriter,
} from './bytes';

export const SNAPSHOT_MAGIC = 0x4d;
export const SNAPSHOT_VERSION = 1;
/** Byte offset of the u32 ackSeq in an encoded snapshot. */
const ACK_OFFSET = 6;

const ANGLE_SCALE = 32768 / PI;
const NO_UNIT = 255;

/** The verbs in cooldown order (KAIJU_ACTION_IDS without 'none'). */
const VERBS: readonly KaijuVerb[] = KAIJU_ACTION_IDS.filter((id): id is KaijuVerb => id !== 'none');

export interface SnapMatch {
  phase: MatchPhase;
  stage: StageId;
  /** Seconds left on the clock (0.1 s steps). */
  clock: number;
  /** Seconds left in a timed phase (0.01 s steps). */
  phaseTime: number;
  barPoints: number;
  marks: PerStage<number>;
  marksReached: number;
  winner: Winner;
  endReason: EndReason;
}

export interface SnapKaiju {
  id: number;
  player: number;
  kind: KaijuKindId;
  stage: StageId;
  alive: boolean;
  moltAvailable: boolean;
  wading: boolean;
  inWater: boolean;
  /** The humans' map may show it. */
  known: boolean;
  /** A player-driven unit has it in sight (scatter bonus). */
  spotted: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  aimYaw: number;
  aimPitch: number;
  hp: number;
  maxHp: number;
  nerve: number;
  /** Seconds of nerve immunity left (0.01 s steps). */
  nerveImmune: number;
  rage: number;
  action: KaijuActionId;
  phase: KaijuPhase;
  /** Seconds spent in the current phase. */
  phaseTime: number;
  /** Length of the current phase; 0 when open-ended. */
  phaseDuration: number;
  held: HeldObject | null;
  /** Seconds until each verb is ready again (0.01 s steps). */
  cooldowns: Record<KaijuVerb, number>;
}

export interface SnapSquad {
  id: number;
  player: number;
  faction: FactionId;
  level: Level;
  eliminated: boolean;
  /** A bot is driving this squad right now. */
  bot: boolean;
  moveOrder: MoveOrder;
  fireMode: FireMode;
  /** Unit id the player drives, or -1. */
  driven: number;
  /** Destination of a 'moveTo' order (0.1 m steps). */
  moveTargetX: number;
  moveTargetZ: number;
  /** Seconds until the faction level's first and second call-in are ready (0.01 s steps). */
  callInCooldowns: [number, number];
}

export interface SnapUnit {
  id: number;
  squad: number;
  type: UnitTypeId;
  state: UnitState;
  alive: boolean;
  veteran: boolean;
  /** This is the unit its squad's player drives. */
  driven: boolean;
  rooted: boolean;
  inWater: boolean;
  /** Its targeting laser is on (charging a volley). */
  laser: boolean;
  /** Dead vehicle whose wreck is still on the field. */
  wreck: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Altitude (0.1 m steps). */
  y: number;
  yaw: number;
  aimYaw: number;
  aimPitch: number;
  /** 0.1 hp steps. */
  hp: number;
  maxHp: number;
  members: number;
  /** 0.5 steps. */
  nerve: number;
  /** Seconds left shaken (0.05 s steps, at most 12.75). */
  shaken: number;
  /** 0..1 in 1/255 steps. */
  charge: number;
  /** Seconds until the weapon is ready (0.05 s steps, at most 12.75). */
  cooldown: number;
}

export interface Snapshot {
  tick: number;
  /** Sequence number of the last input the server applied for the receiving client. */
  ackSeq: number;
  match: SnapMatch;
  kaijus: SnapKaiju[];
  squads: SnapSquad[];
  units: SnapUnit[];
}

const K_ALIVE = 1;
const K_MOLT = 2;
const K_WADING = 4;
const K_WATER = 8;
const K_KNOWN = 16;
const K_SPOTTED = 32;

const S_ELIMINATED = 1;
const S_BOT = 2;

const U_ALIVE = 1;
const U_VETERAN = 2;
const U_DRIVEN = 4;
const U_ROOTED = 8;
const U_WATER = 16;
const U_LASER = 32;
const U_WRECK = 64;

function heldRef(held: HeldObject | null): number {
  if (!held) return 0;
  switch (held.kind) {
    case 'prop':
      return Math.max(0, PROP_KIND_IDS.indexOf(held.prop));
    case 'vehicle':
      return Math.max(0, UNIT_TYPE_IDS.indexOf(held.unitType));
    case 'chunk':
      return Math.max(
        0,
        ARCHETYPES.findIndex((a) => a.id === held.archetype),
      );
    case 'wreck':
      return Math.max(0, WRECK_KINDS.indexOf(held.wreck));
  }
}

function heldFrom(kindCode: number, ref: number): HeldObject | null {
  switch (idOf(HELD_KINDS, kindCode)) {
    case 'prop':
      return { kind: 'prop', prop: idOf(PROP_KIND_IDS, ref) };
    case 'vehicle':
      return { kind: 'vehicle', unitType: idOf(UNIT_TYPE_IDS, ref) };
    case 'chunk':
      return { kind: 'chunk', archetype: (ARCHETYPES[ref] ?? ARCHETYPES[0]).id };
    case 'wreck':
      return { kind: 'wreck', wreck: idOf(WRECK_KINDS, ref) };
    default:
      return null;
  }
}

function writeKaiju(w: ByteWriter, k: SnapKaiju): void {
  writeU8(w, k.id);
  writeU8(w, k.player);
  writeU8(w, KAIJU_KIND_IDS.indexOf(k.kind));
  writeU8(w, k.stage);
  writeU8(
    w,
    (k.alive ? K_ALIVE : 0) |
      (k.moltAvailable ? K_MOLT : 0) |
      (k.wading ? K_WADING : 0) |
      (k.inWater ? K_WATER : 0) |
      (k.known ? K_KNOWN : 0) |
      (k.spotted ? K_SPOTTED : 0),
  );
  writeU8(w, KAIJU_ACTION_IDS.indexOf(k.action));
  writeU8(w, KAIJU_PHASES.indexOf(k.phase));
  writeU8(w, k.held ? HELD_KINDS.indexOf(k.held.kind) : 0);
  writeU16(w, heldRef(k.held));
  writeF32(w, k.x);
  writeF32(w, k.z);
  writeF32(w, k.vx);
  writeF32(w, k.vz);
  writeF32(w, k.yaw);
  writeF32(w, k.aimYaw);
  writeF32(w, k.aimPitch);
  writeF32(w, k.hp);
  writeF32(w, k.maxHp);
  writeF32(w, k.nerve);
  writeF32(w, k.rage);
  writeF32(w, k.phaseTime);
  writeF32(w, k.phaseDuration);
  writeU16(w, quantize(k.nerveImmune, 100, 65535));
  for (const verb of VERBS) writeU16(w, quantize(k.cooldowns[verb], 100, 65535));
}

function readKaiju(r: ByteReader): SnapKaiju {
  const id = readU8(r);
  const player = readU8(r);
  const kind = idOf(KAIJU_KIND_IDS, readU8(r));
  const stage = clampStage(readU8(r));
  const flags = readU8(r);
  const action = idOf(KAIJU_ACTION_IDS, readU8(r));
  const phase = idOf(KAIJU_PHASES, readU8(r));
  const heldKind = readU8(r);
  const ref = readU16(r);
  const x = readF32(r);
  const z = readF32(r);
  const vx = readF32(r);
  const vz = readF32(r);
  const yaw = readF32(r);
  const aimYaw = readF32(r);
  const aimPitch = readF32(r);
  const hp = readF32(r);
  const maxHp = readF32(r);
  const nerve = readF32(r);
  const rage = readF32(r);
  const phaseTime = readF32(r);
  const phaseDuration = readF32(r);
  const nerveImmune = readU16(r) / 100;
  const cooldowns = {} as Record<KaijuVerb, number>;
  for (const verb of VERBS) cooldowns[verb] = readU16(r) / 100;
  return {
    id,
    player,
    kind,
    stage,
    alive: (flags & K_ALIVE) !== 0,
    moltAvailable: (flags & K_MOLT) !== 0,
    wading: (flags & K_WADING) !== 0,
    inWater: (flags & K_WATER) !== 0,
    known: (flags & K_KNOWN) !== 0,
    spotted: (flags & K_SPOTTED) !== 0,
    x,
    z,
    vx,
    vz,
    yaw,
    aimYaw,
    aimPitch,
    hp,
    maxHp,
    nerve,
    nerveImmune,
    rage,
    action,
    phase,
    phaseTime,
    phaseDuration,
    held: heldFrom(heldKind, ref),
    cooldowns,
  };
}

function clampStage(v: number): StageId {
  return v <= 1 ? 1 : v === 2 ? 2 : 3;
}

function writeSquad(w: ByteWriter, s: SnapSquad): void {
  writeU8(w, s.id);
  writeU8(w, s.player);
  writeU8(w, FACTION_IDS.indexOf(s.faction));
  writeU8(w, s.level);
  writeU8(w, (s.eliminated ? S_ELIMINATED : 0) | (s.bot ? S_BOT : 0));
  writeU8(w, MOVE_ORDERS.indexOf(s.moveOrder));
  writeU8(w, FIRE_MODES.indexOf(s.fireMode));
  writeU8(w, s.driven < 0 ? NO_UNIT : s.driven);
  writeI16(w, quantizeI16(s.moveTargetX, 10));
  writeI16(w, quantizeI16(s.moveTargetZ, 10));
  writeU16(w, quantize(s.callInCooldowns[0], 100, 65535));
  writeU16(w, quantize(s.callInCooldowns[1], 100, 65535));
}

function readSquad(r: ByteReader): SnapSquad {
  const id = readU8(r);
  const player = readU8(r);
  const faction = idOf(FACTION_IDS, readU8(r));
  const level = clampStage(readU8(r));
  const flags = readU8(r);
  const moveOrder = idOf(MOVE_ORDERS, readU8(r));
  const fireMode = idOf(FIRE_MODES, readU8(r));
  const driven = readU8(r);
  const moveTargetX = readI16(r) / 10;
  const moveTargetZ = readI16(r) / 10;
  const c0 = readU16(r) / 100;
  const c1 = readU16(r) / 100;
  return {
    id,
    player,
    faction,
    level,
    eliminated: (flags & S_ELIMINATED) !== 0,
    bot: (flags & S_BOT) !== 0,
    moveOrder,
    fireMode,
    driven: driven === NO_UNIT ? -1 : driven,
    moveTargetX,
    moveTargetZ,
    callInCooldowns: [c0, c1],
  };
}

function writeUnit(w: ByteWriter, u: SnapUnit): void {
  writeU8(w, u.id);
  writeU8(w, u.squad);
  writeU8(w, UNIT_TYPE_IDS.indexOf(u.type));
  writeU8(w, UNIT_STATES.indexOf(u.state));
  writeU8(
    w,
    (u.alive ? U_ALIVE : 0) |
      (u.veteran ? U_VETERAN : 0) |
      (u.driven ? U_DRIVEN : 0) |
      (u.rooted ? U_ROOTED : 0) |
      (u.inWater ? U_WATER : 0) |
      (u.laser ? U_LASER : 0) |
      (u.wreck ? U_WRECK : 0),
  );
  writeF32(w, u.x);
  writeF32(w, u.z);
  writeF32(w, u.vx);
  writeF32(w, u.vz);
  writeU16(w, quantize(u.y, 10, 65535));
  writeI16(w, quantizeI16(u.yaw, ANGLE_SCALE));
  writeI16(w, quantizeI16(u.aimYaw, ANGLE_SCALE));
  writeI16(w, quantizeI16(u.aimPitch, ANGLE_SCALE));
  writeU16(w, quantize(u.hp, 10, 65535));
  writeU16(w, quantize(u.maxHp, 10, 65535));
  writeU8(w, quantize(u.members, 1, 255));
  writeU8(w, quantize(u.nerve, 2, 255));
  writeU8(w, quantize(u.shaken, 20, 255));
  writeU8(w, quantize(u.charge, 255, 255));
  writeU8(w, quantize(u.cooldown, 20, 255));
}

function readUnit(r: ByteReader): SnapUnit {
  const id = readU8(r);
  const squad = readU8(r);
  const type = idOf(UNIT_TYPE_IDS, readU8(r));
  const state = idOf(UNIT_STATES, readU8(r));
  const flags = readU8(r);
  const x = readF32(r);
  const z = readF32(r);
  const vx = readF32(r);
  const vz = readF32(r);
  const y = readU16(r) / 10;
  const yaw = readI16(r) / ANGLE_SCALE;
  const aimYaw = readI16(r) / ANGLE_SCALE;
  const aimPitch = readI16(r) / ANGLE_SCALE;
  const hp = readU16(r) / 10;
  const maxHp = readU16(r) / 10;
  const members = readU8(r);
  const nerve = readU8(r) / 2;
  const shaken = readU8(r) / 20;
  const charge = readU8(r) / 255;
  const cooldown = readU8(r) / 20;
  return {
    id,
    squad,
    type,
    state,
    alive: (flags & U_ALIVE) !== 0,
    veteran: (flags & U_VETERAN) !== 0,
    driven: (flags & U_DRIVEN) !== 0,
    rooted: (flags & U_ROOTED) !== 0,
    inWater: (flags & U_WATER) !== 0,
    laser: (flags & U_LASER) !== 0,
    wreck: (flags & U_WRECK) !== 0,
    x,
    z,
    vx,
    vz,
    y,
    yaw,
    aimYaw,
    aimPitch,
    hp,
    maxHp,
    members,
    nerve,
    shaken,
    charge,
    cooldown,
  };
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  if (s.kaijus.length > 255 || s.squads.length > 255 || s.units.length > 255) {
    throw new Error('snapshot has too many entities for the wire format');
  }
  const w = createWriter(64 + s.kaijus.length * 90 + s.squads.length * 16 + s.units.length * 40);
  writeU8(w, SNAPSHOT_MAGIC);
  writeU8(w, SNAPSHOT_VERSION);
  writeU32(w, s.tick >>> 0);
  writeU32(w, s.ackSeq >>> 0);

  const m = s.match;
  writeU8(w, MATCH_PHASES.indexOf(m.phase));
  writeU8(w, m.stage);
  writeU16(w, quantize(m.clock, 10, 65535));
  writeU16(w, quantize(m.phaseTime, 100, 65535));
  writeF32(w, m.barPoints);
  writeF32(w, m.marks[0]);
  writeF32(w, m.marks[1]);
  writeF32(w, m.marks[2]);
  writeU8(w, m.marksReached);
  writeU8(w, WINNERS.indexOf(m.winner));
  writeU8(w, END_REASONS.indexOf(m.endReason));

  writeU8(w, s.kaijus.length);
  writeU8(w, s.squads.length);
  writeU8(w, s.units.length);
  for (const k of s.kaijus) writeKaiju(w, k);
  for (const q of s.squads) writeSquad(w, q);
  for (const u of s.units) writeUnit(w, u);
  return finishWriter(w);
}

/** Decodes a snapshot. Throws on a wrong magic byte, an unknown version or truncated data. */
export function decodeSnapshot(bytes: Uint8Array): Snapshot {
  const r = createReader(bytes);
  if (readU8(r) !== SNAPSHOT_MAGIC) throw new Error('not a snapshot');
  const version = readU8(r);
  if (version !== SNAPSHOT_VERSION) throw new Error(`snapshot version ${version}, expected ${SNAPSHOT_VERSION}`);
  const tick = readU32(r);
  const ackSeq = readU32(r);

  const phase = idOf(MATCH_PHASES, readU8(r));
  const stage = clampStage(readU8(r));
  const clock = readU16(r) / 10;
  const phaseTime = readU16(r) / 100;
  const barPoints = readF32(r);
  const marks: PerStage<number> = [readF32(r), readF32(r), readF32(r)];
  const marksReached = readU8(r);
  const winner = idOf(WINNERS, readU8(r));
  const endReason = idOf(END_REASONS, readU8(r));

  const kaijuCount = readU8(r);
  const squadCount = readU8(r);
  const unitCount = readU8(r);
  const kaijus: SnapKaiju[] = [];
  const squads: SnapSquad[] = [];
  const units: SnapUnit[] = [];
  for (let i = 0; i < kaijuCount; i++) kaijus.push(readKaiju(r));
  for (let i = 0; i < squadCount; i++) squads.push(readSquad(r));
  for (let i = 0; i < unitCount; i++) units.push(readUnit(r));

  return {
    tick,
    ackSeq,
    match: { phase, stage, clock, phaseTime, barPoints, marks, marksReached, winner, endReason },
    kaijus,
    squads,
    units,
  };
}

/** Overwrites the ackSeq of an encoded snapshot in place (the one per-client field). */
export function setSnapshotAck(bytes: Uint8Array, ackSeq: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(ACK_OFFSET, ackSeq >>> 0, true);
}

/** Reads the tick of an encoded snapshot without decoding the rest. */
export function peekSnapshotTick(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2, true);
}
