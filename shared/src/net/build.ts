/**
 * The build stamp: how the server tells a page that was built from the same game as itself
 * from one that was not (a browser tab left open across an update). Nobody bumps it by hand.
 *
 * It has two parts, written `<rules>.<page>`:
 *
 *   rules   a fingerprint of everything both sides must agree on to play together, worked out
 *           when first asked for, by the same code on the server and in the page: every
 *           definition in `defs/` (all tuning numbers, the id lists whose order is the wire
 *           encoding, the voice lines), the checksum of the generated city, and the protocol
 *           and snapshot versions. It works the same in development, in tests and in the
 *           production build, and changes whenever any of those change.
 *   page    the file name of the script the page was started from. The production build puts
 *           a hash of the code into that name, so it changes with ANY change to the client or
 *           to shared code, logic included. The server reads it from the page it serves; a
 *           page reads it from itself. In development the script has no such name and this
 *           part is empty, which means "cannot tell": then only the rules are compared.
 *
 * The page sends its stamp in the join options (`JoinOptions.build`). A page whose stamp does
 * not match, or that sends none, is refused with `JOIN_ERROR.version`; it reloads itself once
 * and, if that did not help, reports the refusal like any other failed join.
 */

import { getCity } from '../city/cache';
import { CITY_SEED } from '../city/types';
import { cityChecksum } from '../city/validate';
import * as defs from '../defs/index';
import { PROTOCOL_VERSION } from './protocol';
import { SNAPSHOT_VERSION } from './snapshot';

/** FNV-1a over the UTF-16 units of a string: plain integer math, the same on every engine. */
function hashText(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Works the rules fingerprint out from the definitions and the city as they are right now. */
export function computeRulesStamp(): string {
  // Every exported value of defs/ that is data. Functions are behavior, not data: `JSON`
  // leaves them out. Numbers are cut to 9 significant digits so that a value an engine
  // computed one bit differently cannot split two builds of the same source.
  const table = defs as Record<string, unknown>;
  const names = Object.keys(table)
    .filter((name) => typeof table[name] !== 'function')
    .sort();
  const text = JSON.stringify(
    [PROTOCOL_VERSION, SNAPSHOT_VERSION, cityChecksum(getCity(CITY_SEED).city), names.map((name) => [name, table[name]])],
    (_key, value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Number(value.toPrecision(9)) : value),
  );
  return hashText(text, 0x811c9dc5).toString(16).padStart(8, '0');
}

let rules: string | null = null;

/** The fingerprint of the shared rules and data (8 hexadecimal digits). Worked out once. */
export function rulesStamp(): string {
  if (rules === null) rules = computeRulesStamp();
  return rules;
}

/** What a script file name must look like to carry a content hash: `name-Abc123_x.js`. */
const HASHED_SCRIPT = /^[A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8}\.js$/;

/**
 * The page part of the stamp for a script address (the `src` of the page's own script): its
 * file name when that name carries a content hash, otherwise '' ("cannot tell").
 */
export function pageIdOf(scriptAddress: string): string {
  const path = scriptAddress.split(/[?#]/)[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  return HASHED_SCRIPT.test(name) ? name : '';
}

/** The whole stamp for a page part ('' when there is none). */
export function buildStamp(page = ''): string {
  return `${rulesStamp()}.${page}`;
}

/**
 * Whether a page carrying `client` may play on a server whose stamp is `server`: the rules
 * must be the same, and so must the page when both sides know theirs. Anything that is not a
 * well-formed stamp (an old page sends none) does not match.
 */
export function buildsMatch(server: string, client: unknown): boolean {
  if (typeof client !== 'string' || client.length > 200) return false;
  const cut = client.indexOf('.');
  const at = server.indexOf('.');
  if (cut < 0 || at < 0) return false;
  if (client.slice(0, cut) !== server.slice(0, at)) return false;
  const theirs = client.slice(cut + 1);
  const ours = server.slice(at + 1);
  return theirs === '' || ours === '' || theirs === ours;
}
