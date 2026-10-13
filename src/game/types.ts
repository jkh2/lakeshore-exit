/** Time of day. */
export type Light = "day" | "golden" | "dusk";

/** How you get up there: the Twin Otter, or the stairs to a marked rooftop. */
export type Ride = "plane" | "roof";
export type PadId = "southloop" | "aqua" | "aon" | "willis";
/** A skydive from the plane, or a BASE jump off a roof. */
export type JumpMode = "skydive" | "base";
/** What you jump in: the standard rig, or a wingsuit that glides before the pull. */
export type Suit = "rig" | "wing";
/** Where a jump came down. */
export type Area = "beach" | "park" | "street" | "roof" | "water" | "none";

export type Phase =
  | "menu"
  | "cabin"
  | "roof"
  | "freefall"
  | "deploying"
  | "malfunction"
  | "canopy"
  | "down"
  | "impact";

export type ScoreItem = { label: string; pts: number; max: number; note: string };

export type JumpScore = {
  total: number;
  max: number;
  /** 0 to 3. */
  stars: number;
  items: ScoreItem[];
  /** Beat the saved best score on this jump. */
  newBest: boolean;
};

export type Outcome = {
  kind: "landed" | "water" | "impact";
  mode: JumpMode;
  suit: Suit;
  /** Wingsuit: meters flown over the ground from the exit to the pull. */
  flightM: number | null;
  /** Wingsuit: distance over height lost once the suit was flying, up to the pull. */
  glide: number | null;
  /** Wingsuit: close passes by a building, and the closest one in meters. */
  passes: number;
  closestM: number | null;
  area: Area;
  /** The roof you came down on: a marked pad's name, or a plain description. */
  roof: string | null;
  /** Meters from the center of the pad's target, on a marked roof. */
  padM: number | null;
  /** Standing somewhere tall enough, with an open edge, to BASE jump from. */
  canBase: boolean;
  /** BASE: the roof you left, and seconds from the exit to the pull. */
  from: string | null;
  delayS: number | null;
  distanceM: number;
  usedReserve: boolean;
  redLight: boolean;
  intoWind: boolean;
  hot: boolean;
  onBeach: boolean;
  log: string[];
  reason: string;
  score: JumpScore;
};

export type Save = {
  v: 1;
  bestM: number | null;
  bestScore: number | null;
  jumps: number;
  rides: number;
  altitudeFt: number;
  malPct: number;
  light: Light;
  ride: Ride;
  roof: PadId;
  suit: Suit;
};

export type Bridge = {
  /** Time of day; read once when the game mounts. */
  light: Light;
  altitudeFt: number;
  malChance: number;
  ride: Ride;
  roof: PadId;
  suit: Suit;
  muted: boolean;
  /** Start from the menu, back to the menu, the same jump again, or BASE off the roof you landed on. */
  command: "start" | "again" | "retry" | "base" | null;
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
  mode: JumpMode;
  suit: Suit;
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
  /** Screen position of the base during formation freefall, or of a rooftop pad under canopy, 0..1 like the door marker. */
  baseU: number;
  baseV: number;
  baseVisible: boolean;
  baseLabel: string;
  dzRel: number;
  dzDist: number;
  /** DZ for the beach; LZ for the nearest open ground on a BASE jump. */
  dzLabel: string;
  dzVisible: boolean;
  outcome: Outcome | null;
  canopy: "none" | "main" | "reserve";
  needsLook: boolean;
  save: Pick<Save, "bestM" | "bestScore" | "jumps" | "rides">;
};

export function createBridge(): Bridge {
  return {
    light: "day",
    altitudeFt: 12500,
    malChance: 0.15,
    ride: "plane",
    roof: "southloop",
    suit: "rig",
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
