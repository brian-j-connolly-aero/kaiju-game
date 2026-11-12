/**
 * The HTTP side of the one port: a health check, the built client when there is one, and a
 * fallback so any page address opens the game. Matchmaking requests and the WebSocket upgrade
 * are handled by the room library on the same server before a request ever gets here.
 *
 * Every address is relative to wherever the page was loaded from, so the same build works on
 * localhost, on a LAN address and behind a tunnel or reverse proxy on a single hostname.
 */

import { pageIdOf, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@mb/shared';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import type { PerfReport } from '../room/perf';

export interface HealthInfo {
  ok: true;
  game: string;
  protocol: number;
  /** The build stamp a page must carry to join (shared/src/net/build.ts). */
  build: string;
  /** Seconds since the server started. */
  uptime: number;
  rooms: number;
  players: number;
  fast: boolean;
  /** Timing of the room loop over the most recent match updates (room/perf.ts). */
  perf: PerfReport;
}

export interface AppOptions {
  /** Folder with the built client (it need not exist yet), or null to serve no page. */
  clientDir: string | null;
  health: () => HealthInfo;
}

/** File names the bundler stamps with a content hash never change, so browsers may keep them. */
const HASHED_ASSET = /-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?)$/;

const NO_CLIENT_NOTE =
  'Monster Battle 9001: the game server is running, but the game page has not been built yet.\n' +
  'Run "npm run build" and reload, or use "npm run dev" while developing.\n';

/**
 * The page part of the build stamp for the page this server serves: the hashed name of the
 * script its index.html starts, or '' when there is no built page (development, tests). Read
 * afresh every time, so a client rebuilt while the server runs is noticed.
 */
export function servedPageId(clientDir: string | null): string {
  if (!clientDir) return '';
  let html: string;
  try {
    html = readFileSync(join(clientDir, 'index.html'), 'utf8');
  } catch {
    return '';
  }
  for (const tag of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const id = pageIdOf(tag[1]);
    if (id) return id;
  }
  return '';
}

/** The room code a page address ends in ("/BCDF", "/join/bcdf/"), or '' when it does not end in one. */
export function roomCodeInPath(path: string): string {
  const last = path.split('/').filter(Boolean).pop() ?? '';
  const code = last.toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return '';
  for (const letter of code) if (!ROOM_CODE_ALPHABET.includes(letter)) return '';
  return code;
}

export function configureApp(app: Application, options: AppOptions): void {
  app.disable('x-powered-by');

  app.get('/healthz', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.json(options.health());
  });

  const dir = options.clientDir;
  if (dir) {
    app.use(
      express.static(dir, {
        index: false,
        setHeaders(res, filePath) {
          res.setHeader(
            'Cache-Control',
            HASHED_ASSET.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
  }

  // The root, and any other address a browser navigates to, opens the game. A request for a
  // missing file (it has an extension) and a request that does not ask for a page stay a 404,
  // so a missing model or sound is reported as missing instead of as a web page.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    const asksForPage = extname(req.path) === '' && (req.headers.accept ?? '').includes('text/html');
    if (!isRead || !(req.path === '/' || asksForPage)) {
      next();
      return;
    }
    if (req.path !== '/') {
      // The page finds its script and assets relative to its own address, so it only works at
      // the root: send every deeper address there. Somebody who typed the room code as a path
      // ("host/BCDF" instead of "host/#BCDF") still lands in that room.
      const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const code = roomCodeInPath(req.path);
      res.set('Cache-Control', 'no-store');
      res.redirect(302, `/${query}${code ? `#${code}` : ''}`);
      return;
    }
    if (dir && existsSync(join(dir, 'index.html'))) {
      res.set('Cache-Control', 'no-cache');
      // Relative to `root`, so a dot folder somewhere above the client is not mistaken for a hidden file.
      res.sendFile('index.html', { root: dir });
    } else {
      res.type('text/plain').send(NO_CLIENT_NOTE);
    }
  });
}
