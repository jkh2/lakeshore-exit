import * as THREE from "three";
import {
  CREW,
  CREW_AT,
  CREW_SIZE,
  JUMPER,
  JUMPER_AT,
  PLAYER,
  RIDES,
  phaseOf,
  type Tape,
} from "./tape";

// The replay's director: cuts a recorded jump into shots the way a jump video is edited. A
// camera on the plane's wing (or beside the helicopter's door, the balloon's basket, or on the
// roof) for the exit; a camera flyer around you in freefall, or chasing and flying past a
// wingsuit; slow motion as the canopy snaps open; a time-lapse of the canopy ride; and a camera
// on the ground for the landing. The tape knows the future, so a flyby camera can wait exactly
// where you are going to pass.

export type ShotKind =
  | "door"
  | "roof"
  | "chase"
  | "flyer"
  | "orbit"
  | "below"
  | "formation"
  | "ringsDown"
  | "wingChase"
  | "wingFront"
  | "flyby"
  | "opening"
  | "canopyFront"
  | "canopyWide"
  | "canopySide"
  | "landing"
  | "after";

export type Shot = { kind: ShotKind; from: number; to: number; speed: number; title: string };

const TITLES: Record<ShotKind, string> = {
  door: "EXIT",
  roof: "EXIT",
  chase: "FREEFALL",
  flyer: "FREEFALL",
  orbit: "FREEFALL",
  below: "FREEFALL",
  formation: "FORMATION",
  ringsDown: "RINGS",
  wingChase: "WINGSUIT",
  wingFront: "WINGSUIT",
  flyby: "FLYBY",
  opening: "OPENING",
  canopyFront: "UNDER CANOPY",
  canopyWide: "UNDER CANOPY",
  canopySide: "UNDER CANOPY",
  landing: "LANDING",
  after: "DOWN",
};

const FOV: Record<ShotKind, number> = {
  door: 70,
  roof: 66,
  chase: 62,
  flyer: 60,
  orbit: 60,
  below: 62,
  formation: 60,
  ringsDown: 66,
  wingChase: 60,
  wingFront: 58,
  flyby: 44,
  opening: 60,
  canopyFront: 58,
  canopyWide: 45,
  canopySide: 55,
  landing: 48,
  after: 55,
};

/**
 * Shots that keep a lens on you from one spot, zooming in while you are far: how much to frame,
 * across and up, in meters. A tall phone screen widens the lens to keep the whole canopy in.
 */
const FRAME_M: Partial<Record<ShotKind, readonly [number, number]>> = {
  flyby: [7, 7],
  landing: [11, 15],
};
/** The tightest zoom, in degrees of vertical field of view. */
const TELE = 6;
/** How far through a flyby you pass the lens. */
const FLYBY_AT = 0.55;
/** How close a camera flying with you may come to another jumper. */
const CREW_CLEAR_M = 3.2;

/** Where to watch each ride's exit from, in the ride's own frame, and what to look at. */
const MOUNTS: Record<"plane" | "heli", { cam: THREE.Vector3; look: THREE.Vector3 }> = {
  // Under the right wing, looking back at the open door.
  plane: { cam: new THREE.Vector3(4.2, 1.95, -0.7), look: new THREE.Vector3(1.22, 0.9, 0.95) },
  // Off the nose on the door side, looking back at the seat over the skid.
  heli: { cam: new THREE.Vector3(-2.7, 1.25, -2.2), look: new THREE.Vector3(-0.9, 0.7, 0.25) },
};

export type Director = {
  shots: Shot[];
  start: number;
  end: number;
  /** Tape time now. */
  time: () => number;
  shot: () => Shot;
  /** Playback speed now: above 1 is a time-lapse, below 1 slow motion. */
  speed: () => number;
  /** Moves the clock on by `dt` real seconds; false once the tape has run out. */
  advance: (dt: number) => boolean;
  /** Cuts straight to the next shot; false if this was the last. */
  next: () => boolean;
  /** Points the camera for frame `f`, the tape at time(). */
  aim: (f: Float32Array, camera: THREE.PerspectiveCamera, dt: number) => void;
};

export type DirectorOpts = {
  /** Moves `cam` toward `subject` until it is out of every building and above the ground. */
  clear: (cam: THREE.Vector3, subject: THREE.Vector3) => void;
  rings: boolean;
};

const AIR = new Set(["freefall", "deploying", "malfunction", "canopy", "down", "impact"]);
const A = PLAYER.at;
const UP = new THREE.Vector3(0, 1, 0);

/** Null if the tape has no exit on it: nothing to replay. */
export function createDirector(tape: Tape, opts: DirectorOpts): Director | null {
  const F = tape.frames;
  const iExit = F.findIndex((f) => AIR.has(phaseOf(f)));
  if (iExit < 0 || F.length < 10) return null;
  const at = (i: number) => F[i]![A.t]!;
  const first = (test: (f: Float32Array) => boolean) => {
    for (let i = iExit; i < F.length; i++) if (test(F[i]!)) return at(i);
    return null;
  };
  const start = at(0);
  const end = at(F.length - 1);
  const tExit = at(iExit);
  const tPull = first((f) => phaseOf(f) === "deploying" || phaseOf(f) === "malfunction");
  const tOpen = first((f) => phaseOf(f) === "canopy");
  const tLand = first((f) => phaseOf(f) === "down" || phaseOf(f) === "impact") ?? end;
  const impact = phaseOf(F[F.length - 1]!) === "impact";
  const ride = RIDES[F[iExit]![A.ride]!] ?? "roof";
  const winged = F.some((f) => f[A.wing]! > 0.5);
  // The formation load: from the exit until break-off.
  const crewFrom = first((f) => f[CREW_AT + CREW.at.started] === 1);
  const crewTo = first((f) => f[CREW_AT + CREW.at.broken] === 1) ?? tLand;

  const shots: Shot[] = [];
  let cursor = start;
  const cut = (kind: ShotKind, to: number, speed = 1, title = TITLES[kind]) => {
    to = Math.min(to, end);
    if (to - cursor < 0.4) return;
    shots.push({ kind, from: cursor, to, speed, title });
    cursor = to;
  };

  const freeEnd = Math.max(tExit + 1, (tPull ?? tLand) - 1.2);
  cut(ride === "roof" ? "roof" : "door", Math.min(tExit + 2.8, freeEnd));
  const cycle: ShotKind[] = winged
    ? ["wingChase", "flyby", "wingFront", "flyby"]
    : opts.rings
      ? ["ringsDown", "chase", "ringsDown", "orbit"]
      : ["chase", "flyer", "orbit", "below"];
  // A long freefall plays its middle a little fast.
  const fast = freeEnd - cursor > 26;
  for (let n = 0; freeEnd - cursor > 0.4; n++) {
    let kind = cycle[n % cycle.length]!;
    const inCrew = crewFrom !== null && cursor >= crewFrom && cursor < crewTo - 3;
    if (inCrew && !winged && n % 2 === 0) kind = "formation";
    // A flyby is over in a blink, so it always plays at real speed.
    const speed = n > 0 && fast && kind !== "flyby" ? 1.7 : 1;
    let to = cursor + (kind === "flyby" ? 4 : 6.5) * speed;
    if (freeEnd - to < 3 * speed) to = freeEnd;
    cut(
      kind,
      to,
      speed,
      kind === "ringsDown" || (opts.rings && kind === "wingChase")
        ? winged
          ? "GATES"
          : "RINGS"
        : undefined,
    );
  }

  if (tOpen !== null) {
    const approach = Math.max(tOpen + 2.4, tLand - 9);
    cut("opening", Math.min(tOpen + 2.4, approach));
    cut("canopyFront", Math.min(cursor + 6, approach));
    const wideEnd = approach - 5;
    // The long middle of the canopy ride goes by in about nine seconds.
    if (wideEnd - cursor > 8) cut("canopyWide", wideEnd, Math.max(2, (wideEnd - cursor) / 9));
    cut("canopySide", approach);
    cut("landing", impact ? tLand + 0.3 : tLand + 0.8, 1, impact ? "IMPACT" : undefined);
    if (!impact) cut("after", end);
  } else if (tPull !== null) cut("opening", tLand + 0.3, 1, impact ? "IMPACT" : undefined);
  else cut("chase", tLand + 0.3, 1, impact ? "IMPACT" : undefined);
  if (!shots.length) return null;
  const stop = shots[shots.length - 1]!.to;

  // Slow motion for the moments worth it: leaving, the opening shock and the touchdown.
  const slow: [number, number, number][] = [[tExit - 0.3, tExit + 1.2, 0.6]];
  if (tPull !== null) slow.push([tPull - 0.2, tPull + 2.6, 0.5]);
  if (tOpen !== null && !impact) slow.push([tLand - 1.6, tLand + 0.4, 0.5]);
  // And the instant a flyby passes the lens.
  for (const shot of shots) {
    if (shot.kind !== "flyby") continue;
    const pass = shot.from + (shot.to - shot.from) * FLYBY_AT;
    slow.push([pass - 0.35, pass + 0.5, 0.45]);
  }

  let t = start;
  let index = 0;
  let fresh = true;
  const shotNow = () => shots[index] ?? shots[shots.length - 1]!;
  const speedAt = (time: number) => {
    let s = shotNow().speed;
    for (const [a, b, k] of slow) if (time >= a && time <= b) s = Math.min(s, k);
    return s;
  };

  // Camera state between frames. The camera and where it looks are kept as offsets from you
  // and eased there, so a camera flying with you keeps up however fast you fall.
  const off = new THREE.Vector3();
  const lookOff = new THREE.Vector3();
  const cam = new THREE.Vector3();
  const look = new THREE.Vector3();
  const want = new THREE.Vector3();
  const aimAt = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const anchorLook = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const rideP = new THREE.Vector3();
  const rideQ = new THREE.Quaternion();
  const tmp = new THREE.Vector3();
  const fw = new THREE.Vector3();
  const subject = new THREE.Vector3();
  const exitP = new THREE.Vector3();
  const probe = new Float32Array(F[0]!.length);
  let yawS = 0;
  let spin = 0;
  let drop = 0;
  let free = 0;
  let lastT = start;
  let fovS = 60;

  /** Level heading `yaw` as a unit vector, and the one to its right. */
  const facing = (yaw: number) => {
    dir.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    side.set(-dir.z, 0, dir.x);
  };
  const posAt = (time: number, out: THREE.Vector3) =>
    out.fromArray(tape.sample(time, probe), A.pos);
  const velAt = (time: number, out: THREE.Vector3) =>
    out.fromArray(tape.sample(time, probe), A.vel);

  function bodyYaw() {
    // Where the body points, level; flat on its belly the frame's forward still leans that way.
    fw.set(0, 0, -1).applyQuaternion(q);
    if (Math.hypot(fw.x, fw.z) < 0.15) fw.set(v.x, 0, v.z);
    return Math.atan2(-fw.x, -fw.z);
  }
  function travelYaw(fallback: number) {
    return Math.hypot(v.x, v.z) > 3 ? Math.atan2(-v.x, -v.z) : fallback;
  }

  function begin(shot: Shot) {
    drop = 0;
    free = Math.max(0, -v.y);
    spin = Math.random() * Math.PI * 2;
    yawS = shot.kind.startsWith("wing") || shot.kind === "flyby" ? travelYaw(bodyYaw()) : bodyYaw();
    if (shot.kind === "door" || shot.kind === "roof") {
      // Where you will leave from, and which way.
      const exitAt = posAt(tExit, exitP);
      velAt(tExit + 0.4, tmp);
      const out = Math.hypot(tmp.x, tmp.z) > 0.5 ? Math.atan2(-tmp.x, -tmp.z) : yawS;
      facing(out);
      if (shot.kind === "roof") {
        // At the edge a few steps to one side, looking back along the roof: you come at the
        // lens and leap out past it.
        anchor
          .copy(exitAt)
          .addScaledVector(dir, -0.8)
          .addScaledVector(side, 3.2)
          .addScaledVector(UP, 1.2);
      } else if (ride === "balloon") {
        // Outside the basket, off to the side of where you go over the rim.
        rideP.fromArray(F[iExit]!, A.ridePos);
        anchor
          .copy(exitAt)
          .addScaledVector(side, 3)
          .addScaledVector(dir, -0.6)
          .add(tmp.set(0, 1.6, 0));
        // Kept in the basket's frame so it rides up with the balloon.
        anchor.sub(rideP);
        anchorLook
          .copy(exitAt)
          .sub(rideP)
          .add(tmp.set(0, 1.2, 0));
      }
    } else if (shot.kind === "flyby") {
      // Waiting beside the line, a little past halfway through the shot.
      const mid = shot.from + (shot.to - shot.from) * FLYBY_AT;
      posAt(mid, anchor);
      velAt(mid, tmp);
      facing(Math.atan2(-tmp.x, -tmp.z));
      const s = Math.random() < 0.5 ? -1 : 1;
      anchor
        .addScaledVector(side, 7 * s)
        .addScaledVector(dir, 4)
        .addScaledVector(UP, 2.2);
    } else if (shot.kind === "landing") {
      // On the ground past where you come down, so you fly in toward the lens.
      posAt(tLand, anchor);
      posAt(tLand - 5, tmp);
      tmp.subVectors(anchor, tmp);
      tmp.y = 0;
      facing(tmp.lengthSq() > 1 ? Math.atan2(-tmp.x, -tmp.z) : yawS);
      const s = Math.random() < 0.5 ? -1 : 1;
      anchor
        .addScaledVector(dir, impact ? 14 : 11)
        .addScaledVector(side, 6 * s)
        .addScaledVector(UP, 1.7);
    } else if (shot.kind === "after") {
      posAt(tLand, anchor);
    }
  }

  return {
    shots,
    start,
    end: stop,
    time: () => t,
    shot: shotNow,
    speed: () => speedAt(t),
    advance(dt) {
      t += dt * speedAt(t);
      while (index < shots.length && t >= shotNow().to) {
        index += 1;
        fresh = true;
      }
      return index < shots.length && t < stop;
    },
    next() {
      if (index + 1 >= shots.length) return false;
      index += 1;
      t = shotNow().from;
      fresh = true;
      return true;
    },
    aim(f, camera, dt) {
      const shot = shotNow();
      p.fromArray(f, A.pos);
      v.fromArray(f, A.vel);
      eye.fromArray(f, A.eye);
      q.fromArray(f, A.q);
      const dtTape = Math.max(0, t - lastT);
      lastT = t;
      if (fresh) begin(shot);
      // The body's middle: below the eyes in freefall, the chest under canopy.
      const phase = phaseOf(f);
      const hanging =
        phase === "canopy" ||
        phase === "down" ||
        phase === "aboard" ||
        phase === "cabin" ||
        phase === "roof";
      subject.copy(eye).addScaledVector(UP, hanging ? -0.5 : -0.15);
      const wingUp = f[A.canopy]! > 0.05 ? 2.2 * f[A.canopy]! : 0;
      const local = t - shot.from;
      let k = 6;
      let fixed = false;
      const yawNow =
        shot.kind.startsWith("wing") || shot.kind === "flyby" ? travelYaw(yawS) : bodyYaw();
      yawS +=
        Math.atan2(Math.sin(yawNow - yawS), Math.cos(yawNow - yawS)) *
        (1 - Math.exp(-2.2 * dt * shot.speed));
      facing(yawS);

      switch (shot.kind) {
        case "door":
        case "roof": {
          fixed = true;
          rideP.fromArray(f, A.ridePos);
          rideQ.fromArray(f, A.rideQ);
          if (shot.kind === "roof") {
            want.copy(anchor);
            aimAt.copy(subject);
            break;
          }
          let lookFrom: THREE.Vector3;
          if (ride === "plane" || ride === "heli") {
            const m = MOUNTS[ride];
            want.copy(m.cam).applyQuaternion(rideQ).add(rideP);
            lookFrom = aimAt.copy(m.look).applyQuaternion(rideQ).add(rideP);
          } else {
            want.copy(anchor).add(rideP);
            lookFrom = aimAt.copy(anchorLook).add(rideP);
          }
          // Watch the door until you go, then follow you away.
          const u = THREE.MathUtils.smoothstep(t, tExit - 0.2, tExit + 0.6);
          aimAt.copy(lookFrom).lerp(subject, u);
          break;
        }
        case "chase":
          want
            .copy(subject)
            .addScaledVector(dir, -4.2)
            .addScaledVector(UP, 2.6)
            .addScaledVector(side, 1);
          aimAt.copy(subject).addScaledVector(dir, 1.5);
          break;
        case "flyer":
          want
            .copy(subject)
            .addScaledVector(dir, 3.4)
            .addScaledVector(UP, 0.5)
            .addScaledVector(side, -0.9);
          aimAt.copy(subject);
          break;
        case "orbit": {
          const a = spin + local * 0.45;
          want.copy(subject).add(anchor.set(Math.cos(a) * 5.5, 1.6, Math.sin(a) * 5.5));
          aimAt.copy(subject);
          break;
        }
        case "below":
          want.copy(subject).addScaledVector(dir, 2).addScaledVector(UP, -8);
          aimAt.copy(subject);
          break;
        case "formation": {
          // Wide enough for the whole base, from the far side of it.
          anchor.fromArray(f, CREW_AT + CREW.at.center);
          aimAt.copy(anchor).lerp(subject, 0.4);
          tmp.subVectors(anchor, subject);
          tmp.y = 0;
          if (tmp.lengthSq() < 0.25) tmp.copy(dir);
          tmp.normalize();
          want
            .copy(anchor)
            .addScaledVector(tmp, 5)
            .add(anchorLook.set(-tmp.z, 0, tmp.x).multiplyScalar(4))
            .addScaledVector(UP, 3);
          break;
        }
        case "ringsDown":
          // Over your shoulder and down the column of rings below.
          want.copy(subject).addScaledVector(UP, 5.5).addScaledVector(dir, -2.2);
          aimAt.copy(subject).addScaledVector(UP, -14).addScaledVector(dir, 1.5);
          break;
        case "wingChase": {
          anchor.copy(v);
          if (anchor.lengthSq() < 1) anchor.copy(dir);
          anchor.normalize();
          want.copy(subject).addScaledVector(anchor, -6.5).addScaledVector(UP, 1.6);
          aimAt.copy(subject).addScaledVector(anchor, 25);
          k = 8;
          break;
        }
        case "wingFront":
          want
            .copy(subject)
            .addScaledVector(dir, 5)
            .addScaledVector(side, 2.5)
            .addScaledVector(UP, 1);
          aimAt.copy(subject);
          k = 8;
          break;
        case "flyby":
          fixed = true;
          want.copy(anchor);
          aimAt.copy(subject);
          break;
        case "opening": {
          // The camera flyer keeps falling as your canopy opens: you shoot up out of frame
          // and the wing blooms overhead.
          drop = Math.min(24, drop + Math.max(0, free - Math.max(0, -v.y)) * dtTape);
          const base = ride === "roof" && !winged;
          want
            .copy(p)
            .addScaledVector(dir, base ? 6 : 2.5)
            .addScaledVector(side, base ? 2 : 5)
            .addScaledVector(UP, 0.6 - drop);
          aimAt.copy(p).addScaledVector(UP, 0.5 + wingUp);
          k = 10;
          break;
        }
        case "canopyFront":
          want.copy(p).addScaledVector(dir, 7).addScaledVector(side, 2).addScaledVector(UP, 1.2);
          aimAt.copy(p).addScaledVector(UP, 2.3);
          break;
        case "canopyWide": {
          const a = spin + local * 0.06;
          want.copy(p).add(anchor.set(Math.cos(a) * 30, 11, Math.sin(a) * 30));
          aimAt.copy(p).addScaledVector(UP, 2);
          k = 3 * shot.speed;
          break;
        }
        case "canopySide":
          want.copy(p).addScaledVector(side, 9).addScaledVector(dir, 2).addScaledVector(UP, 0.5);
          aimAt.copy(p).addScaledVector(UP, 2).addScaledVector(dir, 1.5);
          break;
        case "landing":
          fixed = true;
          want.copy(anchor);
          aimAt.copy(subject).addScaledVector(UP, wingUp * 0.6);
          break;
        case "after": {
          fixed = true;
          const a = spin + local * 0.3;
          want.copy(anchor).add(anchorLook.set(Math.cos(a) * 6, 1.9, Math.sin(a) * 6));
          aimAt.copy(p).addScaledVector(UP, 1.2);
          break;
        }
      }
      if (!fixed && f[CREW_AT + CREW.at.started] === 1) {
        // A camera flying with you stands off from the other jumpers rather than through them.
        for (let i = 0; i < CREW_SIZE; i++) {
          tmp.fromArray(f, JUMPER_AT + i * JUMPER.size + JUMPER.at.pos);
          const d = want.distanceTo(tmp);
          if (d < CREW_CLEAR_M) want.sub(tmp).setLength(CREW_CLEAR_M).add(tmp);
        }
      }
      opts.clear(want, aimAt);
      const pace = dt * Math.max(1, shot.speed);
      // Offsets from your body, not the physics point, which stays put while you ride up.
      tmp.subVectors(want, subject);
      if (fresh || fixed) off.copy(tmp);
      else off.lerp(tmp, 1 - Math.exp(-k * pace));
      tmp.subVectors(aimAt, subject);
      if (fresh) lookOff.copy(tmp);
      else lookOff.lerp(tmp, 1 - Math.exp(-(fixed ? 7 : 10) * pace));
      cam.addVectors(subject, off);
      look.addVectors(subject, lookOff);
      camera.position.copy(cam);
      camera.up.copy(UP);
      camera.lookAt(look);
      // A lens on a fixed spot zooms in on you while you are far off and widens as you come by.
      // On a tall phone screen every shot opens up a little, so it isn't all sky and ground.
      let fov = FOV[shot.kind];
      if (camera.aspect < 1) {
        const tall = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.sqrt(camera.aspect);
        fov = Math.min(80, THREE.MathUtils.radToDeg(2 * Math.atan(tall)));
      }
      const frame = FRAME_M[shot.kind];
      if (frame) {
        const d = Math.max(1, cam.distanceTo(subject));
        const half = Math.max(frame[1] / 2 / d, frame[0] / 2 / d / camera.aspect);
        fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(half)), TELE, fov);
      }
      fovS = fresh ? fov : fovS + (fov - fovS) * (1 - Math.exp(-5 * pace));
      fresh = false;
      if (Math.abs(camera.fov - fovS) > 0.01) {
        camera.fov = fovS;
        camera.updateProjectionMatrix();
      }
    },
  };
}
