/**
 * City data types. The city is static data built identically on the server and on every client
 * from `generateCity(seed)`; nothing here goes over the wire. What changes during a match (the
 * hp of each structure, which props are still alive) lives in the World, indexed by these ids.
 */

import type { StructureClass, TallyClass } from '../defs/ids';
import type { Bounds, OrientedBox } from '../math/geom';
import type { Vec2 } from '../math/vec';

/** Side of the square city, meters. The city spans x, z in [-CITY_HALF, CITY_HALF]. */
export const CITY_SIZE = 2200;
export const CITY_HALF = CITY_SIZE / 2;
/** The one seed everybody builds Port Meridian from. The match seed is separate. */
export const CITY_SEED = 9001;

/** District flavors; archetypes carry the zones they belong in. */
export const ZONE_TAGS = [
  'downtown',
  'oldtown',
  'harbor',
  'industrial',
  'suburb',
  'university',
  'boardwalk',
  'temple',
] as const;
export type ZoneTag = (typeof ZONE_TAGS)[number];

/**
 * A destructible building. Its footprint is the OrientedBox it extends (center x, z; half
 * extents hx, hz along its local axes; yaw), so a Structure can be passed straight to the
 * geometry functions. It stands from the ground (y = 0) up to `height`.
 */
export interface Structure extends OrientedBox {
  /** Index into CityData.structures; also the id used in events and in the hp array. */
  id: number;
  /** Id of its ArchetypeDef; selects the model (`bld_<id>` or `lm_<id>`). */
  archetype: string;
  height: number;
  cls: StructureClass;
  /** Full hit points. Current hp lives in World.structureHp. */
  hp: number;
  /** Destruction bar points it is worth when completely destroyed. */
  value: number;
  /** Display name when this is a named landmark, otherwise null. */
  landmark: string | null;
  /** True for bridge decks: bodies walk over them instead of colliding. */
  passable: boolean;
}

export const PROP_KIND_IDS = [
  'car_sedan',
  'car_taxi',
  'car_van',
  'bus',
  'truck',
  'kiosk',
  'tree_a',
  'tree_b',
  'lamp',
  'trafficlight',
  'bench',
  'hydrant',
  'billboard',
  'busstop',
] as const;
/** Prop kinds; the model is `prop_<kind>` (ASSETS.md section 3). */
export type PropKindId = (typeof PROP_KIND_IDS)[number];

/** A small breakable. Props never block movement or shots; kaiju and vehicles crush them. */
export interface Prop {
  /** Index into CityData.props; also the bit index in World.propAlive. */
  id: number;
  kind: PropKindId;
  x: number;
  z: number;
  yaw: number;
}

export interface PropKindDef {
  id: PropKindId;
  /** Crush radius: a body whose circle reaches within this of the prop center crushes it. */
  radius: number;
  height: number;
  /** Destruction bar points for destroying it (0 for street furniture and trees). */
  value: number;
  /** End screen tally family, or null when it is not tallied. */
  tally: Extract<TallyClass, 'car' | 'kiosk'> | null;
  /** Whether a kaiju can pick it up and throw it. */
  grabbable: boolean;
  /** Whether a kaiju can eat it off the ground. */
  edible: boolean;
  /** Whether crushing it leaves a `prop_car_wreck` (which is grabbable). */
  leavesWreck: boolean;
}

export interface RoadNode {
  id: number;
  x: number;
  z: number;
}

export interface RoadEdge {
  id: number;
  /** Node ids at the two ends. */
  a: number;
  b: number;
  /** Full width of the roadway, meters. */
  width: number;
  kind: 'street' | 'avenue' | 'bridge';
  /** Structure id of the bridge deck that carries this edge, or -1. */
  bridge: number;
}

/** Street network: used by bots for routing, by the generator for props, by the client for the ground. */
export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export const AREA_KINDS = ['water', 'park', 'plaza'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

/** Open ground with no structures: water (wading), parks and plazas. A simple polygon. */
export interface Area {
  id: number;
  kind: AreaKind;
  name: string;
  polygon: Vec2[];
}

/** A named district, for flavor, map tinting and archetype choice. */
export interface District {
  id: number;
  zone: ZoneTag;
  name: string;
  polygon: Vec2[];
  /**
   * Optional building tint, 0xRRGGBB: the client may multiply the color of every building whose
   * center lies in this district by it (one instance color, no extra draw calls), so one light,
   * neutral model per archetype takes the district's color family. Absent means white (no tint).
   */
  tint?: number;
}

/** A low-rise spot where a match can start (stage 1 bounds are centered on one of these). */
export interface NeighborhoodAnchor {
  id: number;
  name: string;
  x: number;
  z: number;
}

export interface CityData {
  seed: number;
  /** Half the side of the square city; always CITY_HALF. */
  half: number;
  structures: Structure[];
  props: Prop[];
  roads: RoadGraph;
  areas: Area[];
  districts: District[];
  anchors: NeighborhoodAnchor[];
  /** Center of downtown; stage 2 bounds lean toward it. */
  downtown: Vec2;
}

/** Ground types stored in the city index raster. */
export const GROUND_KINDS = ['land', 'water', 'park', 'plaza'] as const;
export type GroundKind = (typeof GROUND_KINDS)[number];

export type { Bounds };
