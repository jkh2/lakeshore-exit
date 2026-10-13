import * as THREE from "three";
import { MIN_BASE_M, PADS, SHORE_X, type PadSpec } from "./constants";
import { OPEN_GROUND, geo } from "./skyline";
import type { Solids } from "./solids";
import type { Area } from "./types";

// Standing on the city: the marked rooftops, walking across a roof, and finding an edge to
// jump from. A roof's edge is jumpable where the drop below it is a clean fall to the street;
// where it is a lower roof a few floors down, it is a ledge to stay away from.

/** How wide a body is, for walls and for leaving an edge cleanly. */
export const BODY_R = 0.35;
/** Walk up a step this high, or down one this deep, without it being a fall. */
const STEP_UP = 0.6;
const STEP_DOWN = 1.2;

export type Pad = PadSpec & {
  x: number;
  z: number;
  /** Roof height at the mark. */
  y: number;
  /** Radius of the painted target. */
  r: number;
};

export type Pads = {
  list: Pad[];
  /** The marked pad on this roof near (x, z), if it is one. */
  at: (x: number, y: number, z: number) => Pad | null;
  update: (time: number) => void;
};

/** The roof (or street) under (x, z) for someone standing at height y, and whether a wall is in the way. */
export function floorAt(solids: Solids, x: number, z: number, y: number) {
  const wall = solids.blocked(x, y + STEP_UP, z, BODY_R, 1.7 - STEP_UP) !== null;
  const under = solids.top(x, z, y + STEP_UP);
  return { y: under ? under.y1 : 0, wall };
}

export type Step = {
  /** A step you can take, a wall, a lower roof too close below to jump to, or an edge to jump from. */
  kind: "ok" | "wall" | "ledge" | "edge";
  /** Where your feet end up on an ordinary step. */
  y: number;
  drop: number;
};

/** What stepping to (x, z) from height y would be. */
export function stepTo(solids: Solids, x: number, z: number, y: number): Step {
  const f = floorAt(solids, x, z, y);
  if (f.wall) return { kind: "wall", y, drop: 0 };
  const drop = y - f.y;
  if (drop <= STEP_DOWN) return { kind: "ok", y: f.y, drop };
  return { kind: drop >= MIN_BASE_M ? "edge" : "ledge", y, drop };
}

export type Ahead = {
  /** Still on the roof, a wall, a lower roof too close below, or an edge you can jump. */
  kind: "roof" | "wall" | "ledge" | "edge";
  dist: number;
  drop: number;
};

/** What walking from (x, y, z) along the unit direction (dx, dz) runs into within `max` meters. */
export function lookAhead(
  solids: Solids,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  max: number,
  step = 0.5,
): Ahead {
  let cy = y;
  for (let d = step; d <= max + 1e-6; d += step) {
    const s = stepTo(solids, x + dx * d, z + dz * d, cy);
    if (s.kind === "ok") cy = s.y;
    else if (s.kind === "edge") {
      // A setback a few steps wide is no landing: the fall is to whatever is beyond it.
      let drop = s.drop;
      for (let e = d + 0.5; e <= d + 4; e += 0.5)
        drop = Math.max(drop, cy - floorAt(solids, x + dx * e, z + dz * e, cy).y);
      return { kind: "edge", dist: d, drop };
    } else return { kind: s.kind, dist: d, drop: s.drop };
  }
  return { kind: "roof", dist: max, drop: 0 };
}

/** Whether there is an edge to jump from anywhere you can walk to on this roof. */
export function canBaseFrom(solids: Solids, x: number, y: number, z: number) {
  if (y < MIN_BASE_M) return false;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    if (lookAhead(solids, x, y, z, Math.cos(a), Math.sin(a), 120, 1).kind === "edge") return true;
  }
  return false;
}

/** The ground type at (x, z): lake, beach, a park lawn, or the streets. */
export function areaAt(x: number, z: number): Area {
  if (x > SHORE_X) return "water";
  if (x >= -8 && x <= SHORE_X + 6) return "beach";
  for (const r of OPEN_GROUND) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return "park";
  return "street";
}

/** The closest point of open ground (a park or the beach) to (x, z), for a BASE jumper's landing. */
export function nearestOpen(x: number, z: number, out: THREE.Vector3) {
  // The beach and lakefront lawns run the whole shore.
  let bx = THREE.MathUtils.clamp(x, 10, SHORE_X - 24);
  let bz = z;
  let best = Math.hypot(bx - x, bz - z);
  for (const r of OPEN_GROUND) {
    // Aim a little inside the lawn rather than at its very edge.
    const px = THREE.MathUtils.clamp(x, r.x0 + 20, r.x1 - 20);
    const pz = THREE.MathUtils.clamp(z, r.z0 + 20, r.z1 - 20);
    const d = Math.hypot(px - x, pz - z);
    if (d < best) [best, bx, bz] = [d, px, pz];
  }
  return out.set(bx, 0, bz);
}

/**
 * The marked rooftops: a target painted like the beach's, a dark square under it so it reads
 * from the sky, strobes at its corners, and a faint beam of light above it.
 */
export function createPads(
  scene: THREE.Scene,
  solids: Solids,
  opts: { onTop: (m: THREE.Material, k: number) => THREE.Material; night: boolean },
): Pads {
  const { onTop } = opts;
  const group = new THREE.Group();
  group.name = "pads";
  scene.add(group);
  const paint = (hex: string) =>
    onTop(new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide }), 4);
  const white = paint("#f4f7fa");
  const amber = paint("#f0a202");
  const red = paint("#e23d3d");
  const tar = onTop(new THREE.MeshStandardMaterial({ color: "#262c33", roughness: 0.95 }), 3);
  // Light that fades out as it rises: additive, so the vertex color is the brightness.
  const beamMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: opts.night ? 0.5 : 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beamGeo = new THREE.CylinderGeometry(0.9, 1.6, 160, 12, 4, true);
  const beamPos = beamGeo.getAttribute("position");
  const glow = new THREE.Color("#ffb347");
  const tint = new Float32Array(beamPos.count * 3);
  for (let i = 0; i < beamPos.count; i++) {
    const k = (1 - (beamPos.getY(i) + 80) / 160) ** 2;
    tint.set([glow.r * k, glow.g * k, glow.b * k], i * 3);
  }
  beamGeo.setAttribute("color", new THREE.BufferAttribute(tint, 3));
  const strobeGeo = new THREE.SphereGeometry(0.45, 10, 8);
  const strobes: { mesh: THREE.Mesh; phase: number }[] = [];

  const flat = (
    geom: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new THREE.Mesh(geom, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  const list: Pad[] = [];
  PADS.forEach((spec, n) => {
    const at = geo(spec.lat, spec.lon);
    const x = at.x + spec.dx;
    const z = at.z + spec.dz;
    const top = solids.top(x, z);
    const y = top ? top.y1 : spec.heightM;
    // The biggest circle on the roof around the mark, by probing outward until it falls off.
    let room = 3;
    for (let r = 3; r <= 20; r += 0.5) {
      let ok = true;
      for (let i = 0; i < 16 && ok; i++) {
        const a = (i / 16) * Math.PI * 2;
        const s = solids.top(x + Math.cos(a) * r, z + Math.sin(a) * r, y + 0.1);
        ok = !!s && Math.abs(s.y1 - y) < 0.1;
      }
      if (!ok) break;
      room = r;
    }
    const R = Math.min(14, room - 1.2);
    list.push({ ...spec, x, z, y, r: R });

    flat(new THREE.PlaneGeometry(2 * R + 3, 2 * R + 3), tar, x, y + 0.1, z);
    flat(new THREE.RingGeometry(R - 1, R, 48), white, x, y + 0.14, z);
    if (R > 8) flat(new THREE.RingGeometry(R * 0.55 - 0.7, R * 0.55, 40), amber, x, y + 0.14, z);
    flat(new THREE.RingGeometry(2.6, 3.3, 32), red, x, y + 0.14, z);
    flat(new THREE.CircleGeometry(1.2, 20), amber, x, y + 0.15, z);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(x, y + 80, z);
    group.add(beam);

    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const d = R + 0.9;
      const mesh = new THREE.Mesh(
        strobeGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 3.6), toneMapped: false }),
      );
      mesh.position.set(x + Math.cos(a) * d, y + 0.6, z + Math.sin(a) * d);
      group.add(mesh);
      strobes.push({ mesh, phase: n * 0.37 + i * 0.07 });
    }
  });

  return {
    list,
    at(x, y, z) {
      for (const p of list)
        if (Math.abs(p.y - y) < 0.5 && Math.hypot(p.x - x, p.z - z) < 40) return p;
      return null;
    },
    update(time) {
      // A double flash every second and a half, the way aircraft strobes go.
      for (const s of strobes) {
        const t = (time + s.phase) % 1.5;
        s.mesh.visible = t < 0.06 || (t > 0.16 && t < 0.22);
      }
    },
  };
}
