/** Test helpers: tiny hand-made cities and worlds, so each rule can be checked in isolation. */

import {
  buildCityIndex,
  CITY_HALF,
  createCityQuery,
  createCityState,
  createMatchConfig,
  createWorld,
  type Area,
  type BuiltCity,
  type CityData,
  type CityQuery,
  type MatchConfig,
  type PlayerInput,
  type Prop,
  type PropKindId,
  type Structure,
  type StructureClass,
  type World,
} from '../src/index';

export interface TestStructure {
  x: number;
  z: number;
  /** Full width and depth. */
  w: number;
  d: number;
  height: number;
  yaw?: number;
  hp?: number;
  value?: number;
  cls?: StructureClass;
  passable?: boolean;
  landmark?: string;
}

export interface TestCityOptions {
  structures?: TestStructure[];
  props?: Array<{ kind: PropKindId; x: number; z: number }>;
  /** Axis-aligned water rectangles: [x0, z0, x1, z1]. */
  water?: Array<[number, number, number, number]>;
  /** Anchor positions; default one anchor at the origin. */
  anchors?: Array<[number, number]>;
}

/** An otherwise empty city containing exactly what the test asks for. */
export function makeTestCity(options: TestCityOptions = {}): BuiltCity {
  const structures: Structure[] = (options.structures ?? []).map((s, id) => ({
    id,
    archetype: s.passable ? 'bridge_a' : 'house_a',
    x: s.x,
    z: s.z,
    hx: s.w / 2,
    hz: s.d / 2,
    yaw: s.yaw ?? 0,
    height: s.height,
    cls: s.cls ?? (s.passable ? 'bridge' : 'house'),
    hp: s.hp ?? 100,
    value: s.value ?? 10,
    landmark: s.landmark ?? null,
    passable: s.passable ?? false,
  }));
  const props: Prop[] = (options.props ?? []).map((p, id) => ({ id, kind: p.kind, x: p.x, z: p.z, yaw: 0 }));
  const areas: Area[] = (options.water ?? []).map(([x0, z0, x1, z1], id) => ({
    id,
    kind: 'water',
    name: `water ${id}`,
    polygon: [
      { x: x0, z: z0 },
      { x: x1, z: z0 },
      { x: x1, z: z1 },
      { x: x0, z: z1 },
    ],
  }));
  const city: CityData = {
    seed: 1,
    half: CITY_HALF,
    structures,
    props,
    roads: { nodes: [], edges: [] },
    areas,
    districts: [],
    anchors: (options.anchors ?? [[0, 0]]).map(([x, z], id) => ({ id, name: `Anchor ${id}`, x, z })),
    downtown: { x: 0, z: 0 },
  };
  return { city, index: buildCityIndex(city) };
}

export function queryFor(built: BuiltCity): CityQuery {
  return createCityQuery(built.index, createCityState(built.city));
}

export interface TestWorldOptions extends TestCityOptions {
  seed?: number;
  /** Who is a person: 'kaiju', 'human' (first squad), 'both' or 'none' (all bots). */
  people?: 'kaiju' | 'human' | 'both' | 'none';
  /** Skip the briefing: the world is returned already in 'playing' (one tick has been stepped). Default true. */
  skipBriefing?: boolean;
  /** Use the shipped city instead of a hand-made one. */
  realCity?: boolean;
  /** Bar marks. Hand-made cities default to marks far out of reach so a test match does not end early. */
  marks?: [number, number, number];
  config?: Partial<MatchConfig>;
}

/** Match slots created by makeTestWorld: slot 0 is the kaiju, slot 1 the first squad. */
export const KAIJU_PLAYER = 0;
export const HUMAN_PLAYER = 1;

export function makeTestWorld(options: TestWorldOptions = {}): World {
  const people = options.people ?? 'both';
  const humans: NonNullable<Parameters<typeof createMatchConfig>[0]>['humans'] = [];
  if (people === 'kaiju' || people === 'both') humans.push({ name: 'Kay', role: 'kaiju' });
  if (people === 'human' || people === 'both') humans.push({ name: 'Hugh', role: 'human' });
  const config = { ...createMatchConfig({ humans, anchor: 0 }), ...options.config };
  if (options.skipBriefing ?? true) config.tuning = { ...config.tuning, briefing: 0 };
  const world = createWorld({
    seed: options.seed ?? 7,
    config,
    city: options.realCity ? undefined : makeTestCity(options),
  });
  if (options.marks) world.match.marks = options.marks;
  else if (!options.realCity) world.match.marks = [1e6, 2e6, 3e6];
  // A zero-length briefing still takes one tick to hand over to 'playing'.
  if (options.skipBriefing ?? true) world.step();
  return world;
}

export function input(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { seq: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: 0, ...partial };
}

/** Steps the world `ticks` times with the same per-player inputs; returns all events. */
export function run(world: World, ticks: number, inputs: Array<PlayerInput | null | undefined> = []) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...world.step(inputs));
  return events;
}
