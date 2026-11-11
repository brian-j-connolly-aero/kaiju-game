/** Prop kind definitions: the small breakables listed in ASSETS.md section 3. */

import type { PropKindDef, PropKindId } from './types';

export const PROP_KINDS: Readonly<Record<PropKindId, PropKindDef>> = {
  car_sedan: { id: 'car_sedan', radius: 2.2, height: 1.5, value: 2, tally: 'car', grabbable: true, edible: true, leavesWreck: true },
  car_taxi: { id: 'car_taxi', radius: 2.2, height: 1.6, value: 2, tally: 'car', grabbable: true, edible: true, leavesWreck: true },
  car_van: { id: 'car_van', radius: 2.5, height: 2.2, value: 3, tally: 'car', grabbable: true, edible: true, leavesWreck: true },
  bus: { id: 'bus', radius: 4.5, height: 3.2, value: 6, tally: 'car', grabbable: true, edible: true, leavesWreck: true },
  truck: { id: 'truck', radius: 4, height: 3.3, value: 5, tally: 'car', grabbable: true, edible: true, leavesWreck: true },
  kiosk: { id: 'kiosk', radius: 2, height: 3, value: 4, tally: 'kiosk', grabbable: false, edible: true, leavesWreck: false },
  tree_a: { id: 'tree_a', radius: 1.5, height: 7, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false },
  tree_b: { id: 'tree_b', radius: 1.8, height: 9, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false },
  lamp: { id: 'lamp', radius: 0.4, height: 6, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false },
  trafficlight: { id: 'trafficlight', radius: 0.4, height: 5, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false },
  bench: { id: 'bench', radius: 1, height: 1, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false },
  hydrant: { id: 'hydrant', radius: 0.4, height: 0.9, value: 0, tally: null, grabbable: false, edible: false, leavesWreck: false },
  billboard: { id: 'billboard', radius: 2.5, height: 9, value: 1, tally: null, grabbable: false, edible: false, leavesWreck: false },
  busstop: { id: 'busstop', radius: 2, height: 2.8, value: 1, tally: null, grabbable: false, edible: false, leavesWreck: false },
};

export function propKindDef(id: PropKindId): PropKindDef {
  return PROP_KINDS[id];
}
