import { describe, expect, it } from 'vitest';
import {
  addLobbyPlayer,
  ARCHETYPES,
  base64ToBytes,
  bitClear,
  bitGet,
  bitSet,
  Btn,
  BUTTON_COUNT,
  BUTTON_MASK,
  BUTTON_NAMES,
  buildMatchConfig,
  bytesToBase64,
  canStartMatch,
  cityChecksum,
  cityStateFromWire,
  cleanPlayerName,
  CLIENT_MESSAGE_TYPES,
  COMMAND_IDS,
  createLobbyState,
  createMatchConfig,
  createRng,
  createWorld,
  decodeCityState,
  decodeSnapshot,
  encodeCityState,
  encodeSnapshot,
  FACTION_IDS,
  FIRE_MODES,
  hpForStage,
  KAIJU_ACTION_IDS,
  KAIJU_KIND_IDS,
  KAIJU_PHASES,
  makeRoomCode,
  MATCH_PHASES,
  MAX_AIM_PITCH,
  MOVE_ORDERS,
  peekSnapshotTick,
  pickKaijuSeat,
  PROP_KIND_IDS,
  PROTOCOL_VERSION,
  removeLobbyPlayer,
  ROOM_CODE_ALPHABET,
  sanitizeCommand,
  sanitizeInput,
  SERVER_MESSAGE_TYPES,
  setSnapshotAck,
  snapshotOfWorld,
  structureStageFor,
  UNIT_STATES,
  UNIT_TYPE_IDS,
  welcomeFor,
  WINNERS,
  END_REASONS,
  type HeldObject,
  type SnapKaiju,
  type Snapshot,
  type SnapSquad,
  type SnapUnit,
} from '../src/index';
import { input, makeTestWorld, run } from './helpers';

function sampleKaiju(overrides: Partial<SnapKaiju> = {}): SnapKaiju {
  return {
    id: 0,
    player: 0,
    kind: 'lizard',
    stage: 2,
    alive: true,
    moltAvailable: true,
    wading: false,
    inWater: true,
    submerge: 0,
    known: true,
    spotted: false,
    marked: false,
    x: -812.375,
    z: 44.5,
    vx: 13.25,
    vz: -0.5,
    yaw: 1.25,
    aimYaw: 1.5,
    aimPitch: -0.125,
    hp: 612.5,
    maxHp: 1000,
    nerve: 71.25,
    nerveImmune: 2.5,
    rage: 99,
    action: 'stomp',
    phase: 'windup',
    phaseTime: 0.5,
    phaseDuration: 0.875,
    held: { kind: 'prop', prop: 'bus' },
    cooldowns: { swipe: 0, stomp: 0, grab: 0, throw: 0, eat: 7.25, brace: 0, roar: 17.5, special: 0, molt: 0 },
    ...overrides,
  };
}

function sampleSquad(overrides: Partial<SnapSquad> = {}): SnapSquad {
  return {
    id: 1,
    player: 2,
    faction: 'army',
    level: 3,
    eliminated: false,
    bot: true,
    moveOrder: 'moveTo',
    fireMode: 'charge',
    driven: 5,
    moveTargetX: -340.5,
    moveTargetZ: 1022.5,
    callInCooldowns: [31.25, 0],
    smokeCooldown: 12.5,
    markCooldown: 0,
    ...overrides,
  };
}

function sampleUnit(overrides: Partial<SnapUnit> = {}): SnapUnit {
  return {
    id: 5,
    squad: 1,
    type: 'army_tank_troop',
    state: 'charging',
    alive: true,
    veteran: true,
    driven: false,
    rooted: true,
    inWater: false,
    laser: true,
    wreck: false,
    x: 101.125,
    z: -990.75,
    vx: 0,
    vz: 0,
    y: 0,
    yaw: 0,
    aimYaw: 0,
    aimPitch: 0,
    hp: 212.5,
    maxHp: 300,
    members: 3,
    nerve: 42.5,
    shaken: 1.25,
    charge: 1,
    cooldown: 2.75,
    ...overrides,
  };
}

function sampleSnapshot(): Snapshot {
  return {
    tick: 123456,
    ackSeq: 7890,
    match: {
      phase: 'playing',
      stage: 2,
      clock: 431.5,
      phaseTime: 0,
      barPoints: 1234.5,
      marks: [500, 5421, 26253],
      marksReached: 1,
      winner: 'none',
      endReason: 'none',
    },
    kaijus: [sampleKaiju()],
    squads: [sampleSquad()],
    units: [sampleUnit()],
    smokes: [{ id: 7, squad: 1, x: -120.5, z: 330.2, radius: 30, height: 28, timer: 9.25 }],
  };
}

describe('snapshot codec', () => {
  it('round-trips a snapshot whose values sit on the wire grid exactly', () => {
    const snap = sampleSnapshot();
    expect(decodeSnapshot(encodeSnapshot(snap))).toEqual(snap);
  });

  it('round-trips every enumerated value', () => {
    const base = sampleSnapshot();
    const check = (s: Snapshot): void => {
      expect(decodeSnapshot(encodeSnapshot(s))).toEqual(s);
    };
    for (const phase of MATCH_PHASES) check({ ...base, match: { ...base.match, phase } });
    for (const stage of [1, 2, 3] as const) check({ ...base, match: { ...base.match, stage } });
    for (const winner of WINNERS) check({ ...base, match: { ...base.match, winner } });
    for (const endReason of END_REASONS) check({ ...base, match: { ...base.match, endReason } });
    for (const kind of KAIJU_KIND_IDS) check({ ...base, kaijus: [sampleKaiju({ kind })] });
    for (const action of KAIJU_ACTION_IDS) check({ ...base, kaijus: [sampleKaiju({ action })] });
    for (const phase of KAIJU_PHASES) check({ ...base, kaijus: [sampleKaiju({ phase })] });
    for (const faction of FACTION_IDS) check({ ...base, squads: [sampleSquad({ faction })] });
    for (const moveOrder of MOVE_ORDERS) check({ ...base, squads: [sampleSquad({ moveOrder })] });
    for (const fireMode of FIRE_MODES) check({ ...base, squads: [sampleSquad({ fireMode })] });
    for (const type of UNIT_TYPE_IDS) check({ ...base, units: [sampleUnit({ type })] });
    for (const state of UNIT_STATES) check({ ...base, units: [sampleUnit({ state })] });
  });

  it('round-trips every held object and every flag on its own', () => {
    const base = sampleSnapshot();
    const helds: Array<HeldObject | null> = [
      null,
      { kind: 'wreck', wreck: 'car' },
      { kind: 'wreck', wreck: 'tank' },
      { kind: 'vehicle', unitType: 'army_tank' },
      { kind: 'chunk', archetype: ARCHETYPES[ARCHETYPES.length - 1].id },
      ...PROP_KIND_IDS.map((prop): HeldObject => ({ kind: 'prop', prop })),
    ];
    for (const held of helds) {
      const s = { ...base, kaijus: [sampleKaiju({ held })] };
      expect(decodeSnapshot(encodeSnapshot(s)).kaijus[0].held).toEqual(held);
    }
    const kaijuFlags = ['alive', 'moltAvailable', 'wading', 'inWater', 'known', 'spotted', 'marked'] as const;
    for (const flag of kaijuFlags) {
      const off = Object.fromEntries(kaijuFlags.map((f) => [f, false]));
      const k = sampleKaiju({ ...off, [flag]: true });
      expect(decodeSnapshot(encodeSnapshot({ ...base, kaijus: [k] })).kaijus[0]).toEqual(k);
    }
    const unitFlags = ['alive', 'veteran', 'driven', 'rooted', 'inWater', 'laser', 'wreck'] as const;
    for (const flag of unitFlags) {
      const off = Object.fromEntries(unitFlags.map((f) => [f, false]));
      const u = sampleUnit({ ...off, [flag]: true });
      expect(decodeSnapshot(encodeSnapshot({ ...base, units: [u] })).units[0]).toEqual(u);
    }
    for (const [eliminated, bot] of [[true, false], [false, true]] as const) {
      const q = sampleSquad({ eliminated, bot, driven: -1 });
      expect(decodeSnapshot(encodeSnapshot({ ...base, squads: [q] })).squads[0]).toEqual(q);
    }
  });

  it('round-trips a live world within the documented precision, and is stable after one pass', () => {
    const world = makeTestWorld({ realCity: true, seed: 3 });
    for (let i = 0; i < 200; i++) {
      world.step([input({ seq: i, moveZ: 1, aimYaw: i / 60, aimPitch: -0.2 }), input({ seq: i, moveZ: 1, aimYaw: 2 })]);
    }
    world.kaijus[0].nerve = 33.3333;
    world.kaijus[0].cooldowns.roar = 12.3456;
    world.units[3].charge = 0.4321;
    world.units[3].shaken = 1.2345;
    world.units[3].nerve = 66.6;
    const snap = snapshotOfWorld(world, 4242);
    const bytes = encodeSnapshot(snap);
    const back = decodeSnapshot(bytes);

    expect(back.tick).toBe(world.tick);
    expect(back.ackSeq).toBe(4242);
    expect(back.match.phase).toBe('playing');
    expect(back.match.clock).toBeCloseTo(snap.match.clock, 1);
    expect(back.match.marks[2]).toBeCloseTo(snap.match.marks[2], 0);
    expect(back.kaijus.length).toBe(1);
    expect(back.squads.length).toBe(4);
    expect(back.units.length).toBe(16);

    const k = back.kaijus[0];
    const wk = world.kaijus[0];
    // Positions, velocities and headings are 32-bit floats: good to a fraction of a millimeter.
    expect(k.x).toBeCloseTo(wk.x, 3);
    expect(k.z).toBeCloseTo(wk.z, 3);
    expect(k.vx).toBeCloseTo(wk.vx, 4);
    expect(k.yaw).toBeCloseTo(wk.yaw, 5);
    expect(k.aimPitch).toBeCloseTo(-0.2, 6);
    expect(k.nerve).toBeCloseTo(33.3333, 4);
    expect(k.cooldowns.roar).toBeCloseTo(12.35, 9);
    expect(k.phase).toBe(wk.phase);
    expect(k.action).toBe(wk.action);

    for (const u of back.units) {
      const wu = world.units[u.id];
      expect(u.squad).toBe(wu.squad);
      expect(u.type).toBe(wu.type);
      expect(u.x).toBeCloseTo(wu.x, 3);
      expect(u.z).toBeCloseTo(wu.z, 3);
      expect(u.yaw).toBeCloseTo(wu.yaw, 3);
      expect(u.aimYaw).toBeCloseTo(wu.aimYaw, 3);
      expect(u.hp).toBeCloseTo(wu.hp, 1);
      expect(u.members).toBe(wu.members);
      expect(u.driven).toBe(world.squads[wu.squad].driven === wu.id);
      expect(Math.abs(u.charge - wu.charge)).toBeLessThanOrEqual(1 / 255);
      expect(Math.abs(u.shaken - wu.shaken)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(u.nerve - wu.nerve)).toBeLessThanOrEqual(0.5);
    }
    // Quantization happens once: decoding and re-encoding reproduces the same bytes.
    expect(encodeSnapshot(back)).toEqual(bytes);
    // 15 snapshots a second must stay small.
    expect(bytes.length).toBeLessThan(1000);
  });

  it('patches the per-client acknowledgement without re-encoding', () => {
    const bytes = encodeSnapshot(sampleSnapshot());
    setSnapshotAck(bytes, 99);
    expect(decodeSnapshot(bytes).ackSeq).toBe(99);
    expect(peekSnapshotTick(bytes)).toBe(123456);
    // Works on a view into a larger buffer too.
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 8);
    const view = padded.subarray(8);
    setSnapshotAck(view, 5);
    expect(decodeSnapshot(view)).toEqual({ ...sampleSnapshot(), ackSeq: 5 });
  });

  it('clamps out-of-range values instead of wrapping', () => {
    const s = sampleSnapshot();
    s.units[0].shaken = 100;
    s.units[0].hp = 1e9;
    s.units[0].charge = 3;
    s.units[0].nerve = -5;
    s.squads[0].moveTargetX = 99999;
    const back = decodeSnapshot(encodeSnapshot(s));
    expect(back.units[0].shaken).toBe(12.75);
    expect(back.units[0].hp).toBe(6553.5);
    expect(back.units[0].charge).toBe(1);
    expect(back.units[0].nerve).toBe(0);
    expect(back.squads[0].moveTargetX).toBe(3276.7);
  });

  it('rejects garbage', () => {
    const bytes = encodeSnapshot(sampleSnapshot());
    expect(() => decodeSnapshot(bytes.subarray(0, bytes.length - 3))).toThrow(/truncated/);
    expect(() => decodeSnapshot(new Uint8Array([1, 2, 3]))).toThrow();
    const wrongVersion = bytes.slice();
    wrongVersion[1] = 200;
    expect(() => decodeSnapshot(wrongVersion)).toThrow(/version/);
    expect(() => decodeSnapshot(new Uint8Array(0))).toThrow();
  });
});

describe('city state on the wire', () => {
  it('round-trips structure stages and live props', () => {
    const world = makeTestWorld({ realCity: true });
    const n = world.city.structures.length;
    for (let i = 0; i < n; i++) world.structureStage[i] = (i * 7) % 4;
    for (let i = 0; i < world.city.props.length; i += 3) bitClear(world.propAlive, i);
    for (let i = 0; i < world.city.props.length; i += 6) bitSet(world.propWreck, i);
    const bytes = encodeCityState(world.structureStage, world.propAlive, world.propWreck, world.city.props.length);
    expect(bytes.length).toBe(8 + Math.ceil(n / 4) + 2 * Math.ceil(world.city.props.length / 8));
    const back = decodeCityState(bytes);
    expect(back.structureStage).toEqual(world.structureStage);
    expect(back.propAlive).toEqual(world.propAlive);
    expect(back.propWreck).toEqual(world.propWreck);
    expect(back.propCount).toBe(world.city.props.length);
    expect(() => decodeCityState(bytes.subarray(0, 20))).toThrow();

    // The client mirror agrees with the server about what is standing and at which stage.
    const mirror = cityStateFromWire(world.city, back);
    for (let i = 0; i < n; i++) {
      const maxHp = world.city.structures[i].hp;
      expect(structureStageFor(mirror.structureHp[i], maxHp)).toBe(world.structureStage[i]);
    }
    expect(bitGet(mirror.propAlive, 0)).toBe(false);
    expect(bitGet(mirror.propAlive, 1)).toBe(true);
    expect(() => cityStateFromWire(world.city, { ...back, propCount: 3 })).toThrow();
    expect(hpForStage(100, 3)).toBe(0);
    expect(hpForStage(100, 0)).toBe(100);
  });

  it('survives base64 for text-only transports', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 250]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      const text = bytesToBase64(bytes);
      expect(text).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
      expect(base64ToBytes(text)).toEqual(bytes);
    }
    expect(bytesToBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(bytesToBase64(new Uint8Array([77, 97]))).toBe('TWE=');
    expect(() => base64ToBytes('!!!!')).toThrow();
  });
});

describe('welcome', () => {
  it('carries what a client needs to rebuild the match', () => {
    const world = createWorld({ seed: 77, config: createMatchConfig({ humans: [{ name: 'Ann', role: 'human' }] }) });
    run(world, 5);
    world.structureStage[10] = 3;
    const w = welcomeFor(world, 1);
    expect(w.protocol).toBe(PROTOCOL_VERSION);
    expect(w.seed).toBe(77);
    expect(w.playerId).toBe(1);
    expect(w.kaijuId).toBe(-1);
    expect(w.squadId).toBe(0);
    expect(w.tick).toBe(5);
    expect(w.anchor).toBe(world.match.anchor);
    expect(w.cityChecksum).toBe(cityChecksum(world.city));
    expect(decodeCityState(w.cityState).structureStage[10]).toBe(3);
    expect(welcomeFor(world, 0).kaijuId).toBe(0);
    expect(welcomeFor(world, 99).playerId).toBe(-1);
    // The config is plain JSON.
    expect(JSON.parse(JSON.stringify(w.config))).toEqual(world.config);
    // A client that repeats the server's call gets the same starting world.
    const twin = createWorld({ seed: w.seed, config: w.config });
    expect(twin.match.anchor).toBe(w.anchor);
    expect(twin.kaijus[0].x).toBe(createWorld({ seed: 77, config: world.config }).kaijus[0].x);
  });
});

describe('input and command validation', () => {
  it('defines one bit per button', () => {
    expect(BUTTON_COUNT).toBe(10);
    expect(BUTTON_MASK).toBe(1023);
    const bits = BUTTON_NAMES.map((n) => Btn[n]);
    expect(new Set(bits).size).toBe(BUTTON_COUNT);
    BUTTON_NAMES.forEach((name, i) => expect(Btn[name]).toBe(1 << i));
    expect(COMMAND_IDS).toEqual(['follow', 'moveTo', 'fireAtWill', 'holdCharge']);
  });

  it('accepts a clean input unchanged', () => {
    const clean = { seq: 12, moveX: 0.5, moveZ: -0.5, aimYaw: 1, aimPitch: 0.25, buttons: Btn.fire | Btn.callIn };
    expect(sanitizeInput(clean)).toEqual(clean);
    expect(sanitizeInput({ ...clean, wheel: 'moveTo', marker: { x: 10, z: -20 } })).toEqual({
      ...clean,
      wheel: 'moveTo',
      marker: { x: 10, z: -20 },
    });
  });

  it('clamps and normalizes hostile values', () => {
    const out = sanitizeInput({
      seq: 3.9,
      moveX: 50,
      moveZ: 50,
      aimYaw: 100,
      aimPitch: 9,
      buttons: 0xfffff,
      wheel: 'selfDestruct',
      marker: { x: 1e9, z: -1e9 },
      extra: 'ignored',
    });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.seq).toBe(3);
    expect(Math.hypot(out.moveX, out.moveZ)).toBeCloseTo(1, 9);
    expect(out.aimYaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(out.aimYaw).toBeLessThan(Math.PI);
    expect(out.aimPitch).toBe(MAX_AIM_PITCH);
    expect(out.buttons).toBe(BUTTON_MASK);
    expect(out.wheel).toBeUndefined();
    expect(out.marker).toEqual({ x: 1100, z: -1100 });
    expect(Object.keys(out)).not.toContain('extra');
  });

  it('rejects things that are not inputs', () => {
    expect(sanitizeInput(null)).toBeNull();
    expect(sanitizeInput('hello')).toBeNull();
    expect(sanitizeInput({})).toBeNull();
    expect(sanitizeInput({ seq: 1, moveX: Number.NaN, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: 0 })).toBeNull();
    expect(sanitizeInput({ seq: 1, moveX: 0, moveZ: 0, aimYaw: Infinity, aimPitch: 0, buttons: 0 })).toBeNull();
    expect(sanitizeInput({ seq: 1, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: '3' })).toBeNull();
  });

  it('validates squad commands', () => {
    expect(sanitizeCommand({ type: 'follow', junk: 1 })).toEqual({ type: 'follow' });
    expect(sanitizeCommand({ type: 'fireAtWill' })).toEqual({ type: 'fireAtWill' });
    expect(sanitizeCommand({ type: 'holdCharge' })).toEqual({ type: 'holdCharge' });
    expect(sanitizeCommand({ type: 'moveTo', x: 5, z: 9999 })).toEqual({ type: 'moveTo', x: 5, z: 1100 });
    expect(sanitizeCommand({ type: 'moveTo', x: 'a', z: 0 })).toBeNull();
    expect(sanitizeCommand({ type: 'callIn', callIn: 'artillery', x: 1, z: 2 })).toEqual({
      type: 'callIn',
      callIn: 'artillery',
      x: 1,
      z: 2,
    });
    expect(sanitizeCommand({ type: 'callIn', callIn: 'nuke', x: 1, z: 2 })).toBeNull();
    expect(sanitizeCommand({ type: 'explode' })).toBeNull();
    expect(sanitizeCommand(undefined)).toBeNull();
  });

  it('lists every message type once', () => {
    expect(new Set(CLIENT_MESSAGE_TYPES).size).toBe(CLIENT_MESSAGE_TYPES.length);
    expect(CLIENT_MESSAGE_TYPES).toEqual(expect.arrayContaining(['setName', 'setRole', 'setFaction', 'ready', 'start', 'input', 'command', 'draftPick', 'ping']));
    expect(SERVER_MESSAGE_TYPES).toEqual(['welcome', 'lobby', 'snap', 'events', 'pong']);
  });
});

describe('lobby', () => {
  it('seats up to five players and passes the host on', () => {
    const lobby = createLobbyState('BCDF');
    const names = ['Ann', 'Bob', 'Cy', 'Di', 'Ed'];
    const seats = names.map((n) => addLobbyPlayer(lobby, n)?.seat);
    expect(seats).toEqual([0, 1, 2, 3, 4]);
    expect(addLobbyPlayer(lobby, 'Flo')).toBeNull();
    expect(lobby.host).toBe(0);
    removeLobbyPlayer(lobby, 0);
    expect(lobby.host).toBe(1);
    // The freed seat is reused.
    expect(addLobbyPlayer(lobby, 'Gus')?.seat).toBe(0);
    expect(lobby.players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4]);
  });

  it('cleans names and makes speakable room codes', () => {
    expect(cleanPlayerName('  <b>Rex</b>\n ', 0)).toBe('bRex/b');
    expect(cleanPlayerName('', 2)).toBe('Player 3');
    expect(cleanPlayerName(42, 0)).toBe('Player 1');
    expect(cleanPlayerName('x'.repeat(50), 0).length).toBe(16);
    // Characters that garble a lobby row or a terminal are taken out, whatever is left stays.
    expect(cleanPlayerName('Rex\u202Eevil', 0)).toBe('Rexevil'); // right-to-left override
    expect(cleanPlayerName('R\u200Be\u200Dx\uFEFF', 0)).toBe('Rex'); // zero-width characters
    expect(cleanPlayerName('Rex\u009B31m', 0)).toBe('Rex31m'); // a terminal escape introducer
    expect(cleanPlayerName('Rex\u2028Tyr\u2029', 0)).toBe('RexTyr'); // line and paragraph separators
    expect(cleanPlayerName('Rex \t  the\u00A0 Great', 0)).toBe('Rex the Great');
    // A name with nothing visible in it is no name.
    expect(cleanPlayerName('\u200B\u200B\u200B', 1)).toBe('Player 2');
    expect(cleanPlayerName('\u3164\u2800 \u115F', 1)).toBe('Player 2');
    expect(cleanPlayerName('\u0301\u0301', 1)).toBe('Player 2');
    expect(cleanPlayerName('\uD83D', 1)).toBe('Player 2'); // half an emoji
    // Composed form, and no tower of marks on one letter.
    expect(cleanPlayerName('Ame\u0301lie', 0)).toBe('Am\u00E9lie');
    expect(Array.from(cleanPlayerName(`Z${'\u0301'.repeat(40)}algo`, 0)).filter((c) => /\p{M}/u.test(c)).length).toBeLessThanOrEqual(2);
    // Sixteen characters as people count them: an emoji at the cut is kept whole or left out.
    const emoji = cleanPlayerName(`${'a'.repeat(15)}\u{1F996}\u{1F996}`, 0);
    expect(Array.from(emoji)).toEqual([...'a'.repeat(15), '\u{1F996}']);
    expect(cleanPlayerName('\u{1F996}'.repeat(40), 0)).toBe('\u{1F996}'.repeat(16));
    // Hostile lengths cost nothing.
    expect(cleanPlayerName('\u200B'.repeat(1_000_000) + 'Rex', 0)).toBe('Player 1');
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      const code = makeRoomCode(rng);
      expect(code.length).toBe(4);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it('needs everyone but the host to be ready', () => {
    const lobby = createLobbyState('BCDF');
    addLobbyPlayer(lobby, 'Ann');
    const bob = addLobbyPlayer(lobby, 'Bob');
    expect(canStartMatch(lobby)).toBe(false);
    if (bob) bob.ready = true;
    expect(canStartMatch(lobby)).toBe(true);
    expect(canStartMatch(createLobbyState('XXXX'))).toBe(false);
  });

  it('does not wait for ever for somebody who is not ready, and never makes them the kaiju', () => {
    const lobby = createLobbyState('BCDF');
    for (const n of ['Ann', 'Bob', 'Cy']) addLobbyPlayer(lobby, n);
    const [, bob, cy] = lobby.players;
    bob.ready = true;
    cy.wantsKaiju = true;
    expect(canStartMatch(lobby)).toBe(false);
    // The server marks a player once they have had their time in the lobby.
    cy.waited = true;
    expect(canStartMatch(lobby)).toBe(true);
    // Somebody who is not there to be waited for does not count either way.
    cy.waited = false;
    cy.connected = false;
    expect(canStartMatch(lobby)).toBe(true);

    // Started without Cy: Cy is in the match, but the kaiju goes to somebody who is at the keys.
    cy.connected = true;
    cy.waited = true;
    const rng = createRng(9);
    const picks = new Set<number>();
    for (let i = 0; i < 60; i++) picks.add(pickKaijuSeat(lobby, rng));
    expect([...picks].sort()).toEqual([0, 1]);
    // Once Cy is ready the volunteer gets it, as always.
    cy.ready = true;
    for (let i = 0; i < 20; i++) expect(pickKaijuSeat(lobby, rng)).toBe(2);
  });

  it('gives the kaiju to a volunteer, otherwise rotates it, never twice in a row', () => {
    const lobby = createLobbyState('BCDF');
    for (const n of ['Ann', 'Bob', 'Cy']) addLobbyPlayer(lobby, n);
    const rng = createRng(4);
    lobby.players[1].wantsKaiju = true;
    for (let i = 0; i < 20; i++) expect(pickKaijuSeat(lobby, rng)).toBe(1);
    // Even a volunteer who just played it keeps it: volunteering overrides the rotation.
    lobby.lastKaijuSeat = 1;
    expect(pickKaijuSeat(lobby, rng)).toBe(1);

    lobby.players[1].wantsKaiju = false;
    const picks = new Set<number>();
    for (let i = 0; i < 60; i++) picks.add(pickKaijuSeat(lobby, rng));
    expect([...picks].sort()).toEqual([0, 2]);

    // Two volunteers: the one who did not just play it.
    lobby.players[0].wantsKaiju = true;
    lobby.players[1].wantsKaiju = true;
    for (let i = 0; i < 20; i++) expect(pickKaijuSeat(lobby, rng)).toBe(0);

    lobby.options.botKaiju = true;
    expect(pickKaijuSeat(lobby, rng)).toBe(-1);
  });

  it('lets a lone player pick a side', () => {
    const lobby = createLobbyState('BCDF');
    addLobbyPlayer(lobby, 'Solo');
    const rng = createRng(2);
    expect(pickKaijuSeat(lobby, rng)).toBe(-1);
    lobby.players[0].wantsKaiju = true;
    expect(pickKaijuSeat(lobby, rng)).toBe(0);
  });

  it('builds a full match from a lobby: bots fill every empty slot', () => {
    const lobby = createLobbyState('BCDF');
    for (const n of ['Ann', 'Bob', 'Cy']) addLobbyPlayer(lobby, n);
    lobby.players[2].connected = false;
    const { config, slotBySeat } = buildMatchConfig(lobby, 1, 3);
    expect(config.players.length).toBe(5);
    expect(config.players[0]).toMatchObject({ id: 0, name: 'Bob', role: 'kaiju', bot: false, kaijuKind: 'lizard' });
    expect(config.players[1]).toMatchObject({ id: 1, name: 'Ann', role: 'human', bot: false, faction: 'army', callsign: 'Granite' });
    expect(config.players.slice(2).every((p) => p.bot && p.role === 'human')).toBe(true);
    expect(slotBySeat).toEqual([1, 0, -1, -1, -1]);
    expect(config.anchor).toBe(3);
    expect(config.tuning.clock).toBe(720);
    // A valid config: the simulation accepts it.
    expect(createWorld({ seed: 1, config }).players.length).toBe(5);

    lobby.options.fast = true;
    const practice = buildMatchConfig(lobby, -1);
    expect(practice.config.players[0].bot).toBe(true);
    expect(practice.slotBySeat).toEqual([1, 2, -1, -1, -1]);
    expect(practice.config.tuning.clock).toBeLessThan(720);
  });
});
