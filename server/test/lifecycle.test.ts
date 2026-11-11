/**
 * The whole server, for real: one process on a free port, five clients connecting from Node
 * over HTTP and WebSocket exactly as browsers do. Fast match timers (what MB_FAST=1 sets) and
 * an accelerated simulation, so a complete match fits in a few seconds.
 *
 * create -> join by code (5 clients, a 6th refused) -> lobby -> start -> inputs, snapshots and
 * events -> drop one client and rejoin with its token -> match end -> back to the lobby with
 * the kaiju role rotated -> everyone leaves and the room closes.
 */

import {
  cityChecksum,
  decodeCityState,
  getCity,
  JOIN_ERROR,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
} from '@mb/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { options, Player, startTestServer, token, until, type TestServer } from './netHelpers';

/** Simulation speed for this file: a fast match (150 s on the clock) takes about 12 s. */
const SPEED = 12;

let ts: TestServer;
const players: Player[] = [];

beforeAll(async () => {
  ts = await startTestServer({ speed: SPEED, graceSeconds: 30, endScreenSeconds: 0 });
});

afterAll(async () => {
  for (const p of players) p.stopInputs();
  await ts.server.close();
});

async function codeOf(err: unknown): Promise<number> {
  return (err as { code?: number }).code ?? -1;
}

describe('a room from creation to the last player leaving', () => {
  it('refuses to join a room that does not exist', async () => {
    const err = await Player.join(ts.url, 'ZZZZ', options(9)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    // The library's "no such room" code; the HTTP status itself is an ordinary 404.
    expect(await codeOf(err)).toBe(522);
    const res = await fetch(`${ts.url}/matchmake/joinById/ZZZZ`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('runs a complete match with five clients, a drop and a rejoin', async () => {
    // --- create and join -----------------------------------------------------------------
    const host = await Player.create(ts.url, options(0));
    players.push(host);
    expect(host.code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{4}$`));
    await until(() => host.lobbies.length > 0, 'the host to receive the lobby');
    expect(host.seat).toBe(0);
    expect(host.lobby.code).toBe(host.code);
    expect(host.lobby.options.fast).toBe(true);

    for (let i = 1; i < 5; i++) {
      // People type codes in any case.
      players.push(await Player.join(ts.url, i === 1 ? host.code.toLowerCase() : host.code, options(i)));
    }
    await until(() => players.every((p) => p.lobbies.length > 0 && p.lobby.players.length === 5), 'all five to be seated');
    expect(players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4]);
    expect(host.lobby.players.map((p) => p.name)).toEqual(['Tester 0', 'Tester 1', 'Tester 2', 'Tester 3', 'Tester 4']);
    expect((await (await fetch(`${ts.url}/healthz`)).json()) as object).toMatchObject({ ok: true, rooms: 1, players: 5 });

    const sixth = await Player.join(ts.url, host.code, options(5)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(await codeOf(sixth)).toBe(JOIN_ERROR.roomFull);
    const stale = await Player.join(ts.url, host.code, { protocol: PROTOCOL_VERSION + 7 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(await codeOf(stale)).toBe(JOIN_ERROR.version);

    // --- lobby ---------------------------------------------------------------------------
    players[2].client.send('setRole', { wantsKaiju: true });
    players[3].client.send('setName', { name: 'Renamed' });
    for (const p of players.slice(1)) p.client.send('ready', { ready: true });
    await until(
      () => host.lobby.players.slice(1).every((p) => p.ready) && host.lobby.players[2].wantsKaiju && host.lobby.players[3].name === 'Renamed',
      'the lobby to show everyone ready',
    );
    // Only the host starts.
    players[1].client.send('start', {});
    players[1].client.sendRaw('no-such-message', { anything: true });
    host.client.send('start', {});

    // --- match start ---------------------------------------------------------------------
    await until(() => players.every((p) => p.welcomes.length === 1), 'every client to be welcomed');
    expect(players.every((p) => p.lobby.phase === 'match')).toBe(true);
    const slots = players.map((p) => p.welcome.playerId);
    expect([...slots].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(players[2].welcome.playerId).toBe(0);
    expect(host.lobby.lastKaijuSeat).toBe(2);
    expect(host.lobby.players.map((p) => p.slot)).toEqual(slots);
    const built = getCity(host.welcome.config.citySeed);
    for (const p of players) {
      expect(p.welcome.protocol).toBe(PROTOCOL_VERSION);
      expect(p.welcome.seed).toBe(host.welcome.seed);
      expect(p.welcome.cityChecksum).toBe(cityChecksum(built.city));
      expect(p.welcome.config.tuning.clock).toBe(150);
      const state = decodeCityState(new Uint8Array(p.welcome.cityState));
      expect(state.structureStage.length).toBe(built.city.structures.length);
      expect(state.propCount).toBe(built.city.props.length);
      // The lobby message (phase "match") arrives before the welcome.
      expect(p.order.lastIndexOf('lobby')).toBeLessThan(p.order.indexOf('welcome'));
    }

    // --- inputs, snapshots, events -------------------------------------------------------
    for (const p of players) p.startInputs({ moveZ: 1, aimYaw: 0.5 });
    await until(() => players.every((p) => p.snapshots.length >= 10 && p.snapshot.ackSeq > 0), 'snapshots that acknowledge inputs');
    for (const p of players) {
      const ticks = p.snapshots.map((s) => s.tick);
      expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(p.snapshot.ackSeq).toBeLessThanOrEqual(p.lastSeq);
      expect(p.snapshot.kaijus.length).toBe(1);
      expect(p.snapshot.squads.length).toBe(4);
      expect(p.snapshot.units.length).toBe(16);
      expect(p.snapshot.squads.every((s) => !s.bot)).toBe(true);
    }
    await until(
      () => players.every((p) => p.events.some((e) => e.type === 'matchPhase' && e.phase === 'playing')),
      'the briefing to end for everyone',
    );
    // Every client gets the same events.
    const phaseTicks = (p: Player): number[] => p.events.filter((e) => e.type === 'matchPhase').map((e) => e.tick);
    expect(phaseTicks(players[4])).toEqual(phaseTicks(host));
    // Inputs move things: the kaiju player walks its kaiju.
    const kaijuStart = { x: players[2].snapshots[0].kaijus[0].x, z: players[2].snapshots[0].kaijus[0].z };
    await until(
      () => Math.hypot(host.snapshot.kaijus[0].x - kaijuStart.x, host.snapshot.kaijus[0].z - kaijuStart.z) > 1,
      'the kaiju to move under its player input',
    );

    // --- drop and rejoin -----------------------------------------------------------------
    const dropped = players[4];
    const droppedSlot = dropped.welcome.playerId;
    dropped.stopInputs();
    dropped.client.cut(false);
    await until(() => host.lobby.players[4]?.connected === false, 'the lobby to show the dropped player');
    await until(() => host.snapshot.squads.some((s) => s.player === droppedSlot && s.bot), 'a bot to cover the dropped squad');
    expect(host.lobby.players.length).toBe(5);

    const back = await Player.join(ts.url, host.code, { name: 'Ignored', token: token(4) });
    players[4] = back;
    await until(() => back.welcomes.length === 1 && back.lobbies.length > 0, 'the returning player to be welcomed');
    expect(back.seat).toBe(4);
    expect(back.welcome.playerId).toBe(droppedSlot);
    expect(back.welcome.seed).toBe(host.welcome.seed);
    expect(back.welcome.tick).toBeGreaterThan(0);
    expect(back.lobby.players[4]).toMatchObject({ connected: true, name: 'Tester 4', slot: droppedSlot });
    expect(decodeCityState(new Uint8Array(back.welcome.cityState)).structureStage.length).toBe(built.city.structures.length);
    back.startInputs({ moveX: 1 });
    await until(() => back.snapshots.length > 0 && back.snapshot.ackSeq > 0, 'the returning player to be acknowledged');
    await until(() => host.snapshot.squads.every((s) => !s.bot), 'the bot to hand the squad back');
    expect(back.snapshots.every((s) => s.tick > back.welcome.tick)).toBe(true);
    expect(host.lobby.players[4].connected).toBe(true);

    // --- match end -----------------------------------------------------------------------
    await until(() => players.every((p) => p.events.some((e) => e.type === 'matchEnd')), 'the match to end for everyone', 60_000);
    await until(() => players.every((p) => p.lobby.phase === 'end'), 'the lobby to show the end screen');
    for (const p of players) {
      const end = p.events.find((e) => e.type === 'matchEnd');
      if (!end || end.type !== 'matchEnd') throw new Error('no matchEnd event');
      expect(['humans', 'kaiju']).toContain(end.winner);
      expect(end.tallies.length).toBe(5);
      expect(p.snapshot.match.phase).toBe('ended');
      expect(p.snapshot.match.winner).toBe(end.winner);
      expect(p.snapshot.tick).toBe(end.tick);
    }
    for (const p of players) p.stopInputs();

    // --- back to the lobby, role rotation ------------------------------------------------
    players[3].client.send('toLobby', {});
    host.client.send('toLobby', {});
    await until(() => players.every((p) => p.lobby.phase === 'lobby'), 'everyone to be back in the lobby');
    expect(host.lobby.players.every((p) => !p.ready && p.slot === -1 && p.connected)).toBe(true);
    expect(host.lobby.lastKaijuSeat).toBe(2);

    players[2].client.send('setRole', { wantsKaiju: false });
    for (const p of players.slice(1)) p.client.send('ready', { ready: true });
    await until(() => host.lobby.players.slice(1).every((p) => p.ready) && !host.lobby.players[2].wantsKaiju, 'everyone ready again');
    host.client.send('start', {});
    await until(() => players.every((p) => p.welcomes.length >= 2 && p.welcome.tick === 0), 'the second match to start');
    // Nobody volunteered: the role goes to somebody who did not just have it.
    expect(host.lobby.lastKaijuSeat).not.toBe(2);
    expect(host.lobby.lastKaijuSeat).toBeGreaterThanOrEqual(0);
    expect(players[host.lobby.lastKaijuSeat].welcome.playerId).toBe(0);
    expect(host.welcome.seed).not.toBe(host.welcomes[0].seed);

    // --- everyone leaves -----------------------------------------------------------------
    for (const p of players) await p.leave();
    await until(() => ts.server.health().rooms === 0, 'the empty room to close');
    expect(ts.server.health().players).toBe(0);
    const gone = await Player.join(ts.url, host.code, options(0)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(await codeOf(gone)).toBe(522);
  }, 120_000);
});
