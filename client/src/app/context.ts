/** What every screen can reach: the long-lived services of the client. */

import type { AssetStore } from '../assets/assetStore';
import type { AudioEngine } from '../audio/audioEngine';
import type { Autopilot } from '../game/autoplay';
import type { InputManager } from '../game/input/inputManager';
import type { GameClient } from '../net/gameClient';
import type { KeyValueStore } from '../net/session';
import type { GameRenderer } from '../render/gameRenderer';
import type { MatchRuntime } from './matchRuntime';
import type { PageParams } from './params';

export const SCREEN_IDS = ['boot', 'home', 'lobby', 'briefing', 'match', 'end'] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export interface AppContext {
  params: PageParams;
  store: KeyValueStore;
  assets: AssetStore;
  client: GameClient;
  audio: AudioEngine;
  input: InputManager;
  /** Null when the page was not opened with ?autoplay=1. */
  autopilot: Autopilot | null;
  /** The 3D view. Set once the boot screen has loaded the assets. */
  renderer: GameRenderer | null;
  /** The running match, from its welcome message until the room is back in the lobby. */
  runtime: MatchRuntime | null;
  /** The element screens put their overlay in. */
  ui: HTMLElement;
  /** The player's callsign. */
  name: string;
  /** Why the last room was left, for the home screen to show (an icon id), or ''. */
  notice: string;
  /** Matches this page has seen end, and how the last one ended (for the autopilot and for tests). */
  matchesEnded: number;
  lastResult: { winner: string; reason: string; duration: number } | null;
  /** Local time in seconds. */
  now(): number;
}

/**
 * A screen is a small module: it builds its overlay in `enter`, removes it in `exit`, and may
 * do something every frame. The app decides which screen is showing from the state of the
 * room and the match, so a screen never switches screens itself; it only talks to the client.
 */
export interface Screen {
  readonly id: ScreenId;
  enter(ctx: AppContext): void;
  exit(ctx: AppContext): void;
  /** Once per frame, before the match (or the backdrop) is drawn. `dt` in seconds. */
  frame?(ctx: AppContext, dt: number): void;
}
