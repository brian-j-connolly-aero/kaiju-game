/** Prop kind definitions: the small breakables listed in ASSETS.md section 3. */

import type { PropKindDef, PropKindId } from './types';

/** A city weapon (DESIGN.md section 4, "The city as a weapon"): grabbable while the kaiju is small, never edible, worth nothing to the bar. */
function weapon(id: PropKindId, radius: number, height: number): PropKindDef {
  return { id, radius, height, value: 0, tally: null, grabbable: true, edible: false, leavesWreck: false, cityWeapon: true };
}

export const PROP_KINDS: Readonly<Record<PropKindId, PropKindDef>> = {
  car_sedan: { id: 'car_sedan', radius: 2.2, height: 1.5, value: 2, tally: 'car', grabbable: true, edible: true, leavesWreck: true, cityWeapon: false },
  car_taxi: { id: 'car_taxi', radius: 2.2, height: 1.6, value: 2, tally: 'car', grabbable: true, edible: true, leavesWreck: true, cityWeapon: false },
  car_van: { id: 'car_van', radius: 2.5, height: 2.2, value: 3, tally: 'car', grabbable: true, edible: true, leavesWreck: true, cityWeapon: false },
  bus: { id: 'bus', radius: 4.5, height: 3.2, value: 6, tally: 'car', grabbable: true, edible: true, leavesWreck: true, cityWeapon: false },
  truck: { id: 'truck', radius: 4, height: 3.3, value: 5, tally: 'car', grabbable: true, edible: true, leavesWreck: true, cityWeapon: false },
  kiosk: { id: 'kiosk', radius: 2, height: 3, value: 4, tally: 'kiosk', grabbable: false, edible: true, leavesWreck: false, cityWeapon: false },
  tree_a: { id: 'tree_a', radius: 1.5, height: 7, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false, cityWeapon: false },
  tree_b: { id: 'tree_b', radius: 1.8, height: 9, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false, cityWeapon: false },
  lamp: { id: 'lamp', radius: 0.4, height: 6, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false, cityWeapon: false },
  trafficlight: { id: 'trafficlight', radius: 0.4, height: 5, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false, cityWeapon: false },
  bench: { id: 'bench', radius: 1, height: 1, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false, cityWeapon: false },
  hydrant: { id: 'hydrant', radius: 0.4, height: 0.9, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false, cityWeapon: false },
  billboard: { id: 'billboard', radius: 2.5, height: 9, value: 1, tally: null, grabbable: false, edible: false, leavesWreck: false, cityWeapon: false },
  busstop: { id: 'busstop', radius: 2, height: 2.8, value: 1, tally: null, grabbable: false, edible: false, leavesWreck: false, cityWeapon: false },
  // The city as a weapon. Sizes are the art contract (docs/ASSETS.md section 3): a propane tank
  // 2.4 m long and 1.3 m high, a water tank on short legs 3 m across and 4.5 m high, a television
  // antenna on its 7 m pole, a fast-food pole sign 7.5 m high, a roll-up garage door in its frame
  // 3.2 m wide and 2.8 m high, and the radio mast's 8 m top section lying on its side.
  propane: weapon('propane', 1.3, 1.3),
  watertank: weapon('watertank', 1.6, 4.5),
  antenna: weapon('antenna', 0.5, 7),
  foodsign: weapon('foodsign', 1.5, 7.5),
  garagedoor: weapon('garagedoor', 1.8, 2.8),
  mast: weapon('mast', 4, 1.5),
};

export function propKindDef(id: PropKindId): PropKindDef {
  return PROP_KINDS[id];
}
