import { describe, expect, it } from 'vitest';
import {
  applyInput,
  bitGet,
  boundsContains,
  Btn,
  BtnIndex,
  circleHitsStructure,
  computeBarMarks,
  createInputState,
  createMatchConfig,
  createWorld,
  DT,
  encodeSnapshot,
  getCity,
  MATCH_RULES,
  NEVER_PRESSED_TICKS,
  playerKaiju,
  playerSquad,
  queueCommand,
  setPlayerBot,
  snapshotOfWorld,
  stageBounds,
  SYSTEM_ORDER,
  TICK_RATE,
  valueInBounds,
  type SimEvent,
} from '../src/index';
import { HUMAN_PLAYER, input, KAIJU_PLAYER, makeTestWorld, run } from './helpers';

describe('createWorld', () => {
  it('builds the Tier 1 match: one kaiju, four squads of four, in the briefing', () => {
    const world = createWorld({ seed: 1, config: createMatchConfig() });
    expect(world.tick).toBe(0);
    expect(world.match.phase).toBe('briefing');
    expect(world.match.stage).toBe(1);
    expect(world.match.clock).toBe(720);
    expect(world.match.phaseTime).toBe(10);
    expect(world.kaijus.length).toBe(1);
    expect(world.squads.length).toBe(4);
    expect(world.units.length).toBe(16);
    expect(world.players.length).toBe(5);
    expect(world.players.every((p) => p.bot)).toBe(true);

    const k = world.kaijus[0];
    expect(k.kind).toBe('lizard');
    expect(k.hp).toBe(1000);
    expect(k.radius).toBe(2.4);
    expect(k.height).toBe(4.5);
    expect(k.phase).toBe('idle');
    expect(k.action).toBe('none');
    expect(world.players[k.player].kaijuId).toBe(k.id);
    expect(playerKaiju(world, k.player)).toBe(k);
    expect(playerKaiju(world, 1)).toBeNull();

    for (const squad of world.squads) {
      expect(world.players[squad.player].squadId).toBe(squad.id);
      expect(playerSquad(world, squad.player)).toBe(squad);
      expect(squad.level).toBe(1);
      expect(squad.driven).toBe(squad.units[0]);
      expect(squad.moveOrder).toBe('follow');
      expect(squad.fireMode).toBe('atWill');
      squad.units.forEach((id, slot) => {
        const u = world.units[id];
        expect(id).toBe(squad.id * 4 + slot);
        expect(u.id).toBe(id);
        expect(u.squad).toBe(squad.id);
        expect(u.slot).toBe(slot);
        expect(u.type).toBe('army_rocket_infantry');
        expect(u.alive).toBe(true);
        expect(u.hp).toBe(100);
        expect(u.members).toBe(10);
      });
    }
  });

  it('deploys squads inside the bounds, on open ground, away from the kaiju and from each other', () => {
    for (const anchor of [0, 3, 6, 9]) {
      const world = createWorld({ seed: 5, config: createMatchConfig({ anchor }) });
      const k = world.kaijus[0];
      const b = world.match.bounds;
      expect(b).toEqual(stageBounds(world.city, anchor, 1));
      expect(boundsContains(b, k.x, k.z, k.radius)).toBe(true);
      expect(circleHitsStructure(world.cityQuery, k.x, k.z, k.radius)).toBe(false);
      const leaders = world.squads.map((s) => world.units[s.units[0]]);
      for (const u of world.units) {
        expect(boundsContains(b, u.x, u.z, u.radius)).toBe(true);
        expect(circleHitsStructure(world.cityQuery, u.x, u.z, u.radius)).toBe(false);
        expect(Math.hypot(u.x - k.x, u.z - k.z)).toBeGreaterThan(150);
        for (const other of world.units) {
          if (other.id === u.id) continue;
          expect(Math.hypot(u.x - other.x, u.z - other.z)).toBeGreaterThanOrEqual(u.radius + other.radius);
        }
      }
      // Squads take different sides: no two leaders close together.
      for (let i = 0; i < leaders.length; i++) {
        for (let j = i + 1; j < leaders.length; j++) {
          expect(Math.hypot(leaders[i].x - leaders[j].x, leaders[i].z - leaders[j].z)).toBeGreaterThan(100);
        }
      }
    }
  });

  it('computes fair bar marks from the value actually present', () => {
    const { city } = getCity();
    for (const anchor of city.anchors) {
      const world = createWorld({ seed: 2, config: createMatchConfig({ anchor: anchor.id }) });
      const [p1, p2, p3] = world.match.marks;
      expect(p1).toBeCloseTo(0.35 * valueInBounds(city, stageBounds(city, anchor.id, 1)), 6);
      expect(p2).toBeGreaterThanOrEqual(1.6 * p1 - 1e-9);
      expect(p2).toBeGreaterThanOrEqual(0.3 * valueInBounds(city, stageBounds(city, anchor.id, 2)) - 1e-9);
      expect(p3).toBeGreaterThanOrEqual(1.6 * p2 - 1e-9);
      expect(p3).toBeGreaterThanOrEqual(0.3 * valueInBounds(city, stageBounds(city, anchor.id, 3)) - 1e-9);
    }
    const scaled = computeBarMarks(city, 0, 0.5);
    const full = computeBarMarks(city, 0);
    expect(scaled[2]).toBeCloseTo(full[2] / 2, 6);
  });

  it('picks the starting neighborhood from the seed unless the config fixes it', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      seen.add(createWorld({ seed, config: createMatchConfig() }).match.anchor);
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(createWorld({ seed: 3, config: createMatchConfig({ anchor: 4 }) }).match.anchor).toBe(4);
  });

  it('is deterministic: same seed, config and inputs give the same world', () => {
    const play = (): Uint8Array => {
      const world = makeTestWorld({ realCity: true, seed: 11 });
      for (let i = 0; i < 300; i++) {
        const a = Math.sin(i / 40);
        world.step([
          input({ seq: i, moveZ: 1, aimYaw: a }),
          input({ seq: i, moveZ: 1, moveX: 0.3, aimYaw: -a, buttons: i % 50 < 10 ? Btn.fire : 0 }),
        ]);
      }
      return encodeSnapshot(snapshotOfWorld(world));
    };
    expect(play()).toEqual(play());
  });

  it('rejects malformed configs', () => {
    const config = createMatchConfig();
    expect(() => createWorld({ seed: 1, config: { ...config, players: [] } })).toThrow();
    expect(() => createWorld({ seed: 1, config: { ...config, players: config.players.slice(1) } })).toThrow();
    expect(() => createWorld({ seed: 1, config: { ...config, anchor: 999 } })).toThrow();
    const humansOnly = config.players.slice(1).map((p, i) => ({ ...p, id: i }));
    expect(() => createWorld({ seed: 1, config: { ...config, players: humansOnly } })).toThrow();
  });

  it('runs the eleven systems in the documented order', () => {
    expect(SYSTEM_ORDER).toEqual([
      'inputs',
      'kaijuActions',
      'unitOrders',
      'bots',
      'movement',
      'weapons',
      'projectiles',
      'damage',
      'cityDamage',
      'matchFlow',
      'voice',
    ]);
    expect(TICK_RATE).toBe(30);
    expect(DT).toBeCloseTo(1 / 30, 12);
  });
});

describe('input intake', () => {
  it('derives press and release edges and hold timers from raw button state', () => {
    const s = createInputState();
    const strike = BtnIndex.strike;
    expect(s.sincePressTicks[strike]).toBe(NEVER_PRESSED_TICKS);

    applyInput(s, input({ seq: 1, buttons: Btn.strike }));
    expect(s.pressed).toBe(Btn.strike);
    expect(s.released).toBe(0);
    expect(s.heldTicks[strike]).toBe(1);
    expect(s.sincePressTicks[strike]).toBe(0);

    applyInput(s, input({ seq: 2, buttons: Btn.strike | Btn.roar }));
    expect(s.pressed).toBe(Btn.roar);
    expect(s.heldTicks[strike]).toBe(2);
    expect(s.heldTicks[BtnIndex.roar]).toBe(1);
    expect(s.sincePressTicks[strike]).toBe(1);

    applyInput(s, input({ seq: 3, buttons: Btn.roar }));
    expect(s.released).toBe(Btn.strike);
    expect(s.pressed).toBe(0);
    expect(s.heldTicks[strike]).toBe(0);
    expect(s.lastHeldTicks[strike]).toBe(2);
    expect(s.sincePressTicks[strike]).toBe(2);

    applyInput(s, input({ seq: 4, buttons: 0 }));
    expect(s.released).toBe(Btn.roar);
    expect(s.lastHeldTicks[strike]).toBe(2);
    expect(s.seq).toBe(4);
  });

  it('repeats the last sample when a tick has no input', () => {
    const s = createInputState();
    applyInput(s, input({ seq: 9, moveZ: 1, aimYaw: 0.5, buttons: Btn.block }));
    applyInput(s, null);
    applyInput(s, undefined);
    expect(s.seq).toBe(9);
    expect(s.moveZ).toBe(1);
    expect(s.aimYaw).toBe(0.5);
    expect(s.buttons).toBe(Btn.block);
    expect(s.pressed).toBe(0);
    expect(s.heldTicks[BtnIndex.block]).toBe(3);
  });

  it('tells a tap from a hold the way the kaiju verbs need', () => {
    // Stomp needs the strike button down for 0.35 s: 11 ticks at 30 Hz.
    const holdTicks = Math.ceil(0.35 * TICK_RATE);
    const s = createInputState();
    for (let i = 0; i < 4; i++) applyInput(s, input({ buttons: Btn.strike }));
    applyInput(s, input({ buttons: 0 }));
    expect(s.released & Btn.strike).toBeTruthy();
    expect(s.lastHeldTicks[BtnIndex.strike]).toBeLessThan(holdTicks);

    for (let i = 0; i < holdTicks; i++) applyInput(s, input({ buttons: Btn.strike }));
    expect(s.heldTicks[BtnIndex.strike]).toBe(holdTicks);
    expect(s.heldTicks[BtnIndex.strike] * DT).toBeGreaterThanOrEqual(0.35);
  });

  it('feeds the world: the echoed sequence number and the driven unit control', () => {
    const world = makeTestWorld();
    world.step([input({ seq: 41 }), input({ seq: 17, moveX: 0.5, moveZ: -0.5, aimYaw: 1, aimPitch: 0.2, buttons: Btn.fire })]);
    expect(world.players[KAIJU_PLAYER].input.seq).toBe(41);
    expect(world.players[HUMAN_PLAYER].input.seq).toBe(17);
    const squad = playerSquad(world, HUMAN_PLAYER);
    expect(squad).not.toBeNull();
    if (!squad) return;
    const unit = world.units[squad.driven];
    expect(unit.control).toEqual({ moveX: 0.5, moveZ: -0.5, aimYaw: 1, aimPitch: 0.2, fire: true });
    expect(unit.aimYaw).toBe(1);
    expect(unit.aimPitch).toBe(0.2);
    // Sub-units are not touched by the player's stick.
    expect(world.units[squad.units[1]].control.moveX).toBe(0);
  });

  it('turns wheel picks, markers and queued commands into this tick\'s commands', () => {
    const world = makeTestWorld();
    const p = world.players[HUMAN_PLAYER];
    world.step([null, input({ seq: 1, wheel: 'holdCharge' })]);
    expect(p.commands).toEqual([{ type: 'holdCharge' }]);
    world.step([null, input({ seq: 2 })]);
    expect(p.commands).toEqual([]);

    world.step([null, input({ seq: 3, wheel: 'moveTo', marker: { x: 12, z: -34 } })]);
    expect(p.commands).toEqual([{ type: 'moveTo', x: 12, z: -34 }]);

    queueCommand(world, HUMAN_PLAYER, { type: 'follow' });
    queueCommand(world, HUMAN_PLAYER, { type: 'fireAtWill' });
    world.step([null, input({ seq: 4, wheel: 'holdCharge' })]);
    expect(p.commands).toEqual([{ type: 'follow' }, { type: 'fireAtWill' }, { type: 'holdCharge' }]);
    world.step([null, input({ seq: 5 })]);
    expect(p.commands).toEqual([]);

    // The kaiju player cannot issue squad commands.
    queueCommand(world, KAIJU_PLAYER, { type: 'follow' });
    world.step([input({ seq: 1, wheel: 'follow' }), null]);
    expect(world.players[KAIJU_PLAYER].commands).toEqual([]);
  });

  it('places a move-to marker where the aim ray meets the ground when none is given', () => {
    const world = makeTestWorld();
    const squad = playerSquad(world, HUMAN_PLAYER);
    if (!squad) throw new Error('no squad');
    const unit = world.units[squad.driven];
    const aimYaw = 0.3;
    const aimPitch = -0.1;
    world.step([null, input({ seq: 1, aimYaw, aimPitch, wheel: 'moveTo' })]);
    const cmd = world.players[HUMAN_PLAYER].commands[0];
    expect(cmd.type).toBe('moveTo');
    if (cmd.type !== 'moveTo') return;
    // Eye height 1.7 m looking 0.1 rad down: the ray lands 1.7 / tan(0.1) m ahead.
    const reach = 1.7 / Math.tan(0.1);
    expect(cmd.x).toBeCloseTo(unit.x + Math.sin(aimYaw) * reach, 6);
    expect(cmd.z).toBeCloseTo(unit.z + Math.cos(aimYaw) * reach, 6);
  });

  it('only offers the call-in button when the squad has a call-in (level 3)', () => {
    const world = makeTestWorld();
    world.step([null, input({ seq: 1, buttons: Btn.callIn, marker: { x: 5, z: 6 } })]);
    expect(world.players[HUMAN_PLAYER].commands).toEqual([]);
    world.step([null, input({ seq: 2 })]);
    world.match.stage = 3;
    world.step([null, input({ seq: 3, buttons: Btn.callIn, marker: { x: 5, z: 6 } })]);
    expect(world.players[HUMAN_PLAYER].commands).toEqual([{ type: 'callIn', callIn: 'artillery', x: 5, z: 6 }]);
    // Holding the button does not repeat the request.
    world.step([null, input({ seq: 4, buttons: Btn.callIn, marker: { x: 5, z: 6 } })]);
    expect(world.players[HUMAN_PLAYER].commands).toEqual([]);
  });

  it('lets a bot take over a slot and hands it back', () => {
    const world = makeTestWorld();
    world.step([input({ seq: 5, moveZ: 1 }), null]);
    expect(world.players[KAIJU_PLAYER].input.moveZ).toBe(1);
    setPlayerBot(world, KAIJU_PLAYER, true);
    // The (stub) bot stands still; the person's input is ignored while the bot drives.
    run(world, 3, [input({ seq: 6, moveZ: 1 }), null]);
    expect(world.players[KAIJU_PLAYER].input.moveZ).toBe(0);
    setPlayerBot(world, KAIJU_PLAYER, false);
    world.step([input({ seq: 7, moveZ: 1 }), null]);
    expect(world.players[KAIJU_PLAYER].input.moveZ).toBe(1);
    expect(world.players[KAIJU_PLAYER].input.seq).toBe(7);
  });
});

describe('movement under player input', () => {
  it('freezes everybody during the briefing', () => {
    const world = makeTestWorld({ skipBriefing: false });
    const k = world.kaijus[0];
    const start = { x: k.x, z: k.z };
    run(world, 30, [input({ moveZ: 1 }), input({ moveZ: 1 })]);
    expect(world.match.phase).toBe('briefing');
    expect({ x: k.x, z: k.z }).toEqual(start);
  });

  it('walks the kaiju where the player points it, at hatchling speed', () => {
    const world = makeTestWorld();
    const k = world.kaijus[0];
    const yaw0 = k.yaw;
    run(world, 90, [input({ moveZ: 1, aimYaw: yaw0 })]);
    const dist = Math.hypot(k.x, k.z);
    // 3 s at 8.5 m/s less the acceleration ramp.
    expect(dist).toBeGreaterThan(20);
    expect(dist).toBeLessThanOrEqual(8.5 * 3);
    expect(Math.hypot(k.vx, k.vz)).toBeCloseTo(8.5, 6);
    expect(k.x / dist).toBeCloseTo(Math.sin(yaw0), 6);
    expect(k.z / dist).toBeCloseTo(Math.cos(yaw0), 6);
  });

  it('lets the head lead the body by at most 50 degrees', () => {
    const world = makeTestWorld();
    const k = world.kaijus[0];
    const target = k.yaw + 2.5;
    world.step([input({ aimYaw: target })]);
    const lead = Math.abs(Math.atan2(Math.sin(k.aimYaw - k.yaw), Math.cos(k.aimYaw - k.yaw)));
    expect(lead).toBeCloseTo((50 * Math.PI) / 180, 6);
    run(world, 60, [input({ aimYaw: target, aimPitch: 0.3 })]);
    expect(Math.cos(k.yaw - target)).toBeCloseTo(1, 6);
    expect(Math.cos(k.aimYaw - target)).toBeCloseTo(1, 6);
    expect(k.aimPitch).toBe(0.3);
  });

  it('stops the hatchling at a house but lets it trample a kiosk-height structure', () => {
    const world = makeTestWorld({
      structures: [
        { x: 0, z: 20, w: 6, d: 6, height: 3, value: 40, hp: 50, cls: 'shop' },
        { x: 0, z: 50, w: 12, d: 8, height: 6 },
      ],
    });
    const k = world.kaijus[0];
    k.x = 0;
    k.z = 0;
    const events = run(world, 300, [input({ moveZ: 1, aimYaw: 0 })]);
    // Through the low one (destroyed outright), stopped by the house.
    expect(k.z).toBeCloseTo(46 - 2.4, 5);
    expect(world.structureHp[0]).toBe(0);
    expect(world.structureStage[0]).toBe(3);
    expect(world.structureHp[1]).toBe(100);
    const stageEvents = events.filter((e) => e.type === 'structureStage');
    expect(stageEvents).toEqual([
      { type: 'structureStage', id: 0, stage: 3, by: KAIJU_PLAYER, cause: 'trample', tick: stageEvents[0].tick },
    ]);
    expect(world.match.barPoints).toBeCloseTo(40, 6);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.shop).toBe(1);
    expect(world.players[KAIJU_PLAYER].tally.barPoints).toBeCloseTo(40, 6);
  });

  it('crushes props under the kaiju and counts them', () => {
    const world = makeTestWorld({
      props: [
        { kind: 'car_sedan', x: 0, z: 15 },
        { kind: 'kiosk', x: 1, z: 25 },
        { kind: 'tree_a', x: 0, z: 35 },
        { kind: 'car_van', x: 40, z: 15 },
      ],
    });
    const k = world.kaijus[0];
    k.x = 0;
    k.z = 0;
    const events = run(world, 200, [input({ moveZ: 1, aimYaw: 0 })]);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(bitGet(world.propAlive, 1)).toBe(false);
    expect(bitGet(world.propAlive, 2)).toBe(false);
    expect(bitGet(world.propAlive, 3)).toBe(true);
    // The crushed car leaves a wreck to pick up; the kiosk and the tree leave nothing.
    expect(bitGet(world.propWreck, 0)).toBe(true);
    expect(bitGet(world.propWreck, 1)).toBe(false);
    expect(bitGet(world.propWreck, 2)).toBe(false);
    const crushed = events.filter((e): e is Extract<SimEvent, { type: 'propsDestroyed' }> => e.type === 'propsDestroyed');
    expect(crushed.flatMap((e) => e.ids).sort()).toEqual([0, 1, 2]);
    expect(crushed.every((e) => e.by === KAIJU_PLAYER && e.cause === 'trample')).toBe(true);
    const tally = world.players[KAIJU_PLAYER].tally;
    expect(tally.wrecked.car).toBe(1);
    expect(tally.wrecked.kiosk).toBe(1);
    // Sedan 2 + kiosk 4; the tree is worth nothing.
    expect(world.match.barPoints).toBe(6);
  });

  it('moves the player-driven unit; vehicles crush props, infantry does not', () => {
    const world = makeTestWorld({ props: [{ kind: 'car_sedan', x: 500, z: 505 }] });
    const squad = playerSquad(world, HUMAN_PLAYER);
    if (!squad) throw new Error('no squad');
    const unit = world.units[squad.driven];
    unit.x = 500;
    unit.z = 480;
    world.match.bounds = world.match.stageBounds[2];
    run(world, 150, [null, input({ moveZ: 1, aimYaw: 0 })]);
    expect(unit.z).toBeGreaterThan(505);
    expect(Math.abs(unit.x - 500)).toBeLessThan(1e-6);
    expect(Math.hypot(unit.vx, unit.vz)).toBeCloseTo(6.5, 6);
    expect(bitGet(world.propAlive, 0)).toBe(true);
    // The sub-units fall in behind their leader; the bot squads (whose leaders stand still) stay put.
    const follower = world.units[squad.units[1]];
    expect(follower.vz).toBeGreaterThan(3);
    expect(follower.state).toBe('moving');
    expect(Math.hypot(world.units[5].vx, world.units[5].vz)).toBe(0);

    // The same walk as a tank flattens the car.
    unit.type = 'army_tank';
    unit.radius = 4;
    unit.x = 500;
    unit.z = 480;
    unit.yaw = 0;
    unit.vx = 0;
    unit.vz = 0;
    run(world, 150, [null, input({ moveZ: 1, aimYaw: 0 })]);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(world.players[HUMAN_PLAYER].tally.wrecked.car).toBe(1);
  });

  it('makes the titan wade through a tower, grinding it down by contact', () => {
    const world = makeTestWorld({
      structures: [{ x: 0, z: 100, w: 40, d: 40, height: 150, hp: 20000, value: 500, cls: 'tower' }],
    });
    const k = world.kaijus[0];
    k.x = 0;
    k.z = 0;
    k.yaw = 0;
    world.match.stage = 3;
    world.match.bounds = world.match.stageBounds[2];
    k.stage = 3;
    k.radius = 26;
    k.height = 115;
    let wadedTicks = 0;
    for (let i = 0; i < 30 * 14; i++) {
      const before = world.structureHp[0];
      world.step([input({ moveZ: 1, aimYaw: 0 })]);
      if (world.structureHp[0] < before) {
        wadedTicks++;
        // 900 hp per second of contact.
        expect(before - world.structureHp[0]).toBeCloseTo(900 * DT, 2);
      }
    }
    expect(wadedTicks).toBeGreaterThan(30 * 5);
    expect(k.z).toBeGreaterThan(150);
    expect(world.structureHp[0]).toBeGreaterThan(0);
    expect(world.structureHp[0]).toBeCloseTo(20000 - wadedTicks * 900 * DT, 0);
    expect(world.match.barPoints).toBeCloseTo((500 * (20000 - world.structureHp[0])) / 20000, 3);
    expect(world.structureStage[0]).toBe(1);
  });

  it('keeps everybody inside the stage bounds', () => {
    const world = makeTestWorld();
    const k = world.kaijus[0];
    run(world, 30 * 40, [input({ moveZ: 1, aimYaw: 0.7 }), input({ moveZ: 1, aimYaw: -2 })]);
    const b = world.match.bounds;
    expect(boundsContains(b, k.x, k.z, k.radius - 1e-9)).toBe(true);
    for (const u of world.units) expect(boundsContains(b, u.x, u.z, u.radius - 1e-9)).toBe(true);
    // The kaiju ran into the quarantine line and stopped there.
    expect(k.x === b.maxX - k.radius || k.z === b.maxZ - k.radius).toBe(true);
    expect(MATCH_RULES.unitsPerSquad).toBe(4);
  });
});
