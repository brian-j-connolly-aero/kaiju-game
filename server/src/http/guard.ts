/**
 * The front door. Every web request and every WebSocket upgrade passes through here before the
 * room library or the page handler sees it, because the library reads and parses whatever it
 * is sent and lets a malformed request escape as a rejected promise.
 *
 * What is turned away, cheaply and before any body is read:
 *   - a request body longer than MAX_BODY_BYTES, or one that does not say how long it is
 *     (matchmaking sends three short fields; nothing here ever needs more);
 *   - a Host header or a request address that is not a plain one (the library builds a web
 *     address from them and fails on anything else);
 *   - a visitor who creates rooms, tries room codes or sends join requests far faster than a
 *     person does (see RateLimits).
 *
 * A visitor is identified by the CF-Connecting-IP header when there is one: behind a Cloudflare
 * Tunnel every request arrives from the same local address, and Cloudflare sets that header to
 * the real one. Without it the socket's address is used (a local network). A request from this
 * very machine with no such header is the host's own browser, a development proxy or a test,
 * and is never limited.
 *
 * This is a seat belt for a private playtest server, not a fortress: a determined attacker with
 * many addresses is out of scope.
 */

import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

/** The longest request body accepted, in bytes. Join options are a name, a token and two short stamps. */
export const MAX_BODY_BYTES = 4096;

/** Error codes in the body of a refused request (the room library's client reads `code` from it). */
export const GUARD_ERROR = {
  /** The request is malformed. */
  badRequest: 400,
  /** The body is too long, or its length is not announced. */
  tooLarge: 413,
} as const;

export interface RateLimits {
  /** Rooms one visitor may create per minute. 0 switches this limit off. */
  createsPerMinute: number;
  /** Join requests one visitor may send per minute. 0 switches this limit off. */
  joinsPerMinute: number;
  /** Wrong room codes one visitor may try per minute before every join is refused for the rest of it. 0 switches this limit off. */
  missesPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { createsPerMinute: 20, joinsPerMinute: 60, missesPerMinute: 12 };

export interface GuardOptions {
  limits: RateLimits;
  /** Error code sent (with status 429) to a visitor who is over a limit. */
  busyCode: number;
  /** Room chatter (may be switched off). */
  log?: (line: string) => void;
  /** Milliseconds, monotonic. */
  now?: () => number;
}

export interface Refusal {
  status: number;
  code: number;
  message: string;
}

// --- Checking one request -----------------------------------------------------------------------

/** A host name, an IPv4 address or a bracketed IPv6 address, with an optional port. */
const PLAIN_HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;

/** True when the address in a request line is a path this server can work with. */
export function plainTarget(target: string | undefined): boolean {
  if (!target || target[0] !== '/' || target.length > 2048) return false;
  try {
    // The same parse the library does later; it must not be the first to find out.
    new URL(`ws://server${target}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes or repairs the headers the library would build a web address from, and says why the
 * request must be refused, or null when it may pass.
 */
export function checkRequest(req: Pick<IncomingMessage, 'url' | 'headers' | 'method'>): Refusal | null {
  const headers = req.headers;
  if (!plainTarget(req.url)) return { status: 400, code: GUARD_ERROR.badRequest, message: 'bad request address' };
  if (headers.host !== undefined && !PLAIN_HOST.test(headers.host)) {
    return { status: 400, code: GUARD_ERROR.badRequest, message: 'bad Host header' };
  }
  // A proxy says whether the visitor used https. Anything but those two words is noise.
  const proto = String(headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (proto === 'http' || proto === 'https') headers['x-forwarded-proto'] = proto;
  else delete headers['x-forwarded-proto'];
  // Only HTTP/2 has this pseudo header; this server speaks HTTP/1.1, where it could only be forged.
  delete headers[':authority'];

  if (headers['transfer-encoding'] !== undefined) {
    return { status: 413, code: GUARD_ERROR.tooLarge, message: 'the request body must announce its length' };
  }
  const announced = headers['content-length'];
  if (announced !== undefined) {
    const length = /^\d{1,15}$/.test(announced) ? Number(announced) : Number.NaN;
    if (!(length <= MAX_BODY_BYTES)) {
      return { status: 413, code: GUARD_ERROR.tooLarge, message: `the request body may be at most ${MAX_BODY_BYTES} bytes` };
    }
  }
  return null;
}

const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

/**
 * Who sent this request: the visitor's address as Cloudflare reports it, else the socket's.
 * Null for this machine itself, which is never limited.
 */
export function senderOf(req: { headers: IncomingMessage['headers']; socket?: { remoteAddress?: string } }): string | null {
  const forwarded = req.headers['cf-connecting-ip'];
  if (typeof forwarded === 'string' && /^[0-9A-Fa-f:.]{2,45}$/.test(forwarded)) return forwarded;
  const address = req.socket?.remoteAddress ?? 'unknown';
  return LOOPBACK.test(address) ? null : address;
}

// --- Counting per visitor -----------------------------------------------------------------------

export interface Limiter {
  /** Counts one event for `key`. Returns false when that puts the key over the limit. */
  hit(key: string): boolean;
  /** True when `key` is over the limit right now (without counting anything). */
  over(key: string): boolean;
}

/** A fixed window counter per key: at most `max` events per `windowMs`. `max` 0 never limits. */
export function createLimiter(max: number, windowMs: number, now: () => number): Limiter {
  const windows = new Map<string, { count: number; until: number }>();
  const current = (key: string, t: number): { count: number; until: number } | undefined => {
    const w = windows.get(key);
    if (w && t >= w.until) {
      windows.delete(key);
      return undefined;
    }
    return w;
  };
  return {
    hit(key) {
      if (max <= 0) return true;
      const t = now();
      let w = current(key, t);
      if (!w) {
        // Keys of visitors who went away are swept when the table grows, so it cannot grow for ever.
        if (windows.size >= 2048) for (const [k, old] of windows) if (t >= old.until) windows.delete(k);
        w = { count: 0, until: t + windowMs };
        windows.set(key, w);
      }
      w.count++;
      return w.count <= max;
    },
    over(key) {
      if (max <= 0) return false;
      const w = current(key, now());
      return w !== undefined && w.count >= max;
    },
  };
}

// --- Wiring it in front of the server -----------------------------------------------------------

const MATCHMAKE = /^\/matchmake\/([A-Za-z]+)\//;

function answer(req: IncomingMessage, res: ServerResponse, refusal: Refusal): void {
  const body = JSON.stringify({ code: refusal.code, error: refusal.message });
  res.writeHead(refusal.status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(body);
  // The body was never read. Let what is already on its way drain into nothing for a moment,
  // so the answer is not lost to a connection reset, then hang up whatever the sender does.
  req.resume();
  const socket = req.socket;
  const timer = setTimeout(() => socket.destroy(), 1000);
  timer.unref();
  socket.once('close', () => clearTimeout(timer));
}

/**
 * Puts the guard in front of everything already listening on `server` for requests and
 * upgrades. Call it once, after the room library and the page handler have been attached.
 */
export function installFrontGuard(server: HttpServer, options: GuardOptions): void {
  const now = options.now ?? (() => performance.now());
  const minute = 60_000;
  const creates = createLimiter(options.limits.createsPerMinute, minute, now);
  const joins = createLimiter(options.limits.joinsPerMinute, minute, now);
  const misses = createLimiter(options.limits.missesPerMinute, minute, now);
  const busy = (what: string): Refusal => ({ status: 429, code: options.busyCode, message: `too many ${what}; wait a minute` });
  /** One log line per visitor and minute, not one per refused request. */
  const noted = createLimiter(1, minute, now);
  const note = (sender: string, what: string): void => {
    if (noted.hit(`${what} ${sender}`)) options.log?.(`[guard] refusing ${what} from ${sender} for a while: too many in a minute`);
  };

  /** Applies the per-visitor limits to a matchmaking request. */
  const limit = (req: IncomingMessage, res: ServerResponse): Refusal | null => {
    if (req.method !== 'POST') return null;
    const method = MATCHMAKE.exec(req.url ?? '')?.[1];
    if (!method) return null;
    const sender = senderOf(req);
    if (sender === null) return null;
    if (method === 'create') {
      if (creates.hit(sender)) return null;
      note(sender, 'room creation');
      return busy('rooms created');
    }
    if (misses.over(sender)) {
      note(sender, 'room codes');
      return busy('wrong room codes');
    }
    if (!joins.hit(sender)) {
      note(sender, 'join requests');
      return busy('join requests');
    }
    // "No such room" is only known once the library has answered.
    if (method === 'joinById') res.once('finish', () => void (res.statusCode === 404 && misses.hit(sender)));
    return null;
  };

  const onRequest = server.listeners('request') as Array<(req: IncomingMessage, res: ServerResponse) => void>;
  server.removeAllListeners('request');
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const refusal = checkRequest(req) ?? limit(req, res);
    if (refusal) {
      answer(req, res, refusal);
      return;
    }
    for (const listener of onRequest) listener.call(server, req, res);
  });

  const onUpgrade = server.listeners('upgrade') as Array<(req: IncomingMessage, socket: Duplex, head: Buffer) => void>;
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (checkRequest(req)) {
      socket.destroy();
      return;
    }
    for (const listener of onUpgrade) listener.call(server, req, socket, head);
  });
}
