export type Phase =
  | "menu"
  | "cabin"
  | "freefall"
  | "deploying"
  | "malfunction"
  | "canopy"
  | "down"
  | "impact";

export type Outcome = {
  kind: "landed" | "water" | "impact";
  distanceM: number;
  usedReserve: boolean;
  redLight: boolean;
  intoWind: boolean;
  hot: boolean;
  onBeach: boolean;
  log: string[];
  reason: string;
};

export type Save = {
  v: 1;
  bestM: number | null;
  jumps: number;
  rides: number;
  altitudeFt: number;
  malPct: number;
};

export type Bridge = {
  altitudeFt: number;
  malChance: number;
  muted: boolean;
  command: "start" | "again" | null;
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  pull: boolean;
  cut: boolean;
  reserve: boolean;
  flare: boolean;
};

export type Hud = {
  phase: Phase;
  altitudeFt: number;
  fallMph: number;
  groundMph: number;
  compassDeg: number;
  banner: string;
  bannerLevel: 0 | 1 | 2 | 3;
  pose: string;
  green: boolean;
  inDoor: boolean;
  prompt: string;
  spot: string;
  doorU: number;
  doorV: number;
  doorVisible: boolean;
  /** Screen position of the base during formation freefall, 0..1 like the door marker. */
  baseU: number;
  baseV: number;
  baseVisible: boolean;
  baseLabel: string;
  dzRel: number;
  dzDist: number;
  dzVisible: boolean;
  outcome: Outcome | null;
  canopy: "none" | "main" | "reserve";
  needsLook: boolean;
  save: Pick<Save, "bestM" | "jumps" | "rides">;
};

export function createBridge(): Bridge {
  return {
    altitudeFt: 12500,
    malChance: 0.15,
    muted: false,
    command: null,
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    jump: false,
    pull: false,
    cut: false,
    reserve: false,
    flare: false,
  };
}
