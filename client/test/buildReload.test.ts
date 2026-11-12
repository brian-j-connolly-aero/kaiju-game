/**
 * What a page does when the server says it is from another build of the game (a tab left open
 * across an update): it reloads itself once to fetch the current page, and if it is refused
 * again it reports the failure like any other failed join instead of sitting in a lobby. The
 * room library is replaced by a hand-driven link, so nothing here needs a server.
 */

import { createMatchConfig, createWorld, JOIN_ERROR, welcomeFor, type LobbyState, type ServerMessages, type ServerMessageType } from '@mb/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomLink } from '../src/net/connection';
import { GameClient, type ClosedReason } from '../src/net/gameClient';
import { forgetBuildReload, pageId, reloadForNewBuild, type ReloadTarget } from '../src/net/session';

/** What the fake room library does with the next create or join. */
const next: { refuse: number | null; links: FakeLink[] } = { refuse: null, links: [] };

class FakeLink implements RoomLink {
  readonly code: string;
  left = false;
  private readonly handlers = new Map<string, (payload: never) => void>();

  constructor(code: string) {
    this.code = code;
  }
  send(): void {}
  on<K extends ServerMessageType>(type: K, handler: (payload: ServerMessages[K]) => void): () => void {
    this.handlers.set(type, handler as (payload: never) => void);
    return () => undefined;
  }
  onClosed(): void {}
  onDropped(): void {}
  onReconnected(): void {}
  leave(): void {
    this.left = true;
  }
  cut(): void {}
  /** Delivers a message as the server would. */
  receive<K extends ServerMessageType>(type: K, payload: ServerMessages[K]): void {
    this.handlers.get(type)?.(payload as never);
  }
}

vi.mock('../src/net/connection', async (original) => {
  const real = await original<typeof import('../src/net/connection')>();
  const connect = async (code: string, subscribe: (link: RoomLink) => void): Promise<RoomLink> => {
    if (next.refuse !== null) throw new real.JoinFailure(next.refuse, 'refused');
    const link = new FakeLink(code);
    next.links.push(link);
    subscribe(link);
    return link;
  };
  return {
    ...real,
    createRoom: (_origin: string, _name: string, _token: string, subscribe: (link: RoomLink) => void) => connect('BCDF', subscribe),
    joinRoom: (_origin: string, code: string, _name: string, _token: string, subscribe: (link: RoomLink) => void) => connect(code, subscribe),
  };
});

function makeClient(reloads: string[], allowReload: () => boolean) {
  const closed: ClosedReason[] = [];
  let admitted = 0;
  const client = new GameClient({
    // Never dialled: the room library is replaced by the fake above.
    origin: 'the-page-origin',
    token: 'token-reload-test',
    now: () => 0,
    reload: (code) => {
      if (!allowReload()) return false;
      reloads.push(code);
      return true;
    },
    admitted: () => admitted++,
  });
  client.events.on('closed', (reason) => closed.push(reason));
  return { client, closed, admittedCount: () => admitted };
}

function lobbyState(phase: LobbyState['phase']): LobbyState {
  return {
    code: 'BCDF',
    phase,
    host: 0,
    players: [{ seat: 0, name: 'Tester', wantsKaiju: false, faction: 'army', kaijuKind: 'lizard', ready: false, connected: true, slot: phase === 'match' ? 1 : -1 }],
    options: { botKaiju: false, fast: true },
    lastKaijuSeat: -1,
  };
}

beforeEach(() => {
  next.refuse = null;
  next.links.length = 0;
});

describe('a page the server refuses as being from another build', () => {
  it('reloads once, keeping the room it was joining, and still fails the join for the screen to show', async () => {
    const reloads: string[] = [];
    const { client, closed } = makeClient(reloads, () => true);
    next.refuse = JOIN_ERROR.version;
    await expect(client.join('GHJK', 'Tester')).rejects.toMatchObject({ code: JOIN_ERROR.version });
    expect(reloads).toEqual(['GHJK']);
    expect(client.status).toBe('offline');
    // Creating a room: there is no room to come back to.
    await expect(client.create('Tester')).rejects.toMatchObject({ code: JOIN_ERROR.version });
    expect(reloads).toEqual(['GHJK', '']);
    expect(closed).toEqual([]);
  });

  it('does not reload for any other refusal', async () => {
    const reloads: string[] = [];
    const { client } = makeClient(reloads, () => true);
    for (const code of [JOIN_ERROR.roomFull, JOIN_ERROR.serverFull, JOIN_ERROR.busy, 522, 0]) {
      next.refuse = code;
      await expect(client.join('GHJK', 'Tester')).rejects.toMatchObject({ code });
    }
    expect(reloads).toEqual([]);
  });

  it('tells the page it is current once it is let in', async () => {
    const { client, admittedCount } = makeClient([], () => true);
    await client.join('GHJK', 'Tester');
    expect(client.status).toBe('online');
    expect(admittedCount()).toBe(1);
  });

  it('gets out of a match it cannot draw instead of sitting in the lobby: reload, or the version error', async () => {
    // The welcome of a real match, but for a city this page cannot build (other counts).
    const world = createWorld({ seed: 7, config: createMatchConfig({ humans: [{ name: 'Tester', role: 'human' }], fast: true }) });
    const welcome = welcomeFor(world, 1);
    const broken = { ...welcome, cityState: welcome.cityState.slice(0, 10) };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // First time: the page may still reload.
      const reloads: string[] = [];
      let mayReload = true;
      const { client, closed } = makeClient(reloads, () => mayReload);
      await client.create('Tester');
      const link = next.links[0];
      link.receive('lobby', { lobby: lobbyState('match'), you: 0 });
      link.receive('welcome', broken);
      expect(reloads).toEqual(['BCDF']);
      expect(link.left).toBe(true);
      expect(client.session).toBeNull();
      expect(client.lobby).toBeNull();
      expect(client.status).toBe('offline');
      expect(closed).toEqual([]);

      // After the reload it happens again: no second reload, the ordinary "closed" path instead.
      mayReload = false;
      await client.create('Tester');
      const again = next.links[1];
      again.receive('lobby', { lobby: lobbyState('match'), you: 0 });
      again.receive('welcome', broken);
      expect(reloads).toEqual(['BCDF']);
      expect(again.left).toBe(true);
      expect(client.code).toBe('');
      expect(closed).toEqual(['version']);

      // A welcome the page can use still starts the match.
      await client.create('Tester');
      next.links[2].receive('lobby', { lobby: lobbyState('match'), you: 0 });
      next.links[2].receive('welcome', welcome);
      expect(client.session).not.toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('the reload itself', () => {
  function fakeWindow(storageWorks = true): ReloadTarget & { reloads: number; stored: Map<string, string> } {
    const stored = new Map<string, string>();
    const target = {
      reloads: 0,
      stored,
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void (storageWorks && stored.set(key, value)),
        removeItem: (key: string) => void stored.delete(key),
      },
      location: {
        hash: '',
        reload: () => {
          target.reloads++;
        },
      },
    };
    return target;
  }

  it('happens once per tab until the page has been let in again', () => {
    const tab = fakeWindow();
    expect(reloadForNewBuild('GHJK', tab)).toBe(true);
    expect(tab.reloads).toBe(1);
    expect(tab.location.hash).toBe('#GHJK');
    // The reloaded page is refused again (the server is the stale one): no loop.
    expect(reloadForNewBuild('GHJK', tab)).toBe(false);
    expect(reloadForNewBuild('', tab)).toBe(false);
    expect(tab.reloads).toBe(1);
    // Once a join succeeds the page is known to be current; a later update may reload it again.
    forgetBuildReload(tab);
    expect(reloadForNewBuild('', tab)).toBe(true);
    expect(tab.reloads).toBe(2);
    expect(tab.location.hash).toBe('#GHJK');
  });

  it('never happens when it could not be remembered, or outside a browser', () => {
    const tab = fakeWindow(false);
    expect(reloadForNewBuild('GHJK', tab)).toBe(false);
    expect(tab.reloads).toBe(0);
    expect(reloadForNewBuild('GHJK', null)).toBe(false);
    // In plain Node there is no page to name: the stamp's page part is empty.
    expect(pageId()).toBe('');
    forgetBuildReload(null);
  });
});
