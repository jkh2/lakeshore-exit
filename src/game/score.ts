import { PULL_NOW_FT } from "./constants";
import type { JumpScore, Outcome, ScoreItem } from "./types";

// Every jump is scored out of 100 on the things a coach would debrief: the exit, the dock,
// getting clear before the pull, pulling on time, and the landing. A malfunction costs nothing
// on its own; handling it well is just a jump that still lands. A BASE jump swaps the dock and
// separation for the delay: how long you dared to fall and still opened with room to spare.
// A wingsuit swaps them for the flight: how well the suit glided, how far it went from the
// plane, and off a building how close you dared to pass the towers. Off a helicopter or a
// balloon there is no formation and no wind to fly on at first: the dock and separation give
// way to how fast you got stable in the dead air, and how long a delay you took.

/** Pull at or above this for full marks: the altimeter's critical altitude minus a little track. */
const ON_TIME_FT = 4000;
/** Open at least this far from every other jumper. */
const CLEAR_M = 25;
/** BASE: open at or above this for a clean pull, and above the second for a low one. */
const BASE_CLEAN_FT = 500;
const BASE_LOW_FT = 300;
/** Wingsuit: points for each close pass by a building, up to the cap. */
const PASS_PTS = 5;
const PASS_CAP = 10;

export type JumpFacts = Pick<
  Outcome,
  | "kind"
  | "mode"
  | "ride"
  | "stableS"
  | "area"
  | "roof"
  | "padM"
  | "delayS"
  | "redLight"
  | "intoWind"
  | "hot"
  | "onBeach"
  | "distanceM"
  | "usedReserve"
  | "suit"
  | "flightM"
  | "glide"
  | "passes"
  | "closestM"
> & {
  /** Feet at the first dock, or null if the player never docked. */
  dockedFt: number | null;
  /** Feet at the main pull, or null if they never pulled. */
  pullFt: number | null;
  /** Meters to the nearest other jumper at the pull, if anyone else was in the sky. */
  sepM: number | null;
  /** BASE: ran off the edge rather than stepping off it. */
  running: boolean;
};

const ft = (v: number) => `${Math.round(v).toLocaleString("en-US")} ft`;
const meters = (d: number) => `${d < 10 ? d.toFixed(1) : Math.round(d)} m`;
const km = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);

/** Glide points: full marks at `top` or better, then down in four steps. */
function glidePts(g: number | null, max: number, top: number, step: number) {
  if (g === null) return 0;
  for (let i = 0; i < 4; i++) if (g >= top - step * i) return Math.round(max * (1 - i * 0.2));
  return Math.round(max * 0.2);
}

export function scoreJump(f: JumpFacts): JumpScore {
  const items: ScoreItem[] = [];
  const add = (label: string, pts: number, max: number, note: string) =>
    items.push({ label, pts, max, note });
  const base = f.mode === "base";
  const winged = f.suit === "wing";
  const glideNote = f.glide === null ? "The suit never flew" : `Glide ${f.glide.toFixed(1)}`;

  if (base) {
    add("Exit", f.running ? 10 : 6, 10, f.running ? "Ran off the edge" : "Stepped off");
    if (winged) {
      const pts = glidePts(f.glide, 15, 2.0, 0.4) + Math.min(PASS_CAP, f.passes * PASS_PTS);
      const passNote =
        f.passes > 0 && f.closestM !== null
          ? ` · ${f.passes} close pass${f.passes > 1 ? "es" : ""}, ${meters(f.closestM)}`
          : "";
      add("Flight", pts, 25, glideNote + passNote);
    } else if (f.pullFt === null || f.delayS === null) add("Delay", 0, 25, "Never pulled");
    else {
      const full = Math.min(25, Math.round(f.delayS * 6));
      const pts =
        f.pullFt >= BASE_CLEAN_FT ? full : f.pullFt >= BASE_LOW_FT ? Math.round(full / 2) : 0;
      add("Delay", pts, 25, `${f.delayS.toFixed(1)} s`);
    }
    if (f.pullFt === null) add("Pull", 0, 15, "Never pulled");
    else if (f.pullFt >= BASE_CLEAN_FT) add("Pull", 15, 15, `Clean · ${ft(f.pullFt)}`);
    else if (f.pullFt >= BASE_LOW_FT) add("Pull", 8, 15, `Low · ${ft(f.pullFt)}`);
    else add("Pull", 0, 15, `Too low · ${ft(f.pullFt)}`);
  } else {
    const hop = f.ride === "heli" || f.ride === "balloon";
    if (hop) {
      const note =
        f.ride === "balloon"
          ? "Over the rim"
          : f.redLight
            ? "Went before the pilot cleared you"
            : "Cleared by the pilot";
      add("Exit", f.redLight ? 0 : 10, 10, note);
    } else
      add(
        "Exit",
        f.redLight ? 0 : 10,
        10,
        f.redLight ? "Left on the red light" : "On the green light",
      );

    if (winged) {
      add("Glide", glidePts(f.glide, 20, 2.5, 0.35), 20, glideNote);
      const m = f.flightM ?? 0;
      const range = m >= 4000 ? 15 : m >= 3000 ? 12 : m >= 2000 ? 9 : m >= 1000 ? 5 : m > 0 ? 2 : 0;
      add("Range", range, 15, `${km(m)} flown`);
    } else if (hop) {
      const st = f.stableS;
      const steady = st === null ? 0 : st <= 4 ? 20 : st <= 6 ? 14 : st <= 9 ? 8 : 3;
      add(
        "Stability",
        steady,
        20,
        st === null ? "Never got stable" : `Stable in ${st.toFixed(1)} s`,
      );
      if (f.pullFt === null || f.delayS === null) add("Delay", 0, 15, "Never pulled");
      else if (f.pullFt < PULL_NOW_FT) add("Delay", 0, 15, `${f.delayS.toFixed(1)} s · pulled low`);
      else {
        const d = f.delayS;
        add(
          "Delay",
          d >= 20 ? 15 : d >= 12 ? 11 : d >= 6 ? 7 : 3,
          15,
          `${d.toFixed(1)} s of freefall`,
        );
      }
    } else {
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
    }

    if (f.pullFt === null) add("Pull", 0, 15, "Never pulled");
    else if (f.pullFt >= ON_TIME_FT) add("Pull", 15, 15, `On time · ${ft(f.pullFt)}`);
    else if (f.pullFt >= PULL_NOW_FT) add("Pull", 8, 15, `Late · ${ft(f.pullFt)}`);
    else add("Pull", 0, 15, `Low · ${ft(f.pullFt)}`);
  }

  const landed = f.kind === "landed";
  const water = f.kind === "water";
  const landingMax = base ? 15 : 10;
  add(
    "Heading",
    landed && f.intoWind ? landingMax : 0,
    landingMax,
    landed ? (f.intoWind ? "Into the wind" : "Downwind") : water ? "In the lake" : "—",
  );
  add(
    "Touchdown",
    landed && !f.hot ? landingMax : 0,
    landingMax,
    landed ? (f.hot ? "Hot and fast" : "Soft") : water ? "In the lake" : "—",
  );

  const d = f.distanceM;
  let acc = 0;
  let accNote = water ? "In the lake" : "—";
  if (landed && f.onBeach) {
    acc = d <= 2 ? 20 : d <= 5 ? 16 : d <= 16 ? 10 : d <= 40 ? 5 : 2;
    accNote = `${meters(d)} from the disc`;
  } else if (landed && f.area === "roof" && f.padM !== null) {
    // A marked roof is a target like the beach's, with less room around it.
    const p = f.padM;
    acc = p <= 2 ? 20 : p <= 5 ? 16 : p <= 10 ? 12 : 8;
    accNote = `${meters(p)} from the ${f.roof ?? "roof"} mark`;
  } else if (landed && base) {
    // Off a building, any clear patch of ground is a fine place to land.
    if (f.area === "park") [acc, accNote] = [15, "In the park"];
    else if (f.area === "roof") [acc, accNote] = [10, `On ${f.roof ?? "a rooftop"}`];
    else [acc, accNote] = [6, "In the street"];
  } else if (landed)
    accNote = f.area === "roof" ? `Off the beach · on ${f.roof ?? "a rooftop"}` : "Off the beach";
  add("Accuracy", acc, 20, accNote);

  // Going in scores nothing, whatever came before it.
  if (f.kind === "impact") for (const i of items) i.pts = 0;
  const max = items.reduce((s, i) => s + i.max, 0);
  const total = items.reduce((s, i) => s + i.pts, 0);
  const stars = total >= 85 ? 3 : total >= 65 ? 2 : total >= 40 ? 1 : 0;
  return { total, max, stars, items, newBest: false };
}
