import { describe, expect, it } from 'vitest';
import {
  chooseVoiceLines,
  say,
  SQUAD_CALLSIGNS,
  TICK_RATE,
  VOICE_CUE_IDS,
  VOICE_CUE_RULES,
  VOICE_LINES,
  VOICE_RULES,
  VOICE_SEQUENCE_CUES,
  VOICE_SIDE_RULES,
  voiceLinesFor,
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
  it('names real lines of the right cue and audience for both sides, for every cue', () => {
    const world = quietWorld();
    for (const cue of VOICE_CUE_IDS) {
      world.voice.cooldowns = {};
      world.voice.tokens = VOICE_RULES.chatterTokens;
      world.voice.radio.cooldowns = {};
      world.voice.radio.tokens = VOICE_SIDE_RULES.radio.chatterTokens;
      expect(say(world, cue)).toBe(true);
      const e = lastVoice(world);
      expect(e.cue).toBe(cue);
      for (const side of ['humans', 'kaiju'] as const) {
        const ids = e.lines[side];
        // Exactly what the script offers that side: one line, or the whole sequence, or nothing.
        // The news only speaks for its own short list of cues.
        const offered = side === 'kaiju' && !VOICE_SIDE_RULES.news.cues.includes(cue) ? [] : voiceLinesFor(cue, side);
        if (offered.length === 0) expect(ids).toEqual([]);
        else if (VOICE_SEQUENCE_CUES.includes(cue)) expect(ids).toEqual(offered.map((l) => l.id));
        else expect(ids.length).toBe(1);
        for (const id of ids) {
          const line = BY_ID.get(id);
          expect(line, `${cue}: unknown line id ${id}`).toBeDefined();
          expect(line?.cue).toBe(cue);
          expect([side, 'all']).toContain(line?.audience);
        }
      }
      // Every cue of the contract has something to say to somebody.
      expect(e.lines.humans.length + e.lines.kaiju.length).toBeGreaterThan(0);
    }
  });

  it('plays the briefing as a sequence, in script order', () => {
    const world = makeTestWorld({ skipBriefing: false, people: 'none' });
    const e = eventsOf(world.step(), 'voice')[0];
    expect(e.cue).toBe('match.briefing');
    expect(e.lines.humans.length).toBeGreaterThan(1);
    expect(e.lines.humans).toEqual(voiceLinesFor('match.briefing', 'humans').map((l) => l.id));
    expect(e.lines.kaiju).toEqual(voiceLinesFor('match.briefing', 'kaiju').map((l) => l.id));
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

  it('does not play the same line twice running when the script has a choice', () => {
    const world = quietWorld();
    const cue: VoiceCueId = 'landmark.down';
    expect(VOICE_SIDE_RULES.news.cues).toContain(cue);
    expect(voiceLinesFor(cue, 'kaiju').length).toBeGreaterThan(1);
    let previous = '';
    const heard = new Set<string>();
    for (let i = 0; i < 30; i++) {
      world.voice.cooldowns = {};
      say(world, cue);
      const id = lastVoice(world).lines.kaiju[0];
      expect(id).not.toBe(previous);
      previous = id;
      heard.add(id);
    }
    // And it gets round to more than two of them.
    expect(heard.size).toBeGreaterThan(Math.min(2, voiceLinesFor(cue, 'kaiju').length - 1));
  });

  it('gives a squad its own voice, and never puts one squad\'s line in another\'s mouth', () => {
    const lines: VoiceLine[] = [
      { id: 'a', cue: 'unit.lost', audience: 'humans', speaker: 'Overlord', text: 'A unit is down.' },
      { id: 'b', cue: 'unit.lost', audience: 'humans', speaker: 'Granite', text: 'Granite has lost a unit.' },
      { id: 'c', cue: 'unit.lost', audience: 'humans', speaker: 'Beacon', text: 'Beacon reports a loss.' },
      { id: 'd', cue: 'unit.lost', audience: 'kaiju', speaker: 'Anchor', text: 'The army has lost a unit.' },
    ];
    const callsigns = ['Granite', 'Beacon', 'Tempest', 'Anvil'];
    for (let variant = 0; variant < 12; variant++) {
      // About Granite: Granite speaks. About Beacon: Beacon.
      expect(chooseVoiceLines('unit.lost', 'humans', variant, { callsign: 'Granite', callsigns }, lines).map((l) => l.id)).toEqual(['b']);
      expect(chooseVoiceLines('unit.lost', 'humans', variant, { callsign: 'Beacon', callsigns }, lines).map((l) => l.id)).toEqual(['c']);
      // About Anvil, who has no line of its own: command speaks, never another squad.
      expect(chooseVoiceLines('unit.lost', 'humans', variant, { callsign: 'Anvil', callsigns }, lines).map((l) => l.id)).toEqual(['a']);
      // The kaiju's side hears the news, whoever it is about.
      expect(chooseVoiceLines('unit.lost', 'kaiju', variant, { callsign: 'Granite', callsigns }, lines).map((l) => l.id)).toEqual(['d']);
    }
    // About nobody in particular: any of them, and all of them over time.
    const any = new Set<string>();
    for (let variant = 0; variant < 12; variant++) any.add(chooseVoiceLines('unit.lost', 'humans', variant, { callsigns }, lines)[0].id);
    expect([...any].sort()).toEqual(['a', 'b', 'c']);
    // The line to avoid is avoided when there is another.
    expect(chooseVoiceLines('unit.lost', 'humans', 0, { callsigns, avoid: 'a' }, lines)[0].id).not.toBe('a');
    expect(chooseVoiceLines('unit.lost', 'kaiju', 0, { avoid: 'd' }, lines)[0].id).toBe('d');
    // A cue the script has nothing for is silent, not an error.
    expect(chooseVoiceLines('kaiju.roar', 'humans', 3, {}, lines)).toEqual([]);

    // In a match: a cue about the first squad is in its callsign's voice when it has one.
    const world = quietWorld();
    const own = voiceLinesFor('volley.ready', 'humans').filter((l) => l.speaker === SQUAD_CALLSIGNS[0]);
    expect(own.length).toBeGreaterThan(0);
    say(world, 'volley.ready', 0, 1);
    expect(own.map((l) => l.id)).toContain(lastVoice(world).lines.humans[0]);
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

describe('what each side hears (VOICE_SIDE_RULES)', () => {
  it('keeps the news to the big moments, while the cue still goes out to the radio', () => {
    const world = quietWorld();
    for (const cue of ['building.down', 'volley.ready', 'crossfire', 'nerve.break', 'kaiju.roar'] as const) {
      expect(VOICE_SIDE_RULES.news.cues).not.toContain(cue);
      world.voice.cooldowns = {};
      world.voice.tokens = VOICE_RULES.chatterTokens;
      world.voice.radio.cooldowns = {};
      world.voice.radio.tokens = VOICE_SIDE_RULES.radio.chatterTokens;
      expect(say(world, cue)).toBe(true);
      const e = lastVoice(world);
      expect(e.lines.kaiju).toEqual([]);
      expect(e.lines.humans.length).toBe(1);
    }
    for (const cue of ['stage.2', 'landmark.down', 'end.kaiju', 'match.start'] as const) {
      world.voice.cooldowns = {};
      say(world, cue);
      expect(lastVoice(world).lines.kaiju.length).toBe(1);
    }
  });

  it('makes the radio wait longer than the cue itself before repeating it', () => {
    const world = quietWorld();
    const cue = IMPORTANT;
    const gap = VOICE_CUE_RULES[cue].gap;
    const radioGap = Math.max(VOICE_SIDE_RULES.radio.minGap, gap * VOICE_SIDE_RULES.radio.gapScale);
    expect(radioGap).toBeGreaterThan(gap);
    say(world, cue);
    expect(lastVoice(world).lines.humans.length).toBe(1);
    // The cue may go out again after its own gap, but the radio stays quiet for it...
    run(world, 30 * gap + 1);
    expect(say(world, cue)).toBe(true);
    expect(lastVoice(world).lines.humans).toEqual([]);
    // ...until its own, longer wait is over.
    run(world, 30 * (radioGap - gap) + 1);
    world.voice.cooldowns = {};
    say(world, cue);
    expect(lastVoice(world).lines.humans.length).toBe(1);
  });

  it('rations radio chatter on its own, slower budget', () => {
    const world = quietWorld();
    run(world, 30 * VOICE_SIDE_RULES.radio.chatterRefill * VOICE_SIDE_RULES.radio.chatterTokens);
    const routine = VOICE_CUE_IDS.filter((c) => VOICE_CUE_RULES[c].priority === 0);
    const heard = routine.filter((cue) => {
      world.voice.tokens = VOICE_RULES.chatterTokens;
      say(world, cue);
      return lastVoice(world).lines.humans.length > 0;
    });
    expect(heard.length).toBe(VOICE_SIDE_RULES.radio.chatterTokens);
    expect(VOICE_SIDE_RULES.radio.chatterRefill).toBeGreaterThan(VOICE_RULES.chatterRefill);
  });

  it('never changes the match: a cue nobody hears is still emitted and still draws its number', () => {
    const world = quietWorld();
    say(world, 'crossfire');
    world.voice.cooldowns = {};
    const before = world.rng.s;
    expect(say(world, 'crossfire')).toBe(true);
    const e = lastVoice(world);
    expect(e.lines).toEqual({ humans: [], kaiju: [] });
    expect(world.rng.s).not.toBe(before);
  });

  it('over a whole bot match: the news speaks about ten times less, the radio about half as often', () => {
    let cues = 0;
    let anchor = 0;
    let radio = 0;
    const heard = new Set<string>();
    const { world } = runBotMatch({
      seed: 1,
      onTick: (_w, events) => {
        for (const e of events) {
          if (e.type !== 'voice' || e.cue === 'match.briefing') continue;
          cues++;
          if (e.lines.kaiju.length > 0) {
            anchor++;
            heard.add(e.cue);
          }
          if (e.lines.humans.length > 0) radio++;
        }
      },
    });
    const minutes = world.tick / TICK_RATE / 60;
    // Before this pass both sides spoke for every cue: about 13 lines a minute each.
    expect(cues / minutes).toBeGreaterThan(10);
    expect(anchor / minutes).toBeLessThan(1.6);
    // The news still has its say: every one of its cues that this match came to was heard (a
    // match that ends at stage 2 has fewer of them than one that goes the distance).
    const ending = world.match.winner === 'kaiju' ? 'end.kaiju' : `end.humans.${world.match.endReason}`;
    const must = ['match.start', ending, world.match.winner === 'kaiju' ? 'hearing.kaiju.win' : 'hearing.humans.win'];
    for (let stage = 2; stage <= world.match.stage; stage++) must.push('molt.available', `stage.${stage}`);
    for (const cue of must) expect(heard, cue).toContain(cue);
    expect(anchor).toBeGreaterThanOrEqual(new Set(must).size);
    expect(radio / cues).toBeLessThan(0.6);
    expect(radio / cues).toBeGreaterThan(0.4);
  });
});
