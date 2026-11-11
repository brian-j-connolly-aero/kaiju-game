import { describe, expect, it } from 'vitest';
import {
  applyHit,
  applyStructureDamage,
  barDisplayFraction,
  beginStage,
  boundsContains,
  circleHitsStructure,
  COMBAT_RULES,
  createAimPoint,
  DT,
  endMatch,
  resolveAimPoint,
  say,
  SIM_EVENT_TYPES,
  structureStageFor,
  VOICE_CUE_IDS,
  type Hit,
  type SimEvent,
  type VoiceEvent,
} from '../src/index';
import { HUMAN_PLAYER, KAIJU_PLAYER, makeTestWorld, run } from './helpers';

function voiceCues(events: SimEvent[]): string[] {
  return events.filter((e): e is VoiceEvent => e.type === 'voice').map((e) => e.cue);
}

describe('city damage and the destruction bar', () => {
  it('maps hp to the four visual stages', () => {
    expect(structureStageFor(100, 100)).toBe(0);
    expect(structureStageFor(67, 100)).toBe(0);
    expect(structureStageFor(66, 100)).toBe(1);
    expect(structureStageFor(34, 100)).toBe(1);
    expect(structureStageFor(33, 100)).toBe(2);
    expect(structureStageFor(0.1, 100)).toBe(2);
    expect(structureStageFor(0, 100)).toBe(3);
  });

  it('adds value in proportion to hp lost, whoever caused it, one event per stage change', () => {
    const world = makeTestWorld({
      structures: [{ x: 200, z: 200, w: 20, d: 20, height: 30, hp: 1000, value: 100, cls: 'apartment' }],
    });
    const hit = (damage: number, by: number): SimEvent[] => {
      world.structureHits.push({ id: 0, damage, by, cause: by === KAIJU_PLAYER ? 'swipe' : 'shell' });
      return world.step();
    };
    let events = hit(100, HUMAN_PLAYER);
    expect(world.structureHp[0]).toBe(900);
    expect(world.match.barPoints).toBeCloseTo(10, 6);
    expect(events.filter((e) => e.type === 'structureStage')).toEqual([]);
    expect(world.players[HUMAN_PLAYER].tally.barPoints).toBeCloseTo(10, 6);

    events = hit(300, KAIJU_PLAYER);
    expect(world.match.barPoints).toBeCloseTo(40, 6);
    expect(events.filter((e) => e.type === 'structureStage')).toMatchObject([
      { id: 0, stage: 1, by: KAIJU_PLAYER, cause: 'swipe' },
    ]);

    events = hit(400, KAIJU_PLAYER);
    expect(events.filter((e) => e.type === 'structureStage')).toMatchObject([{ id: 0, stage: 2 }]);

    // Overkill only counts the hp that was left.
    events = hit(5000, HUMAN_PLAYER);
    expect(world.structureHp[0]).toBe(0);
    expect(world.match.barPoints).toBeCloseTo(100, 6);
    expect(events.filter((e) => e.type === 'structureStage')).toMatchObject([
      { id: 0, stage: 3, by: HUMAN_PLAYER, cause: 'shell' },
    ]);
    expect(world.players[HUMAN_PLAYER].tally.wrecked.apartment).toBe(1);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.apartment).toBe(0);
    // A human flattening a building is collateral, and the radio says so.
    expect(voiceCues(events)).toContain('collateral.human');

    // Rubble cannot be destroyed twice.
    events = hit(500, KAIJU_PLAYER);
    expect(world.match.barPoints).toBeCloseTo(100, 6);
    expect(events.filter((e) => e.type === 'structureStage')).toEqual([]);
    expect(applyStructureDamage(world, { id: 0, damage: 50, by: KAIJU_PLAYER, cause: 'swipe' })).toBe(0);
  });

  it('emits a bar mark exactly once as each mark is passed, and feeds the kaiju rage', () => {
    const world = makeTestWorld({
      marks: [50, 120, 400],
      structures: [
        { x: 200, z: 200, w: 20, d: 20, height: 30, hp: 100, value: 60 },
        { x: 300, z: 200, w: 20, d: 20, height: 30, hp: 100, value: 60 },
      ],
    });
    const k = world.kaijus[0];
    world.structureHits.push({ id: 0, damage: 50, by: KAIJU_PLAYER, cause: 'stomp' });
    let events = world.step();
    expect(events.filter((e) => e.type === 'barMark')).toEqual([]);
    // 30 of the 50 points of the first segment: 150 * 30 / 50 = 90 rage.
    expect(k.rage).toBeCloseTo(90, 6);

    world.structureHits.push({ id: 0, damage: 50, by: KAIJU_PLAYER, cause: 'stomp' });
    events = world.step();
    expect(events.filter((e) => e.type === 'barMark')).toMatchObject([{ mark: 1, points: 60 }]);
    expect(world.match.marksReached).toBe(1);
    expect(k.rage).toBe(COMBAT_RULES.rageMax);

    // Human collateral moves the bar but does not enrage the kaiju.
    k.rage = 0;
    world.structureHits.push({ id: 1, damage: 100, by: HUMAN_PLAYER, cause: 'shell' });
    events = world.step();
    expect(events.filter((e) => e.type === 'barMark')).toMatchObject([{ mark: 2 }]);
    expect(k.rage).toBe(0);
    expect(run(world, 5).filter((e) => e.type === 'barMark')).toEqual([]);
  });

  it('maps bar points onto the skyline display', () => {
    const marks: [number, number, number] = [100, 300, 1000];
    expect(barDisplayFraction(0, marks)).toBe(0);
    expect(barDisplayFraction(50, marks)).toBeCloseTo(0.105, 9);
    expect(barDisplayFraction(100, marks)).toBeCloseTo(0.21, 9);
    expect(barDisplayFraction(200, marks)).toBeCloseTo(0.39, 9);
    expect(barDisplayFraction(300, marks)).toBeCloseTo(0.57, 9);
    expect(barDisplayFraction(650, marks)).toBeCloseTo(0.785, 9);
    expect(barDisplayFraction(5000, marks)).toBe(1);
  });

  it('drains the hit queue even though applyHit is still a stub', () => {
    const world = makeTestWorld();
    const hit: Hit = {
      damage: 10,
      nerve: 5,
      fromDir: { x: 0, z: -1 },
      sourceId: 0,
      player: HUMAN_PLAYER,
      kind: 'rocket',
      atWill: false,
    };
    world.hits.push({ target: { entity: 'kaiju', id: 0 }, hit });
    world.step();
    expect(world.hits).toEqual([]);
    expect(() => applyHit(world, { entity: 'unit', id: 0 }, hit)).not.toThrow();
  });
});

describe('match flow', () => {
  it('runs the briefing, then starts the clock', () => {
    const world = makeTestWorld({ skipBriefing: false, people: 'none' });
    const first = world.step();
    expect(first).toMatchObject([
      { type: 'matchPhase', phase: 'briefing', stage: 1, duration: 10, tick: 1 },
      { type: 'voice', cue: 'match.briefing', tick: 1 },
    ]);
    const events = run(world, 30 * 10 - 2);
    expect(events).toEqual([]);
    expect(world.match.phase).toBe('briefing');
    expect(world.match.clock).toBe(720);
    const start = run(world, 2);
    expect(start.map((e) => e.type)).toEqual(['matchPhase', 'voice']);
    expect(start[0]).toMatchObject({ type: 'matchPhase', phase: 'playing', stage: 1 });
    expect(voiceCues(start)).toEqual(['match.start']);
    expect(world.match.phase).toBe('playing');
    run(world, 30);
    expect(world.match.clock).toBeCloseTo(719, 6);
    expect(world.match.elapsed).toBeCloseTo(1, 6);
    expect(world.match.stageTime[0]).toBeCloseTo(1, 6);
  });

  it('gives the humans the win when the clock runs out, with the clock calls on the way', () => {
    const world = makeTestWorld({ people: 'none' });
    world.match.clock = 181;
    const events = run(world, 30 * 200);
    expect(voiceCues(events)).toEqual([
      'clock.3min',
      'clock.1min',
      'clock.10s',
      'end.humans.clock',
      'hearing.humans.win',
    ]);
    expect(world.match.phase).toBe('ended');
    expect(world.match.winner).toBe('humans');
    expect(world.match.endReason).toBe('clock');
    const end = events.find((e) => e.type === 'matchEnd');
    expect(end).toMatchObject({ winner: 'humans', reason: 'clock' });
    if (end?.type === 'matchEnd') {
      expect(end.tallies.length).toBe(world.players.length);
      expect(end.duration).toBeCloseTo(181, 1);
    }
    // After the end nothing changes and nothing more is said.
    const tick = world.tick;
    expect(world.step()).toEqual([]);
    expect(world.tick).toBe(tick);
  });

  it('ends on a kill at any stage', () => {
    const world = makeTestWorld();
    world.kaijus[0].hp = 0;
    const events = world.step();
    expect(events.find((e) => e.type === 'matchEnd')).toMatchObject({ winner: 'humans', reason: 'kill' });
    expect(voiceCues(events)).toEqual(['end.humans.kill', 'hearing.humans.win']);
  });

  it('gives the kaiju the win when the bar passes the third mark', () => {
    const world = makeTestWorld({
      marks: [10, 20, 30],
      structures: [{ x: 200, z: 200, w: 20, d: 20, height: 30, hp: 100, value: 100 }],
    });
    world.structureHits.push({ id: 0, damage: 100, by: KAIJU_PLAYER, cause: 'beam' });
    const events = world.step();
    expect(events.filter((e) => e.type === 'barMark').map((e) => (e.type === 'barMark' ? e.mark : 0))).toEqual([1, 2, 3]);
    expect(events.find((e) => e.type === 'matchEnd')).toMatchObject({ winner: 'kaiju', reason: 'bar' });
    expect(voiceCues(events)).toContain('end.kaiju');
    expect(voiceCues(events)).toContain('hearing.kaiju.win');
    expect(world.match.winner).toBe('kaiju');
  });

  it('endMatch only counts once', () => {
    const world = makeTestWorld();
    endMatch(world, 'humans', 'kill');
    endMatch(world, 'kaiju', 'bar');
    expect(world.match.winner).toBe('humans');
    expect(world.events.filter((e) => e.type === 'matchEnd').length).toBe(1);
  });

  it('beginStage grows the kaiju, widens the bounds and redeploys fresh squads at the new level', () => {
    const world = makeTestWorld({ realCity: true });
    const k = world.kaijus[0];
    k.hp = 300;
    k.nerve = 80;
    k.rage = 55;
    world.units[0].alive = false;
    world.units[1].hp = 12;
    world.squads[0].veteranSlots[1] = true;

    for (const stage of [2, 3] as const) {
      world.events = [];
      beginStage(world, stage);
      expect(world.match.stage).toBe(stage);
      expect(world.match.bounds).toEqual(world.match.stageBounds[stage - 1]);
      expect(world.match.phase).toBe('playing');
      expect(k.stage).toBe(stage);
      expect(k.radius).toBe(stage === 2 ? 9 : 26);
      expect(k.height).toBe(stage === 2 ? 32 : 115);
      expect(k.hp).toBe(1000);
      expect(k.nerve).toBe(0);
      // Rage carries over.
      expect(k.rage).toBe(55);
      expect(world.events.map((e) => e.type)).toEqual(['stageChange', 'matchPhase']);
      const type = stage === 2 ? 'army_tank' : 'army_tank_troop';
      for (const u of world.units) {
        expect(u.alive).toBe(true);
        expect(u.type).toBe(type);
        expect(u.hp).toBe(stage === 2 ? 100 : 300);
        expect(u.members).toBe(stage === 2 ? 1 : 3);
        expect(boundsContains(world.match.bounds, u.x, u.z, u.radius)).toBe(true);
        expect(circleHitsStructure(world.cityQuery, u.x, u.z, u.radius)).toBe(false);
        // "At least 250 m from the kaiju" is reachable from stage 2 on.
        expect(Math.hypot(u.x - k.x, u.z - k.z)).toBeGreaterThanOrEqual(240);
      }
      expect(world.units[1].veteran).toBe(true);
      expect(world.units[2].veteran).toBe(false);
      expect(world.squads[0].level).toBe(stage);
      expect(world.squads[0].callInCooldowns).toEqual(stage === 3 ? [0] : []);
    }
    const cues = voiceCues(run(world, 1));
    expect(cues).not.toContain('match.start');
  });
});

describe('voice cues', () => {
  it('throttles chatty cues and never repeats a clock call', () => {
    const world = makeTestWorld();
    expect(say(world, 'kaiju.roar')).toBe(true);
    expect(say(world, 'kaiju.roar')).toBe(false);
    run(world, 30 * 13);
    expect(say(world, 'kaiju.roar')).toBe(true);
    // Unthrottled cues always go out.
    expect(say(world, 'nerve.break')).toBe(true);
    expect(say(world, 'nerve.break')).toBe(true);
  });

  it('carries a variant number and the squad it is about', () => {
    const world = makeTestWorld();
    world.events = [];
    say(world, 'volley.fired', 2, 3);
    const e = world.events[0];
    expect(e).toMatchObject({ type: 'voice', cue: 'volley.fired', squad: 2, player: 3 });
    if (e.type === 'voice') {
      expect(Number.isInteger(e.variant)).toBe(true);
      expect(e.variant).toBeGreaterThanOrEqual(0);
    }
  });

  it('calls a landmark falling to the kaiju', () => {
    const world = makeTestWorld({
      structures: [{ x: 200, z: 200, w: 30, d: 30, height: 90, hp: 100, value: 500, cls: 'landmark', landmark: 'Old Clock' }],
    });
    world.structureHits.push({ id: 0, damage: 100, by: KAIJU_PLAYER, cause: 'stomp' });
    expect(voiceCues(world.step())).toEqual(['landmark.down']);
  });

  it('only uses cue ids from the contract', () => {
    expect(new Set(VOICE_CUE_IDS).size).toBe(VOICE_CUE_IDS.length);
    expect(VOICE_CUE_IDS.length).toBe(34);
    expect(SIM_EVENT_TYPES.length).toBe(new Set(SIM_EVENT_TYPES).size);
    for (const name of ['projectileSpawn', 'projectileHit', 'structureStage', 'propsDestroyed', 'kaijuAction', 'kaijuStagger', 'kaijuHeld', 'nerveBreak', 'crossfire', 'unitHit', 'memberLost', 'unitDestroyed', 'unitShaken', 'takeover', 'volley', 'roar', 'callin', 'moltAvailable', 'cocoon', 'moltBlast', 'stageChange', 'barMark', 'voice', 'matchEnd']) {
      expect(SIM_EVENT_TYPES).toContain(name);
    }
  });
});

describe('aim points', () => {
  it('lands on the ground, on a structure or on the kaiju, whichever is first', () => {
    const world = makeTestWorld({ structures: [{ x: 0, z: 60, w: 20, d: 10, height: 12 }] });
    const k = world.kaijus[0];
    k.x = 0;
    k.z = 30;
    const aim = createAimPoint();
    // Slightly downward from eye height: hits the kaiju standing in the way.
    resolveAimPoint(world.cityQuery, 0, 1.7, 0, 0, -0.01, 500, aim, world.kaijus);
    expect(aim.on).toBe('kaiju');
    expect(aim.id).toBe(0);
    // The hatchling's hit volume is nearly a ball, so just below mid height it is a little narrower than 2.4 m.
    expect(aim.dist).toBeGreaterThan(30 - 2.4);
    expect(aim.dist).toBeLessThan(30 - 2.2);
    // Without kaiju in the test the ray goes on to the wall.
    resolveAimPoint(world.cityQuery, 0, 1.7, 0, 0, -0.01, 500, aim);
    expect(aim.on).toBe('structure');
    expect(aim.z).toBeCloseTo(55, 6);
    // Steeply down: the ground.
    resolveAimPoint(world.cityQuery, 0, 1.7, 0, 0, -0.5, 500, aim, world.kaijus);
    expect(aim.on).toBe('ground');
    expect(aim.y).toBe(0);
    expect(aim.z).toBeCloseTo(1.7 / Math.tan(0.5), 6);
    // Up into the sky: nothing, the point is at maximum range.
    resolveAimPoint(world.cityQuery, 0, 1.7, 0, Math.PI, 0.4, 500, aim, world.kaijus);
    expect(aim.on).toBe('none');
    expect(aim.dist).toBe(500);
    expect(DT).toBeGreaterThan(0);
  });
});
