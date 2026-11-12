/**
 * The server at real speed: the 30 Hz / 15 Hz rhythm, the library's automatic reconnection,
 * seat takeover, the grace period, and the HTTP side (health check, the built client, the
 * fallback page). One server on a free port for the whole file.
 */

import { buildStamp, CLOSE_REPLACED, JOIN_ERROR, rulesStamp, SNAPSHOT_RATE, TICK_RATE } from '@mb/shared';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PING_INTERVAL_MS, PING_MAX_MISSED } from '../src/net/server';
import { options, Player, sleep, startTestServer, token, until, type TestServer } from './netHelpers';

/** The page the test server serves: a production build names its script after a hash of the code. */
const PAGE = (script: string): string => `<!doctype html><title>Monster Battle 9001</title><script type="module" crossorigin src="./assets/${script}"></script>`;
const PAGE_SCRIPT = 'index-Bq3xK9pZ.js';

const GRACE_SECONDS = 4;
/** Stand-in model bytes that compress well, like the real models do. */
const KAIJU_MODEL = Buffer.from('glTF'.repeat(2000));

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
  writeFileSync(join(clientDir, 'index.html'), PAGE(PAGE_SCRIPT));
  writeFileSync(join(clientDir, 'assets', PAGE_SCRIPT), 'console.log("game")');
  writeFileSync(join(clientDir, 'assets', 'models', 'army_tank.glb'), 'glb');
  // A model the build also compressed (scripts/precompress.mjs).
  writeFileSync(join(clientDir, 'assets', 'models', 'kaiju_gragnor.glb'), KAIJU_MODEL);
  writeFileSync(join(clientDir, 'assets', 'models', 'kaiju_gragnor.glb.gz'), gzipSync(KAIJU_MODEL));
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

  it('says which build it is: the shared rules and the page it serves', async () => {
    const health = (await (await fetch(`${ts.url}/healthz`)).json()) as { build: string };
    expect(health.build).toBe(`${rulesStamp()}.${PAGE_SCRIPT}`);
    expect(health.build).toBe(buildStamp(PAGE_SCRIPT));
    expect(ts.server.build()).toBe(health.build);
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

  it('sends every deeper page address to the root, where the page can find its own files', async () => {
    const where = async (path: string): Promise<[number, string | null]> => {
      const res = await fetch(`${ts.url}${path}`, { headers: { accept: 'text/html' }, redirect: 'manual' });
      return [res.status, res.headers.get('location')];
    };
    // The page loads "./assets/..." relative to its own address: served at /join/BCDF/ it would
    // look for /join/BCDF/assets/... and stay blank. So it is only ever served at the root.
    expect(await where('/lobby/')).toEqual([302, '/']);
    expect(await where('/some/deep/address')).toEqual([302, '/']);
    expect(await where('/assets/')).toEqual([302, '/']);
    // A room code typed as a path becomes the room code the page reads.
    expect(await where('/BCDF')).toEqual([302, '/#BCDF']);
    expect(await where('/join/bcdf/')).toEqual([302, '/#BCDF']);
    expect(await where('/BCDF?debug=1')).toEqual([302, '/?debug=1#BCDF']);
    // Four letters that are not a room code (it has vowels) are just an address.
    expect(await where('/play')).toEqual([302, '/']);
    // The root itself and real files are served, not redirected.
    expect((await where('/'))[0]).toBe(200);
    expect((await where('/?debug=1'))[0]).toBe(200);
    expect((await where(`/assets/${PAGE_SCRIPT}`))[0]).toBe(200);
    // And following the redirect ends on a page whose script address resolves.
    const followed = await fetch(`${ts.url}/join/BCDF/`, { headers: { accept: 'text/html' } });
    expect(followed.redirected).toBe(true);
    expect(new URL(followed.url).pathname).toBe('/');
    const script = /src="([^"]+)"/.exec(await followed.text())?.[1] ?? '';
    expect((await fetch(new URL(script, followed.url))).status).toBe(200);
  });

  it('lets browsers keep hashed build files and revalidate everything else', async () => {
    const hashed = await fetch(`${ts.url}/assets/index-Bq3xK9pZ.js`);
    expect(hashed.status).toBe(200);
    expect(hashed.headers.get('cache-control')).toContain('immutable');
    const model = await fetch(`${ts.url}/assets/models/army_tank.glb`);
    expect(model.status).toBe(200);
    expect(model.headers.get('cache-control')).toBe('no-cache');
  });

  it('sends the compressed copy of a file to browsers that accept it, and the plain one otherwise', async () => {
    const url = `${ts.url}/assets/models/kaiju_gragnor.glb`;
    const packed = await fetch(url, { headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(packed.status).toBe(200);
    expect(packed.headers.get('content-encoding')).toBe('gzip');
    expect(packed.headers.get('content-type')).toBe('model/gltf-binary');
    expect(packed.headers.get('x-file-size')).toBe(String(KAIJU_MODEL.length));
    expect(packed.headers.get('vary')).toContain('Accept-Encoding');
    expect(packed.headers.get('cache-control')).toBe('no-cache');
    expect(Number(packed.headers.get('content-length'))).toBeLessThan(KAIJU_MODEL.length / 10);
    // fetch undoes the compression: the bytes are the model's own.
    expect(Buffer.from(await packed.arrayBuffer()).equals(KAIJU_MODEL)).toBe(true);
    const plain = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(Number(plain.headers.get('content-length'))).toBe(KAIJU_MODEL.length);
    expect(plain.headers.get('vary')).toContain('Accept-Encoding');
    // A file without a compressed copy is sent as it is, even to a browser that accepts gzip.
    const tank = await fetch(`${ts.url}/assets/models/army_tank.glb`, { headers: { 'accept-encoding': 'gzip' } });
    expect(tank.headers.get('content-encoding')).toBeNull();
    expect(await tank.text()).toBe('glb');
    // A missing file stays a 404.
    const missing = await fetch(`${ts.url}/assets/models/missing.glb`, { headers: { 'accept-encoding': 'gzip' } });
    expect(missing.status).toBe(404);
  });

  it('answers 404 for a missing file instead of the game page', async () => {
    const res = await fetch(`${ts.url}/assets/models/missing.glb`, { headers: { accept: 'text/html,*/*' } });
    expect(res.status).toBe(404);
    // A script asking for something that is not there gets a 404 too, not a web page.
    const api = await fetch(`${ts.url}/no/such/api`);
    expect(api.status).toBe(404);
  });
});

describe('pages from another build', () => {
  const refusedCode = async (p: Promise<Player>): Promise<number | undefined> => {
    try {
      await (await track(p)).leave();
      return undefined;
    } catch (err) {
      return (err as { code?: number } | null)?.code;
    }
  };

  it('lets in the page it serves, a development page and a tool built from the same rules', async () => {
    const host = await track(Player.create(ts.url, { ...options(70), build: buildStamp(PAGE_SCRIPT) }));
    // No page part: a development page (its script has no hashed name) or a command-line client.
    const guest = await track(Player.join(ts.url, host.code, { ...options(71), build: buildStamp() }));
    await until(() => guest.lobbies.length > 0 && guest.lobby.players.length === 2, 'both seated');
    await guest.leave();
    await host.leave();
  });

  it('refuses a tab left open across an update, whether the rules changed or only the page', async () => {
    const host = await track(Player.create(ts.url, options(72)));
    const code = host.code;
    // The page was rebuilt (any change to the client or the shared code renames its script).
    expect(await refusedCode(Player.join(ts.url, code, { ...options(73), build: buildStamp('index-AAAAAAAA.js') }))).toBe(JOIN_ERROR.version);
    // The rules changed (the city, a tuning number).
    expect(await refusedCode(Player.join(ts.url, code, { ...options(73), build: `00000000.${PAGE_SCRIPT}` }))).toBe(JOIN_ERROR.version);
    expect(await refusedCode(Player.join(ts.url, code, { ...options(73), build: '00000000.' }))).toBe(JOIN_ERROR.version);
    // A page from before pages carried a stamp.
    expect(await refusedCode(Player.join(ts.url, code, { ...options(73), omitBuild: true }))).toBe(JOIN_ERROR.version);
    // Creating a room is refused the same way, and leaves no room behind.
    expect(await refusedCode(Player.create(ts.url, { ...options(74), build: buildStamp('index-AAAAAAAA.js') }))).toBe(JOIN_ERROR.version);
    await until(() => ts.server.roomCodes().length === 1, 'the refused creator\'s room to close');
    expect(host.lobby.players.length).toBe(1);
    await host.leave();
  });

  it('notices a client that was rebuilt while the server runs', async () => {
    const host = await track(Player.create(ts.url, { ...options(75), build: buildStamp(PAGE_SCRIPT) }));
    const rebuilt = 'index-Zz9yX8wV.js';
    try {
      writeFileSync(join(clientDir, 'index.html'), PAGE(rebuilt));
      expect(ts.server.build()).toBe(buildStamp(rebuilt));
      // The old tab is now the stale one and is told so; a fresh load of the page gets in.
      expect(await refusedCode(Player.join(ts.url, host.code, { ...options(76), build: buildStamp(PAGE_SCRIPT) }))).toBe(JOIN_ERROR.version);
      expect(await refusedCode(Player.join(ts.url, host.code, { ...options(76), build: buildStamp(rebuilt) }))).toBeUndefined();
    } finally {
      writeFileSync(join(clientDir, 'index.html'), PAGE(PAGE_SCRIPT));
    }
    await host.leave();
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

  it('notices within a few seconds a connection that died without a word', async () => {
    // A relay between one player and the server that can go silent in both directions without
    // closing anything on the server's side: what a laptop changing networks looks like.
    const pairs: Array<{ near: Socket; far: Socket; dead: boolean }> = [];
    const relay: Server = createServer((near) => {
      const far = connect(ts.server.port, '127.0.0.1');
      const pair = { near, far, dead: false };
      pairs.push(pair);
      near.on('data', (d: Buffer) => void (pair.dead || far.write(d)));
      far.on('data', (d: Buffer) => void (pair.dead || near.write(d)));
      near.on('close', () => void (pair.dead || far.destroy()));
      far.on('close', () => void (pair.dead || near.destroy()));
      near.on('error', () => undefined);
      far.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
    const relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
    try {
      const host = await track(Player.create(ts.url, options(50)));
      const guest = await track(Player.join(relayUrl, host.code, options(51)));
      await until(() => host.lobbies.length > 0 && host.lobby.players.length === 2, 'both seated');
      // Let a ping or two go round so the test does not start in the middle of nothing.
      await sleep(PING_INTERVAL_MS + 200);
      expect(host.lobby.players[1].connected).toBe(true);

      const diedAt = performance.now();
      for (const pair of pairs) {
        pair.dead = true;
        pair.near.destroy();
      }
      await until(() => host.lobby.players[1]?.connected === false, 'the server to notice the dead connection', 8000);
      const noticedAfter = performance.now() - diedAt;
      // Missed pings, not a close: it takes at least the pings that may go unanswered...
      expect(noticedAfter).toBeGreaterThan(PING_INTERVAL_MS * (PING_MAX_MISSED - 1));
      // ...and no more than a few seconds whatever the settings are called (the library's own
      // defaults needed 6 to 9).
      expect(noticedAfter).toBeLessThan(4500);
      expect(guest.closedCode).not.toBe(4000);
      await host.leave();
    } finally {
      for (const pair of pairs) {
        pair.near.destroy();
        pair.far.destroy();
      }
      await new Promise<void>((resolve) => relay.close(() => resolve()));
    }
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
