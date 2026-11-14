/** Builds the snapshot of a World (server side). */

import type { World } from '../sim/types';
import type { SnapCrate, SnapKaiju, SnapSquad, SnapUnit, Snapshot } from './snapshot';

/**
 * Captures the world as a Snapshot. `ackSeq` is per client: pass the receiving player's
 * `world.players[id].input.seq`, or leave it 0 and patch the encoded bytes with setSnapshotAck.
 */
export function snapshotOfWorld(world: World, ackSeq = 0): Snapshot {
  const m = world.match;
  const kaijus: SnapKaiju[] = world.kaijus.map((k) => ({
    id: k.id,
    player: k.player,
    kind: k.kind,
    stage: k.stage,
    alive: k.alive,
    moltAvailable: k.moltAvailable,
    wading: k.wading,
    inWater: k.inWater,
    known: k.known,
    spotted: k.spotted,
    x: k.x,
    z: k.z,
    vx: k.vx,
    vz: k.vz,
    yaw: k.yaw,
    aimYaw: k.aimYaw,
    aimPitch: k.aimPitch,
    hp: k.hp,
    maxHp: k.maxHp,
    nerve: k.nerve,
    nerveImmune: k.nerveImmune,
    rage: k.rage,
    action: k.action,
    phase: k.phase,
    phaseTime: k.phaseTime,
    phaseDuration: k.phaseDuration,
    held: k.held,
    cooldowns: { ...k.cooldowns },
    submerge: k.submerge,
    moves: [k.moves[0], k.moves[1]],
    offer: k.offer.slice(),
    surge: k.surge,
    clubSwings: k.clubSwings,
    shieldHp: k.shieldHp,
  }));
  const squads: SnapSquad[] = world.squads.map((s) => ({
    id: s.id,
    player: s.player,
    faction: s.faction,
    level: s.level,
    eliminated: s.eliminated,
    bot: world.players[s.player].bot,
    driven: s.driven,
    pickup: s.pickup,
    barrages: s.barrages,
  }));
  const crates: SnapCrate[] = world.crates.map((c) => ({ id: c.id, kind: c.kind, x: c.x, z: c.z, fall: c.fall }));
  const units: SnapUnit[] = world.units.map((u) => {
    const squad = world.squads[u.squad];
    return {
      id: u.id,
      squad: u.squad,
      type: u.type,
      state: u.state,
      alive: u.alive,
      veteran: u.veteran,
      driven: squad.driven === u.id,
      rooted: u.rooted,
      inWater: u.inWater,
      laser: u.alive && u.state === 'charging',
      wreck: u.wreck,
      x: u.x,
      z: u.z,
      vx: u.vx,
      vz: u.vz,
      y: u.y,
      yaw: u.yaw,
      aimYaw: u.aimYaw,
      aimPitch: u.aimPitch,
      hp: u.hp,
      maxHp: u.maxHp,
      members: u.members,
      nerve: u.nerve,
      shaken: u.shaken,
      charge: u.charge,
      cooldown: u.cooldown,
      stunned: u.alive && u.stun > 0,
      stun: u.stun,
    };
  });
  return {
    tick: world.tick,
    ackSeq,
    match: {
      phase: m.phase,
      stage: m.stage,
      clock: m.clock,
      phaseTime: m.phaseTime,
      barPoints: m.barPoints,
      marks: [m.marks[0], m.marks[1], m.marks[2]],
      marksReached: m.marksReached,
      winner: m.winner,
      endReason: m.endReason,
      staticUntil: m.staticUntil,
    },
    kaijus,
    squads,
    units,
    crates,
  };
}
