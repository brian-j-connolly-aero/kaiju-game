/**
 * The server as the host runs it: a process of its own, started from the entry point, with
 * the room log switched off (MB_QUIET=1). Nothing a stranger can send and no stray error may
 * end it, failures are printed whatever MB_QUIET says, and a stop signal still closes it
 * cleanly.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CRASH_REPORTS_PER_MINUTE, installCrashGuard } from '../src/crashGuard';
import { until } from './netHelpers';

const here = dirname(fileURLToPath(import.meta.url));

let child: ChildProcess;
let port = 0;
let out = '';
let err = '';
let exit: { code: number | null; signal: string | null } | null = null;

function send(request: string, waitMs = 1500): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    let answer = '';
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(answer.split('\r\n')[0] ?? '');
    };
    const timer = setTimeout(finish, waitMs);
    socket.on('data', (chunk: Buffer) => {
      answer += chunk.toString('latin1');
      if (answer.includes('\r\n\r\n')) finish();
    });
    socket.on('close', finish);
    socket.on('error', finish);
    socket.on('connect', () => socket.write(request, () => undefined));
  });
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    return res.status === 200;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  child = spawn(process.execPath, ['--import', 'tsx', '--import', join(here, 'fixtures', 'strayErrors.mjs'), join(here, '..', 'src', 'index.ts')], {
    cwd: join(here, '..'),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', MB_QUIET: '1', MB_FAST: '1', MB_CLIENT_DIR: join(here, 'no-such-folder') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString()));
  child.on('exit', (code, signal) => (exit = { code, signal }));
  await until(() => /server on port \d+/.test(out) || exit !== null, 'the server process to start', 25_000);
  port = Number(/server on port (\d+)/.exec(out)?.[1] ?? 0);
}, 30_000);

afterAll(() => {
  if (exit === null) child.kill('SIGKILL');
});

describe('the server process', () => {
  it('starts and answers', async () => {
    expect(exit).toBeNull();
    expect(port).toBeGreaterThan(0);
    expect(await healthy()).toBe(true);
  });

  it('is not ended by the requests that used to end it', async () => {
    const post = (headers: string[], body: string): string =>
      ['POST /matchmake/create/mb HTTP/1.1', ...headers, 'Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`, 'Connection: close'].join('\r\n') +
      '\r\n\r\n' +
      body;
    expect(await send(post(['Host: a b'], '{}'))).toContain('400');
    expect(await send(post(['Host: ['], '{}'))).toContain('400');
    expect(await send(post([`Host: 127.0.0.1:${port}`, 'X-Forwarded-Proto: ht tp'], '{}'))).toContain('200');
    await send(
      [`GET *^ HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13'].join(
        '\r\n',
      ) + '\r\n\r\n',
      500,
    );
    expect(await send(post([`Host: 127.0.0.1:${port}`], JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) })))).toContain('413');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(exit).toBeNull();
    expect(await healthy()).toBe(true);
    // None of them even reached the safety net.
    expect(err).not.toContain('internal error');
  });

  it('writes a stray error down, even with the room log off, and keeps serving', async () => {
    child.kill('SIGUSR2');
    await until(() => err.includes('stray rejection (test)') && err.includes('stray exception (test)'), 'both stray errors to be reported', 5000);
    expect(err).toContain('the server keeps running');
    // A local time of day in front, not a bare stack trace.
    expect(err).toMatch(/^\d\d:\d\d:\d\d An internal error was caught/m);
    expect(exit).toBeNull();
    expect(await healthy()).toBe(true);
  });

  it('stops cleanly when asked to', async () => {
    child.kill('SIGTERM');
    await until(() => exit !== null, 'the server process to exit', 10_000);
    expect(exit).toEqual({ code: 0, signal: null });
  });
});

describe('the crash guard', () => {
  it('reports every error once and sums up a storm instead of flooding the window', () => {
    const source = new EventEmitter();
    const lines: string[] = [];
    let t = 0;
    const remove = installCrashGuard(source, (line) => lines.push(line), () => t);

    source.emit('unhandledRejection', new Error('first'));
    source.emit('uncaughtException', 'second, not even an Error');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('first');
    expect(lines[0]).toContain('keeps running');
    expect(lines[1]).toContain('second, not even an Error');

    for (let i = 0; i < 100; i++) source.emit('uncaughtException', new Error(`storm ${i}`));
    expect(lines).toHaveLength(CRASH_REPORTS_PER_MINUTE);

    t += 61_000;
    source.emit('unhandledRejection', new Error('after the storm'));
    expect(lines[lines.length - 2]).toContain(`${102 - CRASH_REPORTS_PER_MINUTE} more internal errors`);
    expect(lines[lines.length - 1]).toContain('after the storm');

    remove();
    expect(source.listenerCount('unhandledRejection')).toBe(0);
    expect(source.listenerCount('uncaughtException')).toBe(0);
  });
});
