import { PULL_NOW_FT } from "./constants";
import type { JumpScore, Outcome, ScoreItem } from "./types";

// Every jump is scored out of 100 on the things a coach would debrief: the exit, the dock,
// getting clear before the pull, pulling on time, and the landing. A malfunction costs nothing
// on its own; handling it well is just a jump that still lands.

/** Pull at or above this for full marks: the altimeter's critical altitude minus a little track. */
const ON_TIME_FT = 4000;
/** Open at least this far from every other jumper. */
const CLEAR_M = 25;

export type JumpFacts = Pick<
  Outcome,
  "kind" | "redLight" | "intoWind" | "hot" | "onBeach" | "distanceM" | "usedReserve"
> & {
  /** Feet at the first dock, or null if the player never docked. */
  dockedFt: number | null;
  /** Feet at the main pull, or null if they never pulled. */
  pullFt: number | null;
  /** Meters to the nearest other jumper at the pull, if anyone else was in the sky. */
  sepM: number | null;
};

const ft = (v: number) => `${Math.round(v).toLocaleString("en-US")} ft`;

export function scoreJump(f: JumpFacts): JumpScore {
  const items: ScoreItem[] = [];
  const add = (label: string, pts: number, max: number, note: string) =>
    items.push({ label, pts, max, note });

  add("Exit", f.redLight ? 0 : 10, 10, f.redLight ? "Left on the red light" : "On the green light");

  add(
    "Dock",
    f.dockedFt !== null ? 20 : 0,
    20,
    f.dockedFt !== null ? `Docked at ${ft(f.dockedFt)}` : "Never docked on the base",
  );

  if (f.pullFt === null) add("Separation", 0, 15, "No pull");
  else if (f.sepM === null || f.sepM >= CLEAR_M)
    add(
      "Separation",
      15,
      15,
      f.sepM === null ? "Clear air" : `Clear air · ${Math.round(f.sepM)} m`,
    );
  else if (f.sepM >= 15) add("Separation", 6, 15, `Tight · ${Math.round(f.sepM)} m`);
  else add("Separation", 0, 15, `Opened ${Math.round(f.sepM)} m from a jumper`);

  if (f.pullFt === null) add("Pull", 0, 15, "Never pulled");
  else if (f.pullFt >= ON_TIME_FT) add("Pull", 15, 15, `On time · ${ft(f.pullFt)}`);
  else if (f.pullFt >= PULL_NOW_FT) add("Pull", 8, 15, `Late · ${ft(f.pullFt)}`);
  else add("Pull", 0, 15, `Low · ${ft(f.pullFt)}`);

  const landed = f.kind === "landed";
  const water = f.kind === "water";
  add(
    "Heading",
    landed && f.intoWind ? 10 : 0,
    10,
    landed ? (f.intoWind ? "Into the wind" : "Downwind") : water ? "In the lake" : "—",
  );
  add(
    "Touchdown",
    landed && !f.hot ? 10 : 0,
    10,
    landed ? (f.hot ? "Hot and fast" : "Soft") : water ? "In the lake" : "—",
  );

  const d = f.distanceM;
  let acc = 0;
  let accNote = water ? "In the lake" : "—";
  if (landed && f.onBeach) {
    acc = d <= 2 ? 20 : d <= 5 ? 16 : d <= 16 ? 10 : d <= 40 ? 5 : 2;
    accNote = `${d < 10 ? d.toFixed(1) : Math.round(d)} m from the disc`;
  } else if (landed) accNote = "Off the beach";
  add("Accuracy", acc, 20, accNote);

  // Going in scores nothing, whatever came before it.
  if (f.kind === "impact") for (const i of items) i.pts = 0;
  const max = items.reduce((s, i) => s + i.max, 0);
  const total = items.reduce((s, i) => s + i.pts, 0);
  const stars = total >= 85 ? 3 : total >= 65 ? 2 : total >= 40 ? 1 : 0;
  return { total, max, stars, items, newBest: false };
}
