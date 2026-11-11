/**
 * The server at real speed: the 30 Hz / 15 Hz rhythm, the library's automatic reconnection,
 * seat takeover, the grace period, and the HTTP side (health check, the built client, the
 * fallback page). One server on a free port for the whole file.
 */

import { CLOSE_REPLACED, SNAPSHOT_RATE, TICK_RATE } from '@mb/shared';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { options, Player, sleep, startTestServer, token, until, type TestServer } from './netHelpers';

const GRACE_SECONDS = 4;

let ts: TestServer;
let clientDir: string;
const open: Player[] = [];

async function track(p: Promise<Player>): Promise<Player> {
  const player = await p;
  open.push(player);
  return player;
}

/** Creates a room with `count` players and starts a match; `kaiju` is the seat that volunteers, if any. */
async function startedRoom(count: number, firstToken: number, kaiju = -1): Promise<Player[]> {
  const players = [await track(Player.create(ts.url, options(firstToken)))];
  for (let i = 1; i < count; i++) players.push(await track(Player.join(ts.url, players[0].code, options(firstToken + i))));
  await until(() => players.every((p) => p.lobbies.length > 0 && p.lobby.players.length === count), 'everyone seated');
  if (kaiju >= 0) players[kaiju].client.send('setRole', { wantsKaiju: true });
  for (const p of players.slice(1)) p.client.send('ready', { ready: true });
  await until(
    () => players[0].lobby.players.slice(1).every((p) => p.ready) && (kaiju < 0 || players[0].lobby.players[kaiju].wantsKaiju),
    'everyone ready',
  );
  players[0].client.send('start', {});
  await until(() => players.every((p) => p.welcomes.length === 1), 'everyone welcomed');
  return players;
}

beforeAll(async () => {
  clientDir = mkdtempSync(join(tmpdir(), 'mb-server-test-'));
  mkdirSync(join(clientDir, 'assets', 'models'), { recursive: true });
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>Monster Battle 9001</title>');
  writeFileSync(join(clientDir, 'assets', 'index-Bq3xK9pZ.js'), 'console.log("game")');
  writeFileSync(join(clientDir, 'assets', 'models', 'army_tank.glb'), 'glb');
  ts = await startTestServer({ graceSeconds: GRACE_SECONDS, clientDir });
});

afterAll(async () => {
  for (const p of open) p.stopInputs();
  await ts.server.close();
  rmSync(clientDir, { recursive: true, force: true });
});

describe('http', () => {
  it('answers the health check', async () => {
    const res = await fetch(`${ts.url}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, game: 'monster-battle-9001', protocol: 1, fast: true });
  });

  it('serves the built client, and the game page for any page address', async () => {
    const page = await fetch(`${ts.url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await page.text()).toContain('Monster Battle 9001');

    const deep = await fetch(`${ts.url}/join/BCDF`, { headers: { accept: 'text/html' } });
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('Monster Battle 9001');
  });

  it('lets browsers keep hashed build files and revalidate everything else', async () => {
    const hashed = await fetch(`${ts.url}/assets/index-Bq3xK9pZ.js`);
    expect(hashed.status).toBe(200);
    expect(hashed.headers.get('cache-control')).toContain('immutable');
    const model = await fetch(`${ts.url}/assets/models/army_tank.glb`);
    expect(model.status).toBe(200);
    expect(model.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers 404 for a missing file instead of the game page', async () => {
    const res = await fetch(`${ts.url}/assets/models/missing.glb`, { headers: { accept: 'text/html,*/*' } });
    expect(res.status).toBe(404);
    // A script asking for something that is not there gets a 404 too, not a web page.
    const api = await fetch(`${ts.url}/no/such/api`);
    expect(api.status).toBe(404);
  });
});

describe('real time', () => {
  it('simulates 30 ticks and sends 15 snapshots a second', async () => {
    const [solo] = await startedRoom(1, 10);
    // A lone player who does not volunteer leads a squad against a bot kaiju.
    expect(solo.welcome.playerId).toBe(1);
    solo.startInputs({ moveZ: 1 });
    await until(() => solo.snapshots.length > 0, 'the first snapshot');

    const from = solo.snapshots.length;
    const tick0 = solo.snapshot.tick;
    const t0 = performance.now();
    await sleep(2000);
    const seconds = (performance.now() - t0) / 1000;
    const ticks = solo.snapshot.tick - tick0;
    const snaps = solo.snapshots.length - from;

    // Never faster than real time; allowed to run a little behind on a busy machine.
    expect(ticks).toBeLessThanOrEqual(Math.ceil(seconds * TICK_RATE) + 3);
    expect(ticks).toBeGreaterThanOrEqual(seconds * TICK_RATE * 0.6);
    expect(snaps).toBeLessThanOrEqual(Math.ceil(seconds * SNAPSHOT_RATE) + 2);
    expect(snaps).toBeGreaterThanOrEqual(seconds * SNAPSHOT_RATE * 0.5);
    // The acknowledgement follows the inputs closely: a few in flight or queued, no more.
    expect(solo.lastSeq - solo.snapshot.ackSeq).toBeLessThanOrEqual(10);
    expect(solo.snapshot.ackSeq).toBeGreaterThan(40);

    // A latency probe comes straight back.
    solo.client.send('ping', { t: 4242 });
    await until(() => solo.pongs.length === 1, 'the pong');
    expect(solo.pongs[0].t).toBe(4242);
    expect(solo.pongs[0].tick).toBeGreaterThan(tick0);

    // The health check carries the loop's own timing: it has measured this match.
    const perf = ts.server.health().perf;
    expect(perf.samples).toBeGreaterThan(30);
    expect(perf.updateMs.mean).toBeGreaterThan(0);
    expect(perf.updateMs.max).toBeGreaterThanOrEqual(perf.updateMs.p99);
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(TICK_RATE * 0.6);
    expect(perf.ticksPerSecond).toBeLessThanOrEqual(TICK_RATE * 1.1);
    await solo.leave();
  });
});

describe('reconnecting', () => {
  it('restores a cut connection by itself and resumes the same seat and slot', async () => {
    // The host plays the kaiju, so the other player leads a squad.
    const [host, other] = await startedRoom(2, 20, 0);
    for (const p of [host, other]) p.startInputs({ moveZ: 1 });
    await until(() => other.snapshots.length > 5 && other.snapshot.ackSeq > 0, 'play to be under way');
    const slot = other.welcome.playerId;
    expect(slot).toBe(1);
    const ackBefore = other.snapshot.ackSeq;
    const squadIsBot = (p: Player): boolean | undefined => p.snapshot.squads.find((s) => s.player === slot)?.bot;
    expect(squadIsBot(host)).toBe(false);

    other.client.cut(true);
    await until(() => host.lobby.players[1].connected === false, 'the host to see the drop');
    await until(() => host.snapshots.some((s) => s.squads.find((q) => q.player === slot)?.bot), 'a bot to cover the squad');
    await until(() => other.reconnects === 1, 'the library to reconnect', GRACE_SECONDS * 1000);
    await until(() => other.welcomes.length === 2, 'a fresh welcome after reconnecting');
    expect(other.drops).toBe(1);
    expect(other.closedCode).toBeNull();
    expect(other.seat).toBe(1);
    expect(other.welcome.playerId).toBe(slot);
    expect(other.welcome.tick).toBeGreaterThan(other.welcomes[0].tick);
    await until(() => host.lobby.players[1].connected === true, 'the host to see the return');
    // The same page keeps counting its inputs, so the acknowledgement carries on from before.
    const snapsBefore = other.snapshots.length;
    await until(() => other.snapshots.length > snapsBefore + 3, 'snapshots after reconnecting');
    expect(other.snapshot.ackSeq).toBeGreaterThanOrEqual(ackBefore);
    await until(() => squadIsBot(host) === false && squadIsBot(other) === false, 'the squad to be back in human hands');
    for (const p of [host, other]) await p.leave();
  });

  it('gives the seat to the newest connection that shows the same token', async () => {
    const first = await track(Player.create(ts.url, options(30)));
    await until(() => first.lobbies.length > 0, 'the lobby');
    const second = await track(Player.join(ts.url, first.code, { name: 'Second Tab', token: token(30) }));
    await until(() => second.lobbies.length > 0, 'the lobby on the second connection');
    await until(() => first.closedCode !== null, 'the first connection to be closed');
    expect(first.closedCode).toBe(CLOSE_REPLACED);
    expect(second.seat).toBe(0);
    expect(second.lobby.players.length).toBe(1);
    expect(second.lobby.players[0]).toMatchObject({ name: 'Tester 30', connected: true });
    expect(second.lobby.host).toBe(0);
    await second.leave();
  });

  it('cuts off a client that floods the server, and the room carries on', async () => {
    const host = await track(Player.create(ts.url, options(60)));
    const flooder = await track(Player.join(ts.url, host.code, options(61)));
    await until(() => host.lobbies.length > 0 && host.lobby.players.length === 2, 'both seated');
    for (let i = 0; i < 2000; i++) flooder.client.send('ping', { t: i });
    await until(() => flooder.closedCode !== null, 'the flooder to be cut off');
    expect(flooder.closedCode).not.toBe(4000);
    expect(flooder.pongs.length).toBeLessThan(2000);
    await until(() => host.lobby.players[1].connected === false, 'the lobby to show the flooder gone');
    // The other player is unaffected and can start a match.
    host.client.send('start', {});
    await until(() => host.welcomes.length === 1, 'the match to start');
    host.client.send('ping', { t: 1 });
    await until(() => host.pongs.length === 1, 'the pong');
    await host.leave();
  });

  it('gives a seat up after the grace period, and closes the room when nobody is left', async () => {
    const host = await track(Player.create(ts.url, options(40)));
    const guest = await track(Player.join(ts.url, host.code, options(41)));
    await until(() => host.lobbies.length > 0 && host.lobby.players.length === 2, 'both seated');
    const code = host.code;

    const guestCutAt = performance.now();
    guest.client.cut(false);
    await until(() => host.lobby.players.length === 2 && host.lobby.players[1].connected === false, 'the drop to show');
    await until(() => host.lobby.players.length === 1, 'the seat to be given up', (GRACE_SECONDS + 5) * 1000);
    expect(performance.now() - guestCutAt).toBeGreaterThanOrEqual(GRACE_SECONDS * 1000 - 100);

    // The room lives on while anybody holds a seat, even a dropped one...
    const hostCutAt = performance.now();
    host.client.cut(false);
    await sleep(GRACE_SECONDS * 500);
    expect(ts.server.roomCodes()).toContain(code);
    // ...and closes once the last one is given up.
    await until(() => !ts.server.roomCodes().includes(code), 'the room to close', (GRACE_SECONDS + 5) * 1000);
    expect(performance.now() - hostCutAt).toBeGreaterThanOrEqual(GRACE_SECONDS * 1000 - 100);
  });
});
