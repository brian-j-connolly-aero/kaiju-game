/**
 * Entry point: `npm start` (the bundle in dist/) and `npm run dev` (this file through tsx).
 * Reads the environment (see config.ts for every variable), starts the one server, and says
 * where it is listening.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from './config';
import { startGameServer } from './net/server';

// This file sits one folder below the server package both as source (src/) and as the bundle
// (dist/), so the built client is always at ../../client/dist from here.
const here = dirname(fileURLToPath(import.meta.url));
const defaultClientDir = resolve(here, '..', '..', 'client', 'dist');

const quiet = process.env.MB_QUIET === '1';
const log = (line: string): void => {
  console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
};

try {
  const config = configFromEnv(process.env, {
    clientDir: defaultClientDir,
    handleSignals: true,
    log: quiet ? undefined : log,
  });
  if (config.clientDir) config.clientDir = resolve(config.clientDir);
  const server = await startGameServer(config);

  const hasClient = config.clientDir !== null && existsSync(join(config.clientDir, 'index.html'));
  const notes = [
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
  console.error(`The server could not start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
