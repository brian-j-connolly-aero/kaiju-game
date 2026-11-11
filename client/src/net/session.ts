/**
 * What a browser remembers between page loads: the session token that gives a player their
 * seat back (ARCHITECTURE.md section 4.1), the callsign, and the room code in the page address.
 */

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SESSION_TOKEN_PATTERN } from '@mb/shared';

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
