import { describe, expect, it } from 'vitest';
import {
  chooseVoiceLine,
  say,
  VOICE_CUE_IDS,
  VOICE_CUE_RULES,
  VOICE_LINES,
  VOICE_RULES,
  type VoiceCueId,
  type VoiceEvent,
  type VoiceLine,
  type World,
} from '../src/index';
import { runBotMatch } from '../scripts/botMatch';
import { eventsOf, KAIJU_PLAYER, makeTestWorld, parkUnits, run } from './helpers';

const BY_ID = new Map(VOICE_LINES.map((l) => [l.id, l]));

/** A quiet world: nobody near the kaiju, the opening chatter over, a full chatter budget. */
function quietWorld(options: Parameters<typeof makeTestWorld>[0] = {}): World {
  const world = makeTestWorld(options);
  parkUnits(world);
  run(world, 30 * (VOICE_RULES.chatterRefill * VOICE_RULES.chatterTokens + 1));
  world.events = [];
  return world;
}

function lastVoice(world: World): VoiceEvent {
  const e = world.events[world.events.length - 1];
  if (!e || e.type !== 'voice') throw new Error('no voice event');
  return e;
}

/** A cue of each kind that the script gives several lines. */
const CHATTER: VoiceCueId = 'kaiju.roar';
const IMPORTANT: VoiceCueId = 'crossfire';
const CRITICAL: VoiceCueId = 'nerve.break';

describe('voice lines: chosen by the simulation, from whatever the script holds', () => {
  it('holds only the news telling the monster it can molt (round 4: the automatic lines are gone)', () => {
    expect(VOICE_LINES.length).toBeGreaterThan(0);
    for (const line of VOICE_LINES) expect([line.cue, line.audience]).toEqual(['molt.available', 'kaiju']);
  });

  it('gives each side exactly what the script has for it: the molt line to the monster, silence elsewhere', () => {
    const world = quietWorld();
    for (const cue of VOICE_CUE_IDS) {
      world.voice.cooldowns = {};
      world.voice.tokens = VOICE_RULES.chatterTokens;
      expect(say(world, cue)).toBe(true);
      const e = lastVoice(world);
      expect(e.cue).toBe(cue);
      expect(e.lines.humans).toEqual([]);
      if (cue === 'molt.available') {
        expect(e.lines.kaiju.length).toBe(1);
        expect(BY_ID.get(e.lines.kaiju[0])?.cue).toBe(cue);
      } else {
        expect(e.lines.kaiju).toEqual([]);
      }
    }
  });

  it('is deterministic: the same match says the same lines', () => {
    const talk = (): string[] => {
      const world = quietWorld({ seed: 99 });
      const said: string[] = [];
      for (let i = 0; i < 40; i++) {
        world.voice.cooldowns = {};
        world.voice.tokens = VOICE_RULES.chatterTokens;
        say(world, VOICE_CUE_IDS[(i * 7) % VOICE_CUE_IDS.length], i % 5 === 0 ? i % 4 : -1);
        const e = lastVoice(world);
        said.push(`${e.cue}:${e.variant}:${e.lines.humans.join(',')}|${e.lines.kaiju.join(',')}`);
      }
      return said;
    };
    expect(talk()).toEqual(talk());
  });

  it('picks per listener, and not the same line twice running when there is a choice', () => {
    const lines: VoiceLine[] = [
      { id: 'a', cue: 'molt.available', audience: 'kaiju', speaker: 'Anchor', text: 'One.' },
      { id: 'b', cue: 'molt.available', audience: 'kaiju', speaker: 'Anchor', text: 'Two.' },
      { id: 'c', cue: 'molt.available', audience: 'all', speaker: 'Anchor', text: 'Three.' },
    ];
    expect(chooseVoiceLine('molt.available', 'humans', 0, undefined, lines)?.id).toBe('c');
    expect(chooseVoiceLine('molt.available', 'kaiju', 1, undefined, lines)?.id).toBe('b');
    expect(chooseVoiceLine('molt.available', 'kaiju', 1, 'b', lines)?.id).toBe('c');
    expect(chooseVoiceLine('crossfire', 'kaiju', 0, undefined, lines)).toBeNull();

    const world = quietWorld();
    let previous = '';
    for (let i = 0; i < 12; i++) {
      world.voice.cooldowns = {};
      say(world, 'molt.available');
      const id = lastVoice(world).lines.kaiju[0];
      if (VOICE_LINES.length > 1) expect(id).not.toBe(previous);
      previous = id;
    }
  });

  it('never changes the match: a cue nobody hears is still emitted and still draws its number', () => {
    const world = quietWorld();
    say(world, 'crossfire');
    world.voice.cooldowns = {};
    const before = world.rng.s;
    expect(say(world, 'crossfire')).toBe(true);
    expect(lastVoice(world).lines).toEqual({ humans: [], kaiju: [] });
    expect(world.rng.s).not.toBe(before);
  });

  it('over a whole bot match: the monster hears its molt line at every molt, and nothing else is said', () => {
    let molts = 0;
    let heard = 0;
    let other = 0;
    runBotMatch({
      seed: 1,
      onTick: (_w, events) => {
        for (const e of events) {
          if (e.type === 'moltAvailable') molts++;
          if (e.type !== 'voice') continue;
          if (e.cue === 'molt.available' && e.lines.kaiju.length === 1) heard++;
          else other += e.lines.kaiju.length + e.lines.humans.length;
        }
      },
    });
    expect(molts).toBeGreaterThan(0);
    expect(heard).toBe(molts);
    expect(other).toBe(0);
  });
});

describe('radio discipline', () => {
  it('rations routine chatter: a short burst, then one line per refill', () => {
    const world = quietWorld();
    const routine = VOICE_CUE_IDS.filter((c) => VOICE_CUE_RULES[c].priority === 0);
    expect(routine.length).toBeGreaterThan(VOICE_RULES.chatterTokens + 1);
    // Different cues, so only the budget can stop them.
    const said = routine.map((cue) => say(world, cue));
    expect(said.filter(Boolean).length).toBe(VOICE_RULES.chatterTokens);
    expect(said.slice(0, VOICE_RULES.chatterTokens).every(Boolean)).toBe(true);

    // One refill later exactly one more gets through.
    run(world, 30 * VOICE_RULES.chatterRefill + 1);
    const later = routine.slice(VOICE_RULES.chatterTokens).map((cue) => say(world, cue));
    expect(later.filter(Boolean).length).toBe(1);
  });

  it('lets important cues through an empty budget, and the ones the match turns on always', () => {
    const world = quietWorld();
    world.voice.tokens = 0;
    expect(say(world, CHATTER)).toBe(false);
    expect(say(world, IMPORTANT)).toBe(true);
    expect(say(world, CRITICAL)).toBe(true);
    expect(say(world, CRITICAL)).toBe(true);
    // An important cue uses up budget, so chatter gives way to it; a critical one costs nothing.
    world.voice.tokens = 1;
    say(world, CRITICAL);
    expect(world.voice.tokens).toBe(1);
    say(world, 'kaiju.special');
    expect(world.voice.tokens).toBe(0);
    expect(say(world, CHATTER)).toBe(false);
  });

  it('keeps each cue to its own minimum gap', () => {
    const world = quietWorld();
    const gap = VOICE_CUE_RULES[IMPORTANT].gap;
    expect(gap).toBeGreaterThan(0);
    expect(say(world, IMPORTANT)).toBe(true);
    run(world, 30 * gap - 30);
    expect(say(world, IMPORTANT)).toBe(false);
    run(world, 31);
    expect(say(world, IMPORTANT)).toBe(true);
  });

  it('has a rule for every cue, and nothing critical is ever throttled for long', () => {
    for (const cue of VOICE_CUE_IDS) {
      const rule = VOICE_CUE_RULES[cue];
      expect([0, 1, 2]).toContain(rule.priority);
      expect(rule.gap).toBeGreaterThanOrEqual(0);
      if (rule.priority === 2) expect(rule.gap).toBeLessThanOrEqual(2);
    }
  });
});

describe('the cues that watch a number', () => {
  it('calls a badly hurt kaiju once per stage', () => {
    const world = quietWorld();
    const k = world.kaijus[0];
    const cues = (events: ReturnType<typeof run>): string[] => eventsOf(events, 'voice').map((e) => e.cue);
    k.hp = k.maxHp * VOICE_RULES.lowHpFraction + 1;
    expect(cues(run(world, 5))).not.toContain('kaiju.lowhp');
    k.hp = k.maxHp * VOICE_RULES.lowHpFraction - 1;
    const first = eventsOf(run(world, 1), 'voice').filter((e) => e.cue === 'kaiju.lowhp');
    expect(first).toMatchObject([{ player: KAIJU_PLAYER }]);
    // Not again in this stage, however it goes.
    k.hp = k.maxHp;
    run(world, 30);
    k.hp = 10;
    expect(cues(run(world, 60 * 30))).not.toContain('kaiju.lowhp');
    // A new stage, a new call.
    world.match.stage = 2;
    world.match.bounds = world.match.stageBounds[1];
    expect(cues(run(world, 2))).toContain('kaiju.lowhp');
  });

  it('calls the bar closing on each mark once', () => {
    const world = quietWorld({
      marks: [100, 300, 1000],
      structures: [{ x: 150, z: 150, w: 10, d: 10, height: 20, hp: 1000, value: 1000 }],
    });
    const near = (events: ReturnType<typeof run>): number => eventsOf(events, 'voice').filter((e) => e.cue === 'bar.near').length;
    const add = (points: number): ReturnType<typeof run> => {
      world.structureHits.push({ id: 0, damage: points, by: KAIJU_PLAYER, cause: 'swipe' });
      return run(world, 1);
    };
    const wait = (): void => {
      run(world, 30 * (VOICE_CUE_RULES['bar.near'].gap + 1));
    };
    expect(near(add(80))).toBe(0);
    // 85% of the way to the first mark.
    expect(near(add(6))).toBe(1);
    expect(near(add(5))).toBe(0);
    // Past the first mark: nothing until 85% of the way from it to the second (100 + 0.85 * 200).
    wait();
    expect(near(add(20))).toBe(0);
    expect(near(add(150))).toBe(0);
    expect(near(add(15))).toBe(1);
    expect(near(add(10))).toBe(0);
    // And once more on the way to the third.
    wait();
    expect(near(add(620))).toBe(1);
    expect(near(run(world, 30 * 30))).toBe(0);
  });
});
