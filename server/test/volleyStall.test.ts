/**
 * Round 5 (the army's shooting; found by the round 5 army checker): a held Volley on a link that
 * stalls. The player holds Volley; the link stalls for `gap` seconds (nothing arrives), then
 * everything sent meanwhile arrives at once (Volley held all along), then the player keeps
 * holding to full and lets go. A person never let go, so the squad must fire exactly one charged
 * volley, when they did let go. (Round 4 let go of every button after 1.5 s without input: a
 * stall that long fired the volley early and started the charge again from nothing.)
 */
import { Btn, TICK_RATE, type SimEvent } from '@mb/shared';
import { describe, expect, it } from 'vitest';
import { input, makeRoom, seatPlayers, startMatch, TICK_MS } from './helpers';

function squadRoom() {
  const made = makeRoom({ fast: false });
  const [peer] = seatPlayers(made.room, 1);
  made.room.message('p0', 'setRole', { wantsKaiju: false });
  startMatch(made.room, [peer]);
  const world = made.room.match!.world;
  world.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
  made.runUntil(() => world.match.phase === 'playing', 30);
  let seq = 0;
  const tick = (...buttons: number[]): void => {
    for (const b of buttons) made.room.message('p0', 'input', input(++seq, { buttons: b }));
    made.run(TICK_MS / 1000);
  };
  for (let i = 0; i < 10; i++) tick(0);
  peer.clear();
  return { ...made, peer, world, tick };
}

describe('a held Volley through a stall on the line', () => {
  for (const gap of [1.0, 2.0, 3.0]) {
    it(`a ${gap} s stall in the middle of a 5 s hold fires one volley, at the end`, () => {
      const { tick, peer, world } = squadRoom();
      const p = world.players.find((q) => q.role === 'human' && !q.bot)!;
      const squad = world.squads[p.squadId];
      const mates = squad.units.filter((id) => id !== squad.driven).map((id) => world.units[id]);
      for (const u of mates) u.cooldown = 0;
      const V = Btn.volley;
      for (let i = 0; i < 1.5 * TICK_RATE; i++) tick(V);
      const stall = Math.round(gap * TICK_RATE);
      for (let i = 0; i < stall; i++) tick();
      // Everything sent during the stall arrives at once, with this tick's input.
      tick(...Array<number>(stall + 1).fill(V));
      for (let i = 0; i < 5 * TICK_RATE; i++) tick(V);
      tick(0);
      // Long enough for any backlog left by the stall to be played.
      for (let i = 0; i < 6 * TICK_RATE; i++) tick(0);
      const mateIds = new Set(mates.map((u) => u.id));
      const events = peer.events as SimEvent[];
      const fireTicks = new Set(events.flatMap((e) => (e.type === 'projectileSpawn' && mateIds.has(e.ownerId) ? [e.tick] : [])));
      const volleys = events.filter((e) => e.type === 'volley' && e.squad === squad.id);
      expect(fireTicks.size, 'squad-mates fired on more than one tick (an early release during the stall)').toBe(1);
      expect(volleys.length).toBe(1);
    });
  }
});
