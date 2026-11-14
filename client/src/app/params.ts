/**
 * Flags read once from the page address (the query string). They exist for automation and
 * debugging; a player never needs them.
 *
 *   ?autoplay=1     the client plays itself: menus, lobby and the match, on either side
 *   ?debug=1        overlay with frame time, draw calls, triangles and ping
 *   ?name=Rook      callsign to use (otherwise the stored one)
 *   ?profile=b      separate storage (session token, name), so one browser can be two players
 *   ?role=kaiju     autoplay: volunteer for the kaiju (default: play a squad)
 *   ?start=5        autoplay host: start once this many players are in the room and ready
 *   ?practice=1     autoplay host: a bot plays the kaiju
 *   ?loop=1         autoplay host: return to the lobby from the end screen and play again
 *   ?assets=none    ignore the asset manifest: everything is drawn from procedural fallbacks
 *   ?mute=1         no sound
 *   ?res=0.5        render resolution scale (1 = one canvas pixel per CSS pixel)
 *   ?cam=tp         start in third person
 *   ?fps=20         cap the frame rate (automated playtests on software rendering)
 *   ?sandbox=2      no server: run the simulation in the page, this player against the bots,
 *                   starting at stage 1, 2 or 3 (with ?role=kaiju or ?role=human)
 */

export interface PageParams {
  autoplay: boolean;
  debug: boolean;
  name: string | null;
  profile: string;
  role: 'kaiju' | 'human' | null;
  startAt: number;
  practice: boolean;
  loop: boolean;
  noAssets: boolean;
  mute: boolean;
  resolution: number;
  thirdPerson: boolean;
  fpsCap: number;
  /** 0 for normal play; 1..3 starts a local sandbox match at that stage. */
  sandbox: 0 | 1 | 2 | 3;
}

function flag(q: URLSearchParams, key: string): boolean {
  const v = q.get(key);
  return v !== null && v !== '0' && v.toLowerCase() !== 'false';
}

function num(q: URLSearchParams, key: string, fallback: number, lo: number, hi: number): number {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function readPageParams(search: string): PageParams {
  const q = new URLSearchParams(search);
  const role = q.get('role');
  return {
    autoplay: flag(q, 'autoplay'),
    debug: flag(q, 'debug'),
    name: q.get('name'),
    profile: (q.get('profile') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16),
    role: role === 'kaiju' || role === 'human' ? role : null,
    startAt: Math.round(num(q, 'start', 1, 1, 5)),
    practice: flag(q, 'practice'),
    loop: flag(q, 'loop'),
    noAssets: q.get('assets') === 'none',
    mute: flag(q, 'mute'),
    resolution: num(q, 'res', 1, 0.1, 2),
    thirdPerson: q.get('cam') === 'tp',
    fpsCap: num(q, 'fps', 0, 0, 240),
    sandbox: Math.round(num(q, 'sandbox', 0, 0, 3)) as 0 | 1 | 2 | 3,
  };
}
