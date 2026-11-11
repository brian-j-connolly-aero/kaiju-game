import { describe, expect, it } from 'vitest';
import {
  cityChecksum,
  cityStateFromWire,
  createCityQuery,
  decodeCityState,
  decodeSnapshot,
  DT,
  encodeSnapshot,
  getCity,
  kaijuMoveParams,
  kaijuStageDef,
  snapshotOfWorld,
  stageBounds,
  stepMovement,
  UNIT_TYPES,
  unitMoveParams,
  welcomeFor,
  type MoveBody,
  type PlayerInput,
} from '../src/index';
import { HUMAN_PLAYER, input, KAIJU_PLAYER, makeTestWorld } from './helpers';

/**
 * The prediction contract (ARCHITECTURE.md section 4): a client that has only the welcome
 * message, a snapshot and its own inputs can run stepMovement locally and land where the server
 * does. These tests play the server and such a client side by side.
 */
describe('client-side prediction from the wire', () => {
  function wander(i: number, phase: number): PlayerInput {
    return input({
      seq: i,
      moveZ: 1,
      moveX: Math.sin(i / 23 + phase) * 0.6,
      aimYaw: Math.sin(i / 70 + phase) * 2.5,
    });
  }

  it('predicts the kaiju through streets and into walls', () => {
    const world = makeTestWorld({ realCity: true, seed: 21 });
    const welcome = welcomeFor(world, KAIJU_PLAYER);

    // --- client setup, from the welcome message only ---
    const { city, index } = getCity(welcome.config.citySeed);
    expect(cityChecksum(city)).toBe(welcome.cityChecksum);
    const mirror = createCityQuery(index, cityStateFromWire(city, decodeCityState(welcome.cityState)));

    let checked = 0;
    let blockedSometime = false;
    for (let round = 0; round < 12; round++) {
      // The server runs ahead for a while.
      for (let i = 0; i < 45; i++) world.step([wander(world.tick, 0)]);

      // The client receives a snapshot and predicts the next half second from its own inputs.
      const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world, world.players[KAIJU_PLAYER].input.seq)));
      const sk = snap.kaijus[welcome.kaijuId];
      const bounds = stageBounds(city, welcome.anchor, snap.match.stage);
      const body: MoveBody = {
        x: sk.x,
        z: sk.z,
        yaw: sk.yaw,
        vx: sk.vx,
        vz: sk.vz,
        radius: kaijuStageDef(sk.kind, sk.stage).bodyRadius,
      };
      for (let i = 0; i < 15; i++) {
        const inp = wander(world.tick, 0);
        world.step([inp]);
        const result = stepMovement(body, inp, DT, mirror, kaijuMoveParams(sk, bounds));
        if (result.blocked) blockedSometime = true;
      }
      const k = world.kaijus[0];
      expect(body.x).toBeCloseTo(k.x, 3);
      expect(body.z).toBeCloseTo(k.z, 3);
      expect(body.yaw).toBeCloseTo(k.yaw, 4);
      expect(body.vx).toBeCloseTo(k.vx, 3);
      expect(body.vz).toBeCloseTo(k.vz, 3);
      checked++;
    }
    expect(checked).toBe(12);
    // The walk really did run into things, so collision prediction was exercised.
    expect(blockedSometime).toBe(true);
  });

  it('predicts the player-driven unit', () => {
    const world = makeTestWorld({ realCity: true, seed: 22 });
    const welcome = welcomeFor(world, HUMAN_PLAYER);
    const { city, index } = getCity(welcome.config.citySeed);
    const mirror = createCityQuery(index, cityStateFromWire(city, decodeCityState(welcome.cityState)));

    for (let round = 0; round < 12; round++) {
      for (let i = 0; i < 45; i++) world.step([null, wander(world.tick, 1.3)]);
      const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
      const squad = snap.squads[welcome.squadId];
      const su = snap.units[squad.driven];
      expect(su.driven).toBe(true);
      const def = UNIT_TYPES[su.type];
      const bounds = stageBounds(city, welcome.anchor, snap.match.stage);
      const body: MoveBody = { x: su.x, z: su.z, yaw: su.yaw, vx: su.vx, vz: su.vz, radius: def.radius };
      for (let i = 0; i < 15; i++) {
        const inp = wander(world.tick, 1.3);
        world.step([null, inp]);
        stepMovement(body, inp, DT, mirror, unitMoveParams(def, su, bounds));
      }
      const u = world.units[squad.driven];
      expect(body.x).toBeCloseTo(u.x, 2);
      expect(body.z).toBeCloseTo(u.z, 2);
      expect(body.vx).toBeCloseTo(u.vx, 2);
      expect(body.vz).toBeCloseTo(u.vz, 2);
    }
  });
});
