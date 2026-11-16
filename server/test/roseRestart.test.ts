/**
 * Round 4 in the room: the communication rose (passed on to everyone, at most one every two
 * seconds per player, only from somebody playing) and the host's restart (the same people on
 * the same sides, a fresh match).
 */

import { ROSE_ARMY, ROSE_GAP_SECONDS, ROSE_KAIJU, ROSE_PICK_RANGE, type RoseMessage } from '@mb/shared';
import { describe, expect, it } from 'vitest';
import { FakePeer, makeRoom, seatPlayers, startMatch } from './helpers';

function roses(peer: FakePeer): RoseMessage[] {
  return peer.all('rose');
}

describe('communication rose', () => {
  it('passes a wedge on to everyone in the room, with one pick of the line for all', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 3);
    room.message('p1', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(0.2);
    const kaijuSlot = peers[1].welcome.playerId;
    expect(kaijuSlot).toBe(0);

    room.message('p0', 'rose', { cat: ROSE_ARMY.indexOf('science') });
    room.message('p1', 'rose', { cat: ROSE_KAIJU.indexOf('mating') });
    for (const peer of peers) {
      const got = roses(peer);
      expect(got.length).toBe(2);
      expect(got[0]).toMatchObject({ player: peers[0].welcome.playerId, cat: ROSE_ARMY.indexOf('science') });
      expect(got[1]).toMatchObject({ player: kaijuSlot, cat: ROSE_KAIJU.indexOf('mating') });
      for (const r of got) {
        expect(Number.isInteger(r.pick)).toBe(true);
        expect(r.pick).toBeGreaterThanOrEqual(0);
        expect(r.pick).toBeLessThan(ROSE_PICK_RANGE);
      }
    }
    // Every screen got the same pick.
    expect(roses(peers[2]).map((r) => r.pick)).toEqual(roses(peers[0]).map((r) => r.pick));
  });

  it('keeps each player to one every two seconds, each player on their own clock', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 2);
    startMatch(room, peers);
    run(0.2);
    room.message('p0', 'rose', { cat: 0 });
    room.message('p0', 'rose', { cat: 1 });
    room.message('p1', 'rose', { cat: 2 });
    expect(roses(peers[0]).map((r) => r.cat)).toEqual([0, 2]);
    run(ROSE_GAP_SECONDS * 0.5);
    room.message('p0', 'rose', { cat: 3 });
    expect(roses(peers[0]).length).toBe(2);
    run(ROSE_GAP_SECONDS * 0.5);
    room.message('p0', 'rose', { cat: 4 });
    expect(roses(peers[1]).map((r) => r.cat)).toEqual([0, 2, 4]);
  });

  it('ignores a wedge that is not one, and anybody who is not playing', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 5);
    room.message('p0', 'setOptions', { botKaiju: true });
    // In the lobby nothing is passed on.
    room.message('p0', 'rose', { cat: 0 });
    startMatch(room, peers);
    run(0.2);
    expect(peers[4].welcome.playerId).toBe(-1);
    for (const cat of [-1, ROSE_ARMY.length, 1.5, '2', null, undefined, Number.NaN]) room.message('p0', 'rose', { cat });
    room.message('p0', 'rose', null);
    // The fifth person only watches: they hear everything and say nothing.
    room.message('p4', 'rose', { cat: 0 });
    for (const peer of peers) expect(roses(peer)).toEqual([]);
    // A squad has the army's wedges, not the monster's.
    room.message('p1', 'rose', { cat: ROSE_ARMY.length - 1 });
    expect(roses(peers[4]).length).toBe(1);
  });
});

describe('restart', () => {
  it('starts the match over with the same people on the same sides, for the host only', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 3);
    room.message('p2', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(3);
    const before = peers.map((p) => p.welcome);
    const tick = room.matchTick;
    expect(tick).toBeGreaterThan(0);

    room.message('p1', 'restart', {});
    expect(room.matchTick).toBe(tick);

    for (const p of peers) p.clear();
    room.message('p0', 'restart', {});
    expect(room.lobby.phase).toBe('match');
    expect(room.matchTick).toBe(0);
    for (const [i, peer] of peers.entries()) {
      // Every page sees the old match end (the lobby) and the new one begin (a fresh welcome).
      expect(peer.sent.map((s) => s.type).slice(0, 3)).toEqual(['lobby', 'lobby', 'welcome']);
      expect(peer.all('lobby').map((l) => l.lobby.phase)).toEqual(['lobby', 'match']);
      const w = peer.welcome;
      expect(w.tick).toBe(0);
      expect(w.seed).not.toBe(before[i].seed);
      expect(w.playerId).toBe(before[i].playerId);
      expect(w.anchor).toBe(before[i].anchor);
      expect(w.config.players.map((p) => [p.role, p.bot])).toEqual(before[i].config.players.map((p) => [p.role, p.bot]));
    }
    expect(peers[2].welcome.playerId).toBe(0);
    expect(room.lobby.lastKaijuSeat).toBe(2);
  });

  it('works for one person in a bot match, from the match and from the end screen', () => {
    const { room, run, runUntil } = makeRoom({ speed: 50 });
    const [solo] = seatPlayers(room, 1);
    startMatch(room, [solo]);
    run(1);
    expect(solo.welcome.playerId).toBe(1);
    room.message('p0', 'restart', {});
    expect(room.lobby.phase).toBe('match');
    expect(solo.welcome.playerId).toBe(1);
    expect(solo.welcome.config.players[0].bot).toBe(true);
    runUntil(() => room.lobby.phase === 'end', 30);
    room.message('p0', 'restart', {});
    expect(room.lobby.phase).toBe('match');
    expect(room.matchTick).toBe(0);
    expect(solo.welcome.playerId).toBe(1);
    // Not from the lobby: that is what start is for.
    room.message('p0', 'restart', {});
    run(0.5);
    expect(room.matchTick).toBeGreaterThan(0);
  });

  it('gives the kaiju to a bot when the kaiju player has gone', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 2);
    room.message('p1', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(0.5);
    room.leave('p1');
    room.message('p0', 'restart', {});
    expect(peers[0].welcome.config.players[0].bot).toBe(true);
    expect(peers[0].welcome.playerId).toBe(1);
    expect(room.lobby.lastKaijuSeat).toBe(-1);
  });
});
