/**
 * Building mixes for Port Meridian. A palette says which archetypes line a street in one kind
 * of neighborhood, how far they sit back from it and how close together; an infill fills the
 * yards behind (factories, campus halls, container stacks). Weights have a `far` and a `near`
 * value: the generator blends them by how close the lot is to downtown, which gives the height
 * gradient toward the center.
 */

export interface PaletteItem {
  /** Archetype id. */
  a: string;
  /** Weight far from downtown. */
  far: number;
  /** Weight close to downtown (defaults to `far`). */
  near?: number;
}

export interface Palette {
  items: readonly PaletteItem[];
  /** Front garden or forecourt: meters added to the minimum distance from the street. */
  setback: number;
  /** Smallest and largest side gap between neighbors. */
  gap: readonly [number, number];
  /** Chance that a lot gets a building. */
  keep: number;
  /** After this many buildings in a row an alley is left (0: never). */
  alleyEvery: number;
  /** Width of that alley, meters. */
  alley: number;
}

export type PaletteId =
  | 'core'
  | 'bayfront'
  | 'station'
  | 'eastside'
  | 'oldtown'
  | 'highStreet'
  | 'hotels'
  | 'riverside'
  | 'monastery'
  | 'temple'
  | 'templeSlope'
  | 'suburb'
  | 'gardenSuburb'
  | 'oldSuburb'
  | 'rowhouses'
  | 'workerRows'
  | 'campus'
  | 'science'
  | 'industrial'
  | 'docks'
  | 'quay'
  | 'harborVillage'
  | 'boardwalk'
  | 'beachVillage'
  | 'fairground';

export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  // The tower cluster. The generator overrides the pick near the very center (tallest there).
  core: {
    items: [
      { a: 'tower_c', far: 0.5, near: 4 },
      { a: 'tower_b', far: 1.2, near: 4 },
      { a: 'tower_a', far: 3.5, near: 3 },
      { a: 'office_c', far: 4, near: 1.5 },
      { a: 'office_b', far: 3.5, near: 1 },
    ],
    setback: 0.5,
    gap: [5, 9],
    keep: 1,
    alleyEvery: 0,
    alley: 0,
  },
  bayfront: {
    items: [
      { a: 'tower_a', far: 1.5 },
      { a: 'office_c', far: 3 },
      { a: 'office_b', far: 3 },
      { a: 'apartment_c', far: 2 },
    ],
    setback: 1,
    gap: [5, 9],
    keep: 1,
    alleyEvery: 0,
    alley: 0,
  },
  station: {
    items: [
      { a: 'office_a', far: 3 },
      { a: 'office_b', far: 2 },
      { a: 'apartment_c', far: 2 },
      { a: 'shop_c', far: 1.5 },
    ],
    setback: 0.5,
    gap: [3, 6],
    keep: 0.8,
    alleyEvery: 0,
    alley: 0,
  },
  eastside: {
    items: [
      { a: 'shop_c', far: 3, near: 1.5 },
      { a: 'shop_b', far: 3, near: 0 },
      { a: 'rowhouse_a', far: 3, near: 0 },
      { a: 'apartment_a', far: 2, near: 1.5 },
      { a: 'apartment_b', far: 0.5, near: 3 },
      { a: 'apartment_c', far: 0, near: 3 },
      { a: 'office_a', far: 0, near: 3 },
      { a: 'office_b', far: 0, near: 1.5 },
    ],
    setback: 0.5,
    gap: [3, 7],
    keep: 0.9,
    alleyEvery: 0,
    alley: 0,
  },
  // Crooked streets: near-continuous rows of narrow fronts, an alley every few houses.
  oldtown: {
    items: [
      { a: 'rowhouse_a', far: 5, near: 2 },
      { a: 'shop_b', far: 2.5, near: 1.5 },
      { a: 'shop_c', far: 1.5, near: 2.5 },
      { a: 'house_a', far: 1, near: 0 },
      { a: 'shop_a', far: 0.8, near: 0 },
      { a: 'apartment_a', far: 0.6, near: 4.5 },
      { a: 'apartment_b', far: 0, near: 3 },
      { a: 'apartment_c', far: 0, near: 1.5 },
    ],
    setback: 0,
    gap: [0.75, 1.5],
    keep: 0.96,
    alleyEvery: 4,
    alley: 6,
  },
  // A neighborhood high street: walk-up flats over shops, in the gaps between the starting neighborhoods.
  highStreet: {
    items: [
      { a: 'apartment_a', far: 3.5 },
      { a: 'apartment_b', far: 1 },
      { a: 'shop_c', far: 2.5 },
      { a: 'shop_b', far: 2 },
      { a: 'rowhouse_a', far: 2 },
    ],
    setback: 0.5,
    gap: [2, 6],
    keep: 0.9,
    alleyEvery: 3,
    alley: 7,
  },
  // Mansion blocks and offices on the inner ring, next to the towers: Wendside and Halcyon Gate.
  riverside: {
    items: [
      { a: 'office_b', far: 2 },
      { a: 'office_a', far: 3 },
      { a: 'apartment_c', far: 3 },
      { a: 'apartment_b', far: 2.5 },
      { a: 'shop_c', far: 1 },
    ],
    setback: 0.5,
    gap: [3, 7],
    keep: 0.9,
    alleyEvery: 0,
    alley: 0,
  },
  // Seaside hotels along Shore Road, facing the stadium and the bay.
  hotels: {
    items: [
      { a: 'apartment_b', far: 3 },
      { a: 'apartment_c', far: 2.5 },
      { a: 'shop_c', far: 1.5 },
      { a: 'pavilion_a', far: 1 },
    ],
    setback: 1,
    gap: [4, 9],
    keep: 0.75,
    alleyEvery: 0,
    alley: 0,
  },
  // Pilgrims Rise, the north-west slope of Temple Hill: big cloisters and hostels.
  monastery: {
    items: [
      { a: 'campus_a', far: 4 },
      { a: 'apartment_a', far: 4 },
      { a: 'apartment_b', far: 2 },
      { a: 'shrine_a', far: 1.5 },
    ],
    setback: 1.5,
    gap: [3, 7],
    keep: 0.92,
    alleyEvery: 3,
    alley: 6,
  },
  // The top of Temple Hill: cloisters, pilgrim halls and shrines among trees.
  temple: {
    items: [
      { a: 'shrine_a', far: 3, near: 2 },
      { a: 'house_b', far: 3, near: 0.5 },
      { a: 'rowhouse_a', far: 2, near: 0.5 },
      { a: 'campus_a', far: 1.2, near: 3.5 },
      { a: 'apartment_a', far: 1, near: 4.5 },
      { a: 'apartment_b', far: 0, near: 1.2 },
      { a: 'shop_b', far: 1, near: 1 },
    ],
    setback: 1.5,
    gap: [3, 7],
    keep: 0.92,
    alleyEvery: 3,
    alley: 6,
  },
  // The terraces on its western slope, where a match can start.
  templeSlope: {
    items: [
      { a: 'house_b', far: 6 },
      { a: 'house_a', far: 2 },
      { a: 'shrine_a', far: 1.2 },
      { a: 'shop_a', far: 1 },
    ],
    setback: 2,
    gap: [4, 8],
    keep: 0.8,
    alleyEvery: 4,
    alley: 6,
  },
  suburb: {
    items: [
      { a: 'house_a', far: 4 },
      { a: 'house_b', far: 4 },
      { a: 'house_c', far: 3 },
      { a: 'shop_a', far: 0.8 },
    ],
    setback: 3,
    gap: [5, 9],
    keep: 0.82,
    alleyEvery: 0,
    alley: 0,
  },
  gardenSuburb: {
    items: [
      { a: 'house_b', far: 5 },
      { a: 'house_a', far: 3 },
      { a: 'shop_a', far: 0.7 },
    ],
    setback: 4,
    gap: [6, 10],
    keep: 0.85,
    alleyEvery: 0,
    alley: 0,
  },
  oldSuburb: {
    items: [
      { a: 'house_a', far: 5 },
      { a: 'house_c', far: 3 },
      { a: 'rowhouse_a', far: 1.5 },
      { a: 'shop_a', far: 1.2 },
      { a: 'shop_b', far: 0.5 },
    ],
    setback: 2,
    gap: [3.5, 7],
    keep: 0.84,
    alleyEvery: 5,
    alley: 6,
  },
  // University quarter: tight rows of tall narrow houses.
  rowhouses: {
    items: [
      { a: 'rowhouse_a', far: 7 },
      { a: 'house_c', far: 1.5 },
      { a: 'shop_a', far: 1 },
      { a: 'shop_b', far: 0.7 },
    ],
    setback: 0.5,
    gap: [0.75, 1.25],
    keep: 0.9,
    alleyEvery: 5,
    alley: 6.5,
  },
  // Mill workers' terraces by the factories.
  workerRows: {
    items: [
      { a: 'rowhouse_a', far: 5 },
      { a: 'house_c', far: 4 },
      { a: 'shop_a', far: 1.2 },
    ],
    setback: 0,
    gap: [0.75, 1.5],
    keep: 0.88,
    alleyEvery: 6,
    alley: 6.5,
  },
  campus: {
    items: [
      { a: 'campus_a', far: 2.5, near: 4 },
      { a: 'rowhouse_a', far: 3, near: 0.5 },
      { a: 'shop_b', far: 2, near: 1 },
      { a: 'apartment_a', far: 1.5, near: 3.5 },
      { a: 'office_a', far: 0.3, near: 3 },
      { a: 'apartment_b', far: 0, near: 1 },
    ],
    setback: 3,
    gap: [6, 12],
    keep: 0.8,
    alleyEvery: 0,
    alley: 0,
  },
  science: {
    items: [
      { a: 'campus_a', far: 2, near: 2.5 },
      { a: 'factory_a', far: 1.5, near: 0.3 },
      { a: 'shop_b', far: 1.5, near: 0.5 },
      { a: 'office_a', far: 1, near: 4 },
      { a: 'apartment_a', far: 1, near: 2 },
      { a: 'apartment_b', far: 0, near: 2 },
    ],
    setback: 4,
    gap: [8, 14],
    keep: 0.8,
    alleyEvery: 0,
    alley: 0,
  },
  industrial: {
    items: [
      { a: 'factory_b', far: 2.5 },
      { a: 'factory_a', far: 4 },
      { a: 'warehouse_a', far: 1 },
      { a: 'tank_a', far: 1.5 },
      { a: 'shop_b', far: 1 },
    ],
    setback: 4,
    gap: [10, 20],
    keep: 0.62,
    alleyEvery: 0,
    alley: 0,
  },
  docks: {
    items: [
      { a: 'warehouse_a', far: 2 },
      { a: 'factory_a', far: 3 },
      { a: 'container_a', far: 3 },
      { a: 'tank_a', far: 1.5 },
      { a: 'apartment_c', far: 0.6 },
      { a: 'shop_b', far: 0.8 },
    ],
    setback: 4,
    gap: [6, 14],
    keep: 0.8,
    alleyEvery: 0,
    alley: 0,
  },
  // The quay apron: a line of gantry cranes with stacks between them.
  quay: {
    items: [
      { a: 'crane_a', far: 5 },
      { a: 'container_a', far: 1.5 },
    ],
    setback: 0,
    gap: [10, 18],
    keep: 0.9,
    alleyEvery: 0,
    alley: 0,
  },
  harborVillage: {
    items: [
      { a: 'house_c', far: 6 },
      { a: 'house_a', far: 2.5 },
      { a: 'shop_a', far: 1.3 },
      { a: 'shop_b', far: 0.6 },
    ],
    setback: 0.5,
    gap: [2.5, 6],
    keep: 0.86,
    alleyEvery: 4,
    alley: 6,
  },
  boardwalk: {
    items: [
      { a: 'pavilion_a', far: 4 },
      { a: 'shop_a', far: 3 },
      { a: 'apartment_b', far: 1.6 },
      { a: 'house_c', far: 1.5 },
      { a: 'shop_c', far: 1 },
    ],
    setback: 1,
    gap: [3, 8],
    keep: 0.85,
    alleyEvery: 4,
    alley: 6,
  },
  beachVillage: {
    items: [
      { a: 'house_c', far: 6 },
      { a: 'house_a', far: 2 },
      { a: 'pavilion_a', far: 1.4 },
      { a: 'shop_a', far: 1.2 },
    ],
    setback: 1.5,
    gap: [3.5, 7],
    keep: 0.85,
    alleyEvery: 5,
    alley: 6,
  },
  fairground: {
    items: [
      { a: 'pavilion_a', far: 5 },
      { a: 'shop_a', far: 2 },
      { a: 'shop_b', far: 1 },
      { a: 'apartment_b', far: 2 },
      { a: 'apartment_c', far: 1.2 },
    ],
    setback: 2,
    gap: [5, 12],
    keep: 0.75,
    alleyEvery: 0,
    alley: 0,
  },
};

/** Buildings scattered in the yards behind the street fronts. */
export interface Infill {
  items: readonly PaletteItem[];
  /** Spacing of the candidate spots, meters. */
  step: number;
  /** Chance that a free spot is used. */
  keep: number;
  /** Least distance from any street edge, meters. */
  offStreet: number;
  /** Least gap to other buildings, meters. */
  gap: number;
  /** The yards fill up toward downtown and thin out toward the edge of town (campuses), or are the same everywhere (works). */
  gradient: boolean;
}

export type InfillId = 'yards' | 'docks' | 'campus' | 'science' | 'tankFarm' | 'towers' | 'cloisters' | 'courts' | 'backyards';

export const INFILLS: Readonly<Record<InfillId, Infill>> = {
  yards: {
    items: [
      { a: 'factory_a', far: 3 },
      { a: 'warehouse_a', far: 1 },
      { a: 'tank_a', far: 3 },
      { a: 'factory_b', far: 1.5 },
    ],
    step: 46,
    keep: 0.4,
    offStreet: 8,
    gap: 9,
    gradient: false,
  },
  docks: {
    items: [
      { a: 'container_a', far: 6 },
      { a: 'warehouse_a', far: 1.5 },
      { a: 'tank_a', far: 2 },
      { a: 'factory_a', far: 1.5 },
    ],
    step: 32,
    keep: 0.8,
    offStreet: 7,
    gap: 7,
    gradient: false,
  },
  campus: {
    items: [
      { a: 'campus_a', far: 4, near: 4 },
      { a: 'apartment_a', far: 0.5, near: 2.5 },
      { a: 'office_a', far: 0, near: 2 },
    ],
    step: 52,
    keep: 0.42,
    offStreet: 9,
    gap: 12,
    gradient: true,
  },
  science: {
    items: [
      { a: 'campus_a', far: 3, near: 2 },
      { a: 'factory_a', far: 2, near: 0.5 },
      { a: 'tank_a', far: 1, near: 0 },
      { a: 'office_a', far: 0.5, near: 4 },
    ],
    step: 56,
    keep: 0.4,
    offStreet: 9,
    gap: 12,
    gradient: true,
  },
  cloisters: {
    items: [
      { a: 'campus_a', far: 1, near: 3 },
      { a: 'apartment_a', far: 0.5, near: 2 },
      { a: 'shrine_a', far: 3, near: 2 },
    ],
    step: 38,
    keep: 0.9,
    offStreet: 7,
    gap: 7,
    gradient: true,
  },
  // Suburbs: a cottage or two in the long back gardens, with room to slip between.
  backyards: {
    items: [
      { a: 'house_c', far: 3 },
      { a: 'house_a', far: 1 },
    ],
    step: 21,
    keep: 0.6,
    offStreet: 3,
    gap: 6.5,
    gradient: false,
  },
  // Old Town: small houses and workshops in the courts behind the street fronts.
  courts: {
    items: [
      { a: 'rowhouse_a', far: 3 },
      { a: 'house_a', far: 2 },
      { a: 'shop_b', far: 1 },
      { a: 'shrine_a', far: 0.4 },
    ],
    step: 24,
    keep: 0.38,
    offStreet: 3,
    gap: 5.5,
    gradient: false,
  },
  tankFarm: {
    items: [{ a: 'tank_a', far: 1 }],
    step: 30,
    keep: 0.5,
    offStreet: 8,
    gap: 8,
    gradient: false,
  },
  towers: {
    items: [
      { a: 'tower_a', far: 2 },
      { a: 'office_c', far: 2 },
      { a: 'office_b', far: 2 },
    ],
    step: 40,
    keep: 0.8,
    offStreet: 6,
    gap: 8,
    gradient: false,
  },
};
