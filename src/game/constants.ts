import type { Light, PadId, Ride } from "./types";

export const FT_PER_M = 3.280839895;
export const MPH_PER_MPS = 2.236936292;

export const DECISION_FT = 4500;
export const PULL_NOW_FT = 3000;
export const HARD_DECK_FT = 2000;
export const MIN_EXIT_FT = 8000;
export const MAX_EXIT_FT = 20000;
export const DEFAULT_EXIT_FT = 12500;
/** The helicopter and the balloon go up lower than the plane. */
export const HOP_MIN_FT = 5000;
export const HOP_MAX_FT = 14000;
export const DEFAULT_HOP_FT = 7500;
/** Rings off a helicopter or a balloon need this much sky for a course after the dead air. */
export const RINGS_HOP_MIN_FT = 8000;
/** The lowest flat ring, and the lowest wingsuit gate: a ring course always ends above the pull. */
export const RING_FLOOR_FT = 5000;
export const GATE_FLOOR_FT = 5500;
export const DEFAULT_MAL_PCT = 15;

export const DZ_X = 70;
export const DZ_Z = 0;
export const SHORE_X = 150;
export const RUN_X = DZ_X + 520;

export const WIND_X = -4.2;
export const WIND_Z = 0.35;

export const PLANE_MPS = 46;
/** The green light holds while the plane is within this many meters of the spot. */
export const GREEN_HALF = 280;
/** Seconds from boarding to the green light. */
export const GREEN_IN = 15;

export const SAVE_KEY = "lakeshore-exit-v1";

export const LIGHTS = ["day", "golden", "dusk"] as const satisfies readonly Light[];

export function isLight(v: unknown): v is Light {
  return typeof v === "string" && (LIGHTS as readonly string[]).includes(v);
}

export const RIDES = ["plane", "heli", "balloon", "roof"] as const satisfies readonly Ride[];

export function isRide(v: unknown): v is Ride {
  return typeof v === "string" && (RIDES as readonly string[]).includes(v);
}

/** BASE: the shortest drop worth jumping from a roof edge. */
export const MIN_BASE_M = 100;
/** BASE pull calls: pull at the first, now at the second, and below the third it is too late. */
export const BASE_PULL_FT = 600;
export const BASE_NOW_FT = 400;
export const BASE_HARD_FT = 250;

export type PadSpec = {
  id: PadId;
  name: string;
  /** Roof height, meters. */
  heightM: number;
  lat: number;
  lon: number;
  /** Where the mark sits from the tower's center, meters east and south. */
  dx: number;
  dz: number;
  /** The way you face when you arrive: toward an edge you can jump from. */
  yaw: number;
};

/** The marked rooftops: land on them under canopy, or start a BASE jump from one. */
export const PADS: readonly PadSpec[] = [
  {
    id: "southloop",
    name: "South Loop Tower",
    heightM: 274,
    lat: 41.8676,
    lon: -87.6243,
    dx: 0,
    dz: 0,
    yaw: -Math.PI / 2,
  },
  {
    id: "aqua",
    name: "Aqua",
    heightM: 262,
    lat: 41.8863,
    lon: -87.6198,
    dx: 0,
    dz: 0,
    yaw: -Math.PI / 2,
  },
  {
    id: "aon",
    name: "Aon Center",
    heightM: 346,
    lat: 41.8853,
    lon: -87.6215,
    dx: 0,
    dz: 0,
    yaw: -Math.PI / 2,
  },
  // The top two of Willis's nine tubes; its lower tubes crowd every side but the west.
  {
    id: "willis",
    name: "Willis Tower",
    heightM: 442,
    lat: 41.8789,
    lon: -87.6359,
    dx: -11.45,
    dz: 0,
    yaw: Math.PI / 2,
  },
];

export function padById(id: string): PadSpec {
  return PADS.find((p) => p.id === id) ?? PADS[0]!;
}

export function isPadId(v: unknown): v is PadId {
  return typeof v === "string" && PADS.some((p) => p.id === v);
}
