import * as THREE from "three";

// The ring challenge: a course of glowing hoops laid down the sky from the exit. Belly flyers
// fall through flat rings stacked a few seconds apart, each a little off from the last, so the
// game is looking down and tracking across to the next one. A wingsuit flies through upright
// gates laid along a glide that curls back around the drop zone. The next ring burns gold, the
// ones after it are cool white, and a ring you make flashes green and blows outward.

/** One hoop: its center, the way you fly through it, and its radius. */
export type RingSpec = { c: THREE.Vector3; n: THREE.Vector3; r: number };
export type RingKind = "flat" | "gate";

/** Belly flying: ring radius, and the drop between rings, about three and a half seconds. */
export const FLAT_R = 7.5;
export const FLAT_STEP_M = 190;
/** Wingsuit: gate radius, and the distance between gates along the course. */
export const GATE_R = 13;
export const GATE_STEP_M = 420;
/**
 * Gates are laid on this glide, well under the suit's best of about 2.6, so a flyer who banks
 * through every turn still arrives a little high and dives in.
 */
export const GATE_GLIDE = 2;
/** How many rings past the next one are lit. */
const LIT_AHEAD = 4;

/** A small seeded random generator (mulberry32), so jumping again flies the same course. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Flat rings straight down from `from`. The course drifts with the wind, the way a jumper does,
 * and eases toward `toward` (the drop zone), so the last ring leaves you near home. Each ring
 * sits 22 to 48 m across from the one before, and a little more as the course goes on.
 */
export function planFlat(o: {
  seed: number;
  from: THREE.Vector3;
  /** Drop from the exit to the first ring. */
  firstDrop: number;
  /** No ring below this height. */
  floorY: number;
  toward: { x: number; z: number };
  windX: number;
  windZ: number;
}): RingSpec[] {
  const rand = seeded(o.seed);
  const out: RingSpec[] = [];
  const y0 = o.from.y - o.firstDrop;
  if (y0 < o.floorY) return out;
  const count = Math.floor((y0 - o.floorY) / FLAT_STEP_M) + 1;
  const hx = o.toward.x - o.from.x;
  const hz = o.toward.z - o.from.z;
  const home = Math.hypot(hx, hz);
  let jx = 0;
  let jz = 0;
  for (let i = 0; i < count; i++) {
    const y = y0 - i * FLAT_STEP_M;
    // Seconds to get here at about 53 m/s, plus a couple to get up to speed.
    const t = 2 + (o.from.y - y) / 53;
    // Easing home at 6 m/s, stopping short of overhead.
    const k = home > 1 ? Math.min(6 * t, Math.max(0, home - 120)) / home : 0;
    if (i === 0) {
      const a = rand() * Math.PI * 2;
      const m = 6 + rand() * 6;
      jx = Math.cos(a) * m;
      jz = Math.sin(a) * m;
    } else {
      // Wander, but turn back toward the line once far off it.
      const off = Math.hypot(jx, jz);
      const a =
        off > 45 ? Math.atan2(-jz, -jx) + (rand() - 0.5) * Math.PI * 0.9 : rand() * Math.PI * 2;
      const m = 22 + rand() * 26 + Math.min(16, i * 2);
      jx += Math.cos(a) * m;
      jz += Math.sin(a) * m;
    }
    out.push({
      c: new THREE.Vector3(
        o.from.x + o.windX * t + hx * k + jx,
        y,
        o.from.z + o.windZ * t + hz * k + jz,
      ),
      n: new THREE.Vector3(0, -1, 0),
      r: FLAT_R,
    });
  }
  return out;
}

/**
 * Wingsuit gates ahead of `from` along `yaw` (0 is north, positive turns left). Each gate turns
 * the course up to about 20 degrees toward `toward`, so once it gets there it circles it.
 */
export function planGates(o: {
  seed: number;
  from: THREE.Vector3;
  yaw: number;
  floorY: number;
  toward: { x: number; z: number };
}): RingSpec[] {
  const rand = seeded(o.seed);
  const out: RingSpec[] = [];
  let x = o.from.x;
  let z = o.from.z;
  let y = o.from.y;
  let h = o.yaw;
  for (let i = 0; i < 40; i++) {
    const step = i === 0 ? GATE_STEP_M * 0.9 : GATE_STEP_M;
    if (i > 0) {
      const want = Math.atan2(-(o.toward.x - x), -(o.toward.z - z));
      h += THREE.MathUtils.clamp(wrap(want - h), -0.35, 0.35) + (rand() - 0.5) * 0.24;
    }
    x += -Math.sin(h) * step;
    z += -Math.cos(h) * step;
    y -= step / GATE_GLIDE + (i === 0 ? 45 : (rand() - 0.5) * 24);
    if (y < o.floorY) break;
    out.push({
      c: new THREE.Vector3(x, y, z),
      n: new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h)),
      r: GATE_R,
    });
  }
  return out;
}

const GOLD = new THREE.Color(1, 0.62, 0.12);
const COOL = new THREE.Color(0.62, 0.9, 1);
const GREEN = new THREE.Color(0.25, 1, 0.45);
const RED = new THREE.Color(1, 0.22, 0.18);

type Ring = {
  spec: RingSpec;
  group: THREE.Group;
  coreMat: THREE.MeshBasicMaterial;
  haloMat: THREE.MeshBasicMaterial;
  /** 0 ahead, 1 flown through, 2 missed, 3 dropped at the pull; and when it changed. */
  state: 0 | 1 | 2 | 3;
  at: number;
};

export type Course = {
  group: THREE.Group;
  /** Rings in the course; flown through; the next one's index; passes in a row. */
  total(): number;
  got(): number;
  index(): number;
  streak(): number;
  lay(specs: RingSpec[], kind: RingKind, time: number): void;
  clear(): void;
  /** Rings were laid for this jump. */
  laid(): boolean;
  /** The next ring, while there is one. */
  next(): RingSpec | null;
  /** Moving from a to b: through the next ring, past it, or neither yet. */
  cross(a: THREE.Vector3, b: THREE.Vector3, time: number): "pass" | "miss" | null;
  /** The jump is over for rings (the pull): the rest go out quietly. Returns how many were left. */
  close(time: number): number;
  /** Animates the rings; `eye` is the camera, so far rings can glow wider to stay in sight. */
  update(time: number, eye: THREE.Vector3): void;
  /** Sets the course as it stood at `time`, for a replay; Infinity puts it back as it ended. */
  rewind(time: number): void;
  dispose(): void;
};

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

export function createCourse(): Course {
  const group = new THREE.Group();
  group.name = "rings";
  // Ring and glow tubes, for each kind, shared by every ring.
  const geo = {
    flat: {
      core: new THREE.TorusGeometry(FLAT_R, 0.45, 10, 96),
      halo: new THREE.TorusGeometry(FLAT_R, 2, 8, 72),
    },
    gate: {
      core: new THREE.TorusGeometry(GATE_R, 0.6, 10, 96),
      halo: new THREE.TorusGeometry(GATE_R, 2.6, 8, 72),
    },
  };
  let rings: Ring[] = [];
  let idx = 0;
  let got = 0;
  let streak = 0;
  let laid = false;
  let layAt = 0;
  /** Every ring flown, missed or dropped, in order: which, how, its fade clock, and when. */
  const events: { i: number; state: 1 | 2 | 3; at: number; when: number }[] = [];

  function clear() {
    for (const r of rings) {
      group.remove(r.group);
      r.coreMat.dispose();
      r.haloMat.dispose();
    }
    rings = [];
    idx = 0;
    got = 0;
    streak = 0;
    laid = false;
    events.length = 0;
    group.visible = true;
  }

  function mark(i: number, state: 1 | 2 | 3, time: number, when = time) {
    const r = rings[i];
    if (!r) return;
    r.state = state;
    r.at = time;
    events.push({ i, state, at: time, when });
  }

  /** Where segment a→b crosses ring i's plane going through it, or null. Fills _p. */
  function through(i: number, a: THREE.Vector3, b: THREE.Vector3) {
    const r = rings[i];
    if (!r) return null;
    const { c, n } = r.spec;
    const da = _d.subVectors(a, c).dot(n);
    const db = _d.subVectors(b, c).dot(n);
    if (!(da < 0 && db >= 0)) return null;
    const u = da / (da - db);
    _p.lerpVectors(a, b, u);
    return _p.distanceTo(c) <= r.spec.r;
  }

  return {
    group,
    total: () => rings.length,
    got: () => got,
    index: () => idx,
    streak: () => streak,
    laid: () => laid,
    lay(specs, kind, time) {
      clear();
      laid = true;
      layAt = time;
      const g = geo[kind];
      for (const spec of specs) {
        const coreMat = new THREE.MeshBasicMaterial({
          color: COOL.clone(),
          transparent: true,
          toneMapped: false,
        });
        const haloMat = new THREE.MeshBasicMaterial({
          color: COOL.clone(),
          transparent: true,
          opacity: 0.1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const ring = new THREE.Group();
        ring.add(new THREE.Mesh(g.core, coreMat), new THREE.Mesh(g.halo, haloMat));
        ring.position.copy(spec.c);
        // A torus lies in its own XY plane: turn it to face the way you fly through.
        ring.lookAt(_d.copy(spec.c).add(spec.n));
        ring.visible = false;
        group.add(ring);
        rings.push({ spec, group: ring, coreMat, haloMat, state: 0, at: time });
      }
    },
    clear,
    next: () => rings[idx]?.spec ?? null,
    cross(a, b, time) {
      const r = rings[idx];
      if (!r) return null;
      const hit = through(idx, a, b);
      if (hit !== null) {
        mark(idx, hit ? 1 : 2, time);
        idx += 1;
        if (hit) {
          got += 1;
          streak += 1;
          return "pass";
        }
        streak = 0;
        return "miss";
      }
      // Cut the corner through the one after, or dropped well below a gate: this one is gone.
      const skip = through(idx + 1, a, b);
      if (skip !== null || b.y < r.spec.c.y - 150) {
        mark(idx, 2, time);
        idx += 1;
        streak = 0;
        if (skip) {
          mark(idx, 1, time);
          idx += 1;
          got += 1;
          streak = 1;
          return "pass";
        }
        if (skip === false) {
          mark(idx, 2, time);
          idx += 1;
        }
        return "miss";
      }
      return null;
    },
    close(time) {
      let n = 0;
      // Only the lit ones have anything to fade.
      for (let i = idx; i < rings.length; i++, n++)
        mark(i, 3, i - idx <= LIT_AHEAD ? time : time - 9, time);
      idx = rings.length;
      return n;
    },
    update(time, eye) {
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i]!;
        const age = time - r.at;
        if (r.state === 1) {
          // Made it: a green flash that blows outward and fades.
          const u = Math.min(1, age / 0.8);
          r.group.visible = u < 1;
          r.group.scale.setScalar(1 + u * 0.7);
          r.coreMat.color.copy(GREEN).multiplyScalar(3.2 * (1 - u));
          r.coreMat.opacity = 1 - u;
          r.haloMat.color.copy(GREEN);
          r.haloMat.opacity = 0.35 * (1 - u);
          continue;
        }
        if (r.state === 2 || r.state === 3) {
          // Missed: red, then gone. Dropped at the pull: the lights just go out.
          const u = Math.min(1, age / (r.state === 2 ? 1.1 : 0.8));
          const tint = r.state === 2 ? RED : COOL;
          r.group.visible = u < 1;
          r.group.scale.setScalar(1);
          r.coreMat.color.copy(tint).multiplyScalar(1.4);
          r.coreMat.opacity = 0.8 * (1 - u);
          r.haloMat.color.copy(tint);
          r.haloMat.opacity = 0.08 * (1 - u);
          continue;
        }
        const ahead = i - idx;
        r.group.visible = ahead <= LIT_AHEAD;
        if (!r.group.visible) continue;
        // Fade in as a course is laid, the far ones last.
        const fade = Math.min(1, Math.max(0, (age - ahead * 0.15) / 0.6));
        // A thin tube vanishes a couple of hundred meters off: far away the glow carries it.
        const far = THREE.MathUtils.smoothstep(r.spec.c.distanceTo(eye), 50, 230);
        r.group.scale.setScalar(1);
        if (ahead === 0) {
          const pulse = 0.5 + 0.5 * Math.sin(time * 5.5);
          r.coreMat.color.copy(GOLD).multiplyScalar(2.4 + pulse * 1.4);
          r.coreMat.opacity = fade;
          r.haloMat.color.copy(GOLD);
          r.haloMat.opacity = (0.14 + pulse * 0.08 + far * 0.5) * fade;
        } else {
          r.coreMat.color.copy(COOL).multiplyScalar(1.5);
          r.coreMat.opacity = (0.95 - ahead * 0.15) * fade;
          r.haloMat.color.copy(COOL);
          r.haloMat.opacity = (0.06 + far * 0.3) * (1 - ahead * 0.12) * fade;
        }
      }
    },
    rewind(time) {
      group.visible = time >= layAt;
      for (const r of rings) {
        r.state = 0;
        r.at = layAt;
      }
      idx = 0;
      for (const e of events) {
        if (e.when > time) break;
        const r = rings[e.i];
        if (!r) continue;
        r.state = e.state;
        r.at = e.at;
        idx = Math.max(idx, e.i + 1);
      }
    },
    dispose() {
      clear();
      geo.flat.core.dispose();
      geo.flat.halo.dispose();
      geo.gate.core.dispose();
      geo.gate.halo.dispose();
    },
  };
}
