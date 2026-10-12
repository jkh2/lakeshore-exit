import * as THREE from "three";
import { createBody, EYE_UP, type Body, type BodyLook, type BodyPose } from "./body";
import { CANOPY_EYE_Y, createCanopy, togglePosition, type Canopy } from "./canopy";
import { DZ_X, DZ_Z, FT_PER_M, WIND_X, WIND_Z } from "./constants";
import type { ShadowCaster } from "./shadow";

// Two other jumpers leave the plane with the player, build a two-way base and leave a
// slot open for the player to dock on. At break-off they turn, track away, open their
// canopies and fly a pattern to the beach.

export const BREAKOFF_FT = 5500;
/** Base fall rate in m/s: between the player's arch (46) and neutral (53). */
export const BASE_FALL = 51;
/** Eye distance from the formation's center. */
const RADIUS = 0.72;
/** Freefall eye height above the physics point, as for the player's camera. */
const FREEFALL_EYE = 0.32;
const OPEN_DUR = 2.65;

type State = "freefall" | "track" | "deploying" | "canopy" | "down";

/** Suits and helmets for the two other jumpers; the cabin seats them in the same colors. */
export const LOOKS: BodyLook[] = [
  { suit: "#a3302b", suitDark: "#5e1b18", helmet: "#f1f3f5" },
  { suit: "#d8a31a", suitDark: "#6b5210", helmet: "#1b1e22" },
];
/** Nine cells of `base` with `accent` on the listed cells. */
const wing = (base: string, accent: string, cells: number[]) =>
  Array.from({ length: 9 }, (_, i) => (cells.includes(i) ? accent : base));
const WINGS = [wing("#1f6f45", "#f2f4f6", [1, 4, 7]), wing("#4b2d7f", "#f0c419", [2, 6])];
const PULL_FT = [4300, 4050];
/** Landing targets on the sand, clear of the tent and the parked vans by the DZ. */
const LAND_AT: [number, number][] = [
  [DZ_X - 18, DZ_Z - 40],
  [DZ_X - 12, DZ_Z + 36],
];

type Jumper = {
  body: Body;
  wing: Canopy;
  pose: BodyPose;
  /** Physics point, as for the player: the eye is FREEFALL_EYE above it in freefall, the feet under canopy. */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Velocity relative to the base while flying to the slot, so the base's own slowdown after exit carries over. */
  rel: THREE.Vector3;
  yaw: number;
  bank: number;
  brake: number;
  state: State;
  angle: number;
  linked: boolean;
  /** On final approach to the beach. */
  final: boolean;
  openT: number;
  stateT: number;
  pullFt: number;
  landX: number;
  landZ: number;
  frame: THREE.Matrix4;
  inv: THREE.Matrix4;
  left: THREE.Vector3;
  right: THREE.Vector3;
};

export type Formation = {
  /** The base leaves with the player: their exit point and velocity, the door's outward direction and their facing. */
  exit: (at: THREE.Vector3, vel: THREE.Vector3, out: THREE.Vector3, playerYaw: number) => void;
  update: (dt: number, time: number) => void;
  /** Poses the bodies and canopies for this frame. */
  draw: (dt: number, time: number) => void;
  /** True while the base is together in freefall with a slot open for the player. */
  active: () => boolean;
  /** True while the base is built and holding, so the player can dock. */
  ready: () => boolean;
  /** True once the jumpers have broken off. */
  broken: () => boolean;
  started: () => boolean;
  /** The player's slot as a world eye point. */
  slot: (out: THREE.Vector3) => THREE.Vector3;
  center: (out: THREE.Vector3) => THREE.Vector3;
  baseVel: THREE.Vector3;
  /** Yaw that faces the center from the player's slot. */
  slotYaw: () => number;
  setPlayerDocked: (docked: boolean) => void;
  /** World points the player's left and right hands hold while docked. */
  playerGrips: (left: THREE.Vector3, right: THREE.Vector3) => void;
  /** Horizontal distance to the nearest jumper still above the player's canopy height band. */
  nearest: (p: THREE.Vector3) => number;
  /** Adds each jumper in the sky or on the ground, for their shadows. */
  casters: (out: ShadowCaster[]) => void;
  reset: () => void;
  dispose: () => void;
};

function yawOf(x: number, z: number) {
  return Math.atan2(-x, -z);
}

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function smooth(t: number) {
  const u = THREE.MathUtils.clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

export function createFormation(scene: THREE.Scene): Formation {
  const center = new THREE.Vector3();
  const baseVel = new THREE.Vector3();
  let started = false;
  let broken = false;
  let playerAngle = 0;
  let playerDocked = false;

  const jumpers: Jumper[] = LOOKS.map((look, i) => {
    const body = createBody({ thirdPerson: true, look });
    const wing = createCanopy(WINGS[i] ?? WINGS[0]!);
    scene.add(body.group);
    scene.add(wing.group);
    body.group.visible = false;
    wing.group.visible = false;
    return {
      body,
      wing,
      pose: {
        mode: "hidden",
        forward: 0,
        turn: 0,
        leftHand: null,
        rightHand: null,
        gesture: null,
        gestureT: 0,
        walk: 0,
        flare: 0,
        air: 0,
        altFt: 0,
        time: 0,
        reaching: false,
        lean: 1,
        trackAmt: 0,
      },
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rel: new THREE.Vector3(),
      yaw: 0,
      bank: 0,
      brake: 0,
      state: "freefall" as State,
      angle: 0,
      linked: false,
      final: false,
      openT: 0,
      stateT: 0,
      pullFt: PULL_FT[i] ?? 4200,
      landX: LAND_AT[i]?.[0] ?? DZ_X,
      landZ: LAND_AT[i]?.[1] ?? DZ_Z,
      frame: new THREE.Matrix4(),
      inv: new THREE.Matrix4(),
      left: new THREE.Vector3(),
      right: new THREE.Vector3(),
    };
  });

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const gp = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const _e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);

  const dirOf = (out: THREE.Vector3, angle: number) => out.set(Math.cos(angle), 0, Math.sin(angle));
  const slotEye = (out: THREE.Vector3, angle: number) =>
    dirOf(out, angle).multiplyScalar(RADIUS).add(center);

  /** Where two neighbors in the ring hold each other: between them, a little inside the ring. */
  function grip(out: THREE.Vector3, a: number, b: number) {
    dirOf(out, a).add(dirOf(_c, b)).normalize();
    return out
      .multiplyScalar(RADIUS * 0.55)
      .add(center)
      .add(_c.set(0, -0.06, 0));
  }

  /** Assigns a grip point to the left or right hand of a jumper at `angle` facing the center. */
  function assign(
    angle: number,
    point: THREE.Vector3,
    left: THREE.Vector3,
    right: THREE.Vector3,
    has: [boolean, boolean],
  ) {
    // Facing the center, the right hand is on the side of decreasing angle.
    dirOf(_a, angle);
    const facing = _b.copy(_a).negate();
    const rightDir = _a.crossVectors(facing, THREE.Object3D.DEFAULT_UP);
    slotEye(_c, angle);
    const side = rightDir.dot(_c.subVectors(point, _c));
    if (side > 0) {
      right.copy(point);
      has[1] = true;
    } else {
      left.copy(point);
      has[0] = true;
    }
  }

  function jumperFrame(j: Jumper) {
    if (j.state === "freefall" || j.state === "track") {
      _a.copy(j.pos).y += FREEFALL_EYE;
      _e.set(-0.18, j.yaw, 0, "YXZ");
    } else if (j.state === "deploying") {
      const u = smooth(j.openT / OPEN_DUR);
      _a.copy(j.pos).y += THREE.MathUtils.lerp(FREEFALL_EYE, EYE_UP, u);
      _e.set(-0.18 * (1 - u), j.yaw, j.bank * 0.45 * u, "YXZ");
    } else {
      _a.copy(j.pos).y += EYE_UP;
      _e.set(0, j.yaw, j.state === "canopy" ? j.bank * 0.45 : 0, "YXZ");
    }
    _q.setFromEuler(_e);
    j.frame.compose(_a, _q, one);
    j.inv.copy(j.frame).invert();
  }

  function freefallStep(j: Jumper, dt: number) {
    slotEye(_a, j.angle);
    _a.y -= FREEFALL_EYE;
    const err = _b.subVectors(_a, j.pos);
    const dist = err.length();
    if (j.linked || dist < 0.25) {
      j.linked = true;
      // Aim short of the slot by this step's fall, which update() adds right after.
      j.pos.lerp(_a.addScaledVector(baseVel, -dt), 1 - Math.exp(-10 * dt));
      j.vel.copy(baseVel);
    } else {
      const h = Math.hypot(err.x, err.z);
      const gain = 1.3;
      const hx = h > 0 ? (err.x / h) * Math.min(h * gain, 7) : 0;
      const hz = h > 0 ? (err.z / h) * Math.min(h * gain, 7) : 0;
      const vy = THREE.MathUtils.clamp(err.y * gain, -7, 7);
      j.rel.lerp(_c.set(hx, vy, hz), 1 - Math.exp(-2.6 * dt));
      j.vel.copy(baseVel).add(j.rel);
    }
    const want = yawOf(center.x - j.pos.x, center.z - j.pos.z);
    j.yaw += wrap(want - j.yaw) * (1 - Math.exp(-3 * dt));
  }

  function canopyStep(j: Jumper, dt: number) {
    const alt = j.pos.y;
    // Turn final once the target is within a glide into the wind (about 1.15:1), with 30 m
    // allowed for the turn itself. A late turn lands short on the sand, not long in the lake.
    if (!j.final && (alt < 30 || alt * 1.15 <= j.landX - j.pos.x + 30)) j.final = true;
    let want: number;
    if (j.final) {
      // Final: face the lake, into the wind, with a small correction toward the target.
      want = yawOf(1, THREE.MathUtils.clamp((j.landZ - j.pos.z) * 0.01, -0.3, 0.3));
    } else {
      const hx = j.landX - 150 - j.pos.x;
      const hz = j.landZ - j.pos.z;
      want = Math.hypot(hx, hz) < 40 ? j.yaw + 0.8 : yawOf(hx, hz);
    }
    const turn = THREE.MathUtils.clamp(wrap(want - j.yaw), -0.7 * dt, 0.7 * dt);
    j.yaw += turn;
    j.bank += (-(turn / Math.max(dt, 1e-4)) * 0.7 - j.bank) * (1 - Math.exp(-4 * dt));
    const flare = alt < 12 ? 1 : 0;
    j.brake += (flare - j.brake) * (1 - Math.exp(-6 * dt));
    const fspd = 10.5 - j.brake * 6.2;
    let desc = 5.4 - j.brake * 3.15;
    if (flare && alt < 6) desc = Math.min(desc, 1.3);
    _c.set(-Math.sin(j.yaw) * fspd + WIND_X, -desc, -Math.cos(j.yaw) * fspd + WIND_Z);
    j.vel.lerp(_c, 1 - Math.exp(-2.5 * dt));
  }

  return {
    baseVel,
    exit(at, vel, out, playerYaw) {
      started = true;
      broken = false;
      playerDocked = false;
      // The base left just before the player: below and ahead along where they look as they go,
      // so flying straight on closes on the open slot. Never back into the plane.
      const ahead = _a.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
      if (ahead.dot(out) < 0.2) ahead.copy(out).setY(0).normalize();
      center.copy(at).addScaledVector(ahead, 10);
      center.y -= 6;
      baseVel.copy(vel);
      // Leave the open slot on the side facing the player.
      playerAngle = Math.atan2(at.z - center.z, at.x - center.x);
      jumpers.forEach((j, i) => {
        j.state = "freefall";
        j.angle = playerAngle + ((i + 1) * Math.PI * 2) / 3;
        j.linked = false;
        j.final = false;
        j.openT = 0;
        j.stateT = 0;
        j.brake = 0;
        j.bank = 0;
        slotEye(j.pos, j.angle);
        j.pos.y -= FREEFALL_EYE;
        // Start a few meters off the slot so the base visibly builds.
        j.pos.add(_b.set(i === 0 ? 2.2 : -1.8, i === 0 ? 1.4 : -1.1, i === 0 ? -1.6 : 2.4));
        j.vel.copy(baseVel);
        j.rel.set(0, 0, 0);
        j.yaw = playerYaw;
        j.body.group.visible = true;
        j.wing.group.visible = false;
        j.pose.gesture = null;
      });
    },
    update(dt, time) {
      if (!started) return;
      _c.set(WIND_X, -BASE_FALL, WIND_Z);
      baseVel.lerp(_c, 1 - Math.exp(-1.8 * dt));
      center.addScaledVector(baseVel, dt);
      if (!broken && center.y * FT_PER_M < BREAKOFF_FT) {
        broken = true;
        playerDocked = false;
        for (const j of jumpers) {
          if (j.state !== "freefall") continue;
          j.state = "track";
          j.stateT = 0;
          j.linked = false;
        }
      }
      for (const j of jumpers) {
        j.stateT += dt;
        if (j.state === "freefall") {
          freefallStep(j, dt);
        } else if (j.state === "track") {
          // Turn away from the center, then track: flat and fast across the sky.
          const away = yawOf(Math.cos(j.angle), Math.sin(j.angle));
          j.yaw += wrap(away - j.yaw) * (1 - Math.exp(-3.5 * dt));
          const go = smooth((j.stateT - 0.6) / 1.5);
          const spd = 17 * go;
          _c.set(
            -Math.sin(j.yaw) * spd + WIND_X,
            -THREE.MathUtils.lerp(BASE_FALL, 44, go),
            -Math.cos(j.yaw) * spd + WIND_Z,
          );
          j.vel.lerp(_c, 1 - Math.exp(-1.6 * dt));
          if (j.pos.y * FT_PER_M < j.pullFt) {
            j.state = "deploying";
            j.openT = 0;
            j.pose.gesture = "pull";
            j.pose.gestureT = 0;
          }
        } else if (j.state === "deploying") {
          j.openT += dt;
          const u = smooth(j.openT / OPEN_DUR);
          const fspd = THREE.MathUtils.lerp(6, 10.5, u);
          const desc = THREE.MathUtils.lerp(Math.min(Math.abs(j.vel.y), 55), 5.2, u);
          _c.set(-Math.sin(j.yaw) * fspd + WIND_X, -desc, -Math.cos(j.yaw) * fspd + WIND_Z);
          j.vel.lerp(_c, 1 - Math.exp(-3 * dt));
          if (j.openT >= OPEN_DUR) {
            j.state = "canopy";
            j.stateT = 0;
          }
        } else if (j.state === "canopy") {
          canopyStep(j, dt);
        }
        if (j.state !== "down") j.pos.addScaledVector(j.vel, dt);
        if (j.state === "canopy" && j.pos.y <= 0) {
          j.state = "down";
          j.stateT = 0;
          j.pos.y = 0;
          j.vel.set(0, 0, 0);
        }
        j.pose.time = time;
      }
    },
    draw(dt, time) {
      if (!started) return;
      const [a, b] = jumpers as [Jumper, Jumper];
      const together = a.linked && b.linked;
      for (const j of jumpers) {
        jumperFrame(j);
        const p = j.pose;
        p.leftHand = null;
        p.rightHand = null;
        p.time = time;
        p.air = j.vel.length();
        p.altFt = j.pos.y * FT_PER_M;
        p.reaching = false;
        p.trackAmt = 0;
        p.flare = 0;
        if (p.gesture) {
          p.gestureT += dt;
          if (p.gestureT > 1.1) p.gesture = null;
        }
        if (j.state === "freefall") {
          p.mode = "freefall";
          p.lean = 1;
          const has: [boolean, boolean] = [false, false];
          if (together) {
            const other = j === a ? b : a;
            assign(j.angle, grip(gp, j.angle, other.angle), left, right, has);
          }
          if (playerDocked && j.linked)
            assign(j.angle, grip(gp, j.angle, playerAngle), left, right, has);
          if (has[0]) p.leftHand = j.left.copy(left).applyMatrix4(j.inv);
          if (has[1]) p.rightHand = j.right.copy(right).applyMatrix4(j.inv);
        } else if (j.state === "track") {
          p.mode = "freefall";
          p.lean = 1;
          p.trackAmt = smooth((j.stateT - 0.4) / 1.2);
        } else if (j.state === "deploying") {
          const u = smooth(j.openT / OPEN_DUR);
          p.mode = j.openT > 0.9 ? "canopy" : "freefall";
          p.lean = 1 - u;
          p.reaching = true;
          if (p.mode === "canopy") {
            p.leftHand = togglePosition(j.left, -1, 0);
            p.rightHand = togglePosition(j.right, 1, 0);
            p.leftHand.y -= CANOPY_EYE_Y;
            p.rightHand.y -= CANOPY_EYE_Y;
          }
        } else if (j.state === "canopy") {
          p.mode = "canopy";
          p.lean = 0;
          p.flare = j.brake;
          p.leftHand = togglePosition(j.left, -1, j.brake);
          p.rightHand = togglePosition(j.right, 1, j.brake);
          p.leftHand.y -= CANOPY_EYE_Y;
          p.rightHand.y -= CANOPY_EYE_Y;
        } else {
          p.mode = "down";
          p.lean = 0;
        }
        j.body.update(j.frame, p, dt);

        const showWing =
          j.state === "canopy" ||
          (j.state === "deploying" && j.openT > 0.35) ||
          (j.state === "down" && j.stateT < 1.4);
        j.wing.group.visible = showWing;
        if (showWing) {
          const u =
            j.state === "deploying"
              ? smooth(THREE.MathUtils.clamp((j.openT - 0.3) / (OPEN_DUR * 0.8), 0.02, 1))
              : j.state === "down"
                ? 1 - smooth(j.stateT / 1.4) * 0.8
                : 1;
          j.wing.group.position.copy(j.pos);
          j.wing.group.position.y += EYE_UP - CANOPY_EYE_Y;
          j.wing.group.rotation.set(0, j.yaw, j.state === "canopy" ? j.bank * 0.45 : 0);
          j.wing.update(u, j.brake, j.brake);
        }
      }
    },
    active: () => started && !broken && jumpers.every((j) => j.state === "freefall"),
    ready: () => started && !broken && jumpers.every((j) => j.state === "freefall" && j.linked),
    broken: () => broken,
    started: () => started,
    slot: (out) => slotEye(out, playerAngle),
    center: (out) => out.copy(center),
    slotYaw: () => yawOf(-Math.cos(playerAngle), -Math.sin(playerAngle)),
    setPlayerDocked(docked) {
      playerDocked = docked;
    },
    playerGrips(left, right) {
      const has: [boolean, boolean] = [false, false];
      for (const j of jumpers)
        assign(playerAngle, grip(gp, playerAngle, j.angle), left, right, has);
    },
    nearest(p) {
      let best = Infinity;
      for (const j of jumpers) {
        if (j.state === "canopy" || j.state === "down") continue;
        if (Math.abs(j.pos.y - p.y) > 60) continue;
        best = Math.min(best, Math.hypot(j.pos.x - p.x, j.pos.z - p.z));
      }
      return best;
    },
    casters(out) {
      if (!started) return;
      for (const j of jumpers) {
        if (j.body.group.visible) out.push({ feet: j.pos, wing: j.wing.group });
      }
    },
    reset() {
      started = false;
      broken = false;
      playerDocked = false;
      for (const j of jumpers) {
        j.body.group.visible = false;
        j.wing.group.visible = false;
        j.pose.mode = "hidden";
      }
    },
    dispose() {
      for (const j of jumpers) {
        scene.remove(j.body.group, j.wing.group);
        j.body.dispose();
        j.wing.dispose();
      }
    },
  };
}
