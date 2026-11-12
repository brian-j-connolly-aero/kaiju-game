import { describe, expect, it } from 'vitest';
import { buildsMatch, buildStamp, CITY_SEED, cityChecksum, COMBAT_RULES, computeRulesStamp, getCity, pageIdOf, rulesStamp } from '../src/index';

describe('build stamp', () => {
  it('is the same every time it is asked for, and well formed', () => {
    expect(rulesStamp()).toMatch(/^[0-9a-f]{8}$/);
    expect(rulesStamp()).toBe(rulesStamp());
    expect(buildStamp()).toBe(`${rulesStamp()}.`);
    expect(buildStamp('index-Os6xQ8qB.js')).toBe(`${rulesStamp()}.index-Os6xQ8qB.js`);
  });

  it('covers the city and the tuning data, so a page built from other rules gets another stamp', () => {
    const before = computeRulesStamp();
    expect(before).toBe(rulesStamp());

    // A tuning number changes (as an update between two playtests would change it).
    const rules = COMBAT_RULES as unknown as Record<string, unknown>;
    const key = Object.keys(rules).find((k) => typeof rules[k] === 'number');
    expect(key).toBeDefined();
    const saved = rules[key as string] as number;
    try {
      rules[key as string] = saved + 1;
      expect(computeRulesStamp()).not.toBe(before);
    } finally {
      rules[key as string] = saved;
    }
    expect(computeRulesStamp()).toBe(before);

    // The city changes: one building moves by a meter.
    const city = getCity(CITY_SEED).city;
    const s = city.structures[0];
    const checksum = cityChecksum(city);
    try {
      s.x += 1;
      expect(cityChecksum(city)).not.toBe(checksum);
      expect(computeRulesStamp()).not.toBe(before);
    } finally {
      s.x -= 1;
    }
    expect(computeRulesStamp()).toBe(before);

    // A difference in the last bits of a number, as two engines might compute it, is not one.
    try {
      rules[key as string] = saved * (1 + 2e-16) + 1e-13;
      expect(computeRulesStamp()).toBe(before);
    } finally {
      rules[key as string] = saved;
    }
  });

  it('reads the page part from a hashed script address only', () => {
    expect(pageIdOf('./app/index-Os6xQ8qB.js')).toBe('index-Os6xQ8qB.js');
    expect(pageIdOf('https://game.example/app/index-Os6xQ8qB.js?x=1#y')).toBe('index-Os6xQ8qB.js');
    expect(pageIdOf('/app/main-_a-b9ZzQ.js')).toBe('main-_a-b9ZzQ.js');
    // Development: the page starts from a source file, which says nothing about the build.
    expect(pageIdOf('/src/main.ts')).toBe('');
    expect(pageIdOf('http://localhost:5173/src/main.ts?t=1700000000')).toBe('');
    expect(pageIdOf('/@vite/client')).toBe('');
    expect(pageIdOf('')).toBe('');
    expect(pageIdOf('/app/index.js')).toBe('');
  });

  it('matches on the rules, and on the page when both sides know theirs', () => {
    const server = 'aaaaaaaa.index-AAAAAAAA.js';
    expect(buildsMatch(server, 'aaaaaaaa.index-AAAAAAAA.js')).toBe(true);
    // A development page or a tool cannot tell its page: the rules decide.
    expect(buildsMatch(server, 'aaaaaaaa.')).toBe(true);
    // A server that serves no page (development) cannot tell either.
    expect(buildsMatch('aaaaaaaa.', 'aaaaaaaa.index-BBBBBBBB.js')).toBe(true);
    // A tab left open across a rebuild of the client only.
    expect(buildsMatch(server, 'aaaaaaaa.index-BBBBBBBB.js')).toBe(false);
    // A tab left open across a change of the rules.
    expect(buildsMatch(server, 'bbbbbbbb.index-AAAAAAAA.js')).toBe(false);
    expect(buildsMatch(server, 'bbbbbbbb.')).toBe(false);
    // A page from before there was a stamp, and nonsense.
    for (const none of [undefined, null, 1, '', 'aaaaaaaa', {}, ['aaaaaaaa.'], 'a'.repeat(500)]) expect(buildsMatch(server, none)).toBe(false);
  });
});
