import type { Phase } from "./types";

// The jump on tape: a frame of everything needed to draw it again from outside, twenty times
// a second, from a few seconds before the exit until just after the landing. Each frame is a
// flat array of numbers laid out by field. Between two frames a field is eased by its kind: a
// straight blend, an angle the short way round, a quaternion, or a step that takes whichever
// frame is nearer (phases, modes and on/off flags).

export const REC_HZ = 20;
/** Before the exit only the last few seconds are kept: the walk to the door, not the ride up. */
export const PRE_EXIT_S = 4;
/** About twenty minutes of jump, far more than one can last, so a tape can't grow without end. */
const MAX_FRAMES = REC_HZ * 1200;

type Kind = "l" | "a" | "s" | "q";

function layout<K extends string>(fields: readonly (readonly [K, number, Kind])[]) {
  const at = {} as Record<K, number>;
  let kinds = "";
  for (const [name, n, kind] of fields) {
    at[name] = kinds.length;
    kinds += kind.repeat(n);
  }
  return { at, kinds, size: kinds.length };
}

/** You, your canopy and the ride you left. */
export const PLAYER = layout([
  ["t", 1, "l"],
  ["phase", 1, "s"],
  // The body, in the third-person eye frame that createBody({ thirdPerson }) takes.
  ["eye", 3, "l"],
  ["q", 4, "q"],
  ["mode", 1, "s"],
  ["lean", 1, "l"],
  ["track", 1, "l"],
  ["wing", 1, "l"],
  ["reach", 1, "s"],
  ["gesture", 1, "s"],
  ["gestureT", 1, "l"],
  ["forward", 1, "l"],
  ["turn", 1, "l"],
  ["flare", 1, "l"],
  ["air", 1, "l"],
  ["walk", 1, "l"],
  ["brakeL", 1, "l"],
  ["brakeR", 1, "l"],
  // 0 while packed away, else how open.
  ["canopy", 1, "l"],
  ["canopyPos", 3, "l"],
  ["canopyQ", 4, "q"],
  ["reserve", 1, "s"],
  ["streamer", 1, "s"],
  // The physics point and its velocity.
  ["pos", 3, "l"],
  ["vel", 3, "l"],
  // RIDES code, where it is, whether it is still in sight, and the balloon burner.
  ["ride", 1, "s"],
  ["ridePos", 3, "l"],
  ["rideQ", 4, "q"],
  ["rideOn", 1, "s"],
  ["burn", 1, "l"],
  // The other balloons, each x, y, z and a heading.
  ["fleet", 12, "l"],
]);

/** One of the two other jumpers on a formation load. */
export const JUMPER = layout([
  ["pos", 3, "l"],
  ["yaw", 1, "a"],
  ["bank", 1, "l"],
  ["brake", 1, "l"],
  ["state", 1, "s"],
  ["openT", 1, "l"],
  ["stateT", 1, "l"],
  ["linked", 1, "s"],
  ["gesture", 1, "s"],
  ["gestureT", 1, "l"],
]);

/** The formation as a whole. */
export const CREW = layout([
  ["started", 1, "s"],
  ["broken", 1, "s"],
  ["center", 3, "l"],
  ["angle", 1, "a"],
  ["docked", 1, "s"],
]);

export const CREW_SIZE = 2;
export const CREW_AT = PLAYER.size;
export const JUMPER_AT = CREW_AT + CREW.size;
const KINDS = PLAYER.kinds + CREW.kinds + JUMPER.kinds.repeat(CREW_SIZE);
export const FRAME_SIZE = KINDS.length;
for (let i = 0; i < KINDS.length; i++) {
  const run = KINDS.slice(i, i + 4);
  if (KINDS[i] === "q") {
    if (run !== "qqqq") throw new Error("tape: quaternions are four in a row");
    i += 3;
  }
}

export const PHASES: readonly Phase[] = [
  "menu",
  "cabin",
  "aboard",
  "roof",
  "freefall",
  "deploying",
  "malfunction",
  "canopy",
  "down",
  "impact",
];
export const MODES = ["hidden", "cabin", "seated", "perch", "freefall", "canopy", "down"] as const;
export const GESTURES = [null, "pull", "cutaway", "reserve"] as const;
export const RIDES = ["roof", "plane", "heli", "balloon"] as const;

/** Phase code from a frame. */
export const phaseOf = (f: Float32Array) => PHASES[f[PLAYER.at.phase]!] ?? "menu";

/** Blends frames a and b, u of the way from a, into out. */
export function mix(a: Float32Array, b: Float32Array, u: number, out: Float32Array) {
  for (let i = 0; i < KINDS.length; i++) {
    const k = KINDS[i];
    const x = a[i]!;
    const y = b[i]!;
    if (k === "l") out[i] = x + (y - x) * u;
    else if (k === "s") out[i] = u < 0.5 ? x : y;
    else if (k === "a") {
      const d = Math.atan2(Math.sin(y - x), Math.cos(y - x));
      out[i] = x + d * u;
    } else {
      // Normalized lerp, the short way round.
      const dot =
        a[i]! * b[i]! + a[i + 1]! * b[i + 1]! + a[i + 2]! * b[i + 2]! + a[i + 3]! * b[i + 3]!;
      const s = dot < 0 ? -1 : 1;
      let len = 0;
      for (let j = 0; j < 4; j++) {
        const v = a[i + j]! + (s * b[i + j]! - a[i + j]!) * u;
        out[i + j] = v;
        len += v * v;
      }
      len = Math.sqrt(len) || 1;
      for (let j = 0; j < 4; j++) out[i + j] = out[i + j]! / len;
      i += 3;
    }
  }
  return out;
}

export type Tape = {
  frames: Float32Array[];
  /** Sim time of t = 0 on the tape; frames hold time since then, which keeps it precise. */
  t0: number;
  /** Wipes the tape for a new jump starting at sim time `t0`. */
  reset: (t0: number) => void;
  /** Adds a frame; before the exit, frames older than PRE_EXIT_S fall off the front. */
  push: (f: Float32Array, preExit: boolean) => void;
  /** Index of the last frame at or before tape time t. */
  find: (t: number) => number;
  /** The tape at time t, blended between the frames either side. */
  sample: (t: number, out: Float32Array) => Float32Array;
  duration: () => number;
};

export function createTape(): Tape {
  const frames: Float32Array[] = [];
  const T = PLAYER.at.t;
  const tape: Tape = {
    frames,
    t0: 0,
    reset(t0) {
      frames.length = 0;
      tape.t0 = t0;
    },
    push(f, preExit) {
      frames.push(f);
      if (preExit) {
        while (frames.length > 2 && f[T]! - frames[0]![T]! > PRE_EXIT_S) frames.shift();
      }
      if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
    },
    find(t) {
      let lo = 0;
      let hi = frames.length - 1;
      if (hi < 0) return -1;
      if (t <= frames[0]![T]!) return 0;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (frames[mid]![T]! <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    sample(t, out) {
      const i = tape.find(t);
      const a = frames[Math.max(0, i)];
      if (!a) return out;
      const b = frames[i + 1];
      if (!b) {
        out.set(a);
        return out;
      }
      const span = b[T]! - a[T]!;
      return mix(a, b, span > 0 ? Math.min(1, Math.max(0, (t - a[T]!) / span)) : 0, out);
    },
    duration: () => (frames.length ? frames[frames.length - 1]![T]! - frames[0]![T]! : 0),
  };
  return tape;
}
