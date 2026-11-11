#!/usr/bin/env node
/**
 * npm run dev: starts the `dev` script of the server and of the client side by side (hot
 * reload on both), prefixes their output, and stops both when either stops or on Ctrl+C.
 * A workspace without a `dev` script is skipped, so this works while packages are still empty.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const targets = [];
for (const dir of ['server', 'client']) {
  const file = resolve(root, dir, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.scripts && pkg.scripts.dev) targets.push({ label: dir, name: pkg.name });
}

if (targets.length === 0) {
  console.log('dev: neither the server nor the client has a `dev` script yet. Nothing to start.');
  process.exit(0);
}

const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    try {
      // Each child leads its own process group, so the whole tree (npm, then the tool) goes down.
      if (isWindows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  setTimeout(() => process.exit(code), 300);
}

function pipe(stream, label, target) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) target.write(`[${label}] ${line}\n`);
  });
  stream.on('end', () => {
    if (pending) target.write(`[${label}] ${pending}\n`);
  });
}

for (const t of targets) {
  const child = spawn('npm', ['run', 'dev', '--workspace', t.name], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    detached: !isWindows,
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  });
  children.push(child);
  pipe(child.stdout, t.label, process.stdout);
  pipe(child.stderr, t.label, process.stderr);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.log(`[${t.label}] stopped (${signal ?? `exit code ${code}`}). Stopping the rest.`);
    stopAll(code ?? 1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
