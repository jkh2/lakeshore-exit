import * as THREE from "three";

// The wingsuit's flight model: lift and drag on the velocity through the air, with the lift
// tilted by the bank to turn. Coefficients are accelerations per (m/s)^2. Neutral is the best
// glide, about 2.6:1 at 48 m/s through the air (100 mph forward, under 40 mph down). A dive
// sheds lift for speed, and a flare buys lift with it: hold one and the suit climbs a little
// while the speed bleeds away.

type Coef = { lift: number; drag: number };
const NEUTRAL: Coef = { lift: 0.00397, drag: 0.00153 };
const DIVE: Coef = { lift: 0.0008, drag: 0.0011 };
const FLARE: Coef = { lift: 0.0062, drag: 0.0034 };
/** Before the suit fills it is a body falling to about 53 m/s. */
const BODY_DRAG = 9.81 / 53 ** 2;
/** Seconds after the exit for the suit to fill with air. */
export const WING_FILL_S = 1.6;
const MAX_BANK = 0.7;
/** Shoulder twist: a direct turn on top of the banked lift, so the suit answers the keys. */
const TWIST = 0.35;

export type Wing = {
  /** Seconds since the exit. */
  t: number;
  /** Radians, positive rolled left (turning left). */
  bank: number;
  /** -1 flare .. +1 dive, eased from the keys. */
  pitch: number;
  /** Where the suit points: the air track once it flies, before that where you face. */
  yaw: number;
};

export function createWing(yaw: number): Wing {
  return { t: 0, bank: 0, pitch: 0, yaw };
}

/** 0..1: how full of air the suit is. */
export function wingFill(w: Wing) {
  const u = THREE.MathUtils.clamp((w.t - 0.3) / WING_FILL_S, 0, 1);
  return u * u * (3 - 2 * u);
}

const air = new THREE.Vector3();
const dir = new THREE.Vector3();
const fwd = new THREE.Vector3();
const lift = new THREE.Vector3();
const side = new THREE.Vector3();

/**
 * One step of flight. `turn` is +1 for a left turn, `forward` +1 to dive and -1 to flare.
 * Changes `vel` in place.
 */
export function flyWing(
  w: Wing,
  vel: THREE.Vector3,
  windX: number,
  windZ: number,
  turn: number,
  forward: number,
  dt: number,
) {
  w.t += dt;
  const fill = wingFill(w);
  const ease = (rate: number) => 1 - Math.exp(-rate * dt);
  w.pitch += (THREE.MathUtils.clamp(forward, -1, 1) - w.pitch) * ease(3);
  w.bank += (THREE.MathUtils.clamp(turn, -1, 1) * MAX_BANK * fill - w.bank) * ease(2.5);

  air.set(vel.x - windX, vel.y, vel.z - windZ);
  const hv = Math.hypot(air.x, air.z);
  if (hv > 12 && fill > 0.5) {
    const d = Math.atan2(-air.x, -air.z) - w.yaw;
    w.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * ease(4);
  } else w.yaw += turn * 1.25 * (1 - fill) * dt;

  const p = w.pitch;
  const to = p >= 0 ? DIVE : FLARE;
  const k = Math.abs(p);
  const cl = (NEUTRAL.lift + (to.lift - NEUTRAL.lift) * k) * fill;
  const cd = BODY_DRAG + (NEUTRAL.drag + (to.drag - NEUTRAL.drag) * k - BODY_DRAG) * fill;

  const v = air.length();
  if (v > 0.5) {
    dir.copy(air).multiplyScalar(1 / v);
    // Diving steeply, the pilot holds the suit at a big angle to the airflow, where it lifts
    // hardest: that is how a start off a building turns a fall into flight in a few seconds.
    const steep = THREE.MathUtils.clamp((-dir.y - 0.45) / 0.45, 0, 1) * fill;
    // Lift is square to the airflow, toward "up" leaned a little toward where the suit points.
    // Falling straight down after a roof exit, that leaned up is what pulls you out of the dive.
    fwd.set(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
    lift.set(fwd.x * 0.6, 1, fwd.z * 0.6).normalize();
    lift.addScaledVector(dir, -dir.dot(lift));
    if (lift.lengthSq() < 1e-6) lift.copy(fwd);
    lift.normalize();
    side.crossVectors(dir, lift);
    lift.multiplyScalar(Math.cos(w.bank)).addScaledVector(side, -Math.sin(w.bank));
    const q = v * v;
    vel.addScaledVector(lift, cl * (1 + 3 * steep) * q * dt);
    vel.addScaledVector(dir, -cd * (1 + 0.6 * steep) * q * dt);
    // The suit's sides resist slipping sideways through the air, so it flies where it points.
    const slip = (air.x * Math.cos(w.yaw) - air.z * Math.sin(w.yaw)) * (1 - Math.exp(-1.5 * dt));
    vel.x -= Math.cos(w.yaw) * slip;
    vel.z += Math.sin(w.yaw) * slip;
  }
  vel.y -= 9.81 * dt;

  // Twisting the shoulders swings the track around without bleeding speed.
  const twist = turn * TWIST * fill * dt;
  if (twist !== 0) {
    const c = Math.cos(twist);
    const s = Math.sin(twist);
    const x = vel.x - windX;
    const z = vel.z - windZ;
    vel.x = windX + x * c + z * s;
    vel.z = windZ - x * s + z * c;
  }
  return fill;
}

/** The flight path's pitch: 0 level, negative descending. */
export function pathPitch(vel: THREE.Vector3, windX: number, windZ: number) {
  return Math.atan2(vel.y, Math.hypot(vel.x - windX, vel.z - windZ));
}
