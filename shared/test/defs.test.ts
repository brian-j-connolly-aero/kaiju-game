import { describe, expect, it } from 'vitest';
import {
  addMods,
  ARMY,
  CALLIN_IDS,
  CALLINS,
  callInDef,
  codeOf,
  COMBAT_RULES,
  DAMAGE_KINDS,
  DEG,
  emptyMods,
  FACTION_IDS,
  factionDef,
  factionLevelDef,
  hasModFlag,
  idOf,
  KAIJU_ACTION_IDS,
  KAIJU_KIND_IDS,
  kaijuActionDef,
  kaijuKindDef,
  kaijuStageDef,
  LIZARD,
  MATCH_RULES,
  membersForHp,
  missingVoiceCues,
  modMult,
  parseVoiceLines,
  perStage,
  pickVoiceLine,
  PLAYABLE_FACTIONS,
  PLAYABLE_KAIJU_KINDS,
  PROJECTILE_TYPE_IDS,
  PROJECTILE_TYPES,
  shotsForMembers,
  SNAPSHOT_EVERY_TICKS,
  SQUAD_CALLSIGNS,
  SQUAD_RULES,
  STAGES,
  stageDef,
  TALLY_CLASSES,
  UNIT_TYPE_IDS,
  UNIT_TYPES,
  UPGRADES,
  upgradeDef,
  VOICE_CUE_IDS,
  VOICE_LINE_PROBLEMS,
  VOICE_LINES,
  VOICE_SEQUENCE_CUES,
  voiceLinesFor,
  WEAPON_IDS,
  WEAPONS,
  type KaijuVerb,
} from '../src/index';

describe('stages (DESIGN.md section 2)', () => {
  it('match the stages table', () => {
    expect(STAGES.map((s) => s.boundsHalfSize)).toEqual([180, 460, 1100]);
    expect(STAGES.map((s) => s.humanLevel)).toEqual([1, 2, 3]);
    expect(STAGES.map((s) => s.timeOfDay)).toEqual(['afternoon', 'sunset', 'night']);
    expect(STAGES.map((s) => s.scatterMult)).toEqual([1.0, 0.8, 0.6]);
    expect(STAGES.map((s) => s.kaijuAlwaysKnown)).toEqual([false, true, true]);
    expect(stageDef(2).key).toBe('juvenile');
    expect(perStage([10, 20, 30], 3)).toBe(30);
  });

  it('carry the match rules', () => {
    expect(MATCH_RULES.clock).toBe(12 * 60);
    expect(MATCH_RULES.briefing).toBe(10);
    expect(MATCH_RULES.intermission).toBe(8);
    expect(MATCH_RULES.intermissionWithDraft).toBe(20);
    expect(MATCH_RULES.cocoon).toBe(10);
    expect(MATCH_RULES.blastKillRadius).toBe(3.5);
    expect(MATCH_RULES.blastShoveRadius).toBe(7);
    expect(MATCH_RULES.redeployMinKaijuDist).toBe(250);
    // The three fractions are tuned with the balance harness (docs/BALANCE.md).
    expect(MATCH_RULES.bar).toMatchObject({ p1: 0.18, p2: 0.125, p3: 0.31, growth: 1.6, display: [0.21, 0.57, 1] });
    expect(MATCH_RULES.maxPlayers).toBe(5);
    expect(SNAPSHOT_EVERY_TICKS).toBe(2);
  });
});

describe('the one rule set (DESIGN.md section 3)', () => {
  it('has the kaiju damage profile', () => {
    expect(LIZARD.hp).toBe(1000);
    expect(LIZARD.nerveCapacity).toBe(100);
    expect(LIZARD.nerveLeak).toBe(7.5);
    expect(LIZARD.damage).toMatchObject({
      normalMult: 0.12,
      braceFrontMult: 0.04,
      helplessMult: 0.5,
      braceNerveMult: 0.25,
      frontMult: 1,
      flankMult: 1.35,
      rearMult: 1.7,
    });
    expect(LIZARD.damage.braceHalfArc).toBeCloseTo(60 * DEG, 12);
    expect(LIZARD.damage.frontHalfAngle).toBeCloseTo(60 * DEG, 12);
    expect(LIZARD.damage.rearAngle).toBeCloseTo(135 * DEG, 12);
  });

  it('has the shared combat numbers', () => {
    expect(COMBAT_RULES.crossfireMinAngle).toBeCloseTo(60 * DEG, 12);
    expect(COMBAT_RULES).toMatchObject({
      crossfireWindow: 2.5,
      crossfireNerveMult: 1.75,
      atWillNerveMult: 0.5,
      nerveSlowMax: 0.3,
      staggerDuration: 5,
      staggerNerveImmunity: 8,
      unitNerveCapacity: 100,
      unitNerveLeak: 8,
      shakenDuration: 4,
      friendlyLossNerve: 15,
      friendlyLossRadius: 40,
      chargeTime: 6,
      volleyDamagePerCharge: 1,
      volleyNervePerCharge: 2,
      scatterSlowedMult: 0.6,
      scatterSpottedMult: 0.7,
      spotRange: 150,
      veteranAimErrorMult: 0.7,
      rageMax: 100,
      rageDamagePerPoint: 12,
    });
    expect(COMBAT_RULES.chargeHalfArc).toBeCloseTo(35 * DEG, 12);
  });
});

describe('squad rules the design leaves to the build', () => {
  it('has sane starting values', () => {
    expect(COMBAT_RULES.scatterSlowedNerve).toBe(0.3);
    expect(SQUAD_RULES).toMatchObject({ formationGap: 2, catchUpSpeed: 1.3, aimRayRange: 1500, aimHeights: [0.5, 0.8, 0.25] });
    expect(SQUAD_RULES.aimTurnRate).toBeCloseTo(270 * DEG, 12);
    expect(SQUAD_RULES.callInElevation).toBeCloseTo(75 * DEG, 12);
    for (const [key, value] of Object.entries(SQUAD_RULES)) {
      const numbers = typeof value === 'number' ? [value] : value;
      for (const n of numbers) expect(n, key).toBeGreaterThan(0);
    }
    // A tank's about-turn fits inside the stuck timer, or turning round would count as being stuck.
    expect(Math.PI / UNIT_TYPES.army_tank.turnRate).toBeLessThan(SQUAD_RULES.stuckTime);
    // The slot tolerance is tighter than the spacing, or neighbours would settle on each other.
    expect(SQUAD_RULES.slotTolerance).toBeLessThan(1);
    expect(SQUAD_RULES.formationStagger).toBeLessThan(1);
  });
});

describe('the Lizard (DESIGN.md sections 2 and 4)', () => {
  it('has the per-stage body numbers', () => {
    expect(LIZARD.name).toBe('Gragnor');
    expect(LIZARD.stages.map((s) => s.height)).toEqual([4.5, 32, 115]);
    expect(LIZARD.stages.map((s) => s.bodyRadius)).toEqual([2.4, 9, 26]);
    expect(LIZARD.stages.map((s) => s.topSpeed)).toEqual([8.5, 14, 22]);
    expect(LIZARD.stages.map((s) => s.turnRate / DEG).map((v) => Math.round(v))).toEqual([200, 120, 75]);
    expect(LIZARD.stages.map((s) => s.trampleHeight)).toEqual([3.5, 12, 70]);
    expect(LIZARD.stages.map((s) => s.wadesTall)).toEqual([false, false, true]);
    expect(LIZARD.stages[2].wadeSpeedMult).toBe(0.45);
    expect(LIZARD.headLeadMax).toBeCloseTo(50 * DEG, 12);
    expect(LIZARD.trampleDps).toBe(40);
    expect(kaijuStageDef('lizard', 2).bodyRadius).toBe(9);
  });

  it('defines every verb with the timings from the action table', () => {
    const a = LIZARD.actions;
    for (const id of KAIJU_ACTION_IDS) {
      if (id === 'none') continue;
      expect(a[id].id).toBe(id);
      expect(kaijuActionDef('lizard', id as KaijuVerb)).toBe(a[id]);
    }
    expect(a.swipe).toMatchObject({
      button: 'strike',
      gesture: 'tap',
      timing: { windup: 0.45, active: 0.15, recover: 0.5 },
      reach: 2.5,
      unitDamage: 70,
      unitNerve: 40,
      structureDamage: [40, 300, 2000],
    });
    expect(a.swipe.arc).toBeCloseTo(120 * DEG, 12);
    expect(a.stomp).toMatchObject({
      button: 'strike',
      gesture: 'hold',
      holdTime: 0.35,
      timing: { windup: 0.9, active: 0.1, recover: 0.9 },
      radius: 3.6,
      unitDamageCenter: 100,
      unitDamageEdge: 30,
      unitNerveCenter: 40,
      unitNerveEdge: 10,
      structureDamage: [55, 420, 2600],
      moveMult: 0,
    });
    expect(a.grab).toMatchObject({ button: 'grab', gesture: 'tap', reach: 2.5, vehicleFromStage: 2, chunkFromStage: 2 });
    expect(a.grab.timing.windup).toBe(0.4);
    expect(a.grab.arc).toBeCloseTo(100 * DEG, 12);
    expect(a.throw).toMatchObject({
      speed: [25, 45, 70],
      unitDamage: 120,
      impactRadius: [4, 10, 22],
      structureDamage: [60, 350, 1500],
    });
    expect(a.throw.timing.windup + a.throw.timing.active + a.throw.timing.recover).toBeCloseTo(0.5, 12);
    expect(a.eat).toMatchObject({ button: 'grab', gesture: 'hold', holdTime: 0.5, heal: 80, cooldown: 10, moveMult: 0 });
    expect(a.eat.timing.active).toBe(2);
    expect(a.brace).toMatchObject({ button: 'block', gesture: 'level', moveMult: 0, turnMult: 0.3, activePhase: 'brace' });
    expect(a.roar).toMatchObject({ gesture: 'press', cooldown: 18, radius: [40, 110, 280], unitNerve: 100, resetsCharge: true });
    expect(a.roar.timing.active).toBe(1.2);
    expect(a.special).toMatchObject({
      special: 'beam',
      rageCost: 100,
      range: [60, 220, 600],
      width: [2.2, 7.5, 21],
      unitDps: 150,
      structureDps: [60, 600, 4000],
      turnMult: 0.25,
    });
    // The breath fights the head (polish pass), but stays aimable: all it can stray, shake and
    // pull together, is well inside the head's lead over the body.
    expect([a.special.wobbleYaw, a.special.wobblePitch, a.special.driftYaw, a.special.kickPitch].map((x) => +((x ?? 0) / DEG).toFixed(6))).toEqual([4, 1.5, 6, 4]);
    expect((a.special.wobbleYaw ?? 0) + (a.special.driftYaw ?? 0)).toBeLessThan(LIZARD.headLeadMax / 3);
    expect(a.special.timing).toMatchObject({ windup: 0.8, active: 3 });
    expect(a.molt).toMatchObject({ button: 'molt', gesture: 'hold', holdTime: 1, activePhase: 'cocoon' });
  });

  it('is the only registered kind for now, and unknown kinds fail loudly', () => {
    expect(PLAYABLE_KAIJU_KINDS).toEqual(['lizard']);
    expect(kaijuKindDef('lizard')).toBe(LIZARD);
    expect(() => kaijuKindDef('moth')).toThrow(/not registered/);
    expect(KAIJU_KIND_IDS).toEqual(['lizard', 'crab', 'burrower', 'moth']);
  });
});

describe('the Army (DESIGN.md section 5)', () => {
  it('fields the right unit at each level', () => {
    expect(ARMY.levels.map((l) => l.unitType)).toEqual(['army_rocket_infantry', 'army_tank', 'army_tank_troop']);
    expect(ARMY.levels.map((l) => l.callIns)).toEqual([[], [], ['artillery']]);
    expect(factionLevelDef('army', 3).callIns).toEqual(['artillery']);
    expect(PLAYABLE_FACTIONS).toEqual(['army']);
    expect(factionDef('army').name).toBe('Army');
    expect(() => factionDef('faith')).toThrow(/not registered/);
    expect(FACTION_IDS).toEqual(['army', 'air', 'science', 'faith']);
  });

  it('matches the unit and weapon table', () => {
    const [l1, l2, l3] = ARMY.levels.map((l) => UNIT_TYPES[l.unitType]);
    expect([l1.hp, l1.speed, l1.radius, l1.members]).toEqual([100, 6.5, 3, 10]);
    expect([l2.hp, l2.speed, l2.radius, l2.members]).toEqual([100, 15, 4, 1]);
    expect([l3.hp, l3.speed, l3.radius, l3.members]).toEqual([300, 15, 9, 3]);
    const w = [l1, l2, l3].map((u) => WEAPONS[u.weapon]);
    expect(w.map((x) => x.maxShots)).toEqual([3, 1, 3]);
    expect(w.map((x) => x.damage)).toEqual([3.2, 9.5, 3.2]);
    expect(w.map((x) => x.nerve)).toEqual([1.8, 5.4, 4.5]);
    expect(w.map((x) => x.range)).toEqual([160, 420, 600]);
    expect(w.map((x) => x.cooldown)).toEqual([2.6, 3.2, 3.2]);
    expect(w.map((x) => x.splashRadius)).toEqual([3, 5, 5]);
    expect(w.map((x) => x.structureDamage)).toEqual([3, 25, 25]);
    expect(w.map((x) => +(x.aimErrorAtWill / DEG).toFixed(3))).toEqual([3.5, 2.5, 2.5]);
    expect(w.map((x) => +(x.aimErrorVolley / DEG).toFixed(3))).toEqual([1.2, 0.9, 0.9]);
    expect(w.map((x) => PROJECTILE_TYPES[x.projectile].speed)).toEqual([55, 110, 110]);
    expect(w.map((x) => PROJECTILE_TYPES[x.projectile].flight)).toEqual(['flat', 'flat', 'flat']);
  });

  it('normalizes a squad salvo to about 38 damage at every level, and about 20 nerve at levels 1 and 2', () => {
    for (const level of ARMY.levels) {
      const unit = UNIT_TYPES[level.unitType];
      const weapon = WEAPONS[unit.weapon];
      const shots = shotsForMembers(weapon, unit.members);
      expect(shots).toBe(weapon.maxShots);
      const damage = MATCH_RULES.unitsPerSquad * shots * weapon.damage;
      const nerve = MATCH_RULES.unitsPerSquad * shots * weapon.nerve;
      expect(damage).toBeGreaterThanOrEqual(38);
      expect(damage).toBeLessThan(38.5);
      // Tuned per level with the balance harness (docs/BALANCE.md). Level 3 is counted per tank
      // since the polish pass (docs/STATUS.md section 15): see the next test.
      if (level.level === 3) continue;
      expect(nerve).toBeGreaterThanOrEqual(19);
      expect(nerve).toBeLessThanOrEqual(22);
    }
  });

  it('counts level 3 per tank: a charged volley of ten tanks (three of them leaders shooting uncharged) breaks the titan from the front, six do not', () => {
    const P = LIZARD.damage;
    const shell = WEAPONS[UNIT_TYPES.army_tank_troop.weapon].nerve;
    const full = 1 + COMBAT_RULES.volleyNervePerCharge;
    expect((3 * shell + 7 * shell * full) * P.frontMult).toBeGreaterThan(LIZARD.nerveCapacity * 1.05);
    expect((2 * shell + 4 * shell * full) * P.frontMult).toBeLessThan(LIZARD.nerveCapacity * 0.75);
    // A level 3 tank is worth nearly what a level 2 tank is.
    expect(shell / WEAPONS[UNIT_TYPES.army_tank.weapon].nerve).toBeGreaterThan(0.8);
  });

  it('at levels 1 and 2, keeps one squad most of the way: a full-charge volley stays under the nerve capacity', () => {
    // (At level 3 a full squad's volley passes it; the two-squad rule in the damage system is
    // what keeps one squad from breaking the kaiju alone there: volleyRules.test.ts.)
    const P = LIZARD.damage;
    for (const level of ARMY.levels) {
      if (level.level === 3) continue;
      const unit = UNIT_TYPES[level.unitType];
      const weapon = WEAPONS[unit.weapon];
      const salvo = shotsForMembers(weapon, unit.members) * weapon.nerve;
      const charged = 3 * salvo * (1 + COMBAT_RULES.volleyNervePerCharge);
      // The trigger shot plus three fully charged sub-units, from the worst side...
      expect((salvo + charged) * P.rearMult).toBeLessThan(LIZARD.nerveCapacity);
      // ...and as the one-player crossfire: the leader on the flank, the sub-units in front.
      expect(salvo * P.flankMult + charged * P.frontMult * COMBAT_RULES.crossfireNerveMult).toBeLessThan(LIZARD.nerveCapacity);
      // Two squads whose fire crosses do break it, even from the front.
      expect((salvo + charged) * P.frontMult * (1 + COMBAT_RULES.crossfireNerveMult)).toBeGreaterThan(LIZARD.nerveCapacity);
    }
  });

  it('loses shots and members as a unit is worn down', () => {
    const rockets = WEAPONS.army_rocket_launchers;
    expect([10, 7, 6, 4, 3, 1, 0].map((m) => shotsForMembers(rockets, m))).toEqual([3, 3, 2, 2, 1, 1, 0]);
    const troop = WEAPONS.army_troop_guns;
    expect([3, 2, 1, 0].map((m) => shotsForMembers(troop, m))).toEqual([3, 2, 1, 0]);
    const inf = UNIT_TYPES.army_rocket_infantry;
    expect([100, 91, 90, 55, 10, 1, 0].map((hp) => membersForHp(inf, hp))).toEqual([10, 10, 9, 6, 1, 1, 0]);
    const tanks = UNIT_TYPES.army_tank_troop;
    expect([300, 201, 200, 100, 1, 0].map((hp) => membersForHp(tanks, hp))).toEqual([3, 3, 2, 1, 1, 0]);
  });

  it('has the artillery call-in', () => {
    expect(callInDef('artillery')).toMatchObject({
      delay: 4,
      shells: 8,
      duration: 2,
      scatterRadius: 28,
      damage: 9,
      nerve: 5,
      splashRadius: 14,
      structureDamage: 300,
      cooldown: 35,
      projectile: 'arty',
    });
    expect(PROJECTILE_TYPES.arty.flight).toBe('arc');
    expect(PROJECTILE_TYPES.thrown.flight).toBe('thrown');
  });
});

describe('registries and ids', () => {
  it('define every listed id', () => {
    for (const id of UNIT_TYPE_IDS) expect(UNIT_TYPES[id].id).toBe(id);
    for (const id of WEAPON_IDS) expect(WEAPONS[id].id).toBe(id);
    for (const id of PROJECTILE_TYPE_IDS) expect(PROJECTILE_TYPES[id].id).toBe(id);
    for (const id of CALLIN_IDS) expect(CALLINS[id].id).toBe(id);
    for (const id of UNIT_TYPE_IDS) {
      expect(WEAPON_IDS).toContain(UNIT_TYPES[id].weapon);
      expect(FACTION_IDS).toContain(UNIT_TYPES[id].faction);
    }
    for (const list of [KAIJU_ACTION_IDS, DAMAGE_KINDS, TALLY_CLASSES, UNIT_TYPE_IDS, WEAPON_IDS]) {
      expect(new Set<string>(list).size).toBe(list.length);
    }
    expect(TALLY_CLASSES).toEqual(['car', 'kiosk', 'house', 'shop', 'apartment', 'office', 'tower', 'factory', 'bridge', 'landmark']);
  });

  it('maps ids to wire codes and back', () => {
    expect(codeOf(KAIJU_ACTION_IDS, 'none')).toBe(0);
    expect(codeOf(KAIJU_ACTION_IDS, 'molt')).toBe(9);
    expect(idOf(KAIJU_ACTION_IDS, 2)).toBe('stomp');
    expect(idOf(KAIJU_ACTION_IDS, 200)).toBe('none');
    expect(() => codeOf(KAIJU_ACTION_IDS, 'dance' as 'none')).toThrow();
  });
});

describe('upgrades and mods (schema only in Tier 1)', () => {
  it('starts with an empty pool and neutral mods', () => {
    expect(UPGRADES).toEqual([]);
    expect(() => upgradeDef('magnetic_hide')).toThrow();
    const mods = emptyMods();
    expect(modMult(mods, 'speed')).toBe(1);
    expect(hasModFlag(mods, 'tailClub')).toBe(false);
  });

  it('folds upgrades into a mods table', () => {
    const mods = emptyMods();
    addMods(mods, { mult: { speed: 1.1, damageTaken: 0.9 }, flags: ['tailClub'] });
    addMods(mods, { mult: { speed: 1.1 }, flags: ['tailClub', 'acidSpit'] });
    expect(modMult(mods, 'speed')).toBeCloseTo(1.21, 12);
    expect(modMult(mods, 'damageTaken')).toBe(0.9);
    expect(modMult(mods, 'aimError')).toBe(1);
    expect(mods.flags).toEqual(['tailClub', 'acidSpit']);
    expect(hasModFlag(mods, 'acidSpit')).toBe(true);
  });
});

describe('voice script (owned by the audio team; schema in ASSETS.md section 6)', () => {
  it('is valid: every line has a known cue and audience, a speaker, text and a unique file-safe id', () => {
    expect(VOICE_LINE_PROBLEMS).toEqual([]);
    expect(VOICE_LINES.length).toBeGreaterThan(0);
  });

  it('covers every cue in the contract', () => {
    const covered = new Set(VOICE_LINES.map((l) => l.cue));
    expect(VOICE_CUE_IDS.filter((cue) => !covered.has(cue))).toEqual([]);
  });


  it('reports schema problems instead of throwing', () => {
    const { lines, problems } = parseVoiceLines([
      { id: 'ok_1', cue: 'crossfire', audience: 'humans', speaker: 'Overlord', text: 'Crossfire.' },
      { id: 'ok_1', cue: 'crossfire', audience: 'humans', speaker: 'Overlord', text: 'Again.' },
      { id: 'bad_cue', cue: 'pizza.time', audience: 'humans', speaker: 'Overlord', text: 'No.' },
      { id: 'bad_audience', cue: 'crossfire', audience: 'martians', speaker: 'Overlord', text: 'No.' },
      { id: 'Bad Id', cue: 'crossfire', audience: 'all', speaker: 'Overlord', text: 'No.' },
      { id: 'no_text', cue: 'crossfire', audience: 'all', speaker: 'Overlord' },
      'nonsense',
    ]);
    expect(lines.map((l) => l.id)).toEqual(['ok_1']);
    expect(problems.length).toBe(6);
    expect(parseVoiceLines({ nope: true }).problems).toEqual(['voice script is not an array']);
  });

  it('picks lines per listener, deterministically, preferring the squad that is speaking', () => {
    const lines = parseVoiceLines([
      { id: 'a', cue: 'volley.ready', audience: 'humans', speaker: 'Overlord', text: 'Ready.' },
      { id: 'b', cue: 'volley.ready', audience: 'humans', speaker: 'Granite', text: 'Granite ready.' },
      { id: 'c', cue: 'volley.ready', audience: 'kaiju', speaker: 'Anchor', text: 'They are ready.' },
      { id: 'd', cue: 'hearing.kaiju.win', audience: 'all', speaker: 'Chair', text: 'Order.' },
    ]).lines;
    expect(voiceLinesFor('volley.ready', 'humans', lines).map((l) => l.id)).toEqual(['a', 'b']);
    expect(voiceLinesFor('volley.ready', 'kaiju', lines).map((l) => l.id)).toEqual(['c']);
    expect(voiceLinesFor('hearing.kaiju.win', 'kaiju', lines).map((l) => l.id)).toEqual(['d']);
    expect(pickVoiceLine('volley.ready', 'humans', 0, undefined, lines)?.id).toBe('a');
    expect(pickVoiceLine('volley.ready', 'humans', 1, undefined, lines)?.id).toBe('b');
    expect(pickVoiceLine('volley.ready', 'humans', 2, undefined, lines)?.id).toBe('a');
    expect(pickVoiceLine('volley.ready', 'humans', 0, 'Granite', lines)?.id).toBe('b');
    expect(pickVoiceLine('volley.ready', 'humans', 0, 'Anvil', lines)?.id).toBe('a');
    expect(pickVoiceLine('crossfire', 'humans', 0, undefined, lines)).toBeNull();
    expect(missingVoiceCues('kaiju', lines)).toContain('crossfire');
    expect(missingVoiceCues('kaiju', lines)).not.toContain('volley.ready');
    expect(VOICE_SEQUENCE_CUES).toContain('match.briefing');
    expect(SQUAD_CALLSIGNS.length).toBe(4);
  });
});
