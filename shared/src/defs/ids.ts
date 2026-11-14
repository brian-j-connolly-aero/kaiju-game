/**
 * Every enumerated id in the game, as `const` arrays. The position of an id in its array is its
 * wire code in binary snapshots, so:
 *
 *   - only ever APPEND to these arrays (Tier 2 content appends its ids);
 *   - never reorder or remove an entry without bumping PROTOCOL_VERSION in net/protocol.ts.
 *
 * Ids planned for Tier 2 are listed already where the wire format or the lobby needs them, even
 * though their definitions are not registered yet (see the registries in this folder).
 */

/** Growth stage of the kaiju and of the whole match: 1 hatchling, 2 juvenile, 3 titan. */
export type StageId = 1 | 2 | 3;
export const STAGE_IDS: readonly StageId[] = [1, 2, 3];

/** A value for each of the three stages, in order. Read it with `perStage(values, stage)`. */
export type PerStage<T> = readonly [T, T, T];

export function perStage<T>(values: PerStage<T>, stage: StageId): T {
  return values[stage - 1];
}

/** Human army level; always equal to the current stage. */
export type Level = 1 | 2 | 3;

export const MATCH_PHASES = ['lobby', 'briefing', 'playing', 'intermission', 'ended'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export const SIDES = ['kaiju', 'humans'] as const;
export type Side = (typeof SIDES)[number];

/** Match result. 'none' while the match is running. */
export const WINNERS = ['none', 'kaiju', 'humans'] as const;
export type Winner = (typeof WINNERS)[number];

export const END_REASONS = ['none', 'bar', 'kill', 'clock'] as const;
export type EndReason = (typeof END_REASONS)[number];

export const ROLES = ['kaiju', 'human'] as const;
export type Role = (typeof ROLES)[number];

// --- Kaiju -----------------------------------------------------------------------------------

export const KAIJU_KIND_IDS = ['lizard', 'crab', 'burrower', 'moth'] as const;
export type KaijuKindId = (typeof KAIJU_KIND_IDS)[number];

/**
 * The kaiju verbs. 'none' means no action is running. These match the icon names in ASSETS.md
 * (`k_swipe`, `k_stomp`, ...). 'special' is the kind's signature attack (the Lizard's beam).
 * 'charge' and 'tailSweep' are moves a kaiju can pick at a molt (KAIJU_MOVE_IDS). 'club' is
 * Strike with a fast-food sign in the hand (phase 2, the city as a weapon): a big swing instead
 * of a throw.
 */
export const KAIJU_ACTION_IDS = [
  'none',
  'swipe',
  'stomp',
  'grab',
  'throw',
  'eat',
  'brace',
  'roar',
  'special',
  'molt',
  'charge',
  'tailSweep',
  'club',
] as const;
export type KaijuActionId = (typeof KAIJU_ACTION_IDS)[number];
/** An action that can actually be performed (everything except 'none'). */
export type KaijuVerb = Exclude<KaijuActionId, 'none'>;

/** Phases of the kaiju action state machine (ARCHITECTURE.md section 3). */
export const KAIJU_PHASES = [
  'idle',
  'windup',
  'active',
  'recover',
  'brace',
  'eat',
  'roar',
  'special',
  'stagger',
  'cocoon',
  'dead',
  // The charge's run, and the stumble it always ends in.
  'charge',
  'stumble',
  // A propane tank went off in its hand (phase 2): a short recoil, rooted, no action ('none').
  'flinch',
] as const;
export type KaijuPhase = (typeof KAIJU_PHASES)[number];

/**
 * The moves a kaiju picks at a molt, one card of three (DESIGN.md section 4, "Molt cards"): the
 * first pick goes on its first move button, the second on its second. 'none' is an empty slot.
 * Each is one of its verbs: 'beam' is the Lizard's special (`kaijuMoveVerb` in defs/kaiju).
 * Icons: `k_special` for the beam, otherwise `k_<verb>` like every verb.
 */
export const KAIJU_MOVE_IDS = ['none', 'beam', 'roar', 'charge', 'tailSweep', 'brace'] as const;
export type KaijuMoveId = (typeof KAIJU_MOVE_IDS)[number];
/** A move that can be held in a slot (everything except 'none'). */
export type KaijuMove = Exclude<KaijuMoveId, 'none'>;

/** What a kaiju can hold in its hand. */
export const HELD_KINDS = ['none', 'prop', 'wreck', 'vehicle', 'chunk'] as const;
export type HeldKind = (typeof HELD_KINDS)[number];

/**
 * Wrecks that can lie on the ground and be picked up: a crushed car (`prop_car_wreck`) or a
 * destroyed tank (`army_tank_wreck`).
 */
export const WRECK_KINDS = ['car', 'tank'] as const;
export type WreckKind = (typeof WRECK_KINDS)[number];

// --- Humans ----------------------------------------------------------------------------------

export const FACTION_IDS = ['army', 'air', 'science', 'faith'] as const;
export type FactionId = (typeof FACTION_IDS)[number];

export const UNIT_TYPE_IDS = ['army_rocket_infantry', 'army_tank', 'army_tank_troop'] as const;
export type UnitTypeId = (typeof UNIT_TYPE_IDS)[number];

export const WEAPON_IDS = ['army_rocket_launchers', 'army_tank_gun', 'army_troop_guns'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

/**
 * 'tracer', 'missile' and 'heavyShell' are what the machine gun, the missile pod and the big
 * cannon pick-ups fire (docs/ROADMAP.md, phase 2; defs/pickups.ts).
 */
export const PROJECTILE_TYPE_IDS = ['rocket', 'shell', 'arty', 'thrown', 'tracer', 'missile', 'heavyShell'] as const;
export type ProjectileTypeId = (typeof PROJECTILE_TYPE_IDS)[number];

/**
 * flat: straight line, no gravity. arc: shell falling from off the map. thrown: ballistic.
 * guided: the missile pod's rockets, which curve onto the aim point (a constant acceleration for
 * a set time, then straight on; `ProjectileSpawnEvent` has the formula).
 */
export const FLIGHT_MODELS = ['flat', 'arc', 'thrown', 'guided'] as const;
export type FlightModel = (typeof FLIGHT_MODELS)[number];

/**
 * Army pick-ups (docs/ROADMAP.md, phase 2): what a supply crate holds. 'none' is no pick-up.
 * The first three replace the driven unit's own weapon (`WeaponPickupId`); the artillery radio
 * turns the squad's next charged volleys into barrages; reinforcements act at once. Their
 * pictures are in client/public/assets/ui (docs/ASSETS.md, section 5).
 */
export const PICKUP_IDS = ['none', 'machineGun', 'bigCannon', 'missilePod', 'artilleryRadio', 'reinforcements'] as const;
export type PickupId = (typeof PICKUP_IDS)[number];
/** What a crate can hold (every pick-up except 'none'). */
export type PickupKind = Exclude<PickupId, 'none'>;
/** The pick-ups that replace the driven unit's own weapon until the stage ends. */
export const WEAPON_PICKUP_IDS = ['machineGun', 'bigCannon', 'missilePod'] as const;
export type WeaponPickupId = (typeof WEAPON_PICKUP_IDS)[number];

export const CALLIN_IDS = ['artillery'] as const;
export type CallInId = (typeof CALLIN_IDS)[number];

/** Animation and behavior state of one unit. */
export const UNIT_STATES = ['idle', 'moving', 'charging', 'shaken', 'dead'] as const;
export type UnitState = (typeof UNIT_STATES)[number];

// --- Damage ----------------------------------------------------------------------------------

/** What kind of thing dealt a hit. Carried by applyHit and by damage events. */
export const DAMAGE_KINDS = [
  'swipe',
  'stomp',
  'thrown',
  'beam',
  'trample',
  'wade',
  'roar',
  'blast',
  'rocket',
  'shell',
  'arty',
  // The kaiju's charge (units it runs into, buildings it smashes), its tail sweep, and the city
  // giving way when every squad is gone ("never alone", DESIGN.md section 2).
  'charge',
  'tailSweep',
  'collapse',
  // Phase 2: the pick-up weapons' shots (machine gun, missile pod, big cannon), and a building
  // that fell over landing on what lay under it.
  'tracer',
  'missile',
  'heavyShell',
  'fall',
  // Phase 2, the city as a weapon and the special buildings: a propane tank going off, the gas
  // station's fireball, a thrown water tank's splash, a thrown antenna or mast (a javelin), and
  // the fast-food sign swung as a club.
  'propane',
  'fireball',
  'splash',
  'javelin',
  'club',
] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

// --- City ------------------------------------------------------------------------------------

/** Structure classes. Each has a tally pictogram `tl_<class>` (ASSETS.md section 5). */
export const STRUCTURE_CLASSES = [
  'house',
  'shop',
  'apartment',
  'office',
  'tower',
  'factory',
  'bridge',
  'landmark',
] as const;
export type StructureClass = (typeof STRUCTURE_CLASSES)[number];

/** Everything the end screen tallies: the structure classes plus the two valuable prop families. */
export const TALLY_CLASSES = ['car', 'kiosk', ...STRUCTURE_CLASSES] as const;
export type TallyClass = (typeof TALLY_CLASSES)[number];

/** Visual damage state of a structure: 0 intact, 1 damaged, 2 heavily damaged, 3 rubble. */
export type StructureStage = 0 | 1 | 2 | 3;
export const STRUCTURE_STAGE_RUBBLE: StructureStage = 3;

export const TIMES_OF_DAY = ['afternoon', 'sunset', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** Wire code of an id: its index in the id array. Throws on an unknown id (always a bug). */
export function codeOf<T extends string>(ids: readonly T[], id: T): number {
  const i = ids.indexOf(id);
  if (i < 0) throw new Error(`unknown id "${id}"`);
  return i;
}

/** Id for a wire code. Out-of-range codes fall back to the first entry so a bad byte never crashes a client. */
export function idOf<T extends string>(ids: readonly T[], code: number): T {
  return ids[code] ?? ids[0];
}
