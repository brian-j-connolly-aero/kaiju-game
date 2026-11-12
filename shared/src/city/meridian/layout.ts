/**
 * PORT MERIDIAN: the hand-made part.
 *
 * Everything in this file is data, written in MAP coordinates: [east, north] in meters from
 * the city center, the way the in-game map shows the city (north up, east to the right). The
 * generator turns them into world coordinates with x = -east, z = north (ARCHITECTURE: +Z up
 * the map puts +X on the left).
 *
 * The plan, in one breath: the sea lies to the south with a wide bay cut into it. The River
 * Wend comes down from the north, bends past Temple Hill, splits around Chapter Island and
 * reaches the bay between the Old Town (west bank) and the downtown towers (east bank).
 * Downtown is the square in the middle; around it lie the mid-rise quarters (Old Town, the
 * university, the science park, Eastside, the works, the docks, the stadium); around those,
 * along the west, north and east edges, the low-rise neighborhoods where a match starts.
 *
 * Three numbers shape the level (see docs/CITY.md, "Why the city is laid out in three bands"):
 * - CORE: the towers stand within 180 m of the center (east-west). Every neighborhood anchor is
 *   920 m out, so its stage 2 square (which slides 280 m toward downtown and reaches 460 m
 *   further) stops exactly at the ring boulevard: no juvenile ever gets the towers, the titan does.
 * - FRAME: the avenues at 740 m separate the starting neighborhoods from the mid-rise ring.
 * - EDGE: the beltway at 1070 m is where squads deploy at stage 3.
 */

import type { InfillId, PaletteId } from './palettes';

/** [east, north], meters. */
export type Pt = readonly [number, number];

export const EDGE = 1070;
export const FRAME = 740;
export const RING = 200;
/** Structures are never generated beyond this distance from the center on either axis. */
export const BUILD_LIMIT = 1054;

/** Where stage 2 bounds lean to: the middle of the tower cluster. */
export const DOWNTOWN: Pt = [0, -100];

// ---------------------------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------------------------

/**
 * The River Wend from north to south: [east, north, half width, half width of the island].
 * Smoothed by the generator. The straight reaches are where the bridges cross.
 */
export const RIVER: ReadonlyArray<readonly [number, number, number, number]> = [
  [-120, 1100, 34, 0],
  [-120, 1010, 34, 0],
  [-200, 900, 34, 0],
  [-290, 830, 34, 0],
  [-300, 790, 35, 0],
  [-300, 690, 35, 0],
  [-330, 600, 35, 0],
  [-400, 480, 35, 0],
  [-400, 130, 35, 0],
  [-372, 70, 37, 0],
  [-338, 28, 40, 0],
  [-330, -20, 46, 30],
  [-330, -70, 46, 44],
  [-330, -170, 46, 46],
  [-330, -240, 46, 40],
  [-330, -290, 44, 0],
  [-330, -350, 46, 0],
  [-330, -480, 48, 0],
];

/** The sea, clockwise from the south-west corner. `smooth` runs are natural shore, the rest is quay. */
export const SEA: ReadonlyArray<{ smooth: boolean; pts: readonly Pt[] }> = [
  { smooth: false, pts: [[-1100, -1100]] },
  // The beach west of the pier.
  {
    smooth: true,
    pts: [
      [-1100, -802],
      [-960, -806],
      [-840, -800],
      [-745, -798],
    ],
  },
  // The boardwalk pier.
  {
    smooth: false,
    pts: [
      [-745, -880],
      [-700, -880],
    ],
  },
  // The beach east of the pier and the west shore of the bay, up to the river mouth.
  {
    smooth: true,
    pts: [
      [-700, -798],
      [-620, -800],
      [-552, -796],
      [-512, -770],
      [-486, -705],
      [-464, -625],
      [-442, -545],
      [-412, -485],
      [-384, -448],
    ],
  },
  // Across the river mouth, the embankment, the quay with two finger piers, the Long Mole.
  {
    smooth: false,
    pts: [
      [-280, -448],
      [-276, -431],
      [208, -431],
      [208, -540],
      [128, -540],
      [128, -582],
      [208, -582],
      [208, -700],
      [128, -700],
      [128, -742],
      [208, -742],
      [208, -922],
      [-176, -922],
      [-196, -932],
      [-196, -948],
      [-176, -958],
      [208, -958],
      [208, -1100],
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Parks and plazas
// ---------------------------------------------------------------------------------------------

export interface OpenSpec {
  kind: 'park' | 'plaza';
  name: string;
  /** Rectangle [east0, north0, east1, north1]... */
  rect?: readonly [number, number, number, number];
  /** ...or a disc [east, north, radius] (drawn as a 16-sided polygon)... */
  disc?: readonly [number, number, number];
  /** ...or any polygon. */
  poly?: readonly Pt[];
}

export const OPEN: readonly OpenSpec[] = [
  // Greens and squares at the heart of each starting neighborhood (the anchors stand on them).
  { kind: 'park', name: 'Alder Green', rect: [-948, 892, -892, 948] },
  { kind: 'park', name: 'Bellhaven Common', rect: [-958, -278, -882, -202] },
  { kind: 'plaza', name: 'Cinder Yard', rect: [895, -260, 945, -210] },
  { kind: 'park', name: 'Dovecote Green', rect: [-568, 892, -512, 948] },
  { kind: 'park', name: 'Easter Green', disc: [920, 380, 40] },
  { kind: 'plaza', name: 'Fennel Steps', rect: [-948, 308, -908, 348] },
  { kind: 'plaza', name: 'Gull Stairs', rect: [895, -745, 945, -695] },
  { kind: 'plaza', name: 'Ivy Court', rect: [215, 895, 265, 945] },
  { kind: 'plaza', name: 'Juniper Square', rect: [-945, -625, -895, -575] },

  // Around the landmarks.
  { kind: 'park', name: 'Temple Gardens', disc: [-590, 460, 52] },
  { kind: 'park', name: 'Halcyon Hill', rect: [350, 510, 466, 626] },
  { kind: 'park', name: 'Signal Hill', rect: [500, 850, 670, 1000] },
  { kind: 'park', name: 'Scholars Quad', rect: [-160, 500, -40, 620] },
  { kind: 'park', name: 'Wend Gardens', rect: [-362, 214, -322, 452] },
  { kind: 'park', name: 'Hollowmere Meadow', rect: [-424, 760, -338, 852] },
  { kind: 'park', name: 'Chapter Green', rect: [-366, -268, -294, -216] },
  { kind: 'park', name: 'Pilgrims Garden', rect: [-362, -56, -298, -8] },
  { kind: 'plaza', name: 'Cathedral Close', rect: [-368, -135, -292, -84] },
  { kind: 'plaza', name: 'Founders Plaza', rect: [-75, -392, 75, -324] },
  { kind: 'plaza', name: 'Exchange Square', rect: [-90, -60, -12, 10] },
  { kind: 'plaza', name: 'Station Square', rect: [15, 212, 185, 236] },
  { kind: 'plaza', name: 'Market Square', rect: [-625, -15, -565, 45] },
  { kind: 'park', name: 'Foundry Green', rect: [350, -238, 455, -172] },
  { kind: 'plaza', name: 'Wheel Plaza', rect: [-735, -764, -645, -722] },
  { kind: 'plaza', name: 'Stadium Concourse', rect: [-698, -668, -522, -512] },
  // The waterfront promenade under the towers, and the beach.
  { kind: 'plaza', name: 'Embankment Promenade', rect: [-274, -430, 206, -418] },
  { kind: 'plaza', name: 'Juniper Strand', rect: [-1100, -800, -548, -780] },
];

// ---------------------------------------------------------------------------------------------
// Arterial streets, drawn by hand
// ---------------------------------------------------------------------------------------------

export interface BridgeSpec {
  /** A point in the water on the street's line; the generator finds both banks from it. */
  at: Pt;
  /** Deck archetype. */
  deck: 'bridge_a' | 'bridge_b';
}

export interface StreetSpec {
  name: string;
  pts: readonly Pt[];
  width: number;
  kind: 'street' | 'avenue';
  /** Buildings may front it (default true). */
  lots?: boolean;
  /** Parked cars per 100 m of curb (default by kind). */
  cars?: number;
  bridges?: readonly BridgeSpec[];
  /** A crossing through the shallow river with no deck. */
  ford?: boolean;
}

function gridStreets(): StreetSpec[] {
  const out: StreetSpec[] = [];
  // Downtown: east-west streets every 90 m, north-south every 100 m.
  for (const n of [110, 20, -160, -250]) {
    out.push({ name: `Core Street ${n}`, pts: [[-RING, n], [RING, n]], width: 14, kind: 'street', cars: 3 });
  }
  for (const e of [-100, 100]) {
    out.push({ name: `Core Lane ${e}`, pts: [[e, RING], [e, -405]], width: 14, kind: 'street', cars: 3 });
  }
  return out;
}

export const STREETS: readonly StreetSpec[] = [
  // The beltway: where squads deploy at stage 3 and drive round the city.
  {
    name: 'Meridian Beltway',
    pts: [[-EDGE, -772], [-EDGE, 1010], [-1010, EDGE], [1010, EDGE], [EDGE, 1010], [EDGE, -1010], [1010, -EDGE], [260, -EDGE]],
    width: 16,
    kind: 'avenue',
    cars: 0.5,
    bridges: [{ at: [-120, EDGE], deck: 'bridge_a' }],
  },
  { name: 'Quay Road', pts: [[260, -EDGE], [260, -405]], width: 16, kind: 'avenue', cars: 1 },

  // The waterfront: Dock Street, the Embankment, the Grand Harbor Bridge, Shore Road.
  {
    name: 'Shore Road',
    pts: [[EDGE, -405], [728, -405], [260, -405], [RING, -405], [0, -405], [-RING, -405], [-440, -405], [-FRAME, -405], [-EDGE, -405]],
    width: 22,
    kind: 'avenue',
    cars: 1.4,
    bridges: [{ at: [-330, -405], deck: 'bridge_b' }],
  },
  // The two long cross-town avenues.
  {
    name: 'Meridian Avenue',
    pts: [[-EDGE, RING], [-764, RING], [-RING, RING], [0, RING], [RING, RING], [748, RING], [EDGE, RING]],
    width: 22,
    kind: 'avenue',
    cars: 1.4,
    bridges: [{ at: [-400, RING], deck: 'bridge_a' }],
  },
  {
    name: 'Northern Avenue',
    pts: [[-EDGE, 734], [-770, FRAME], [-420, FRAME], [-180, FRAME], [0, 748], [RING, 752], [470, 748], [FRAME, FRAME], [EDGE, 730]],
    width: 20,
    kind: 'avenue',
    cars: 1.2,
    bridges: [{ at: [-300, FRAME], deck: 'bridge_a' }],
  },
  {
    name: 'Old Post Road',
    pts: [[-FRAME, -772], [-FRAME, -705], [-FRAME, -475], [-FRAME, -405], [-746, -70], [-764, RING], [-784, 470], [-770, FRAME], [-748, 900], [-FRAME, EDGE]],
    width: 20,
    kind: 'avenue',
    cars: 1.2,
  },
  {
    name: 'Ironmongers Road',
    pts: [[FRAME, EDGE], [FRAME, FRAME], [752, 470], [748, RING], [736, -70], [728, -405], [736, -800], [FRAME, -EDGE]],
    width: 20,
    kind: 'avenue',
    cars: 1.2,
  },
  { name: 'Kingsway', pts: [[0, EDGE], [0, 748], [0, RING], [0, -250]], width: 22, kind: 'avenue', cars: 1.4 },
  // The ring boulevard round the towers: the stage 2 quarantine line runs along it.
  { name: 'River Drive', pts: [[-RING, RING], [-RING, -405]], width: 22, kind: 'avenue', cars: 1.2 },
  { name: 'East Ring', pts: [[RING, 752], [RING, RING], [RING, -405]], width: 22, kind: 'avenue', cars: 1.4 },
  { name: 'Harrow Road', pts: [[RING, RING], [FRAME, FRAME], [1040, 1040]], width: 20, kind: 'avenue', cars: 1 },

  // One street straight across the middle: Old Town, both arms of the river, downtown, the works.
  {
    name: 'Chapter Street',
    pts: [[-746, -70], [-RING, -70]],
    width: 12,
    kind: 'street',
    cars: 2,
    bridges: [
      { at: [-397, -70], deck: 'bridge_a' },
      { at: [-263, -70], deck: 'bridge_a' },
    ],
  },
  { name: 'Exchange Street', pts: [[-RING, -70], [RING, -70]], width: 14, kind: 'street', cars: 3 },
  { name: 'Foundry Street', pts: [[RING, -70], [736, -70], [EDGE, -70]], width: 18, kind: 'avenue', cars: 1.2 },

  ...gridStreets(),

  // Collectors.
  { name: 'College Street', pts: [[-350, 470], [0, 470], [RING, 470], [752, 470]], width: 14, kind: 'street', cars: 2.5 },
  { name: 'Tanners Ford', pts: [[-455, 460], [-350, 470]], width: 9, kind: 'street', lots: false, cars: 0, ford: true },
  { name: 'Furnace Lane', pts: [[470, RING], [470, -405]], width: 14, kind: 'street', cars: 2 },
  { name: 'Wharf Street', pts: [[260, -800], [736, -800], [EDGE, -800]], width: 14, kind: 'street', cars: 2 },

  // The Old Town's river front.
  {
    name: 'Tanners Quay',
    pts: [[-440, -405], [-420, -345], [-402, -300], [-436, -240], [-444, -200], [-444, -70], [-442, -20], [-420, 28], [-428, 70], [-456, 130], [-456, RING]],
    width: 11,
    kind: 'street',
    cars: 2,
  },

  // The seafront: the boardwalk along the beach, then Bay Road up the west shore of the bay.
  { name: 'The Boardwalk', pts: [[-EDGE, -772], [-FRAME, -772], [-540, -772]], width: 12, kind: 'street', cars: 1.5 },
  { name: 'Bay Road', pts: [[-540, -772], [-516, -705], [-495, -625], [-472, -545], [-448, -475], [-440, -405]], width: 12, kind: 'street', cars: 1.5 },
  { name: 'Fairground Row', pts: [[-FRAME, -705], [-516, -705]], width: 12, kind: 'street', cars: 2 },
  { name: 'Stadium Way', pts: [[-FRAME, -475], [-448, -475]], width: 12, kind: 'street', cars: 2 },
  { name: 'Pier Walk', pts: [[-722, -772], [-722, -866]], width: 8, kind: 'street', lots: false, cars: 0 },
  { name: 'The Long Mole', pts: [[260, -940], [-146, -940]], width: 8, kind: 'street', lots: false, cars: 0 },
];

// ---------------------------------------------------------------------------------------------
// Landmarks, placed by hand
// ---------------------------------------------------------------------------------------------

export interface LandmarkSpec {
  archetype: string;
  at: Pt;
  /** Which way the front looks. */
  face: 'N' | 'E' | 'S' | 'W';
}

export const LANDMARKS: readonly LandmarkSpec[] = [
  { archetype: 'meridian_tower', at: [-51, -25], face: 'S' },
  { archetype: 'city_hall', at: [0, -292], face: 'S' },
  { archetype: 'tidewater_cathedral', at: [-330, -176], face: 'N' },
  { archetype: 'anchor_field', at: [-605, -590], face: 'N' },
  { archetype: 'tidewheel', at: [-690, -744], face: 'S' },
  { archetype: 'halcyon_observatory', at: [408, 568], face: 'S' },
  { archetype: 'farewell_light', at: [-172, -940], face: 'N' },
  { archetype: 'kiln_point_power', at: [905, 68], face: 'W' },
  { archetype: 'sevenfold_temple', at: [-590, 460], face: 'E' },
  { archetype: 'grand_station', at: [100, 263], face: 'S' },
  { archetype: 'signal_mast', at: [585, 925], face: 'S' },
  { archetype: 'gasworks', at: [556, -250], face: 'W' },
  { archetype: 'founders_clock', at: [-100, 560], face: 'S' },
];

// ---------------------------------------------------------------------------------------------
// Neighborhood anchors (ids are stable; the names are the placeholder's, kept for continuity)
// ---------------------------------------------------------------------------------------------

export const ANCHORS: ReadonlyArray<{ name: string; at: Pt }> = [
  { name: 'Alder Row', at: [-920, 920] },
  { name: 'Bellhaven', at: [-920, -240] },
  { name: 'Cinder Flats', at: [920, -235] },
  { name: 'Dovecote', at: [-540, 920] },
  { name: 'Easter Green', at: [920, 380] },
  { name: 'Fennel Hill', at: [-928, 328] },
  { name: 'Gull Point', at: [920, -720] },
  { name: 'Harrow Lane', at: [920, 920] },
  { name: 'Ivy Court', at: [240, 920] },
  { name: 'Juniper Bay', at: [-920, -600] },
];

// ---------------------------------------------------------------------------------------------
// Districts (for names, map tint and the art direction)
// ---------------------------------------------------------------------------------------------

export interface DistrictSpec {
  zone: 'downtown' | 'oldtown' | 'harbor' | 'industrial' | 'suburb' | 'university' | 'boardwalk' | 'temple';
  name: string;
  poly: readonly Pt[];
}

const rect = (e0: number, n0: number, e1: number, n1: number): Pt[] => [
  [e0, n0],
  [e1, n0],
  [e1, n1],
  [e0, n1],
];

export const DISTRICTS: readonly DistrictSpec[] = [
  {
    zone: 'downtown',
    name: 'Downtown',
    poly: [
      [-237, -431],
      [470, -431],
      [470, 200],
      [200, 200],
      [200, 300],
      [-200, 300],
      [-200, 200],
      [-237, 200],
    ],
  },
  { zone: 'oldtown', name: 'Old Town', poly: rect(-740, -405, -237, 200) },
  {
    zone: 'temple',
    name: 'Temple Hill',
    poly: [
      [-1100, 200],
      [-400, 200],
      [-400, 480],
      [-330, 600],
      [-300, 690],
      [-300, 740],
      [-1100, 740],
    ],
  },
  {
    zone: 'suburb',
    name: 'Hollowmere',
    poly: [
      [-1100, 740],
      [-300, 740],
      [-300, 790],
      [-290, 830],
      [-200, 900],
      [-120, 1010],
      [-120, 1100],
      [-1100, 1100],
    ],
  },
  {
    zone: 'university',
    name: 'University',
    poly: [
      [-400, 200],
      [-200, 200],
      [-200, 300],
      [200, 300],
      [200, 740],
      [-300, 740],
      [-300, 690],
      [-330, 600],
      [-400, 480],
    ],
  },
  { zone: 'university', name: 'Halcyon Science Park', poly: rect(200, 200, 740, 740) },
  {
    zone: 'suburb',
    name: 'Northgate',
    poly: [
      [-300, 740],
      [1100, 740],
      [1100, 1100],
      [-120, 1100],
      [-120, 1010],
      [-200, 900],
      [-290, 830],
      [-300, 790],
    ],
  },
  { zone: 'suburb', name: 'Easter Green', poly: rect(740, 200, 1100, 740) },
  { zone: 'industrial', name: 'The Cinder Works', poly: rect(470, -405, 1100, 200) },
  { zone: 'harbor', name: 'The Docks', poly: rect(208, -1100, 1100, -405) },
  { zone: 'boardwalk', name: 'The Boardwalk', poly: rect(-1100, -802, -385, -405) },
  { zone: 'suburb', name: 'Bellhaven', poly: rect(-1100, -405, -740, 200) },
];

// ---------------------------------------------------------------------------------------------
// Patches: the procedural part is told what to grow where
// ---------------------------------------------------------------------------------------------

/** A street lattice: lines at the given offsets along two axes, bent and thinned by the options. */
export interface LatticeSpec {
  type: 'lattice';
  origin: Pt;
  /** Direction of the u axis, [east, north] (any length). The v axis is u turned a quarter left. */
  u: Pt;
  /** Offsets of the v-lines along u, and of the u-lines along v, meters. */
  us: readonly number[];
  vs: readonly number[];
  /** Largest random shift of a crossing, meters. */
  jitter?: number;
  /** Curving: each crossing drifts sideways from the one before it by up to this much. */
  wave?: number;
  /** Chance that a piece of a u-line (along u) or of a v-line is left out. */
  dropU?: number;
  dropV?: number;
  width?: number;
  /** How far a line reaches beyond the lattice to meet an older street. */
  joinLen?: number;
  /** Chance that a long block gets a short dead-end close. */
  closes?: number;
  cars?: number;
}

/** Ring streets round a center with spokes between them (terraces, a garden suburb). */
export interface PolarSpec {
  type: 'polar';
  center: Pt;
  rings: ReadonlyArray<{
    r: number;
    /** Crossings round the ring: 8, 16 or 32. */
    n: number;
    /** Spokes outward from this ring to the next: every how many of this ring's crossings, and from which. */
    spokeEvery: number;
    spokeFrom?: number;
  }>;
  /** Chance that a piece of ring is left out. */
  dropRing?: number;
  width?: number;
  joinLen?: number;
  cars?: number;
}

export interface PatchSpec {
  name: string;
  /** Rectangle [east0, north0, east1, north1] or polygon the patch covers. */
  rect?: readonly [number, number, number, number];
  poly?: readonly Pt[];
  palette: PaletteId;
  streets?: LatticeSpec | PolarSpec;
  infill?: InfillId;
  /** Multiplies the palette's chance that a lot is built (the knob that balances neighborhoods). */
  keep?: number;
  /** Multiplies the palette's side gaps between neighbors. */
  gap?: number;
  /** Added to the "how close to downtown" measure (0 far, 1 near) that blends a palette's weights. */
  near?: number;
  /** Terraces: after this many buildings in a row leave a garden gap of `rowGap` meters. */
  rowEvery?: number;
  rowGap?: number;
  /** Kiosks per 100 m of street. */
  kiosks?: number;
  /** Multiplies the parked cars on the streets here. */
  cars?: number;
  /** A starting neighborhood: nothing taller than a house or shop is allowed here. */
  lowRise?: boolean;
}

const EAST: Pt = [1, 0];

/** Earlier patches win where two overlap. */
export const PATCHES: readonly PatchSpec[] = [
  // --- High streets in the gaps between the starting neighborhoods (they take their streets from
  // the neighborhood patterns below, and bring mid-rise blocks into each stage 2 square) -----------
  { name: 'Pilgrims Rise', rect: [-1056, 518, -744, 732], palette: 'monastery', kiosks: 0.6, keep: 1.087 },
  { name: 'Shore Hotels', rect: [-726, -500, -450, -419], palette: 'hotels', kiosks: 1, keep: 1.333 },
  { name: 'Bay Hotels', rect: [-575, -770, -440, -500], palette: 'hotels', kiosks: 1, keep: 1.333 },
  { name: 'Bellhaven High Street', rect: [-1056, -46, -760, 136], palette: 'highStreet', kiosks: 1, keep: 0.867 },
  { name: 'Mast Quarter', rect: [432, 752, 730, 1056], palette: 'highStreet', kiosks: 0.8, keep: 1.111 },
  { name: 'Easter Rise', rect: [750, 574, 1056, 730], palette: 'highStreet', kiosks: 0.8, keep: 1.111 },
  { name: 'Chandlers Row', rect: [744, -536, 1056, -419], palette: 'highStreet', kiosks: 0.8, keep: 1.111 },
  // --- The inner ring: dense mid-rise quarters right against the ring boulevard, in the corner of
  // every stage 2 square nearest downtown. They draw the juvenile toward the towers. ---------------
  { name: 'Wendside', rect: [-372, 204, -206, 624], palette: 'riverside', kiosks: 0.6, keep: 1.111 },
  { name: 'Halcyon Gate', rect: [214, 214, 470, 460], palette: 'riverside', kiosks: 0.6, keep: 0.685 },
  { name: 'Customs Quarter', rect: [268, -560, 470, -419], palette: 'riverside', kiosks: 0.6, keep: 1.111 },

  // --- The ten starting neighborhoods (the frame) ------------------------------------------------
  {
    name: 'Alder Row',
    rect: [-1056, 736, -736, 1056],
    palette: 'suburb',
    infill: 'backyards',
    lowRise: true,
    keep: 1.22,
    gap: 0.8,
    cars: 2.6,
    kiosks: 0.5,
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [-1020, -962, -878, -796], vs: [796, 878, 962, 1024], jitter: 5, wave: 10, closes: 0.5 },
  },
  {
    name: 'Bellhaven',
    rect: [-1056, -391, -736, 186],
    palette: 'oldSuburb',
    lowRise: true,
    keep: 1.063,
    gap: 1,
    cars: 1,
    kiosks: 0.6,
    streets: {
      type: 'lattice',
      origin: [0, 0],
      u: EAST,
      us: [-1012, -978, -862, -800],
      vs: [-352, -298, -182, -112, -42, 28, 98, 152],
      jitter: 3,
      dropU: 0.1,
      dropV: 0.3,
    },
  },
  {
    name: 'Cinder Flats',
    rect: [736, -391, 1056, -84],
    palette: 'workerRows',
    lowRise: true,
    keep: 0.583,
    gap: 1,
    cars: 1,
    kiosks: 0.6,
    rowEvery: 3,
    rowGap: 36,
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [806, 878, 962], vs: [-352, -277, -193, -130], jitter: 1.5, dropV: 0.4 },
  },
  {
    name: 'Dovecote',
    rect: [-736, 736, -130, 1056],
    palette: 'suburb',
    infill: 'backyards',
    lowRise: true,
    keep: 1.218,
    gap: 0.8,
    cars: 1.7,
    kiosks: 0.5,
    streets: {
      type: 'lattice',
      origin: [0, 0],
      u: [1, 0.05],
      us: [-682, -588, -494, -410, -326],
      vs: [796, 874, 966, 1026],
      jitter: 7,
      wave: 6,
      dropU: 0.05,
      dropV: 0.1,
      closes: 0.3,
    },
  },
  {
    name: 'Easter Green',
    rect: [736, 214, 1056, 736],
    palette: 'gardenSuburb',
    infill: 'backyards',
    lowRise: true,
    keep: 1.176,
    gap: 0.8,
    cars: 2.35,
    kiosks: 0.5,
    streets: {
      type: 'polar',
      center: [920, 380],
      rings: [
        { r: 62, n: 8, spokeEvery: 2 },
        { r: 128, n: 16, spokeEvery: 2, spokeFrom: 1 },
        { r: 196, n: 32, spokeEvery: 4 },
        { r: 264, n: 32, spokeEvery: 4, spokeFrom: 2 },
        { r: 332, n: 32, spokeEvery: 8 },
      ],
      joinLen: 100,
    },
  },
  {
    name: 'Fennel Hill',
    rect: [-1056, 186, -736, 736],
    palette: 'templeSlope',
    infill: 'backyards',
    lowRise: true,
    keep: 1.087,
    gap: 0.8,
    cars: 1,
    kiosks: 0.5,
  },
  {
    name: 'Gull Point',
    rect: [736, -1056, 1056, -419],
    palette: 'harborVillage',
    lowRise: true,
    keep: 0.955,
    gap: 1.2,
    cars: 1,
    kiosks: 0.7,
    streets: {
      type: 'lattice',
      origin: [770, -1040],
      u: [1, 0.28],
      us: [-20, 44, 108, 172, 236, 300],
      vs: [-70, -10, 50, 110, 170, 230, 290, 350, 410, 470, 530, 590],
      jitter: 11,
      dropU: 0.18,
      dropV: 0.22,
      width: 10,
    },
  },
  {
    name: 'Harrow Lane',
    rect: [736, 736, 1056, 1056],
    palette: 'suburb',
    infill: 'backyards',
    lowRise: true,
    keep: 1.22,
    gap: 0.8,
    cars: 2.6,
    kiosks: 0.5,
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [800, 884, 968, 1026], vs: [806, 890, 974, 1030], jitter: 6, wave: 12, closes: 0.5 },
  },
  {
    name: 'Ivy Court',
    rect: [-260, 736, 736, 1056],
    palette: 'rowhouses',
    lowRise: true,
    keep: 0.619,
    gap: 1,
    cars: 1,
    kiosks: 0.7,
    rowEvery: 3,
    rowGap: 36,
    streets: {
      type: 'lattice',
      origin: [0, 0],
      u: EAST,
      us: [-180, -96, 104, 198, 282, 400, 478, 700],
      vs: [878, 962, 1030],
      jitter: 2,
      dropV: 0.25,
      dropU: 0.08,
    },
  },
  {
    name: 'Juniper Bay',
    rect: [-1056, -770, -736, -419],
    palette: 'beachVillage',
    lowRise: true,
    keep: 0.822,
    gap: 1,
    cars: 1,
    kiosks: 0.9,
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [-1010, -962, -878, -800], vs: [-718, -642, -558, -480], jitter: 3, dropV: 0.2 },
  },

  // --- Downtown --------------------------------------------------------------------------------
  { name: 'Station Row', rect: [-186, 212, 186, 300], palette: 'station', keep: 0.551 },
  { name: 'Bayfront', rect: [-186, -392, 186, -262], palette: 'bayfront' },
  { name: 'The Core', rect: [-186, -262, 186, 186], palette: 'core' },
  {
    name: 'Eastside',
    rect: [214, -391, 456, 186],
    palette: 'eastside',
    keep: 0.5,
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [335], vs: [-250, -160, 20, 110], joinLen: 175 },
  },

  // --- West bank ---------------------------------------------------------------------------------
  {
    name: 'Old Town',
    rect: [-726, -391, -436, 186],
    palette: 'oldtown',
    keep: 1.018,
    near: 0.8,
    infill: 'courts',
    kiosks: 0.8,
    streets: {
      type: 'lattice',
      origin: [-700, -366],
      u: [1, 0.11],
      us: [0, 70, 140, 210, 280],
      vs: [0, 72, 144, 216, 288, 360, 432, 504],
      jitter: 17,
      dropU: 0.15,
      dropV: 0.15,
      width: 10,
      joinLen: 90,
    },
  },
  {
    name: 'Temple Hill',
    poly: [
      [-1056, 214],
      [-430, 214],
      [-430, 500],
      [-360, 620],
      [-340, 726],
      [-1056, 726],
    ],
    palette: 'temple',
    keep: 1.087,
    near: 0.5,
    infill: 'cloisters',
    kiosks: 0.4,
    streets: {
      type: 'polar',
      center: [-590, 460],
      rings: [
        { r: 70, n: 8, spokeEvery: 2 },
        { r: 135, n: 16, spokeEvery: 2, spokeFrom: 1 },
        { r: 200, n: 16, spokeEvery: 2 },
        { r: 265, n: 32, spokeEvery: 4, spokeFrom: 2 },
        { r: 330, n: 32, spokeEvery: 4 },
        { r: 395, n: 32, spokeEvery: 4, spokeFrom: 2 },
        { r: 460, n: 32, spokeEvery: 4 },
      ],
      dropRing: 0.06,
      joinLen: 140,
    },
  },
  { name: 'Fairground', rect: [-726, -762, -440, -419], palette: 'fairground', kiosks: 1.6, keep: 1.333 },

  // --- North: the university and the science park ---------------------------------------------------
  {
    name: 'University',
    rect: [-370, 304, 186, 726],
    palette: 'campus',
    keep: 0.717,
    infill: 'campus',
    kiosks: 0.6,
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [-282, -178, 96], vs: [300, 385, 552, 646], joinLen: 200 },
  },
  {
    name: 'Halcyon Science Park',
    rect: [214, 214, 726, 726],
    palette: 'science',
    keep: 1.25,
    infill: 'science',
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [335, 605], vs: [335, 650], joinLen: 290 },
  },

  // --- East: the works and the docks ----------------------------------------------------------------
  {
    name: 'Kiln Point',
    rect: [754, -56, 1056, 186],
    palette: 'industrial',
    keep: 0.5,
    infill: 'tankFarm',
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [806], vs: [0, 138], joinLen: 120 },
  },
  {
    name: 'The Cinder Works',
    rect: [484, -391, 726, 186],
    palette: 'industrial',
    keep: 0.693,
    infill: 'yards',
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [605], vs: [-320, -170, 65], joinLen: 150 },
  },
  { name: 'The Quay', rect: [210, -1056, 252, -419], palette: 'quay', keep: 1.111 },
  {
    name: 'The Docks',
    rect: [268, -1056, 726, -419],
    palette: 'docks',
    keep: 1.25,
    infill: 'docks',
    streets: { type: 'lattice', origin: [0, 0], u: EAST, us: [420, 580], vs: [-940, -600], joinLen: 170 },
  },
];
