import type { Area, JumpMode, Light, Outcome, Ride, Suit } from "./types";

// A logbook like a real skydiver's, and a license ladder modeled on the USPA's A to D. Each
// license is five goals, done in any order and on any jump; a license is yours once its goals
// and every license below it are done. Nothing in the game is locked behind one: they are a
// record of what you have done and a pointer to what to try next.

export type LicenseId = "A" | "B" | "C" | "D";

/** One line in the logbook. */
export type LogEntry = {
  /** Jump number, counting every exit. */
  n: number;
  /** When the jump ended, in ms since 1970. */
  at: number;
  ride: Ride;
  suit: Suit;
  mode: JumpMode;
  light: Light;
  exitFt: number | null;
  /** Seconds from the exit to the pull. */
  freefallS: number | null;
  pullFt: number | null;
  kind: Outcome["kind"];
  area: Area;
  /** BASE: the roof you jumped from. */
  from: string | null;
  /** A marked roof's name, or a plain description of another roof. */
  roof: string | null;
  /** Meters from the beach disc. */
  distM: number;
  /** Meters from a marked roof's target. */
  padM: number | null;
  score: number;
  stars: number;
  reserve: boolean;
};

/** What a goal is checked against: the jump that just ended, and the log so far. */
export type JumpDone = Pick<
  Outcome,
  | "kind"
  | "mode"
  | "ride"
  | "redLight"
  | "onBeach"
  | "intoWind"
  | "hot"
  | "distanceM"
  | "usedReserve"
  | "area"
  | "padM"
  | "flightM"
  | "closestM"
  | "rings"
> & {
  score: number;
  /** Jumps so far, this one included. */
  jumps: number;
  dockedFt: number | null;
  pullFt: number | null;
};

export type Goal = {
  id: string;
  license: LicenseId;
  title: string;
  test: (j: JumpDone) => boolean;
};

/** Goal ids, mapped to the jump number each was done on. */
export type GoalsDone = Record<string, number>;

/** The newest jumps kept in the log. */
export const LOG_MAX = 100;

export const LICENSES: { id: LicenseId; name: string; blurb: string }[] = [
  { id: "A", name: "A license", blurb: "Solo: leave on time, open high, land soft on the beach." },
  { id: "B", name: "B license", blurb: "Fly with others, land close, and handle a bad canopy." },
  { id: "C", name: "C license", blurb: "Off the towers, in the suit and through the rings." },
  { id: "D", name: "D license", blurb: "Precision: the disc, the rooftop marks and the towers." },
];

const alive = (j: JumpDone) => j.kind !== "impact";
const landed = (j: JumpDone) => j.kind === "landed";
const onDisc = (j: JumpDone, m: number) => landed(j) && j.onBeach && j.distanceM <= m;

export const GOALS: Goal[] = [
  { id: "a-jumps", license: "A", title: "Log 5 jumps", test: (j) => j.jumps >= 5 },
  {
    id: "a-green",
    license: "A",
    title: "Leave the plane on the green light",
    test: (j) => alive(j) && j.ride === "plane" && !j.redLight,
  },
  {
    id: "a-pull",
    license: "A",
    title: "Pull at or above 4,000 ft",
    test: (j) => alive(j) && j.mode === "skydive" && j.pullFt !== null && j.pullFt >= 4000,
  },
  { id: "a-beach", license: "A", title: "Land on the beach", test: (j) => landed(j) && j.onBeach },
  {
    id: "a-soft",
    license: "A",
    title: "Land soft and into the wind",
    test: (j) => landed(j) && j.intoWind && !j.hot,
  },

  { id: "b-jumps", license: "B", title: "Log 15 jumps", test: (j) => j.jumps >= 15 },
  {
    id: "b-dock",
    license: "B",
    title: "Dock on the formation",
    test: (j) => alive(j) && j.dockedFt !== null,
  },
  { id: "b-10m", license: "B", title: "Land within 10 m of the disc", test: (j) => onDisc(j, 10) },
  {
    id: "b-reserve",
    license: "B",
    title: "Cut away and land your reserve",
    test: (j) => landed(j) && j.usedReserve,
  },
  {
    id: "b-hop",
    license: "B",
    title: "Jump from the helicopter or the balloon",
    test: (j) => alive(j) && (j.ride === "heli" || j.ride === "balloon"),
  },

  { id: "c-jumps", license: "C", title: "Log 30 jumps", test: (j) => j.jumps >= 30 },
  { id: "c-3m", license: "C", title: "Land within 3 m of the disc", test: (j) => onDisc(j, 3) },
  {
    id: "c-base",
    license: "C",
    title: "BASE jump off a tower and land",
    test: (j) => landed(j) && j.mode === "base",
  },
  {
    id: "c-wing",
    license: "C",
    title: "Fly 2 km in the wingsuit",
    test: (j) => alive(j) && (j.flightM ?? 0) >= 2000,
  },
  {
    id: "c-rings",
    license: "C",
    title: "Fly through every ring on a course",
    test: (j) => alive(j) && !!j.rings && j.rings.total > 0 && j.rings.got === j.rings.total,
  },

  { id: "d-jumps", license: "D", title: "Log 60 jumps", test: (j) => j.jumps >= 60 },
  { id: "d-1m", license: "D", title: "Land within 1 m of the disc", test: (j) => onDisc(j, 1) },
  {
    id: "d-pad",
    license: "D",
    title: "Land within 3 m of a rooftop mark",
    test: (j) => landed(j) && j.area === "roof" && j.padM !== null && j.padM <= 3,
  },
  {
    id: "d-pass",
    license: "D",
    title: "Pass a tower within 10 m in the wingsuit",
    test: (j) => alive(j) && j.closestM !== null && j.closestM <= 10,
  },
  { id: "d-95", license: "D", title: "Score 95 or more", test: (j) => j.score >= 95 },
];

/** The highest license held: every goal of it and of each license below it done. */
export function licenseOf(done: GoalsDone): LicenseId | null {
  let held: LicenseId | null = null;
  for (const l of LICENSES) {
    if (!GOALS.every((g) => g.license !== l.id || done[g.id] !== undefined)) break;
    held = l.id;
  }
  return held;
}

/** The license being worked toward, and its goals still to do; null once D is held. */
export function nextLicense(done: GoalsDone): { id: LicenseId; todo: Goal[] } | null {
  const held = licenseOf(done);
  const next = LICENSES[held === null ? 0 : LICENSES.findIndex((l) => l.id === held) + 1];
  if (!next) return null;
  return {
    id: next.id,
    todo: GOALS.filter((g) => g.license === next.id && done[g.id] === undefined),
  };
}

/**
 * Checks a finished jump against every goal not yet done, marking the ones it meets with jump
 * number `n`. Returns those goals, and the license they completed, if any.
 */
export function award(done: GoalsDone, jump: JumpDone, n: number) {
  const before = licenseOf(done);
  const earned = GOALS.filter((g) => done[g.id] === undefined && g.test(jump));
  for (const g of earned) done[g.id] = n;
  const after = licenseOf(done);
  return { earned, licensed: after !== before ? after : null };
}

const RIDES: readonly string[] = ["plane", "heli", "balloon", "roof"];
const KINDS: readonly string[] = ["landed", "water", "impact"];
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown) => v === null || num(v);

/** The log from a save, keeping only well-formed entries, newest last. */
export function cleanLog(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is LogEntry => {
      if (!e || typeof e !== "object") return false;
      const x = e as Record<string, unknown>;
      return (
        num(x.n) &&
        num(x.at) &&
        RIDES.includes(x.ride as string) &&
        KINDS.includes(x.kind as string) &&
        num(x.distM) &&
        num(x.score) &&
        numOrNull(x.exitFt) &&
        numOrNull(x.freefallS) &&
        numOrNull(x.pullFt)
      );
    })
    .slice(-LOG_MAX);
}

/** The goals done, from a save, keeping only goals that still exist. */
export function cleanGoals(raw: unknown): GoalsDone {
  const out: GoalsDone = {};
  if (!raw || typeof raw !== "object") return out;
  const x = raw as Record<string, unknown>;
  for (const g of GOALS) {
    const v = x[g.id];
    if (num(v)) out[g.id] = v as number;
  }
  return out;
}
