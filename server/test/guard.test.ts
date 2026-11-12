/**
 * The front door: what the server does with web requests before the room library or the page
 * handler sees them. Oversized bodies, malformed requests and visitors who hammer matchmaking
 * must never take the process down, stall the room loops or lock anybody out. One real server
 * on a free port for the whole file; requests are written by hand so they can be as wrong as
 * a stranger's script would make them.
 */

import { buildStamp, CLOSE_JOIN_TIMEOUT, JOIN_ERROR, ROOM_NAME } from '@mb/shared';
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRequest, createLimiter, DEFAULT_RATE_LIMITS, MAX_BODY_BYTES, senderOf } from '../src/http/guard';
import { MAX_BACKLOG_BYTES, MAX_WAITING_ROOMS, sendBounded } from '../src/net/matchRoom';
import { options, Player, startTestServer, token, until, type TestServer } from './netHelpers';

/** Rooms with somebody in them that the test server allows. */
const MAX_ROOMS = 3;
/** Seconds a join request waits for its connection, and a connection for its handshake, on the test server. */
const RESERVATION_SECONDS = 1;
const JOIN_TIMEOUT_SECONDS = 1;

let ts: TestServer;
const open: Player[] = [];
/** Rejections nobody handled while this file ran: each one would have ended a real server. */
const unhandled: unknown[] = [];
const onUnhandled = (err: unknown): void => {
  unhandled.push(err);
};

async function track(p: Promise<Player>): Promise<Player> {
  const player = await p;
  open.push(player);
  return player;
}

interface RawResponse {
  /** HTTP status, or 0 when the server closed the connection without answering. */
  status: number;
  head: string;
  body: string;
}

/** Sends bytes exactly as given on a fresh connection and collects whatever comes back. */
function raw(request: string | Buffer, waitMs = 3000): Promise<RawResponse> {
  return new Promise((resolve) => {
    const socket = connect(ts.server.port, '127.0.0.1');
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      const text = Buffer.concat(chunks).toString('latin1');
      const split = text.indexOf('\r\n\r\n');
      const head = split < 0 ? text : text.slice(0, split);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0);
      resolve({ status, head, body: split < 0 ? '' : text.slice(split + 4) });
    };
    const timer = setTimeout(finish, waitMs);
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      // Every answer asked for here is small and complete in one piece once its head is in.
      if (Buffer.concat(chunks).includes('\r\n\r\n')) setTimeout(finish, 30);
    });
    socket.on('error', finish);
    socket.on('close', finish);
    socket.on('connect', () => {
      // A server that refuses early may reset the connection while the rest is still being sent.
      socket.write(request, () => undefined);
    });
  });
}

function post(path: string, body: string, headers: string[] = [], host = `127.0.0.1:${ts.server.port}`): string {
  return (
    [`POST ${path} HTTP/1.1`, `Host: ${host}`, 'Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`, 'Connection: close', ...headers].join(
      '\r\n',
    ) +
    '\r\n\r\n' +
    body
  );
}

async function healthy(): Promise<boolean> {
  const res = await fetch(`${ts.url}/healthz`);
  return res.status === 200 && ((await res.json()) as { ok: boolean }).ok;
}

/** A matchmaking request with nothing behind it: no WebSocket is ever opened for the answer. */
async function bare(method: 'create' | 'joinById', room: string, body: object = {}, visitor?: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${ts.url}/matchmake/${method}/${room}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(visitor ? { 'cf-connecting-ip': visitor } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

async function rooms(): Promise<number> {
  return ((await (await fetch(`${ts.url}/healthz`)).json()) as { rooms: number }).rooms;
}

beforeAll(async () => {
  process.on('unhandledRejection', onUnhandled);
  ts = await startTestServer({ maxRooms: MAX_ROOMS, reservationSeconds: RESERVATION_SECONDS, joinTimeoutSeconds: JOIN_TIMEOUT_SECONDS });
});

afterAll(async () => {
  for (const p of open) p.stopInputs();
  await ts.server.close();
  process.off('unhandledRejection', onUnhandled);
});

describe('request bodies', () => {
  it('refuses a matchmaking body of 1 MB with 413 instead of reading it', async () => {
    const big = JSON.stringify({ name: 'x'.repeat(1024 * 1024) });
    const t0 = performance.now();
    const res = await raw(post(`/matchmake/joinById/ZZZZ`, big));
    expect(res.status).toBe(413);
    // Refused on the header alone: nothing waits for a megabyte to arrive and be parsed.
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(await healthy()).toBe(true);
  });

  it('refuses a body that announces no length (chunked), whatever its real size', async () => {
    const res = await raw(
      [`POST /matchmake/create/${ROOM_NAME} HTTP/1.1`, `Host: 127.0.0.1:${ts.server.port}`, 'Transfer-Encoding: chunked', 'Connection: close'].join('\r\n') +
        '\r\n\r\n5\r\nhello\r\n',
    );
    expect(res.status).toBe(413);
    expect(await rooms()).toBe(0);
  });

  it('applies the same limit to every address, not only to matchmaking', async () => {
    const res = await raw(post('/healthz', 'y'.repeat(MAX_BODY_BYTES + 1)));
    expect(res.status).toBe(413);
  });

  it('still lets an ordinary create and join through', async () => {
    const host = await track(Player.create(ts.url, options(1)));
    const guest = await track(Player.join(ts.url, host.code, options(2)));
    await until(() => guest.lobbies.length > 0 && guest.lobby.players.length === 2, 'both seated');
    await host.leave();
    await guest.leave();
    await until(() => ts.server.roomCodes().length === 0, 'the room to close');
  });
});

describe('rooms and join requests with nobody behind them', () => {
  it('cannot fill the server: seventy creates with no connection leave room for a real one', async () => {
    const answers = await Promise.all(Array.from({ length: 70 }, () => bare('create', ROOM_NAME)));
    // None of them is refused for lack of room, although the limit is three rooms.
    expect(answers.every((a) => a.status === 200)).toBe(true);
    expect(await rooms()).toBeLessThanOrEqual(MAX_WAITING_ROOMS);

    const host = await track(Player.create(ts.url, options(10)));
    await until(() => host.lobbies.length > 0, 'the real creator to be seated');
    expect(host.lobby.players.length).toBe(1);

    // And they go away by themselves once the wait for their creators is over.
    await until(() => ts.server.roomCodes().length === 1, 'the waiting rooms to close', (RESERVATION_SECONDS + 3) * 1000);
    expect(ts.server.roomCodes()).toEqual([host.code]);
    await host.leave();
  });

  it('counts only rooms somebody is in against the room limit', async () => {
    const hosts: Player[] = [];
    for (let i = 0; i < MAX_ROOMS; i++) hosts.push(await track(Player.create(ts.url, options(20 + i))));
    const refused = await Player.create(ts.url, options(29)).catch((err: unknown) => err);
    expect((refused as { code?: number } | null)?.code).toBe(JOIN_ERROR.serverFull);
    for (const h of hosts) await h.leave();
    await until(() => ts.server.roomCodes().length === 0, 'the rooms to close');
  });

  it('cannot lock a room: thirty join requests with no connection do not keep players out', async () => {
    const host = await track(Player.create(ts.url, options(30)));
    const answers = await Promise.all(Array.from({ length: 30 }, () => bare('joinById', host.code, { name: 'Nobody' })));
    expect(answers.every((a) => a.status === 200)).toBe(true);

    // A friend can still join, and the host's own reload (same token) gets its seat back.
    const friend = await track(Player.join(ts.url, host.code, options(31)));
    const reloaded = await track(Player.join(ts.url, host.code, options(30)));
    await until(() => reloaded.lobbies.length > 0 && friend.lobbies.length > 0, 'both to be seated');
    expect(reloaded.seat).toBe(0);
    expect(reloaded.lobby.players.map((p) => p.name)).toEqual(['Tester 30', 'Tester 31']);
    await friend.leave();
    await reloaded.leave();
    await until(() => ts.server.roomCodes().length === 0, 'the room to close');
  });

  it('closes a connection that never finishes joining and takes its seat back', async () => {
    const host = await track(Player.create(ts.url, options(40)));
    const seatOffer = await bare('joinById', host.code, { name: 'Zombie', token: token(41), build: buildStamp() });
    expect(seatOffer.status).toBe(200);
    const { processId, roomId, sessionId } = seatOffer.data as { processId: string; roomId: string; sessionId: string };

    // A raw socket that connects and then never answers the server's join offer.
    const zombie = new WebSocket(`ws://127.0.0.1:${ts.server.port}/${processId}/${roomId}?sessionId=${sessionId}`);
    let closeCode = 0;
    zombie.addEventListener('close', (event) => (closeCode = event.code));
    await until(() => host.lobby.players.length === 2, 'the zombie to be given a seat');
    expect(host.lobby.players[1].name).toBe('Zombie');

    const t0 = performance.now();
    await until(() => host.lobby.players.length === 1, 'the zombie seat to be taken back', (JOIN_TIMEOUT_SECONDS + 4) * 1000);
    expect(performance.now() - t0).toBeGreaterThan(JOIN_TIMEOUT_SECONDS * 1000 - 300);
    await until(() => closeCode !== 0, 'the zombie socket to be closed');
    expect(closeCode).toBe(CLOSE_JOIN_TIMEOUT);
    // The seat was given up at once: no grace period for a connection that never joined.
    expect(host.lobby.players.map((p) => p.name)).toEqual(['Tester 40']);
    await host.leave();
    await until(() => ts.server.roomCodes().length === 0, 'the room to close');
  });

  it('stops queueing for a connection whose backlog is over the limit, and cuts it once', () => {
    const sent: string[] = [];
    let cuts = 0;
    const client = {
      ref: { bufferedAmount: 0 },
      send: (type: string) => sent.push(type),
      sendBytes: (type: string) => sent.push(`${type} (bytes)`),
    };
    // The room library's client has many more members than a send needs.
    const send = (type: 'pong' | 'snap'): boolean =>
      sendBounded(client as never, type, type === 'snap' ? new Uint8Array(4) : { t: 1, tick: 2 }, MAX_BACKLOG_BYTES, () => cuts++);

    expect(send('pong')).toBe(true);
    client.ref.bufferedAmount = MAX_BACKLOG_BYTES;
    expect(send('snap')).toBe(true);
    client.ref.bufferedAmount = MAX_BACKLOG_BYTES + 1;
    expect(send('snap')).toBe(false);
    expect(send('pong')).toBe(false);
    expect(sent).toEqual(['pong', 'snap (bytes)']);
    expect(cuts).toBe(2);
  });
});

describe('one visitor hammering matchmaking', () => {
  const visitor = '203.0.113.7';

  it('may create a few rooms a minute, then is told to wait; other visitors are not affected', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < DEFAULT_RATE_LIMITS.createsPerMinute + 3; i++) statuses.push((await bare('create', ROOM_NAME, {}, visitor)).status);
    expect(statuses.slice(0, DEFAULT_RATE_LIMITS.createsPerMinute).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(DEFAULT_RATE_LIMITS.createsPerMinute)).toEqual([429, 429, 429]);
    const refused = await bare('create', ROOM_NAME, {}, visitor);
    expect(refused.data.code).toBe(JOIN_ERROR.busy);

    expect((await bare('create', ROOM_NAME, {}, '203.0.113.8')).status).toBe(200);
    // This machine itself (no tunnel header) is never limited: the host, development, tests.
    expect((await bare('create', ROOM_NAME)).status).toBe(200);
  });

  it('may try a dozen wrong room codes a minute, then every join is refused for a while', async () => {
    const guesser = '203.0.113.20';
    const host = await track(Player.create(ts.url, options(50)));
    for (let i = 0; i < DEFAULT_RATE_LIMITS.missesPerMinute; i++) {
      const miss = await bare('joinById', 'ZZZZ', {}, guesser);
      expect(miss.status).toBe(404);
    }
    // Even the right code is refused now, so sweeping the codes finds nothing.
    const hit = await bare('joinById', host.code, {}, guesser);
    expect(hit.status).toBe(429);
    expect(hit.data.code).toBe(JOIN_ERROR.busy);
    // Somebody else who knows the code walks in.
    expect((await bare('joinById', host.code, {}, '203.0.113.21')).status).toBe(200);
    await host.leave();
  });

  it('tells visitors apart by the tunnel header, and never limits this machine', () => {
    const local = { remoteAddress: '127.0.0.1' };
    expect(senderOf({ headers: { 'cf-connecting-ip': '198.51.100.4' }, socket: local })).toBe('198.51.100.4');
    expect(senderOf({ headers: { 'cf-connecting-ip': '2001:db8::1' }, socket: local })).toBe('2001:db8::1');
    expect(senderOf({ headers: {}, socket: local })).toBeNull();
    expect(senderOf({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBeNull();
    expect(senderOf({ headers: {}, socket: { remoteAddress: '192.168.1.20' } })).toBe('192.168.1.20');
    // A header that is not an address is not believed.
    expect(senderOf({ headers: { 'cf-connecting-ip': 'x'.repeat(200) }, socket: { remoteAddress: '192.168.1.20' } })).toBe('192.168.1.20');
  });

  it('counts per key in a window that starts over after a minute', () => {
    let t = 0;
    const limiter = createLimiter(2, 60_000, () => t);
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([true, true, false]);
    expect(limiter.over('a')).toBe(true);
    expect(limiter.over('b')).toBe(false);
    expect(limiter.hit('b')).toBe(true);
    t = 60_000;
    expect(limiter.over('a')).toBe(false);
    expect(limiter.hit('a')).toBe(true);
    // A limit of 0 means no limit.
    const off = createLimiter(0, 60_000, () => t);
    for (let i = 0; i < 100; i++) expect(off.hit('a')).toBe(true);
  });
});

describe('the request check', () => {
  const check = (headers: Record<string, string>, url = '/matchmake/create/mb'): number => checkRequest({ url, headers, method: 'POST' })?.status ?? 0;

  it('lets plain requests through and names what is wrong with the others', () => {
    expect(check({ host: 'example.trycloudflare.com', 'content-length': '120' })).toBe(0);
    expect(check({ host: 'localhost:5173' })).toBe(0);
    expect(check({ host: '192.168.1.20:2567', 'content-length': String(MAX_BODY_BYTES) })).toBe(0);
    expect(check({ host: '[::1]:2567' })).toBe(0);
    expect(check({ host: 'my_pc:2567' })).toBe(0);
    expect(check({})).toBe(0);

    expect(check({ host: 'a b' })).toBe(400);
    expect(check({ host: 'evil.example/..' })).toBe(400);
    expect(check({ host: 'user@example.com' })).toBe(400);
    expect(check({ host: 'x' }, 'http://elsewhere/')).toBe(400);
    expect(check({ host: 'x' }, '*')).toBe(400);
    expect(check({ host: 'x', 'content-length': String(MAX_BODY_BYTES + 1) })).toBe(413);
    expect(check({ host: 'x', 'content-length': '1e3' })).toBe(413);
    expect(check({ host: 'x', 'transfer-encoding': 'chunked' })).toBe(413);
  });

  it('keeps only a believable X-Forwarded-Proto', () => {
    const headers: Record<string, string> = { host: 'x', 'x-forwarded-proto': 'HTTPS, http', ':authority': 'elsewhere' };
    expect(checkRequest({ url: '/', headers, method: 'GET' })).toBeNull();
    expect(headers['x-forwarded-proto']).toBe('https');
    expect(headers[':authority']).toBeUndefined();
    const bad: Record<string, string> = { host: 'x', 'x-forwarded-proto': 'ht tp' };
    expect(checkRequest({ url: '/', headers: bad, method: 'GET' })).toBeNull();
    expect(bad['x-forwarded-proto']).toBeUndefined();
  });
});

describe('malformed requests', () => {
  it('answers 400 to a Host header that is not a host name, and keeps running', async () => {
    const before = new Set(ts.server.roomCodes());
    for (const host of ['a b', '[', 'exa mple.com:80', 'a/b', '']) {
      const res = await raw(post(`/matchmake/create/${ROOM_NAME}`, '{}', [], host));
      expect(res.status, `Host: "${host}"`).toBe(400);
    }
    expect(await healthy()).toBe(true);
    // None of them got as far as creating a room.
    expect(ts.server.roomCodes().filter((code) => !before.has(code))).toEqual([]);
  });

  it('ignores a nonsense X-Forwarded-Proto header instead of building an address from it', async () => {
    const res = await raw(post('/matchmake/joinById/ZZZZ', '{}', ['X-Forwarded-Proto: ht tp']));
    // The request itself is fine: it is answered like any other join of a room that does not exist.
    expect(res.status).toBe(404);
    expect(res.body).toContain('"code":522');
    expect(await healthy()).toBe(true);
  });

  it('drops a WebSocket upgrade whose address cannot be parsed', async () => {
    const upgrade = (target: string): string =>
      [
        `GET ${target} HTTP/1.1`,
        `Host: 127.0.0.1:${ts.server.port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
      ].join('\r\n') + '\r\n\r\n';
    for (const target of ['*^', 'http://[', 'ws://example.com/a/b', '/a b']) {
      const res = await raw(upgrade(target), 1000);
      expect(res.status, `target "${target}"`).not.toBe(101);
    }
    expect(await healthy()).toBe(true);
  });

  it('survives request lines and bodies that are simply wrong', async () => {
    const port = ts.server.port;
    const junk = [
      'GET / HTTP/9.9\r\n\r\n',
      'NONSENSE\r\n\r\n',
      `POST /matchmake/create/${ROOM_NAME} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: abc\r\n\r\n`,
      post(`/matchmake/create/${ROOM_NAME}`, '{"name":'),
      post(`/matchmake/create/${ROOM_NAME}`, '[1,2,3]'),
      post(`/matchmake/create/${ROOM_NAME}`, 'null'),
      post('/matchmake/create/__proto__', '{}'),
      post('/matchmake/constructor/mb', '{}'),
      post('/matchmake/joinById/%00%ff', '{}'),
      post(`/matchmake/create/${ROOM_NAME}?${'q='.repeat(2000)}`, '{}'),
      `GET http://[/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
      `OPTIONS * HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
    ];
    for (const request of junk) await raw(request, 1000);
    expect(await healthy()).toBe(true);
  });

  it('left no rejected promise unhandled: none of the above could have ended the process', async () => {
    // Rejections surface a turn of the event loop after the request that caused them.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(unhandled).toEqual([]);
    expect(JOIN_ERROR.roomFull).toBe(4401);
  });
});
