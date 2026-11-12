/**
 * What a browser remembers between page loads: the session token that gives a player their
 * seat back (ARCHITECTURE.md section 4.1), the callsign, and the room code in the page address.
 * Also what the page knows about itself: which build it is, and whether it has already
 * reloaded itself for a newer one.
 */

import { pageIdOf, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SESSION_TOKEN_PATTERN } from '@mb/shared';

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Storage that may be unavailable (private windows, blocked cookies): fall back to memory. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

export function browserStore(): KeyValueStore {
  const fallback = memoryStore();
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(key) ?? fallback.getItem(key);
      } catch {
        return fallback.getItem(key);
      }
    },
    setItem(key, value) {
      fallback.setItem(key, value);
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Kept in memory only: the seat survives a dropped socket but not a page reload.
      }
    },
  };
}

export function makeToken(random: () => number = Math.random): string {
  let token = '';
  for (let i = 0; i < 24; i++) token += TOKEN_ALPHABET[Math.floor(random() * TOKEN_ALPHABET.length) % TOKEN_ALPHABET.length];
  return token;
}

/** The stored session token, made on first use. `profile` separates players sharing one browser. */
export function sessionToken(store: KeyValueStore, profile = ''): string {
  const key = `mb.token${profile ? `.${profile}` : ''}`;
  const existing = store.getItem(key);
  if (existing && SESSION_TOKEN_PATTERN.test(existing)) return existing;
  const token = makeToken();
  store.setItem(key, token);
  return token;
}

export function storedName(store: KeyValueStore, profile = ''): string {
  return store.getItem(`mb.name${profile ? `.${profile}` : ''}`) ?? '';
}

export function storeName(store: KeyValueStore, name: string, profile = ''): void {
  store.setItem(`mb.name${profile ? `.${profile}` : ''}`, name);
}

/** Cleans what someone typed or pasted into a room code: capitals, code letters only. */
export function cleanRoomCode(raw: string): string {
  let code = '';
  for (const ch of raw.toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(ch)) code += ch;
    if (code.length === ROOM_CODE_LENGTH) break;
  }
  return code;
}

/** The room code in a page address fragment ("#BCDF"), or '' when there is none. */
export function roomCodeFromHash(hash: string): string {
  const code = cleanRoomCode(hash.replace(/^#/, ''));
  return code.length === ROOM_CODE_LENGTH ? code : '';
}

// --- Which build this page is --------------------------------------------------------------------

/**
 * The page part of the build stamp (shared/src/net/build.ts): the file name of the script this
 * page was started from, which in the production build carries a hash of the code. '' in
 * development and outside a browser, where it cannot be told.
 */
export function pageId(): string {
  if (typeof document === 'undefined') return '';
  for (const script of Array.from(document.scripts)) {
    const id = pageIdOf(script.src);
    if (id) return id;
  }
  return '';
}

const RELOADED_KEY = 'mb.reloadedForBuild';

/** The part of `window` a reload needs; tests hand in a stand-in. */
export interface ReloadTarget {
  sessionStorage: KeyValueStore & { removeItem(key: string): void };
  location: { hash: string; reload(): void };
}

function reloadTarget(): ReloadTarget | null {
  return typeof window === 'undefined' ? null : window;
}

/**
 * The server refused this page as being from another build. Reloads the page to fetch the
 * current one, at most once: the reload is remembered for this tab, so a page that is still
 * refused afterwards (the server itself is the stale one) reports the failure instead of
 * reloading for ever. `code` is the room being joined, if any; it is put in the address so the
 * fresh page goes straight back to it. Returns true when a reload was started.
 */
export function reloadForNewBuild(code: string, target: ReloadTarget | null = reloadTarget()): boolean {
  if (!target) return false;
  try {
    if (target.sessionStorage.getItem(RELOADED_KEY)) return false;
    target.sessionStorage.setItem(RELOADED_KEY, '1');
    // Without storage the reload could not be remembered, and would repeat for ever.
    if (!target.sessionStorage.getItem(RELOADED_KEY)) return false;
  } catch {
    return false;
  }
  if (code) target.location.hash = `#${code}`;
  target.location.reload();
  return true;
}

/** This page was let into a room: it is current, so a later update may reload it again. */
export function forgetBuildReload(target: ReloadTarget | null = reloadTarget()): void {
  try {
    target?.sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // Nothing was remembered either.
  }
}
