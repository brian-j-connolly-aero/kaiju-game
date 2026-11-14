import { describe, expect, it } from 'vitest';
import {
  angleDist,
  beginStage,
  BOT_RULES,
  Btn,
  BUTTON_MASK,
  COMMAND_IDS,
  createMatchConfig,
  createWorld,
  LIZARD,
  MATCH_RULES,
  MAX_AIM_PITCH,
  sanitizeInput,
  setPlayerBot,
  TICK_RATE,
  WEAPONS,
  yawFromTo,
  type MatchConfig,
  type SimEvent,
  type World,
} from '../src/index';
import { eventsOf, HUMAN_PLAYER, input, KAIJU_PLAYER, makeTestWorld, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const SEC = TICK_RATE;
const ROCKET_RANGE = WEAPONS.army_rocket_launchers.range;

/** Bots that play: both sides, or one side with the other standing still. */
function bots(kaiju: boolean, humans: boolean): Partial<MatchConfig> {
  return { bots: { kaijuHandicap: kaiju ? 0 : 1, humanHandicap: humans ? 0 : 1 } };
}

/** An open field (or the given city) with four bot squads and a kaiju that stands still unless a test moves it. */
function squadWorld(options: TestWorldOptions = {}): World {
  const world = makeTestWorld({ people: 'none', config: bots(false, true), ...options });
  placeKaiju(world, 0, 0, 0);
  return world;
}

function leaders(world: World) {
  return world.squads.map((s) => world.units[s.driven]);
}

describe('bots play through the input interface only', () => {
  it('writes inputs a client could have sent: in range, the right buttons for the role, one wheel pick at a time', () => {
    const world = createWorld({ seed: 11, config: { ...createMatchConfig({ fast: true }) } });
    const kaijuButtons = Btn.strike | Btn.grab | Btn.block | Btn.roar | Btn.special | Btn.molt;
    const squadButtons = Btn.fire | Btn.callIn;
    const seen = { kaiju: 0, squad: 0, wheel: new Set<string>(), marker: 0 };
    for (let t = 0; t < 150 * SEC && world.match.phase !== 'ended'; t++) {
      world.step();
      for (const p of world.players) {
        const b = p.botInput;
        // Sanitizing a bot's input changes nothing: it was a legal input already.
        const clean = sanitizeInput(JSON.parse(JSON.stringify(b)));
        expect(clean).not.toBeNull();
        expect(clean?.moveX).toBeCloseTo(b.moveX, 9);
        expect(clean?.moveZ).toBeCloseTo(b.moveZ, 9);
        expect(clean?.aimPitch).toBe(b.aimPitch);
        expect(clean?.buttons).toBe(b.buttons);
        expect(Math.hypot(b.moveX, b.moveZ)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(b.aimPitch)).toBeLessThanOrEqual(MAX_AIM_PITCH);
        expect(Number.isFinite(b.aimYaw)).toBe(true);
        expect(b.buttons & ~BUTTON_MASK).toBe(0);
        expect(b.seq).toBe(world.tick);
        if (p.role === 'kaiju') {
          expect(b.buttons & squadButtons).toBe(0);
          expect(b.wheel).toBeUndefined();
          seen.kaiju |= b.buttons;
        } else {
          expect(b.buttons & kaijuButtons).toBe(0);
          if (b.wheel) {
            expect(COMMAND_IDS).toContain(b.wheel);
            seen.wheel.add(b.wheel);
          }
          if (b.marker) seen.marker++;
          seen.squad |= b.buttons;
        }
      }
    }
    // Over a whole (fast) match the bots used their repertoire.
    expect(seen.kaiju & Btn.strike).toBeTruthy();
    expect(seen.kaiju & Btn.molt).toBeTruthy();
    expect(seen.squad & Btn.fire).toBeTruthy();
    expect([...seen.wheel].sort()).toEqual(['follow', 'holdCharge']);
    expect(world.match.stage).toBeGreaterThan(1);
  });

  it('a fully handicapped bot stands still with its hands off the buttons and never touches the generator', () => {
    const world = makeTestWorld({ people: 'none' });
    const before = world.rng.s;
    const yaws = world.players.map((p) => p.botInput.aimYaw);
    const events = run(world, 5 * SEC);
    for (const p of world.players) {
      expect(p.botInput).toMatchObject({ moveX: 0, moveZ: 0, buttons: 0, seq: world.tick });
      expect(p.botInput.wheel).toBeUndefined();
      expect(p.botInput.aimYaw).toBe(yaws[p.id]);
    }
    expect(eventsOf(events, 'kaijuAction')).toEqual([]);
    expect(eventsOf(events, 'volley')).toEqual([]);
    // (The squads' sub-units still fire at will at a kaiju in range: that is the rules, not the bot.)
    const k = world.kaijus[0];
    expect([k.vx, k.vz]).toEqual([0, 0]);
    // The only random draws were the radio's and the at-will shots': the bots made none.
    const draws = eventsOf(events, 'voice').length + 2 * eventsOf(events, 'projectileSpawn').length;
    const replay = { s: before };
    for (let i = 0; i < draws; i++) replay.s = (replay.s + 0x6d2b79f5) >>> 0;
    expect(eventsOf(events, 'projectileSpawn').length === 0 ? world.rng.s : replay.s).toBe(replay.s);
  });
});

describe('the squad bot', () => {
  it('takes a firing position inside its range band, parks on hold-and-charge, and volleys when charged', () => {
    const world = squadWorld();
    const k = world.kaijus[0];
    const events = run(world, 45 * SEC);

    for (const squad of world.squads) {
      const leader = world.units[squad.driven];
      const d = Math.hypot(leader.x - k.x, leader.z - k.z);
      // Inside the band the bot parks in, and not on top of the kaiju.
      expect(d).toBeGreaterThanOrEqual(BOT_RULES.squad.retreatAt * ROCKET_RANGE);
      expect(d).toBeLessThanOrEqual(BOT_RULES.squad.standoffMax * ROCKET_RANGE + 2);
      // Parked: hold fire and charge, the sub-units planted with their arcs on the kaiju.
      expect(squad.fireMode).toBe('charge');
      for (const id of squad.units) {
        if (id === squad.driven) continue;
        const u = world.units[id];
        expect(u.rooted).toBe(true);
        expect(angleDist(u.arcYaw, yawFromTo(u.x, u.z, k.x, k.z))).toBeLessThan(0.2);
      }
      // The leader keeps its crosshair on the kaiju.
      expect(angleDist(leader.aimYaw, yawFromTo(leader.x, leader.z, k.x, k.z))).toBeLessThan(0.05);
    }
    // Every squad fired charged volleys, at (nearly) full charge.
    const volleys = eventsOf(events, 'volley');
    for (const squad of world.squads) expect(volleys.filter((v) => v.squad === squad.id).length).toBeGreaterThanOrEqual(2);
    // ...except into a broken nerve, when every second counts and they fire as the guns load.
    const windows = eventsOf(events, 'kaijuStagger');
    const staggered = (tick: number): boolean => {
      let on = false;
      for (const e of windows) if (e.tick <= tick) on = e.on;
      return on;
    };
    const patient = volleys.filter((v) => !staggered(v.tick) && !staggered(v.tick - 1));
    expect(patient.length).toBeGreaterThanOrEqual(4);
    expect(patient.every((v) => v.charge >= BOT_RULES.squad.volleyCharge - 1e-6)).toBe(true);
    // They did not plink: every projectile was part of a charged volley (the ragged fire into a stagger aside).
    expect(eventsOf(events, 'projectileSpawn').every((s) => s.volley || staggered(s.tick) || staggered(s.tick - 1))).toBe(true);
    // Rockets found the target.
    expect(eventsOf(events, 'kaijuHit').length).toBeGreaterThan(20);
  });

  it('spreads the squads around the kaiju so their fire crosses, and together they break its nerve', () => {
    const world = squadWorld();
    const k = world.kaijus[0];
    const events = run(world, 60 * SEC);
    const bearings = leaders(world).map((u) => yawFromTo(k.x, k.z, u.x, u.z));
    for (let i = 0; i < bearings.length; i++) {
      for (let j = i + 1; j < bearings.length; j++) expect(angleDist(bearings[i], bearings[j])).toBeGreaterThan(0.8);
    }
    expect(eventsOf(events, 'crossfire').length).toBeGreaterThan(0);
    // A kaiju that just stands there is broken, again and again, and killed: coordinated volleys do kill.
    expect(eventsOf(events, 'nerveBreak').length).toBeGreaterThanOrEqual(2);
    const more = run(world, 240 * SEC);
    expect(k.alive).toBe(false);
    expect(eventsOf(more, 'matchEnd')).toMatchObject([{ winner: 'humans', reason: 'kill' }]);
  });

  it('backs off when the kaiju comes close, and comes back when it has gone', () => {
    const world = squadWorld();
    const k = world.kaijus[0];
    run(world, 30 * SEC);
    const squad = world.squads[0];
    const leader = world.units[squad.driven];
    expect(squad.fireMode).toBe('charge');
    expect(world.units[squad.units[1]].rooted).toBe(true);
    const retreat = BOT_RULES.squad.retreatAt * ROCKET_RANGE;

    // The kaiju turns up 25 m from the leader.
    const away = yawFromTo(k.x, k.z, leader.x, leader.z);
    placeKaiju(world, leader.x - Math.sin(away) * 25, leader.z - Math.cos(away) * 25, away);
    const events = run(world, 12 * SEC);
    // It un-parked (follow) and drove off: the whole squad is clear of the kaiju again.
    expect(world.players[squad.player].botState.parked || Math.hypot(leader.x - k.x, leader.z - k.z) > retreat).toBe(true);
    expect(Math.hypot(leader.x - k.x, leader.z - k.z)).toBeGreaterThan(retreat);
    for (const id of squad.units) expect(Math.hypot(world.units[id].x - k.x, world.units[id].z - k.z)).toBeGreaterThan(30);
    expect(squad.moveOrder).toBe('follow');
    // No volley was fired from the saddle.
    expect(eventsOf(events, 'volley').filter((v) => v.squad === 0 && v.tick > world.tick - 11 * SEC && v.tick < world.tick - 4 * SEC)).toEqual([]);

    // Left alone, it parks again and goes back to work.
    const later = run(world, 30 * SEC);
    expect(world.units[squad.units[1]].rooted).toBe(true);
    expect(eventsOf(later, 'volley').some((v) => v.squad === 0)).toBe(true);
  });

  it('does not know where a hatchling is until somebody sees it: it searches, and holds its fire', () => {
    // Walls on all four sides of the kaiju: nobody can see it, so it is not on the humans' map.
    const walls = [
      { x: 0, z: 30, w: 80, d: 4, height: 30 },
      { x: 0, z: -30, w: 80, d: 4, height: 30 },
      { x: 30, z: 0, w: 4, d: 80, height: 30 },
      { x: -30, z: 0, w: 4, d: 80, height: 30 },
    ].map((s) => ({ ...s, hp: 1e9 }));
    const world = squadWorld({ structures: walls });
    const k = world.kaijus[0];
    const start = leaders(world).map((u) => ({ x: u.x, z: u.z }));
    const events = run(world, 40 * SEC);
    expect(k.known).toBe(false);
    expect(eventsOf(events, 'projectileSpawn')).toEqual([]);
    for (const p of world.players) if (p.role === 'human') expect(p.botState.mode).toBe('search');
    // They went looking (toward the middle of the bounds first, then around).
    leaders(world).forEach((u, i) => expect(Math.hypot(u.x - start[i].x, u.z - start[i].z)).toBeGreaterThan(40));

    // A wall comes down: now they see it, and they engage.
    world.structureHp[0] = 0;
    const later = run(world, 40 * SEC);
    expect(k.known).toBe(true);
    expect(eventsOf(later, 'volley').length).toBeGreaterThan(0);
  });

  it('pours fire into a cocoon as fast as the guns load', () => {
    const world = squadWorld();
    const k = world.kaijus[0];
    run(world, 30 * SEC);
    k.phase = 'cocoon';
    k.action = 'molt';
    k.phaseTime = 0;
    k.phaseDuration = 1e9;
    k.hp = 1e6;
    k.maxHp = 1e6;
    const events = run(world, 10 * SEC);
    const cooldown = WEAPONS.army_rocket_launchers.cooldown;
    for (const squad of world.squads) {
      const shots = eventsOf(events, 'projectileSpawn').filter((s) => s.ownerId === squad.driven);
      const salvos = new Set(shots.map((s) => s.tick)).size;
      // Ten seconds of a 2.6 s weapon: three or four salvos from the leader alone.
      expect(salvos).toBeGreaterThanOrEqual(Math.floor(10 / cooldown) - 1);
    }
  });

  it('calls artillery on the kaiju at level 3, leading it, and keeps calling when it is ready again', () => {
    const world = squadWorld({ realCity: true });
    beginStage(world, 3);
    const k = world.kaijus[0];
    const events = run(world, 50 * SEC);
    const marked = eventsOf(events, 'callin').filter((e) => e.phase === 'marked');
    // All four squads called it in, and those whose battery was ready again called again.
    expect(new Set(marked.map((e) => e.squad)).size).toBe(4);
    expect(marked.length).toBeGreaterThan(4);
    for (const e of marked) expect(Math.hypot(e.x - k.x, e.z - k.z)).toBeLessThan(40);
    expect(eventsOf(events, 'projectileSpawn').filter((s) => s.owner === 'callin').length).toBeGreaterThanOrEqual(32);
  });
});

describe('the kaiju bot', () => {
  /** A street of houses with cars parked along it, and the squads far away (or told to stand still). */
  const STREET: TestWorldOptions = {
    structures: [-60, -40, -20, 0, 20, 40, 60].flatMap((x) => [
      { x, z: 30, w: 10, d: 10, height: 6, hp: 80, value: 8 },
      { x, z: -30, w: 10, d: 10, height: 6, hp: 80, value: 8 },
    ]),
    props: [-50, -10, 30, 70].map((x) => ({ kind: 'car_sedan' as const, x, z: 0 })),
  };

  function kaijuWorld(options: TestWorldOptions = {}): World {
    const world = makeTestWorld({ people: 'none', config: bots(true, false), ...STREET, ...options });
    // The squads keep out of it: parked in a corner, holding their fire.
    for (const u of world.units) placeUnit(world, u.id, 150 + (u.id % 4) * 8, 150 + Math.floor(u.id / 4) * 8);
    for (const squad of world.squads) squad.fireMode = 'charge';
    return world;
  }

  it('goes for what pays best: walks over cars, swipes houses down, and fills the bar', () => {
    const world = kaijuWorld();
    const k = world.kaijus[0];
    const events = run(world, 60 * SEC);
    const tally = world.players[KAIJU_PLAYER].tally;
    // A minute in, most of the street is down (a house is two swipes; the cars can wait).
    expect(tally.wrecked.house).toBeGreaterThanOrEqual(8);
    expect(world.match.barPoints).toBeGreaterThan(8 * 8);
    // Given another minute it has had everything, the cars included.
    run(world, 60 * SEC);
    expect(tally.wrecked.house).toBe(14);
    expect(tally.wrecked.car).toBe(4);
    const verbs = eventsOf(events, 'kaijuAction').filter((e) => e.phase === 'windup').map((e) => e.action);
    expect(verbs.filter((v) => v === 'swipe' || v === 'stomp').length).toBeGreaterThan(12);
    // It kept moving: no long spells of standing about.
    expect(k.alive).toBe(true);
    expect(tally.barPoints).toBeCloseTo(world.match.barPoints, 6);
  });

  it('molts when it may, comes out bigger, and carries on to the win', () => {
    const world = kaijuWorld({ marks: [30, 60, 100] });
    const events: SimEvent[] = [];
    for (let t = 0; t < 240 * SEC && world.match.phase !== 'ended'; t++) events.push(...world.step());
    expect(eventsOf(events, 'cocoon').length).toBe(2);
    expect(eventsOf(events, 'stageChange').map((e) => e.stage)).toEqual([2, 3]);
    expect(eventsOf(events, 'matchEnd')).toMatchObject([{ winner: 'kaiju', reason: 'bar' }]);
    // It did not dawdle once the molt was offered (nobody was looking, so it had nothing to hide from).
    const offered = eventsOf(events, 'moltAvailable')[0].tick;
    const closed = eventsOf(events, 'cocoon')[0].tick;
    expect(closed - offered).toBeLessThan(4 * SEC);
  });

  it('eats when it is hurt: from the street, a car at a time', () => {
    const world = kaijuWorld({ structures: [] });
    const k = world.kaijus[0];
    k.hp = 300;
    const events = run(world, 30 * SEC);
    const meals = eventsOf(events, 'kaijuHeld').filter((e) => e.reason === 'eat');
    expect(meals.length).toBeGreaterThanOrEqual(2);
    expect(k.hp).toBeGreaterThanOrEqual(300 + 2 * LIZARD.actions.eat.heal);
    // Not hurt, it leaves the cars to be walked over instead.
    const fresh = kaijuWorld({ structures: [] });
    expect(eventsOf(run(fresh, 30 * SEC), 'kaijuHeld').filter((e) => e.reason === 'eat')).toEqual([]);
  });

  it('fights what comes close: it roars at guns charging inside its roar, and tramples and swipes units in reach', () => {
    const world = kaijuWorld({ structures: [], props: [] });
    const k = placeKaiju(world, 0, 0, 0);
    // A squad parks and charges 25 m away: inside the roar radius, inside its patience.
    const squad = world.squads[0];
    squad.units.forEach((id, i) => placeUnit(world, id, -12 + i * 8, 25));
    run(world, 1, [null, input({ wheel: 'holdCharge' })]);
    // (Squad 0 belongs to a bot standing still; give the order the way the server would.)
    squad.fireMode = 'charge';
    for (const id of squad.units) {
      if (id === squad.driven) continue;
      const u = world.units[id];
      u.nav.hasHold = true;
      u.nav.holdX = u.x;
      u.nav.holdZ = u.z;
    }
    const events = run(world, 20 * SEC);
    expect(eventsOf(events, 'roar').length).toBeGreaterThanOrEqual(1);
    const lost = eventsOf(events, 'unitDestroyed').filter((e) => e.squad === 0);
    expect(lost.length).toBeGreaterThanOrEqual(2);
    expect(lost.every((e) => e.by === KAIJU_PLAYER)).toBe(true);
    expect(k.alive).toBe(true);
  });

  it('braces when enough charged lasers are on it, facing them, and not forever', () => {
    const world = kaijuWorld({ structures: [], props: [] });
    const k = placeKaiju(world, 0, 0, 0);
    // Two squads planted 100 m north, charged and holding: out of its dash range, lasers on it.
    for (const s of [0, 1]) {
      const squad = world.squads[s];
      squad.units.forEach((id, i) => {
        const u = placeUnit(world, id, -40 + s * 50 + i * 8, 118);
        if (id === squad.driven) return;
        u.nav.hasHold = true;
        u.nav.holdX = u.x;
        u.nav.holdZ = u.z;
      });
    }
    let braced = 0;
    let longest = 0;
    let spell = 0;
    let facing = 0;
    for (let t = 0; t < 40 * SEC; t++) {
      world.step();
      if (k.phase === 'brace') {
        braced++;
        spell++;
        longest = Math.max(longest, spell);
        if (angleDist(k.yaw, 0) < 0.5) facing++;
      } else {
        spell = 0;
      }
    }
    expect(braced).toBeGreaterThan(2 * SEC);
    // It turns its front to the guns while it braces...
    expect(facing).toBeGreaterThan(braced * 0.6);
    // ...and gives up after a while, so that patient squads cannot pin it for good.
    expect(longest).toBeLessThanOrEqual((BOT_RULES.kaiju.braceMax + 0.5) * SEC);
    expect(braced).toBeLessThan(25 * SEC);
  });

  it('turns its beam on units in reach when it has the rage for it', () => {
    const world = kaijuWorld({ structures: [], props: [] });
    const k = placeKaiju(world, 0, 0, 0);
    world.squads[0].units.forEach((id, i) => placeUnit(world, id, -12 + i * 8, 45));
    k.rage = 100;
    const events = run(world, 8 * SEC);
    expect(eventsOf(events, 'kaijuAction').some((e) => e.action === 'special' && e.phase === 'special')).toBe(true);
    expect(eventsOf(events, 'unitDestroyed').some((e) => e.cause === 'beam')).toBe(true);
    expect(k.rage).toBeLessThan(100);
  });
});

describe('handicaps and hand-overs', () => {
  it('a handicapped kaiju bot hesitates that share of the time, and gets less done', () => {
    const wreck = (handicap: number): { idle: number; bar: number } => {
      const world = makeTestWorld({ people: 'none', realCity: true, seed: 5, config: { bots: { kaijuHandicap: handicap, humanHandicap: 1 } } });
      for (const squad of world.squads) squad.fireMode = 'charge';
      let idle = 0;
      const ticks = 90 * SEC;
      for (let t = 0; t < ticks; t++) {
        world.step();
        const b = world.players[KAIJU_PLAYER].botInput;
        if (b.buttons === 0 && b.moveX === 0 && b.moveZ === 0 && world.kaijus[0].phase === 'idle') idle++;
      }
      return { idle: idle / ticks, bar: world.match.barPoints };
    };
    const best = wreck(0);
    const half = wreck(0.5);
    expect(best.idle).toBeLessThan(0.2);
    expect(half.idle).toBeGreaterThan(0.25);
    expect(half.idle).toBeLessThan(0.75);
    expect(half.bar).toBeLessThan(best.bar * 0.85);
    expect(half.bar).toBeGreaterThan(0);
  });

  it('a bot takes over a dropped player with a fresh mind, and hands the slot back with the controls let go', () => {
    const world = makeTestWorld({ realCity: true, config: bots(true, true) });
    const k = world.kaijus[0];
    const p = world.players[KAIJU_PLAYER];
    // The person holds Strike and walks; the bots of the other slots play on around them.
    run(world, 20, [input({ seq: 20, moveZ: 1, buttons: Btn.strike }), input({ seq: 20 })]);
    expect(p.input.buttons).toBe(Btn.strike);

    // They drop: the bot drives from the very next tick, and their stale input is ignored.
    setPlayerBot(world, KAIJU_PLAYER, true);
    expect(p.bot).toBe(true);
    expect(p.botState.stage).toBe(0);
    const bar = world.match.barPoints;
    run(world, 40 * SEC, [input({ seq: 21, moveZ: -1, buttons: Btn.roar }), input({ seq: 21 })]);
    expect(p.input.seq).toBe(world.tick - 1);
    expect(world.match.barPoints).toBeGreaterThan(bar);
    expect(p.botState.stage).toBe(1);

    // They come back while the bot has a button down: the controls are let go at once...
    p.botInput.buttons = Btn.strike | Btn.block;
    p.botInput.moveZ = 1;
    world.step([null, input({ seq: 22 })]);
    expect(p.input.buttons).toBe(Btn.strike | Btn.block);
    setPlayerBot(world, KAIJU_PLAYER, false);
    world.step([null, input({ seq: 23 })]);
    expect(p.input).toMatchObject({ buttons: 0, moveX: 0, moveZ: 0 });
    expect(p.input.released).toBe(Btn.strike | Btn.block);
    // ...and stay let go until their own first input arrives, which is then obeyed.
    run(world, 10, [null, input({ seq: 24 })]);
    expect(p.input.buttons).toBe(0);
    const yaw = k.yaw;
    world.step([input({ seq: 30, aimYaw: yaw, moveZ: 1 }), input({ seq: 25 })]);
    expect(p.input).toMatchObject({ seq: 30, moveZ: 1 });

    // The same hook hands a bot squad to a late joiner and takes it back.
    const h = world.players[HUMAN_PLAYER];
    setPlayerBot(world, HUMAN_PLAYER, true);
    run(world, 5 * SEC);
    expect(h.botState.stage).toBe(world.match.stage);
    setPlayerBot(world, HUMAN_PLAYER, false);
    world.step();
    expect(h.input).toMatchObject({ buttons: 0, moveX: 0, moveZ: 0 });
    // Handing a slot to what it already is changes nothing.
    const mind = h.botState;
    setPlayerBot(world, HUMAN_PLAYER, false);
    expect(h.botState).toBe(mind);
    expect(MATCH_RULES.maxPlayers).toBe(5);
  });
});
