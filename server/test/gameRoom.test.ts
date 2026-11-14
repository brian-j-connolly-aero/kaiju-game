/**
 * The room logic end to end, with fake connections and a hand-driven clock: lobby, match loop,
 * snapshots and events, reconnects, late joiners, match end and the way back to the lobby.
 */

import {
  Btn,
  BUTTON_MASK,
  cityChecksum,
  CLOSE_REPLACED,
  CLOSE_SEAT_RELEASED,
  decodeCityState,
  decodeSnapshot,
  getCity,
  JOIN_ERROR,
  PROTOCOL_VERSION,
  SNAPSHOT_RATE,
  TICK_RATE,
} from '@mb/shared';
import { describe, expect, it } from 'vitest';
import { MAX_CATCH_UP_STEPS, STARVED_BUTTON_TICKS, STARVED_TICKS } from '../src/room/match';
import { INPUT_QUEUE_MAX } from '../src/room/inputQueue';
import { JoinRefused } from '../src/room/peer';
import { ackOf, FakePeer, input, makeRoom, seatPlayers, startMatch, TICK_MS, tokenOf } from './helpers';

function refusal(fn: () => unknown): JoinRefused {
  try {
    fn();
  } catch (err) {
    if (err instanceof JoinRefused) return err;
    throw err;
  }
  throw new Error('the join was not refused');
}

describe('lobby', () => {
  it('seats the first player as host and tells everyone about every change', () => {
    const { room } = makeRoom();
    const [a, b] = seatPlayers(room, 2);
    expect(a.lobby.you).toBe(0);
    expect(b.lobby.you).toBe(1);
    expect(a.lobby.lobby.code).toBe('BCDF');
    expect(a.lobby.lobby.phase).toBe('lobby');
    expect(a.lobby.lobby.host).toBe(0);
    expect(a.lobby.lobby.options.fast).toBe(true);
    expect(a.lobby.lobby.players.map((p) => p.name)).toEqual(['Player A', 'Player B']);
    expect(a.lobby.lobby.players.every((p) => p.connected && p.slot === -1)).toBe(true);
    // The first player was told about the second.
    expect(a.all('lobby').length).toBe(2);
  });

  it('seats five players and refuses the sixth', () => {
    const { room } = makeRoom();
    seatPlayers(room, 5);
    const err = refusal(() => room.join(new FakePeer('late'), { name: 'Late', token: 'token-late-abcdef' }));
    expect(err.code).toBe(JOIN_ERROR.roomFull);
    expect(room.seatCount).toBe(5);
  });

  it('refuses a client built for another protocol version, and accepts one that sends none', () => {
    const { room } = makeRoom();
    const err = refusal(() => room.join(new FakePeer('old'), { protocol: PROTOCOL_VERSION + 1 }));
    expect(err.code).toBe(JOIN_ERROR.version);
    expect(room.empty).toBe(true);
    expect(room.join(new FakePeer('bare'), undefined)).toBe(0);
  });

  it('refuses a page from another build of the game, or from before pages said which build they are', () => {
    const { room, log, skip } = makeRoom({ build: 'aaaaaaaa.index-AAAAAAAA.js' });
    for (const build of ['bbbbbbbb.index-AAAAAAAA.js', 'aaaaaaaa.index-BBBBBBBB.js', undefined, 7, '']) {
      const err = refusal(() => room.join(new FakePeer('stale'), { name: 'Stale', protocol: PROTOCOL_VERSION, build }));
      expect(err.code).toBe(JOIN_ERROR.version);
    }
    expect(room.empty).toBe(true);
    // The host is told in plain words, but not once per refusal: one line a minute is enough.
    const told = (): number => log.filter((line) => line.includes('another build') && line.includes('restart the server')).length;
    expect(told()).toBe(1);
    skip(61_000);
    refusal(() => room.join(new FakePeer('stale'), { build: 'bbbbbbbb.' }));
    expect(told()).toBe(2);
    expect(room.join(new FakePeer('same'), { build: 'aaaaaaaa.index-AAAAAAAA.js' })).toBe(0);
    // A development page and a command-line client know only the rules they were built from.
    expect(room.join(new FakePeer('dev'), { build: 'aaaaaaaa.' })).toBe(1);

    // The page the server serves can change while it runs: the stamp is asked for at every join.
    let served = 'aaaaaaaa.index-AAAAAAAA.js';
    const live = makeRoom({ build: () => served }).room;
    expect(live.join(new FakePeer('first'), { build: 'aaaaaaaa.index-AAAAAAAA.js' })).toBe(0);
    served = 'aaaaaaaa.index-CCCCCCCC.js';
    expect(refusal(() => live.join(new FakePeer('old tab'), { build: 'aaaaaaaa.index-AAAAAAAA.js' })).code).toBe(JOIN_ERROR.version);
    expect(live.join(new FakePeer('new tab'), { build: 'aaaaaaaa.index-CCCCCCCC.js' })).toBe(1);
  });

  it('applies name, role, faction, ready and options, and ignores what is not allowed', () => {
    const { room } = makeRoom();
    const [a, b] = seatPlayers(room, 2);

    room.message('p1', 'setName', { name: '  <b>Rex</b> the very long named one  ' });
    // Cut to sixteen characters, and not left ending in a space.
    expect(b.lobby.lobby.players[1].name).toBe('bRex/b the very');
    room.message('p1', 'setName', { name: 42 });
    expect(b.lobby.lobby.players[1].name).toBe('Player 2');

    room.message('p1', 'setRole', { wantsKaiju: true, kaijuKind: 'not-a-kaiju' });
    expect(a.lobby.lobby.players[1].wantsKaiju).toBe(true);
    expect(a.lobby.lobby.players[1].kaijuKind).toBe('lizard');
    room.message('p1', 'setRole', { wantsKaiju: 'yes' });
    expect(a.lobby.lobby.players[1].wantsKaiju).toBe(true);

    room.message('p1', 'setFaction', { faction: 'martians' });
    expect(a.lobby.lobby.players[1].faction).toBe('army');

    room.message('p1', 'ready', { ready: true });
    expect(a.lobby.lobby.players[1].ready).toBe(true);

    // Only the host changes room options.
    room.message('p1', 'setOptions', { botKaiju: true });
    expect(a.lobby.lobby.options.botKaiju).toBe(false);
    room.message('p0', 'setOptions', { botKaiju: true });
    expect(a.lobby.lobby.options.botKaiju).toBe(true);
    // Nobody changes the fast flag from outside.
    room.message('p0', 'setOptions', { fast: false, botKaiju: false });
    expect(a.lobby.lobby.options.fast).toBe(true);
  });

  it('survives every kind of nonsense message', () => {
    const { room } = makeRoom();
    const [a] = seatPlayers(room, 1);
    const before = a.sent.length;
    const junk: unknown[] = [undefined, null, 0, 'text', [], { seq: 'x' }, { t: Number.NaN }, { ready: 1 }];
    for (const type of ['input', 'command', 'ping', 'ready', 'setRole', 'setFaction', 'draftPick', 'toLobby', '', 'bogus']) {
      for (const payload of junk) expect(() => room.message('p0', type, payload)).not.toThrow();
    }
    expect(() => room.message('nobody', 'start', {})).not.toThrow();
    expect(room.lobby.phase).toBe('lobby');
    // None of it changed anything, so nothing was sent.
    expect(a.sent.length).toBe(before);
  });

  it('starts only for the host, and only when everyone else is ready', () => {
    const { room } = makeRoom();
    const peers = seatPlayers(room, 3);
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('lobby');
    room.message('p1', 'ready', { ready: true });
    room.message('p2', 'ready', { ready: true });
    room.message('p1', 'start', {});
    expect(room.lobby.phase).toBe('lobby');
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('match');
    for (const peer of peers) expect(peer.lobby.lobby.phase).toBe('match');
  });

  it('lets the host start without somebody who has had twenty seconds to get ready', () => {
    const { room, run } = makeRoom({ startWaitSeconds: 20 });
    const peers = seatPlayers(room, 4);
    room.message('p1', 'ready', { ready: true });
    room.message('p2', 'ready', { ready: true });
    room.message('p3', 'setRole', { wantsKaiju: true });
    // Player D left the tab open and went to make tea. For a while the room waits.
    run(19);
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('lobby');
    expect(peers[0].lobby.lobby.players.some((p) => p.waited)).toBe(false);

    // After twenty seconds in the lobby the server says so in the lobby state, once.
    const before = peers[0].all('lobby').length;
    run(2);
    expect(peers[0].all('lobby').length).toBe(before + 1);
    expect(peers[0].lobby.lobby.players.map((p) => p.waited)).toEqual([true, true, true, true]);
    expect(peers[0].lobby.lobby.players[3].ready).toBe(false);

    // Only the host can use it.
    room.message('p1', 'start', {});
    expect(room.lobby.phase).toBe('lobby');
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('match');
    // Player D is in the match all the same, with a squad to come back to, but is not the
    // kaiju although they volunteered: nobody waits for a kaiju that is not at the keyboard.
    expect(peers[3].welcome.playerId).toBeGreaterThan(0);
    expect(peers.filter((p) => p.welcome.playerId === 0).length).toBeLessThanOrEqual(1);
    expect(peers[0].lobby.lobby.lastKaijuSeat).not.toBe(3);
  });

  it('starts the waiting time over for somebody who has only just come (back) into the lobby', () => {
    const { room, run, runUntil } = makeRoom({ startWaitSeconds: 20, graceSeconds: 600 });
    const peers = seatPlayers(room, 2);
    run(30);
    expect(peers[0].lobby.lobby.players.map((p) => p.waited)).toEqual([true, true]);
    // A third person arrives: the room waits for them again, for their twenty seconds.
    const late = new FakePeer('late');
    room.join(late, { name: 'Late', token: 'token-late-abcdef' });
    room.message('p1', 'ready', { ready: true });
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('lobby');
    // Somebody whose connection blipped gets the same courtesy when they are back.
    room.drop('p1');
    run(1);
    expect(room.resume(new FakePeer('p1'))).toBe(true);
    expect(peers[0].lobby.lobby.players.map((p) => p.waited)).toEqual([true, false, false]);
    room.message('late', 'ready', { ready: true });
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('match');

    // Back from the match everybody's ready flag is cleared and everybody gets their time again.
    runUntil(() => room.lobby.phase === 'end', 400);
    room.message('p0', 'toLobby', {});
    expect(peers[0].lobby.lobby.players.map((p) => [p.ready, p.waited])).toEqual([
      [false, false],
      [false, false],
      [false, false],
    ]);
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('lobby');
    run(21);
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('match');
  });

  it('answers a ping with the same number and the current tick', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 1);
    room.message('p0', 'ping', { t: 123.5 });
    expect(peers[0].last('pong')).toEqual({ t: 123.5, tick: 0 });
    startMatch(room, peers);
    run(1);
    room.message('p0', 'ping', { t: 7 });
    expect(peers[0].last('pong')).toEqual({ t: 7, tick: TICK_RATE });
  });

  it('passes the host role on when the host leaves', () => {
    const { room } = makeRoom();
    const [, b, c] = seatPlayers(room, 3);
    room.leave('p0');
    expect(b.lobby.lobby.host).toBe(1);
    expect(c.lobby.lobby.players.map((p) => p.seat)).toEqual([1, 2]);
    // A newcomer takes the free seat.
    const d = new FakePeer('p3');
    expect(room.join(d, { name: 'D' })).toBe(0);
    expect(d.lobby.lobby.host).toBe(1);
  });

  it('hands the host role to a connected player when the host has been gone a while', () => {
    const { room, run } = makeRoom({ hostHandoffSeconds: 5, graceSeconds: 60 });
    const [, b] = seatPlayers(room, 2);
    room.drop('p0');
    run(4);
    expect(b.lobby.lobby.host).toBe(0);
    run(2);
    expect(b.lobby.lobby.host).toBe(1);
    // The old host comes back as an ordinary player.
    const back = new FakePeer('p0-again');
    room.join(back, { token: tokenOf(0) });
    expect(back.lobby.you).toBe(0);
    expect(back.lobby.lobby.host).toBe(1);
  });
});

describe('match start', () => {
  it('gives every player a welcome with their own slot and the full city state', () => {
    const { room } = makeRoom();
    const peers = seatPlayers(room, 5);
    room.message('p3', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);

    const slots = peers.map((p) => p.welcome.playerId);
    expect([...slots].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(peers[3].welcome.playerId).toBe(0);
    expect(peers[3].welcome.kaijuId).toBe(0);
    expect(peers[3].welcome.squadId).toBe(-1);
    expect(peers[0].welcome.squadId).toBeGreaterThanOrEqual(0);

    const built = getCity(peers[0].welcome.config.citySeed);
    for (const peer of peers) {
      const w = peer.welcome;
      expect(w.protocol).toBe(PROTOCOL_VERSION);
      expect(w.tick).toBe(0);
      expect(w.cityChecksum).toBe(cityChecksum(built.city));
      expect(w.config.tuning.clock).toBe(150);
      expect(w.config.players.filter((p) => !p.bot).length).toBe(5);
      const state = decodeCityState(w.cityState);
      expect(state.structureStage.length).toBe(built.city.structures.length);
      expect(state.propCount).toBe(built.city.props.length);
    }
    // The lobby tells everyone who plays which slot.
    const lobby = peers[0].lobby.lobby;
    expect(lobby.phase).toBe('match');
    expect(lobby.lastKaijuSeat).toBe(3);
    expect(lobby.players.map((p) => p.slot)).toEqual(slots);
  });

  it('lets a lone player practise: a squad against a bot kaiju, or the kaiju against bot squads', () => {
    const solo = makeRoom();
    const [a] = seatPlayers(solo.room, 1);
    startMatch(solo.room, [a]);
    expect(a.welcome.playerId).toBe(1);
    expect(a.welcome.config.players[0].bot).toBe(true);
    expect(a.welcome.config.players.filter((p) => p.bot).length).toBe(4);

    const beast = makeRoom();
    const [b] = seatPlayers(beast.room, 1);
    beast.room.message('p0', 'setRole', { wantsKaiju: true });
    startMatch(beast.room, [b]);
    expect(b.welcome.playerId).toBe(0);
    expect(b.welcome.config.players.filter((p) => p.bot).length).toBe(4);
  });

  it('honours the practice option: a bot kaiju, and the fifth person watches', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 5);
    room.message('p0', 'setOptions', { botKaiju: true });
    startMatch(room, peers);
    expect(peers.map((p) => p.welcome.playerId)).toEqual([1, 2, 3, 4, -1]);
    expect(room.lobby.lastKaijuSeat).toBe(-1);
    run(0.5);
    // The watcher gets snapshots like everyone else, with nothing to acknowledge.
    expect(peers[4].snapshots.length).toBeGreaterThan(3);
    expect(peers[4].lastSnapshot.ackSeq).toBe(0);
  });

  it('rotates the kaiju role: never the same player twice in a row unless they volunteer', () => {
    const { room, runUntil } = makeRoom({ speed: 50 });
    const peers = seatPlayers(room, 3);
    const kaijuSeats: number[] = [];
    for (let i = 0; i < 4; i++) {
      startMatch(room, peers);
      kaijuSeats.push(room.lobby.lastKaijuSeat);
      runUntil(() => room.lobby.phase === 'end', 30);
      room.message('p0', 'toLobby', {});
      expect(room.lobby.phase).toBe('lobby');
    }
    for (let i = 1; i < kaijuSeats.length; i++) expect(kaijuSeats[i]).not.toBe(kaijuSeats[i - 1]);
    for (const seat of kaijuSeats) expect(seat).toBeGreaterThanOrEqual(0);

    // A volunteer gets it every time.
    room.message('p2', 'setRole', { wantsKaiju: true });
    for (let i = 0; i < 2; i++) {
      startMatch(room, peers);
      expect(room.lobby.lastKaijuSeat).toBe(2);
      runUntil(() => room.lobby.phase === 'end', 30);
      room.message('p0', 'toLobby', {});
    }
  });
});

describe('match loop', () => {
  it('steps 30 times a second and sends 15 snapshots a second, with events alongside', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 2);
    startMatch(room, peers);
    for (const p of peers) p.clear();
    run(2);

    expect(room.match?.world.tick).toBe(2 * TICK_RATE);
    for (const peer of peers) {
      const snaps = peer.snapshots;
      expect(snaps.length).toBe(2 * SNAPSHOT_RATE);
      expect(snaps.map((s) => s.tick)).toEqual(snaps.map((_, i) => (i + 1) * 2));
      // Fast tuning: a one second briefing, then play.
      expect(snaps[0].match.phase).toBe('briefing');
      expect(snaps[snaps.length - 1].match.phase).toBe('playing');
      const phases = peer.events.filter((e) => e.type === 'matchPhase').map((e) => (e.type === 'matchPhase' ? e.phase : ''));
      expect(phases).toEqual(['briefing', 'playing']);
    }

    // Events travel just before the snapshot that covers their tick: after the previous
    // snapshot's tick, at or before the next one's.
    let previousSnapTick = 0;
    let waiting: number[] = [];
    let eventMessages = 0;
    for (const sent of peers[0].sent) {
      if (sent.type === 'events') {
        eventMessages++;
        waiting = (sent.payload as Array<{ tick: number }>).map((e) => e.tick);
        for (const tick of waiting) expect(tick).toBeGreaterThan(previousSnapTick);
      } else if (sent.type === 'snap') {
        const tick = decodeSnapshot(sent.payload as Uint8Array).tick;
        for (const eventTick of waiting) expect(eventTick).toBeLessThanOrEqual(tick);
        waiting = [];
        previousSnapTick = tick;
      }
    }
    expect(eventMessages).toBeGreaterThanOrEqual(2);
    expect(waiting).toEqual([]);
  });

  it('applies one input per player per tick, from the tick after the first one, and acknowledges them', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 2);
    room.message('p0', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(1.5); // through the briefing

    // Three inputs arrive at once; the simulation takes exactly one per tick.
    for (const seq of [1, 2, 3]) room.message('p1', 'input', input(seq, { moveZ: 1 }));
    const world = room.match!.world;
    const slot = peers[1].welcome.playerId;
    const before = world.tick;
    run(TICK_MS / 1000);
    // The first tick after a player's first input is the cushion: it is played on a guess while
    // the input waits, so that the match plays every input a tick after it was due.
    expect(world.tick).toBe(before + 1);
    expect(world.players[slot].input.seq).toBe(0);
    expect(peers[1].lastSnapshot.tick).toBe(world.tick);
    expect(ackOf(peers[1].lastSnapshot)).toEqual({ played: 0, drops: 0 });
    run(TICK_MS / 1000);
    expect(world.players[slot].input.seq).toBe(1);
    run(TICK_MS / 1000);
    expect(world.players[slot].input.seq).toBe(2);
    // A snapshot goes out every second tick and acknowledges the inputs played by then.
    expect(peers[1].lastSnapshot.tick).toBe(world.tick);
    expect(ackOf(peers[1].lastSnapshot)).toEqual({ played: 2, drops: 0 });
    run(TICK_MS / 1000);
    expect(world.players[slot].input.seq).toBe(3);
    // The other player sent nothing and is acknowledged nothing.
    expect(peers[0].lastSnapshot.ackSeq).toBe(0);
    // With the queue empty the last input repeats: the unit keeps moving. Each of those ticks
    // stands in for an input still on its way, and the snapshot says how many will be dropped.
    const unit = world.units[world.squads[world.players[slot].squadId].driven];
    const x0 = unit.x;
    const z0 = unit.z;
    const lastPlayedAt = world.tick;
    run(0.3);
    expect(Math.hypot(unit.x - x0, unit.z - z0)).toBeGreaterThan(0.5);
    const snap = peers[1].lastSnapshot;
    expect(ackOf(snap)).toEqual({ played: 3, drops: snap.tick - lastPlayedAt });
  });

  it('cleans what clients send before it reaches the simulation', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 1);
    startMatch(room, peers);
    run(1.5);
    room.message('p0', 'input', { seq: 1, moveX: 50, moveZ: -50, aimYaw: 100, aimPitch: 9, buttons: 0xffff });
    run((2 * TICK_MS) / 1000);
    const state = room.match!.world.players[peers[0].welcome.playerId].input;
    expect(Math.hypot(state.moveX, state.moveZ)).toBeLessThanOrEqual(1.0001);
    expect(Math.abs(state.aimYaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
    expect(Math.abs(state.aimPitch)).toBeLessThan(Math.PI / 2);
    // Every bit a button has, and nothing else: since phase 1 the buttons are strike, grab, molt,
    // fire, stomp, the two move buttons and the volley; the bits of the old brace, roar and beam
    // (2 to 4) and of the old artillery, smoke and mark (7 to 9) are free and dropped.
    expect(state.buttons).toBe(BUTTON_MASK);
    expect(BUTTON_MASK).toBe(0x3c63);
  });

  it('brings a connected but silent player to a stop instead of leaving them walking', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 1);
    startMatch(room, peers);
    run(1.5);
    room.message('p0', 'input', input(1, { moveZ: 1, aimYaw: 0.7, buttons: Btn.fire }));
    run((2 * TICK_MS) / 1000);
    const state = room.match!.world.players[peers[0].welcome.playerId].input;
    expect(state.moveZ).toBe(1);
    run((STARVED_TICKS + 1) * (TICK_MS / 1000));
    expect(state.moveZ).toBe(0);
    // A held button is kept a little longer (a hiccup must not cut a hold), then let go too.
    expect(state.buttons).toBe(Btn.fire);
    run((STARVED_BUTTON_TICKS - STARVED_TICKS) * (TICK_MS / 1000));
    expect(state.moveZ).toBe(0);
    expect(state.buttons).toBe(0);
    expect(state.aimYaw).toBeCloseTo(0.7);
    // The guesses before the stop stood in for inputs on their way; the ticks after it stand for
    // nothing (the player is away, not late).
    expect(ackOf(peers[0].lastSnapshot)).toEqual({ played: 1, drops: STARVED_TICKS - 1 });
  });

  describe('on a link that stalls and then delivers everything at once', () => {
    /** A room whose only player is the kaiju, in play, with the bots standing still. */
    function kaijuRoom() {
      const made = makeRoom({ fast: false });
      const [peer] = seatPlayers(made.room, 1);
      made.room.message('p0', 'setRole', { wantsKaiju: true });
      startMatch(made.room, [peer]);
      const world = made.room.match!.world;
      world.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
      made.runUntil(() => world.match.phase === 'playing', 30);
      let seq = 0;
      /** One tick of real time; `buttons` is what arrives during it (nothing during a stall). */
      const tick = (...buttons: number[]): void => {
        for (const b of buttons) made.room.message('p0', 'input', input(++seq, { buttons: b }));
        made.run(TICK_MS / 1000);
      };
      const actions = (): string[] =>
        peer.events.flatMap((e) => (e.type === 'kaijuAction' && e.phase !== 'recover' && e.phase !== 'idle' ? [`${e.action}/${e.phase}`] : []));
      for (let i = 0; i < 10; i++) tick(0);
      peer.clear();
      return { ...made, peer, world, tick, actions };
    }

    it('still plays a tap that was pressed and released inside the stall', () => {
      for (const downs of [1, 2, 3]) {
        const { tick, actions } = kaijuRoom();
        // Nine ticks with nothing arriving, then the nine late inputs and the current one.
        for (let i = 0; i < 9; i++) tick();
        tick(0, 0, 0, ...new Array<number>(downs).fill(Btn.strike), ...new Array<number>(7 - downs).fill(0));
        for (let i = 0; i < 45; i++) tick(0);
        expect(actions(), `a tap of ${downs} input(s)`).toEqual(['swipe/windup', 'swipe/active']);
      }
    });

    it('keeps a brace a brace through a stall longer than half a second', () => {
      const { tick, actions, world, room } = kaijuRoom();
      // The brace is a move picked at a molt, held on its move button (net/input.ts).
      world.kaijus[0].moves = ['brace', 'none'];
      tick(Btn.move1);
      tick(Btn.move1);
      // 0.8 s with nothing arriving (more than the half second after which the kaiju stops
      // walking), then the late inputs: the player held the button all along.
      for (let i = 0; i < 24; i++) tick();
      expect(world.kaijus[0].phase).toBe('brace');
      tick(...new Array<number>(25).fill(Btn.move1));
      for (let i = 0; i < 5; i++) tick(Btn.move1);
      expect(world.kaijus[0].phase).toBe('brace');
      for (let i = 0; i < 10; i++) tick(0);
      // One brace, not one cut short by the stall and a second one started by the late inputs.
      expect(actions()).toEqual(['brace/brace']);
      // The guessed ticks were paid back: what is left is the queue's usual few inputs of slack
      // (it only skips once it holds more than INPUT_QUEUE_MAX), not 0.8 s of delay.
      expect(room.match!.queues[0].items.length).toBeLessThan(INPUT_QUEUE_MAX);
    });

    it('keeps a hold to eat whole through a stall in the middle of it', () => {
      const { tick, actions, world } = kaijuRoom();
      const k = world.kaijus[0];
      // Something to eat in the hand, so the hold has something to eat.
      k.held = { kind: 'wreck', wreck: 'car' };
      tick(Btn.grab);
      // The line stalls for 0.7 s right after the press; the player keeps holding.
      for (let i = 0; i < 21; i++) tick();
      tick(...new Array<number>(22).fill(Btn.grab));
      for (let i = 0; i < 3; i++) tick(0);
      for (let i = 0; i < 80; i++) tick(0);
      expect(actions()).toContain('eat/eat');
      expect(actions().filter((a) => a.startsWith('throw'))).toEqual([]);
    });

    it('lets go of a held button as soon as the late inputs show it was released', () => {
      const { tick, world } = kaijuRoom();
      tick(Btn.stomp);
      for (let i = 0; i < 6; i++) tick();
      expect(world.players[0].input.buttons & Btn.stomp).toBe(Btn.stomp);
      // The release had happened two inputs into the stall.
      tick(Btn.stomp, Btn.stomp, 0, 0, 0, 0, 0);
      expect(world.players[0].input.buttons & Btn.stomp).toBe(0);
    });
  });

  describe('on a link that delivers inputs a little late', () => {
    /**
     * A squad leader walking and turning, tapping Fire now and then, whose inputs reach the
     * server a random 0 to `maxLate` ticks late (in order, as over one connection). Records,
     * for every snapshot from the first one that has played an input, how many ticks the body
     * has had beyond the inputs the client counts in its prediction (the snapshot's tick less
     * the inputs played and the inputs the server will drop), and the buttons the simulation saw.
     */
    function lateLink(maxLate: number, seed: number) {
      const { room, run } = makeRoom();
      const peers = seatPlayers(room, 1);
      startMatch(room, peers);
      const world = room.match!.world;
      world.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
      const slot = peers[0].welcome.playerId;
      let rand = seed;
      const roll = (n: number): number => {
        rand = (rand * 1103515245 + 12345) % 2147483648;
        return rand % n;
      };
      const inFlight: Array<{ at: number; seq: number; buttons: number }> = [];
      const sent: number[] = [];
      const seen: number[] = [];
      const extra = new Set<number>();
      let lastSnap = 0;
      let arriveLast = 0;
      for (let t = 1; t <= 600; t++) {
        // The client: one input per tick. After 15 s the link is quick again.
        const buttons = t < 580 && roll(9) === 0 ? Btn.fire : 0;
        sent.push(buttons);
        const late = t < 450 ? roll(maxLate + 1) : 0;
        arriveLast = Math.max(arriveLast, t + late);
        inFlight.push({ at: arriveLast, seq: t, buttons });
        while (inFlight.length > 0 && inFlight[0].at <= t) {
          const next = inFlight.shift()!;
          room.message('p0', 'input', input(next.seq, { moveZ: 1, aimYaw: next.seq * 0.02, buttons: next.buttons }));
        }
        run(TICK_MS / 1000);
        seen.push(world.players[slot].input.buttons);
        const bytes = peers[0].last('snap');
        if (!bytes) continue;
        const snap = decodeSnapshot(bytes);
        if (snap.tick !== lastSnap) {
          lastSnap = snap.tick;
          const ack = ackOf(snap);
          if (ack.played > 0) extra.add(snap.tick - ack.played - ack.drops);
        }
      }
      return { room, world, sent, seen, extra: [...extra] };
    }

    it('never gives the body a step the client does not count, and builds up no delay', () => {
      for (const maxLate of [1, 2, 4, 8]) {
        const { room, extra } = lateLink(maxLate, 7 + maxLate);
        // One value all match long: whatever arrives late, the body has had exactly one tick for
        // every input the client counts. (Before, every late input added a step that the client
        // pulled back when the queue later skipped inputs: the stutter.)
        expect(extra, `inputs up to ${maxLate} ticks late`).toHaveLength(1);
        // Once the link is quick again the inputs wait no more than a tick or two.
        expect(room.match!.queues[0].items.length, `inputs up to ${maxLate} ticks late`).toBeLessThanOrEqual(2);
      }
    });

    it('still plays every tap of Fire, late or not', () => {
      const presses = (buttons: number[]): number => buttons.filter((b, i) => b & Btn.fire && !(i > 0 && buttons[i - 1] & Btn.fire)).length;
      for (const maxLate of [2, 8]) {
        const { sent, seen } = lateLink(maxLate, 3 + maxLate);
        expect(presses(seen), `inputs up to ${maxLate} ticks late`).toBe(presses(sent));
      }
    });
  });

  it('never spirals: a long stall costs a handful of ticks and one snapshot', () => {
    const { room, run, skip } = makeRoom();
    const peers = seatPlayers(room, 1);
    startMatch(room, peers);
    run(1);
    const world = room.match!.world;
    const tick = world.tick;
    const snaps = peers[0].all('snap').length;
    skip(30_000);
    room.update();
    expect(world.tick - tick).toBe(MAX_CATCH_UP_STEPS);
    expect(peers[0].all('snap').length).toBe(snaps + 1);
    // And it is back to one tick per tick of time straight away.
    run(1);
    expect(world.tick).toBe(tick + MAX_CATCH_UP_STEPS + TICK_RATE);
  });

  it('takes everyone back to the lobby instead of crashing when the simulation throws', () => {
    const { room, run, log } = makeRoom();
    const peers = seatPlayers(room, 2);
    startMatch(room, peers);
    run(0.5);
    room.match!.world.step = () => {
      throw new Error('boom');
    };
    expect(() => run(0.2)).not.toThrow();
    expect(room.lobby.phase).toBe('lobby');
    expect(room.match).toBeNull();
    expect(peers[0].lobby.lobby.phase).toBe('lobby');
    expect(peers[0].lobby.lobby.players.every((p) => p.slot === -1 && !p.ready)).toBe(true);
    expect(log.some((line) => line.includes('boom'))).toBe(true);
    // The room still works: a new match can start.
    startMatch(room, peers);
    expect(room.lobby.phase).toBe('match');
  });

  it('reports a failed match even when the room log is switched off', () => {
    // MB_QUIET=1: no room chatter at all, but failures have their own way out.
    const failures: string[] = [];
    const { room, run } = makeRoom({ log: undefined, logError: (line) => failures.push(line) });
    const peers = seatPlayers(room, 1);
    startMatch(room, peers);
    run(0.5);
    expect(failures).toEqual([]);
    room.match!.world.step = () => {
      throw new Error('boom');
    };
    run(0.2);
    expect(room.lobby.phase).toBe('lobby');
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain('[room BCDF]');
    expect(failures[0]).toContain('the simulation failed');
    expect(failures[0]).toContain('boom');
  });
});

describe('dropped players', () => {
  it('covers a dropped player with a bot and gives the slot back on a token rejoin', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 3);
    room.message('p0', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(1.5);
    const world = room.match!.world;
    const slot = peers[2].welcome.playerId;
    room.message('p2', 'input', input(40, { moveZ: 1 }));
    run(0.2);
    expect(ackOf(peers[2].lastSnapshot).played).toBe(40);

    expect(room.drop('p2')).toBe(true);
    expect(room.drop('p2')).toBe(false);
    expect(world.players[slot].bot).toBe(true);
    expect(peers[0].lobby.lobby.players[2].connected).toBe(false);
    expect(peers[0].lobby.lobby.players[2].slot).toBe(slot);
    const sentWhileGone = peers[2].sent.length;
    run(3);
    expect(peers[2].sent.length).toBe(sentWhileGone);
    expect(peers[0].lastSnapshot.squads.find((s) => s.player === slot)?.bot).toBe(true);
    // Messages from the dead connection are ignored.
    room.message('p2', 'input', input(41));

    // The player reloads the page: a new connection, the same token, input numbering from 1.
    const back = new FakePeer('p2-reloaded');
    expect(room.join(back, { name: 'Somebody Else', token: tokenOf(2) })).toBe(2);
    expect(peers[2].closed?.code).toBe(CLOSE_REPLACED);
    expect(world.players[slot].bot).toBe(false);
    expect(back.lobby.you).toBe(2);
    expect(back.lobby.lobby.players[2].connected).toBe(true);
    expect(back.lobby.lobby.players[2].name).toBe('Player C');
    const welcome = back.welcome;
    expect(welcome.playerId).toBe(slot);
    expect(welcome.tick).toBe(world.tick);
    expect(decodeCityState(welcome.cityState).structureStage.length).toBe(world.city.structures.length);
    // The welcome comes after the lobby and before any snapshot.
    expect(back.sent.map((s) => s.type)).toEqual(['lobby', 'welcome']);

    run(0.2);
    expect(back.lastSnapshot.ackSeq).toBe(0);
    expect(back.lastSnapshot.squads.find((s) => s.player === slot)?.bot).toBe(false);
    room.message('p2-reloaded', 'input', input(1, { moveX: 1 }));
    run(0.1);
    expect(ackOf(back.lastSnapshot).played).toBe(1);
    expect(back.snapshots.every((s) => s.tick > welcome.tick)).toBe(true);
    expect(back.events.every((e) => e.tick > welcome.tick)).toBe(true);
  });

  it('keeps the acknowledgement when the same connection comes back by itself', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 2);
    startMatch(room, peers);
    run(1.5);
    const slot = peers[1].welcome.playerId;
    room.message('p1', 'input', input(77));
    run(0.1);
    room.drop('p1');
    run(1);
    const again = new FakePeer('p1');
    expect(room.resume(again)).toBe(true);
    expect(room.match!.world.players[slot].bot).toBe(false);
    expect(again.sent.map((s) => s.type)).toEqual(['lobby', 'welcome']);
    expect(again.welcome.playerId).toBe(slot);
    run(0.1);
    expect(again.lastSnapshot.ackSeq).toBe(77);
    // Inputs the client had buffered from before the drop are stale and ignored.
    room.message('p1', 'input', input(70));
    room.message('p1', 'input', input(78));
    run(0.1);
    expect(ackOf(again.lastSnapshot).played).toBe(78);
    // Coming back for a seat that is gone is refused.
    expect(room.resume(new FakePeer('stranger'))).toBe(false);
  });

  it('gives the seat up after the grace period; the bot keeps the slot', () => {
    const { room, run } = makeRoom({ graceSeconds: 5 });
    const peers = seatPlayers(room, 2);
    startMatch(room, peers);
    run(1.5);
    const slot = peers[1].welcome.playerId;
    room.drop('p1');
    run(4);
    expect(room.seatCount).toBe(2);
    expect(peers[1].closed).toBeNull();
    run(2);
    expect(room.seatCount).toBe(1);
    expect(peers[1].closed?.code).toBe(CLOSE_SEAT_RELEASED);
    expect(peers[0].lobby.lobby.players.map((p) => p.seat)).toEqual([0]);
    expect(room.match!.world.players[slot].bot).toBe(true);
    // The library reporting the final leave afterwards changes nothing.
    room.leave('p1');
    expect(room.seatCount).toBe(1);

    // Coming back later with the same token is a fresh seat, and the freed squad is theirs again.
    const back = new FakePeer('p1-late');
    room.join(back, { name: 'Late', token: tokenOf(1) });
    expect(back.welcome.playerId).toBe(slot);
    expect(room.match!.world.players[slot].bot).toBe(false);
  });

  it('is empty once the last player is gone for good', () => {
    const { room, run } = makeRoom({ graceSeconds: 3 });
    const [a] = seatPlayers(room, 1);
    startMatch(room, [a]);
    run(1);
    room.drop('p0');
    expect(room.empty).toBe(false);
    run(2);
    // The match plays on with bots while the seat is held.
    expect(room.match!.world.tick).toBeGreaterThan(80);
    expect(room.empty).toBe(false);
    run(2);
    expect(room.empty).toBe(true);
    expect(room.connectedCount).toBe(0);
  });

  it('lets the newest connection with a token take the seat from an older live one', () => {
    const { room } = makeRoom();
    const [a, b] = seatPlayers(room, 2);
    const second = new FakePeer('p0-second-tab');
    expect(room.join(second, { token: tokenOf(0) })).toBe(0);
    expect(a.closed?.code).toBe(CLOSE_REPLACED);
    expect(room.seatCount).toBe(2);
    expect(b.lobby.lobby.players.length).toBe(2);
    // The library later reports the old connection as dropped and gone: both are ignored.
    expect(room.drop('p0')).toBe(false);
    room.leave('p0');
    expect(room.seatCount).toBe(2);
    expect(second.lobby.lobby.players[0].connected).toBe(true);
    room.message('p0-second-tab', 'setName', { name: 'Tab Two' });
    expect(b.lobby.lobby.players[0].name).toBe('Tab Two');
  });

  it('does not treat a missing or malformed token as an identity', () => {
    const { room } = makeRoom();
    room.join(new FakePeer('x'), { name: 'X', token: 'short' });
    room.join(new FakePeer('y'), { name: 'Y', token: 'short' });
    room.join(new FakePeer('z'), { name: 'Z' });
    room.join(new FakePeer('w'), { name: 'W' });
    expect(room.seatCount).toBe(4);
  });

  it('keeps a dropped seat for its owner: a newcomer is refused until the grace period is over', () => {
    const { room, run } = makeRoom({ graceSeconds: 10 });
    const peers = seatPlayers(room, 5);
    // One player reloads the page: the connection is gone for a moment.
    room.drop('p3');
    run(1);
    const sixth = new FakePeer('sixth');
    const err = refusal(() => room.join(sixth, { name: 'Sixth', token: 'token-sixth-abcdef' }));
    expect(err.code).toBe(JOIN_ERROR.roomFull);
    expect(peers[3].closed).toBeNull();
    expect(room.seatCount).toBe(5);
    // The reloaded page comes back with its token and gets its own seat.
    run(1);
    const back = new FakePeer('p3-reloaded');
    expect(room.join(back, { token: tokenOf(3) })).toBe(3);
    expect(peers[3].closed?.code).toBe(CLOSE_REPLACED);

    // Somebody who stays away longer than the grace period does give the seat up, and only
    // then can a newcomer have it.
    room.drop('p1');
    run(9);
    expect(refusal(() => room.join(new FakePeer('early'), { name: 'Early' })).code).toBe(JOIN_ERROR.roomFull);
    run(2);
    expect(peers[1].closed?.code).toBe(CLOSE_SEAT_RELEASED);
    expect(room.join(new FakePeer('late'), { name: 'Late', token: 'token-late-abcdef' })).toBe(1);
    expect(room.seatCount).toBe(5);
  });

  it('never gives a dropped kaiju player\'s seat to a sixth person during the match', () => {
    const { room, run } = makeRoom({ graceSeconds: 45 });
    const peers = seatPlayers(room, 5);
    room.message('p0', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(2);
    const world = room.match!.world;
    expect(peers[0].welcome.playerId).toBe(0);

    // The kaiju player's connection blips. A second later a sixth person tries to join.
    room.drop('p0');
    expect(world.players[0].bot).toBe(true);
    run(1);
    const sixth = new FakePeer('sixth');
    expect(refusal(() => room.join(sixth, { name: 'Sixth', token: 'token-sixth-abcdef' })).code).toBe(JOIN_ERROR.roomFull);
    expect(peers[0].closed).toBeNull();

    // Two seconds after that the kaiju player is back and has the kaiju again.
    run(2);
    const back = new FakePeer('p0-back');
    expect(room.join(back, { token: tokenOf(0) })).toBe(0);
    expect(back.welcome.playerId).toBe(0);
    expect(back.welcome.kaijuId).toBe(0);
    expect(world.players[0].bot).toBe(false);
    expect(peers[0].closed?.code).toBe(CLOSE_REPLACED);
  });

  it('gives the kaiju back to its player even after the grace period, while a bot still has it', () => {
    const { room, run } = makeRoom({ graceSeconds: 5 });
    const peers = seatPlayers(room, 5);
    room.message('p0', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(2);
    const world = room.match!.world;

    // The kaiju player's laptop sleeps for longer than the grace period: the seat is given up.
    room.drop('p0');
    run(6);
    expect(peers[0].closed?.code).toBe(CLOSE_SEAT_RELEASED);
    expect(room.seatCount).toBe(4);
    expect(world.players[0].bot).toBe(true);

    // Same link, same token: a new seat, and the kaiju they were playing.
    const back = new FakePeer('p0-back');
    room.join(back, { name: 'Player A', token: tokenOf(0) });
    expect(back.welcome.playerId).toBe(0);
    expect(back.welcome.kaijuId).toBe(0);
    expect(world.players[0].bot).toBe(false);
    expect(back.lobby.lobby.players.find((p) => p.seat === back.lobby.you)?.slot).toBe(0);
    expect(back.lobby.lobby.lastKaijuSeat).toBe(back.lobby.you);
    room.message('p0-back', 'input', input(1, { moveZ: 1 }));
    run(0.2);
    expect(ackOf(back.lastSnapshot).played).toBe(1);
  });

  it('never hands the kaiju to anybody but the player who had it', () => {
    const { room, run } = makeRoom({ graceSeconds: 5 });
    const peers = seatPlayers(room, 3);
    room.message('p0', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(1);
    const world = room.match!.world;
    const squadOfB = peers[1].welcome.playerId;
    room.drop('p0');
    room.drop('p1');
    run(6);
    expect(room.seatCount).toBe(1);

    // A stranger gets a squad nobody ever played before the squad a known player may return to,
    // and never the kaiju.
    const stranger = new FakePeer('stranger');
    room.join(stranger, { name: 'Stranger', token: 'token-stranger-abc' });
    expect(stranger.welcome.playerId).toBeGreaterThan(0);
    expect(stranger.welcome.playerId).not.toBe(squadOfB);
    expect(world.players[0].bot).toBe(true);
    // The squad player comes back to their own squad, the kaiju player to the kaiju.
    const b = new FakePeer('p1-back');
    room.join(b, { token: tokenOf(1) });
    expect(b.welcome.playerId).toBe(squadOfB);
    const a = new FakePeer('p0-back');
    room.join(a, { token: tokenOf(0) });
    expect(a.welcome.playerId).toBe(0);
    expect(world.players.filter((p) => !p.bot).map((p) => p.id).sort()).toEqual([0, squadOfB, peers[2].welcome.playerId, stranger.welcome.playerId].sort());
  });

  it('forgets who had which slot when the match is over', () => {
    const { room, run, runUntil } = makeRoom({ graceSeconds: 2 });
    const peers = seatPlayers(room, 2);
    room.message('p0', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(1);
    room.drop('p0');
    run(3);
    runUntil(() => room.lobby.phase === 'end', 400);
    room.message('p1', 'toLobby', {});
    // The next match is a new deal: the old kaiju player joins it late and gets a squad.
    room.message('p1', 'start', {});
    expect(room.lobby.phase).toBe('match');
    const back = new FakePeer('p0-back');
    room.join(back, { token: tokenOf(0) });
    expect(back.welcome.playerId).toBeGreaterThan(0);
  });

  it('does not count a dropped player when the host starts', () => {
    const { room } = makeRoom({ graceSeconds: 600 });
    const peers = seatPlayers(room, 3);
    room.drop('p2');
    room.message('p1', 'ready', { ready: true });
    room.message('p0', 'start', {});
    expect(room.lobby.phase).toBe('match');
    expect(peers[0].welcome.config.players.filter((p) => !p.bot).length).toBe(2);
    // The dropped player returns during the match and takes over a bot squad.
    const back = new FakePeer('p2-back');
    room.join(back, { token: tokenOf(2) });
    expect(back.lobby.you).toBe(2);
    expect(back.welcome.playerId).toBeGreaterThan(0);
    expect(room.match!.world.players[back.welcome.playerId].bot).toBe(false);
  });
});

describe('late joiners', () => {
  it('hands a late joiner a bot squad, by name', () => {
    const { room, run } = makeRoom();
    const peers = seatPlayers(room, 2);
    room.message('p0', 'setRole', { wantsKaiju: true });
    startMatch(room, peers);
    run(2);
    const world = room.match!.world;
    const late = new FakePeer('late');
    room.join(late, { name: 'Latecomer', token: 'token-late-abcdef' });
    const slot = late.welcome.playerId;
    expect(slot).toBeGreaterThanOrEqual(2);
    expect(world.players[slot].role).toBe('human');
    expect(world.players[slot].bot).toBe(false);
    expect(late.welcome.config.players[slot].name).toBe('Latecomer');
    expect(peers[0].lobby.lobby.players[2].slot).toBe(slot);
    room.message('late', 'input', input(1, { moveZ: 1 }));
    run(0.2);
    expect(ackOf(late.lastSnapshot).played).toBe(1);
    expect(late.lastSnapshot.squads.find((s) => s.player === slot)?.bot).toBe(false);

    // Two more fill the last squads; nobody is left a bot and nobody shares a slot.
    const more = [new FakePeer('m1'), new FakePeer('m2')];
    more.forEach((p, i) => room.join(p, { name: `More ${i}` }));
    const taken = [...peers, late, ...more].map((p) => p.welcome.playerId);
    expect(new Set(taken).size).toBe(5);
    expect(world.players.every((p) => !p.bot)).toBe(true);
  });
});

describe('match end', () => {
  it('plays a fast match to the end, shows the result, and returns to the lobby on the host', () => {
    const { room, runUntil, run } = makeRoom({ speed: 20 });
    const peers = seatPlayers(room, 5);
    startMatch(room, peers);
    const firstKaiju = room.lobby.lastKaijuSeat;
    runUntil(() => room.lobby.phase === 'end', 60);

    for (const peer of peers) {
      expect(peer.lobby.lobby.phase).toBe('end');
      const end = peer.events.filter((e) => e.type === 'matchEnd');
      expect(end.length).toBe(1);
      const e = end[0];
      if (e.type !== 'matchEnd') throw new Error('unreachable');
      expect(['humans', 'kaiju']).toContain(e.winner);
      expect(e.tallies.length).toBe(5);
      const final = peer.lastSnapshot;
      expect(final.match.phase).toBe('ended');
      expect(final.match.winner).toBe(e.winner);
      expect(final.tick).toBe(e.tick);
      // The final snapshot is the last thing sent about the match.
      expect(peer.sent.filter((s) => s.type !== 'lobby').at(-1)?.type).toBe('snap');
    }

    // Nothing more is simulated or sent on the end screen.
    const tick = room.match!.world.tick;
    const count = peers[0].sent.length;
    run(2);
    expect(room.match!.world.tick).toBe(tick);
    expect(peers[0].sent.length).toBe(count);

    // Someone arriving at the end screen sees the result too.
    room.leave('p4');
    const late = new FakePeer('late');
    room.join(late, { name: 'Late' });
    expect(late.sent.map((s) => s.type)).toEqual(['lobby', 'welcome', 'snap', 'events']);
    expect(late.welcome.playerId).toBe(-1);
    expect(late.lastSnapshot.match.phase).toBe('ended');
    expect(late.events.map((e) => e.type)).toEqual(['matchEnd']);

    // Only the host leaves the end screen.
    room.message('p1', 'toLobby', {});
    expect(room.lobby.phase).toBe('end');
    room.message('p0', 'ready', { ready: true });
    room.message('p0', 'toLobby', {});
    expect(room.lobby.phase).toBe('lobby');
    expect(room.match).toBeNull();
    const lobby = peers[1].lobby.lobby;
    expect(lobby.phase).toBe('lobby');
    expect(lobby.players.every((p) => !p.ready && p.slot === -1)).toBe(true);
    expect(lobby.lastKaijuSeat).toBe(firstKaiju);

    // The next match gives the kaiju to somebody else.
    const everyone = [...peers.slice(0, 4), late];
    startMatch(room, everyone);
    expect(room.lobby.phase).toBe('match');
    expect(room.lobby.lastKaijuSeat).not.toBe(firstKaiju);
    expect(everyone.map((p) => p.welcome.playerId).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(everyone.every((p) => p.welcome.tick === 0)).toBe(true);
  });

  it('returns to the lobby by itself when the host does nothing', () => {
    const { room, runUntil, run } = makeRoom({ speed: 50, endScreenSeconds: 10 });
    const peers = seatPlayers(room, 2);
    startMatch(room, peers);
    runUntil(() => room.lobby.phase === 'end', 30);
    run(9);
    expect(room.lobby.phase).toBe('end');
    run(2);
    expect(room.lobby.phase).toBe('lobby');
    expect(peers[1].lobby.lobby.phase).toBe('lobby');
  });

  it('stays on the end screen for as long as the host likes when the timeout is off', () => {
    const { room, runUntil, run } = makeRoom({ speed: 50, endScreenSeconds: 0 });
    const peers = seatPlayers(room, 1);
    startMatch(room, peers);
    runUntil(() => room.lobby.phase === 'end', 30);
    run(600);
    expect(room.lobby.phase).toBe('end');
  });
});
