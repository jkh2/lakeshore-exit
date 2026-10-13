import { DEFAULT_EXIT_FT, DEFAULT_MAL_PCT, SAVE_KEY, isLight, isPadId } from "./constants";
import type { Save } from "./types";

export function defaultSave(): Save {
  return {
    v: 1,
    bestM: null,
    bestScore: null,
    jumps: 0,
    rides: 0,
    altitudeFt: DEFAULT_EXIT_FT,
    malPct: DEFAULT_MAL_PCT,
    light: "day",
    ride: "plane",
    roof: "southloop",
    suit: "rig",
  };
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<Save>;
    if (!parsed || parsed.v !== 1) return defaultSave();
    const base = defaultSave();
    return {
      v: 1,
      bestM: typeof parsed.bestM === "number" ? parsed.bestM : null,
      bestScore: typeof parsed.bestScore === "number" ? parsed.bestScore : null,
      jumps: typeof parsed.jumps === "number" ? parsed.jumps : 0,
      rides: typeof parsed.rides === "number" ? parsed.rides : 0,
      altitudeFt:
        typeof parsed.altitudeFt === "number" ? parsed.altitudeFt : base.altitudeFt,
      malPct: typeof parsed.malPct === "number" ? parsed.malPct : base.malPct,
      light: isLight(parsed.light) ? parsed.light : base.light,
      ride: parsed.ride === "roof" ? "roof" : "plane",
      roof: isPadId(parsed.roof) ? parsed.roof : base.roof,
      suit: parsed.suit === "wing" ? "wing" : "rig",
    };
  } catch {
    return defaultSave();
  }
}

export function writeSave(save: Save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* private mode */
  }
}
