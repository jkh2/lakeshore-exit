import type { Light } from "./types";

export const FT_PER_M = 3.280839895;
export const MPH_PER_MPS = 2.236936292;

export const DECISION_FT = 4500;
export const PULL_NOW_FT = 3000;
export const HARD_DECK_FT = 2000;
export const MIN_EXIT_FT = 8000;
export const MAX_EXIT_FT = 20000;
export const DEFAULT_EXIT_FT = 12500;
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
