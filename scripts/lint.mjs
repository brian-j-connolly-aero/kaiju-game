#!/usr/bin/env node
/**
 * npm run lint: lint-level sanity checks for the rules in ARCHITECTURE.md and CLAUDE.md that the
 * type checker cannot see. No dependencies; runs in well under a second.
 *
 * Rules
 *   purity      shared/src is pure: no DOM, no Node APIs, no clocks, no Math.random, no console.
 *   layering    shared never imports server or client; server and client never import each
 *               other; the room library is only imported inside server/src/net and
 *               client/src/net; three.js only inside the client.
 *   no-any      `any` needs a comment on the same line or the line above saying why.
 *   ts-comment  no @ts-ignore or @ts-nocheck; @ts-expect-error needs a reason.
 *   tests       no .only / .skip / .todo in tests (no skipped tests, ever).
 *   offline     the client loads nothing from the network: no http(s) URLs in client code.
 *
 * It also prints how many STUB(...) markers remain, as a progress gauge (never a failure).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (file) => relative(root, file).split(sep).join('/');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.vite', 'coverage', 'public']);

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * Blanks out comments and string contents (keeping line breaks and column positions) so the
 * rules below only ever match real code. Good enough for the code style used in this repo.
 */
function codeOnly(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j++;
        if (c !== '`' && text[j] === '\n') break;
        j++;
      }
      out += c + blank(text.slice(i + 1, j)) + (j < n ? text[j] : '');
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const problems = [];
function report(file, lineNo, rule, message) {
  problems.push(`${rel(file)}:${lineNo}  [${rule}]  ${message}`);
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)(['"])([^'"]+)\1/g;

function importsOf(text) {
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(line))) found.push({ spec: m[2], line: idx + 1 });
  });
  return found;
}

const PURITY = [
  [/\bMath\.random\b/, 'Math.random (use the seeded generator in math/rng.ts)'],
  [/\bDate\.now\b|\bnew\s+Date\b/, 'Date (the simulation counts ticks, never wall time)'],
  [/\bperformance\./, 'performance.* (no clocks in shared code)'],
  [/\bset(?:Timeout|Interval|Immediate)\s*\(|\brequestAnimationFrame\s*\(/, 'timers (no timers in shared code)'],
  [/\bprocess\.|\b__dirname\b|\bBuffer\b/, 'Node API'],
  [/\b(?:window|document|navigator|localStorage)\./, 'DOM API'],
  [/\bconsole\./, 'console (return or throw instead; shared code has no I/O)'],
];

const ANY_RE = /(?::|\bas)\s*any\b|<any\b|\bany\[\]|,\s*any\s*>/;
const ROOM_LIB_RE = /^(?:colyseus|colyseus\.js|@colyseus\/.*)$/;

function checkTypeScript(file) {
  const raw = readFileSync(file, 'utf8');
  const code = codeOnly(raw);
  const rawLines = raw.split('\n');
  const codeLines = code.split('\n');
  const path = rel(file);
  const inShared = path.startsWith('shared/');
  const inSharedSrc = path.startsWith('shared/src/');
  const inServer = path.startsWith('server/');
  const inClient = path.startsWith('client/');
  const isTest = /\.test\.ts$/.test(path) || path.includes('/test/');

  codeLines.forEach((line, idx) => {
    const n = idx + 1;
    if (inSharedSrc) {
      for (const [re, what] of PURITY) if (re.test(line)) report(file, n, 'purity', `shared/src must stay pure: ${what}`);
    }
    if (ANY_RE.test(line)) {
      const hasWhy = /\/\/|\/\*/.test(rawLines[idx]) || (idx > 0 && /^\s*(?:\/\/|\/?\*)/.test(rawLines[idx - 1]));
      if (!hasWhy) report(file, n, 'no-any', '`any` needs a comment explaining why (same line or the line above)');
    }
    if (isTest && /\b(?:it|test|describe)\.(?:only|skip|todo)\b|\bx(?:it|describe)\s*\(/.test(line)) {
      report(file, n, 'tests', 'no .only / .skip / .todo: every test runs, every time');
    }
    if (inClient && /https?:\/\//.test(rawLines[idx]) && !/https?:\/\/(?:www\.w3\.org|localhost|127\.0\.0\.1)/.test(rawLines[idx])) {
      // Comments may cite documentation; code and strings may not point at the network.
      const commentOnly = !/https?:\/\//.test(line) && !/(['"`]).*https?:\/\/.*\1/.test(rawLines[idx]);
      if (!commentOnly) report(file, n, 'offline', 'no network URLs in client code: the game must run fully offline');
    }
  });

  rawLines.forEach((line, idx) => {
    if (/@ts-ignore|@ts-nocheck/.test(line)) report(file, idx + 1, 'ts-comment', 'fix the type error instead of hiding it');
    const m = /@ts-expect-error(.*)$/.exec(line);
    if (m && m[1].replace(/\*\/\s*$/, '').trim().length < 8) {
      report(file, idx + 1, 'ts-comment', '@ts-expect-error needs a reason after it');
    }
  });

  for (const { spec, line } of importsOf(raw)) {
    const target = spec.startsWith('.') ? rel(resolve(dirname(file), spec)) : spec;
    if (inShared) {
      if (/^@mb\/(?:server|client)/.test(spec) || /^(?:server|client)\//.test(target)) {
        report(file, line, 'layering', 'shared code never imports from server or client');
      }
      if (spec.startsWith('.') && !target.startsWith('shared/')) {
        report(file, line, 'layering', `import leaves the shared package: ${spec}`);
      }
      if (inSharedSrc && (spec.startsWith('node:') || ROOM_LIB_RE.test(spec) || spec === 'three')) {
        report(file, line, 'purity', `shared/src must not import ${spec}`);
      }
    }
    if (inServer && (/^@mb\/client/.test(spec) || /^client\//.test(target))) {
      report(file, line, 'layering', 'server never imports from client');
    }
    if (inClient && (/^@mb\/server/.test(spec) || /^server\//.test(target))) {
      report(file, line, 'layering', 'client never imports from server');
    }
    if ((inServer || inClient) && spec.startsWith('.') && /^shared\//.test(target)) {
      report(file, line, 'layering', "import shared code as '@mb/shared', not by relative path");
    }
    if (ROOM_LIB_RE.test(spec) && !/^(?:server|client)\/src\/net\//.test(path)) {
      report(file, line, 'layering', 'the room library is only imported inside server/src/net and client/src/net');
    }
    if ((spec === 'three' || spec.startsWith('three/')) && !inClient) {
      report(file, line, 'layering', 'three.js is only imported inside the client');
    }
  }
}

function checkClientAsset(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    if (/(?:src|href)\s*=\s*["']https?:\/\/|url\(\s*["']?https?:\/\/|@import\s+["']https?:\/\//.test(line)) {
      report(file, idx + 1, 'offline', 'no CDN or remote links: the game must run fully offline');
    }
  });
}

const tsFiles = [
  ...walk(join(root, 'shared'), ['.ts']),
  ...walk(join(root, 'server'), ['.ts']),
  ...walk(join(root, 'client'), ['.ts']),
];
for (const file of tsFiles) checkTypeScript(file);
for (const file of walk(join(root, 'client'), ['.html', '.css'])) checkClientAsset(file);

// STUB inventory (informational).
const stubs = new Map();
for (const file of tsFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/STUB\(([a-z0-9-]+)\)/g)) stubs.set(m[1], (stubs.get(m[1]) ?? 0) + 1);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\nlint: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${tsFiles.length} files.`);
  process.exit(1);
}
const stubText = [...stubs.entries()].map(([tag, n]) => `${n} STUB(${tag})`).join(', ');
console.log(`lint: ${tsFiles.length} files clean.${stubText ? ` Remaining markers: ${stubText}.` : ''}`);
