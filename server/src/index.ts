/**
 * Entry point: `npm start` (the bundle in dist/) and `npm run dev` (this file through tsx).
 * Reads the environment (see config.ts for every variable), starts the one server, and says
 * where it is listening.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from './config';
import { installCrashGuard } from './crashGuard';
import { startGameServer } from './net/server';

// This file sits one folder below the server package both as source (src/) and as the bundle
// (dist/), so the built client is always at ../../client/dist from here.
const here = dirname(fileURLToPath(import.meta.url));
const defaultClientDir = resolve(here, '..', '..', 'client', 'dist');

const quiet = process.env.MB_QUIET === '1';
/** The time on the host's own clock, as hh:mm:ss. */
function clock(): string {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
const log = (line: string): void => {
  console.log(`${clock()} ${line}`);
};
/** Failures are printed whatever MB_QUIET says: they are what the host is asked to copy. */
const logError = (line: string): void => {
  console.error(`${clock()} ${line}`);
};

// From here on an error nobody caught is written down and the server keeps running.
installCrashGuard(process, logError);

try {
  const config = configFromEnv(process.env, {
    clientDir: defaultClientDir,
    handleSignals: true,
    log: quiet ? undefined : log,
    logError,
  });
  if (config.clientDir) config.clientDir = resolve(config.clientDir);
  const server = await startGameServer(config);

  const hasClient = config.clientDir !== null && existsSync(join(config.clientDir, 'index.html'));
  const notes = [
    `build ${server.build()}`,
    config.checkBuild ? '' : 'pages from any build are let in (MB_ANY_BUILD)',
    config.fast ? 'fast timers (MB_FAST)' : '',
    config.latencyMs > 0 ? `${config.latencyMs} ms simulated latency` : '',
    config.speed !== 1 ? `simulation speed x${config.speed}` : '',
  ].filter(Boolean);
  console.log(
    `Monster Battle 9001 server on port ${server.port}` +
      (config.host ? ` (${config.host})` : '') +
      `: open http://localhost:${server.port}/` +
      (hasClient ? '' : ' (the game page is not built yet: run "npm run build")') +
      (notes.length > 0 ? ` [${notes.join(', ')}]` : ''),
  );
} catch (err) {
  const code = (err as { code?: unknown } | null)?.code;
  const reason =
    code === 'EADDRINUSE'
      ? 'the port is already in use. Is another copy of the server running? Set PORT to use a different one.'
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`The server could not start: ${reason}`);
  process.exit(1);
}
